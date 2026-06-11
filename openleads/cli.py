"""
Command-line interface.

Finding:   ``find`` · ``sources`` · ``verify`` · ``cache``
Outreach:  ``write`` · ``send`` · ``run`` (find→verify→write→send) · ``inbox``
Manage:    ``config`` · ``doctor`` · ``crm`` · ``web`` · ``chat``

Running ``openleads`` with no arguments launches the chat REPL. Free-text queries
are parsed by the rule-based intent parser; explicit flags always override.
Sending is dry-run by default — add ``--live`` to actually send.
"""
from __future__ import annotations

import argparse
import csv
import sys

from openleads import __version__, intent, ui, writers
from openleads.cache.store import Cache
from openleads.db import DB
from openleads.engine import build_leads
from openleads.models import Query
from openleads.sources import get_source, list_sources


# --------------------------------------------------------------------------- #
# Query building                                                              #
# --------------------------------------------------------------------------- #
def _query_from_args(args) -> Query:
    text = " ".join(getattr(args, "query", []) or []).strip()
    q = intent.rule_parse(text) if text else Query()
    for attr in ("source", "industry", "location", "title", "keyword", "format", "out"):
        val = getattr(args, attr, None)
        if val is not None:
            setattr(q, "fmt" if attr == "format" else attr, val)
    if getattr(args, "count", None) is not None:
        q.count = args.count
    if getattr(args, "verified_only", False):
        q.verified_only = True
    if getattr(args, "deep", False):
        q.deep = True
    if getattr(args, "max_companies", None) is not None:
        q.max_companies = args.max_companies
    q.use_cache = not getattr(args, "no_cache", False)
    return q


def _read_leads_csv(path: str) -> list[dict]:
    """Read a leads CSV (as written by `find`) into lead dicts for drafting."""
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            email = (row.get("Email") or "").strip()
            if not email:
                continue
            out.append({
                "first_name": (row.get("First Name") or "").strip(),
                "last_name": (row.get("Last Name") or "").strip(),
                "email": email,
                "title": (row.get("Title") or "").strip(),
                "organization": (row.get("Organization Name") or row.get("Company") or "").strip(),
                "industry": (row.get("Industry") or "").strip(),
                "city": (row.get("City") or "").strip(),
                "country": (row.get("Country") or "").strip(),
                "linkedin_url": (row.get("LinkedIn Url") or "").strip(),
                "tier": (row.get("Email Tier") or "safe").strip(),
            })
    return out


# --------------------------------------------------------------------------- #
# Finding                                                                     #
# --------------------------------------------------------------------------- #
def cmd_find(args) -> int:
    q = _query_from_args(args)
    cache = Cache() if q.use_cache else None
    db = DB()
    print(ui.banner())
    print(f"  target: {q.count} leads · source: {q.source or 'auto'} · "
          f"deliverable-only: {'yes' if q.verified_only else 'no'} · "
          f"deep: {'yes' if q.deep else 'no'} · format: {q.fmt}")
    print("=" * 64)
    progress = {"n": 0}

    def on_progress(kind, payload):
        if kind == "phase":
            print(f"[engine] {payload}")
        elif kind == "lead":
            progress["n"] += 1
            print(ui.lead_line(payload, progress["n"], q.count))

    try:
        leads = build_leads(q, cache=cache, db=db, on_progress=on_progress)
    except ValueError as e:
        print(f"[!] {e}", file=sys.stderr)
        return 2
    finally:
        if cache:
            cache.close()
        db.close()

    if not leads:
        print("[!] No leads produced. Try without --verified-only or a broader query.")
        return 1
    print(ui.summary_line(leads))
    writers.write(leads, fmt=q.fmt, path=q.out)
    dest = q.out or ("leads.csv" if q.fmt == "csv" else "stdout")
    print(f"[output] wrote {len(leads)} leads -> {dest}")
    return 0


def cmd_sources(args) -> int:
    if args.subject and args.subject != "list":
        name = args.name or (args.subject if args.subject != "info" else None)
        src = get_source(name) if name else None
        if not src:
            print(f"[!] unknown source: {name}", file=sys.stderr)
            return 2
        info = src.info()
        print(f"{info.name}\n  kind:        {info.kind}\n  vertical:    {info.vertical}\n"
              f"  description: {info.description}")
        return 0
    print("Available sources (drop a .py in ~/.openleads/sources to add your own):\n")
    for info in list_sources():
        print(f"  {info.name:<12} [{info.kind:<7}] {info.vertical}")
        print(f"  {'':<12} {info.description}")
    return 0


def cmd_verify(args) -> int:
    from openleads.emails.resolve import verify_address
    cache = Cache()
    try:
        for email in args.emails:
            res = verify_address(email, cache=cache)
            tag = ui.TAGS.get(res.confidence, "  ?")
            print(f"{tag} {email:<34} {res.tier:<6} score {res.score:<3} "
                  f"{'· ' + res.reasons[0] if res.reasons else ''}")
    finally:
        cache.close()
    return 0


def cmd_cache(args) -> int:
    cache = Cache()
    try:
        if args.action == "clear":
            print(f"[cache] cleared {cache.clear()} entries")
        else:
            info = cache.info()
            print(f"[cache] {info['path']}")
            for ns, c in sorted(info["counts"].items()):
                print(f"  {ns:<10} {c}")
            if not info["counts"]:
                print("  (empty)")
    finally:
        cache.close()
    return 0


# --------------------------------------------------------------------------- #
# Outreach                                                                    #
# --------------------------------------------------------------------------- #
def _print_pipeline_summary(out: dict, live: bool) -> None:
    leads = out.get("leads", [])
    safe = sum(1 for ld in leads if ld.tier == "safe")
    drafts = out.get("drafts", [])
    results = out.get("results", [])
    sent = sum(1 for r in results if r.status == "sent")
    preview = sum(1 for r in results if r.status == "preview")
    skipped = sum(1 for r in results if r.status == "skipped")
    print("\n" + "=" * 56)
    print(f"  leads: {len(leads)}  ·  deliverable(safe): {safe}  ·  drafts: {len(drafts)}")
    if results:
        print(f"  {'SENT' if live else 'PREVIEW'}: {sent or preview}  ·  skipped: {skipped}")
    pf = out.get("preflight")
    if pf and pf.get("domain"):
        print(f"  sending-domain grade: {pf['grade']} ({pf['score']}/100)"
              + ("" if pf["ready"] else "  ← fix SPF/DKIM/DMARC for best inboxing"))
    wu = out.get("warmup")
    if wu:
        print(f"  warmup: day {wu['day']} · {wu['remaining']}/{wu['allowance']} left today")
    print("=" * 56)


def cmd_run(args) -> int:
    from openleads.automate import pipeline
    q = _query_from_args(args)
    q.verified_only = True  # the pipeline targets deliverable leads
    cache, db = Cache(), DB()
    live = bool(args.live)

    def on_progress(kind, payload):
        if kind == "phase":
            print(f"[run] {payload}")
        elif kind == "lead":
            print("  " + ui.lead_line(payload, 0, q.count))
        elif kind == "draft":
            print(f"  drafted → {payload.email}  «{payload.subject}»")
        elif kind == "send":
            print(f"  {payload.status:>7} → {payload.email}"
                  + (f" ({payload.detail})" if payload.detail else ""))

    print(ui.banner())
    print(f"  RUN: {q.count} leads · {'LIVE SEND' if live else 'dry-run preview'} "
          f"· deep: {'yes' if q.deep else 'no'}")
    print("=" * 64)
    try:
        out = pipeline.run(q, send=not args.no_send, dry_run=not live,
                           cache=cache, db=db, on_progress=on_progress)
    except ValueError as e:
        print(f"[!] {e}", file=sys.stderr)
        return 2
    finally:
        cache.close()
        db.close()
    _print_pipeline_summary(out, live)
    if not live and out.get("drafts"):
        print("\nReviewed the previews? Re-run with --live to actually send.")
    return 0


def cmd_write(args) -> int:
    from openleads.outreach import compose
    db = DB()
    try:
        if args.from_file:
            leads = _read_leads_csv(args.from_file)
        else:
            from openleads.automate import pipeline
            q = _query_from_args(args)
            q.verified_only = True
            cache = Cache()
            out = pipeline.run(q, send=False, cache=cache, db=db)
            cache.close()
            drafts = out["drafts"]
            return _emit_drafts(drafts, args)
        drafts = [compose.draft(ld) for ld in leads if ld.get("email")]
        return _emit_drafts(drafts, args)
    finally:
        db.close()


def _emit_drafts(drafts, args) -> int:
    if not drafts:
        print("[!] nothing to write — no deliverable leads found.")
        return 1
    for d in drafts:
        flag = "" if d.lint.get("ok") else f"  [spam-lint {d.lint.get('score')}!]"
        print(f"\n── {d.email} ─{flag}\nSubject: {d.subject}\n{d.body}")
    if args.out:
        import json
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump([d.to_dict() for d in drafts], f, indent=2)
        print(f"\n[output] wrote {len(drafts)} drafts -> {args.out}")
    return 0


def cmd_send(args) -> int:
    from openleads.automate import pipeline
    q = _query_from_args(args)
    q.verified_only = True
    cache, db = Cache(), DB()
    live = bool(args.live)
    try:
        out = pipeline.run(q, send=True, dry_run=not live, cache=cache, db=db,
                           on_progress=lambda k, p: None)
    finally:
        cache.close()
        db.close()
    _print_pipeline_summary(out, live)
    if not live:
        print("\nDry-run only. Re-run with --live to send for real.")
    return 0


def cmd_inbox(args) -> int:
    from openleads.outreach import inbox
    print("[inbox] scanning for replies & bounces…")
    summary = inbox.scan(days=args.days)
    if summary.get("error"):
        print(f"[!] {summary['error']}  (configure IMAP via `openleads config`)")
        return 2
    print(f"  scanned {summary['scanned']} · replied {summary['replied']} "
          f"· bounced {summary['bounced']}")
    return 0


# --------------------------------------------------------------------------- #
# Manage                                                                      #
# --------------------------------------------------------------------------- #
def cmd_crm(args) -> int:
    from openleads.automate import crm
    db = DB()
    try:
        if args.export:
            n = crm.export_csv(db, args.export, status=args.status)
            print(f"[crm] exported {n} leads -> {args.export}")
            return 0
        ov = crm.overview(db)
        print("CRM overview")
        print(f"  leads: {ov['total_leads']}  · sent: {ov['sent_total']} "
              f"(today {ov['sent_today']}) · suppressed: {ov['suppressed']}")
        for status, n in sorted(ov["by_status"].items()):
            print(f"    {status:<14} {n}")
        rows = crm.rows(db, status=args.status, limit=args.limit)
        if rows:
            print()
            for r in rows[:args.limit]:
                print(f"  {r['email']:<34} {r['tier']:<6} {r['status']:<12} {r['organization']}")
    finally:
        db.close()
    return 0


def cmd_config(args) -> int:
    from openleads import config_cmd
    return config_cmd.main(args)


def cmd_doctor(args) -> int:
    from openleads import doctor
    return doctor.run(args)


def cmd_web(args) -> int:
    try:
        from openleads.web.server import serve
    except ImportError as e:  # pragma: no cover
        print(f"[!] web app unavailable: {e}", file=sys.stderr)
        return 2
    return serve(port=args.port, open_browser=not args.no_open)


def cmd_chat(args) -> int:
    from openleads.chat import run
    return run()


def cmd_campaign(args) -> int:
    try:
        from openleads import campaign
    except ImportError as e:  # pragma: no cover
        print(f"[!] campaign needs the extra: pip install 'openleads[campaign]' ({e})",
              file=sys.stderr)
        return 2
    return campaign.main(args.rest)


# --------------------------------------------------------------------------- #
# Parser                                                                      #
# --------------------------------------------------------------------------- #
def _add_query_flags(p, with_output=True):
    p.add_argument("query", nargs="*", help='e.g. "50 fintech founders verified only"')
    p.add_argument("-s", "--source", help="source name (see `openleads sources`)")
    p.add_argument("-n", "--count", type=int, help="how many leads (default 20)")
    p.add_argument("--industry", help="industry/tag filter")
    p.add_argument("--location", help="location filter")
    p.add_argument("--title", help="title filter")
    p.add_argument("--keyword", help="free keyword / topic")
    p.add_argument("--verified-only", action="store_true",
                   help="keep only deliverable (safe-tier) leads")
    p.add_argument("--deep", action="store_true",
                   help="deeper ground-truth harvesting (slower, more accurate)")
    p.add_argument("--no-cache", action="store_true", help="bypass the cache")
    p.add_argument("--max-companies", type=int, help="scan budget")
    if with_output:
        p.add_argument("--format", choices=["csv", "json", "ndjson"], help="output format")
        p.add_argument("-o", "--out", help="output path ('-' for stdout)")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="openleads",
        description="Free, open-source Apollo alternative — find anyone, verify deliverably, and send.",
    )
    p.add_argument("--version", action="version", version=f"openleads {__version__}")
    sub = p.add_subparsers(dest="command")

    f = sub.add_parser("find", help="find + verify leads")
    _add_query_flags(f)
    f.set_defaults(func=cmd_find)

    r = sub.add_parser("run", help="find → verify → write → send (dry-run unless --live)")
    _add_query_flags(r, with_output=False)
    r.add_argument("--live", action="store_true", help="actually send (default: preview)")
    r.add_argument("--no-send", action="store_true", help="stop after drafting")
    r.set_defaults(func=cmd_run)

    w = sub.add_parser("write", help="draft personalized emails for leads")
    _add_query_flags(w, with_output=False)
    w.add_argument("--from", dest="from_file", help="draft from a leads CSV instead of searching")
    w.add_argument("-o", "--out", help="save drafts to a JSON file")
    w.set_defaults(func=cmd_write)

    sd = sub.add_parser("send", help="find → write → send (dry-run unless --live)")
    _add_query_flags(sd, with_output=False)
    sd.add_argument("--live", action="store_true", help="actually send (default: preview)")
    sd.set_defaults(func=cmd_send)

    s = sub.add_parser("sources", help="list/inspect available sources")
    s.add_argument("subject", nargs="?", help="'list' (default) or 'info'")
    s.add_argument("name", nargs="?", help="source name for 'info'")
    s.set_defaults(func=cmd_sources)

    v = sub.add_parser("verify", help="verify one or more concrete email addresses")
    v.add_argument("emails", nargs="+")
    v.set_defaults(func=cmd_verify)

    ib = sub.add_parser("inbox", help="scan IMAP for replies & bounces (optional)")
    ib.add_argument("--days", type=int, default=21, help="how far back to scan")
    ib.set_defaults(func=cmd_inbox)

    cr = sub.add_parser("crm", help="view/export your local CRM")
    cr.add_argument("--status", help="filter by status (new/sent/replied/bounced/…)")
    cr.add_argument("--limit", type=int, default=50)
    cr.add_argument("--export", help="export CRM to a CSV path")
    cr.set_defaults(func=cmd_crm)

    cfg = sub.add_parser("config", help="manage settings & secrets (interactive if no action)")
    cfg.add_argument("action", nargs="?", choices=["list", "get", "set", "unset"])
    cfg.add_argument("key", nargs="?")
    cfg.add_argument("value", nargs="?")
    cfg.set_defaults(func=cmd_config)

    dr = sub.add_parser("doctor", help="health-check finding + sending setup")
    dr.set_defaults(func=cmd_doctor)

    wb = sub.add_parser("web", help="launch the local web dashboard")
    wb.add_argument("--port", type=int, default=None, help="port (default 8787)")
    wb.add_argument("--no-open", action="store_true", help="don't open a browser")
    wb.set_defaults(func=cmd_web)

    c = sub.add_parser("cache", help="inspect or clear the cache")
    c.add_argument("action", nargs="?", choices=["info", "clear"], default="info")
    c.set_defaults(func=cmd_cache)

    ch = sub.add_parser("chat", help="launch the interactive chat REPL")
    ch.set_defaults(func=cmd_chat)

    cp = sub.add_parser("campaign", help="(v2) cold-email companion")
    cp.add_argument("rest", nargs=argparse.REMAINDER)
    cp.set_defaults(func=cmd_campaign)
    return p


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    if not argv:
        return cmd_chat(argparse.Namespace())  # bare `openleads` → chat
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
