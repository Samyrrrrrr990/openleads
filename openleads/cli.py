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
import re
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
    if getattr(args, "no_people", False):
        q.discover = False
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
    from openleads.emails import netcheck
    body = [
        ui.c("find", ui.WHITE, ui.BOLD) + ui.c(f"  {q.count} leads", ui.GREY),
        ui.status_line([
            ("source", q.source or "auto"),
            ("deliver", "safe only" if q.verified_only else "all tiers"),
            ("format", q.fmt),
        ]).strip(),
        ui.status_line([
            ("port 25", "open" if netcheck.port25_open() else "blocked → infra/ground-truth"),
            ("mode", "deep" if q.deep else "fast"),
        ]).strip(),
    ]
    print(ui.box(body, title="✦ openleads", width=64))
    progress = {"n": 0}

    def on_progress(kind, payload):
        if kind == "phase":
            print(ui.c(f"  ◆ {payload}", ui.FAINT))
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
    print(ui.c(f"  ↳ wrote {len(leads)} leads → {dest}\n", ui.GREY))
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
    print(ui.sources_block(list_sources()))
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


def cmd_enrich(args) -> int:
    """Enrich a CSV of people/companies into verified emails (Clay-style)."""
    from openleads import enrich
    cache, db = Cache(), DB()
    print(ui.c(f"  enrich  {args.file}", ui.WHITE, ui.BOLD))
    n = {"i": 0}

    def on_progress(kind, ld):
        if kind == "lead":
            n["i"] += 1
            print("  " + ui.lead_line(ld, n["i"], 0))
    try:
        leads = enrich.enrich_file(args.file, cache=cache, db=db, deep=args.deep,
                                   on_progress=on_progress)
    except FileNotFoundError:
        print(f"[!] no such file: {args.file}", file=sys.stderr)
        return 2
    finally:
        cache.close()
        db.close()
    safe = sum(1 for ld in leads if ld.tier == "safe")
    print(ui.rule())
    print(f"  enriched {len(leads)} rows · {safe} deliverable")
    out = args.out or "enriched.csv"
    writers.write(leads, fmt=("json" if out.endswith(".json") else "csv"), path=out)
    print(ui.c(f"  ↳ wrote {len(leads)} → {out}", ui.GREY))
    return 0


def cmd_export(args) -> int:
    """Export your CRM (or a leads CSV) to a sink: csv/json/ndjson/sheets/webhook/notion/airtable."""
    from openleads.automate import crm, exporters
    db = DB()
    try:
        if args.from_file:
            leads = _read_leads_csv(args.from_file)
        else:
            leads = crm.rows(db, status=args.status, limit=args.limit)
    finally:
        db.close()
    if not leads:
        print("[!] nothing to export (empty CRM — run a search first, or pass --from FILE)")
        return 1
    res = exporters.export(leads, sink=args.sink, target=args.target)
    if res.get("ok"):
        print(ui.c(f"  ✓ exported {res.get('count', len(leads))} leads → {args.sink}"
                   f" {res.get('target','')}", ui.GREY))
        if res.get("hint"):
            print(ui.c("  " + res["hint"], ui.FAINT))
        return 0
    print(f"[!] export failed: {res.get('error')}", file=sys.stderr)
    return 2


def cmd_recipe(args) -> int:
    """Manage saved automation recipes (ICP + message + schedule + export)."""
    from openleads.automate import recipes
    db = DB()
    try:
        action = (args.action or "list").lower()
        if action == "list":
            rows = recipes.list_recipes(db)
            if not rows:
                print("  no recipes yet — add one: openleads recipe add NAME \"agencies in Miami\"")
                return 0
            for r in rows:
                sched = (f"{r['send_hour']:02d}:{r['send_minute']:02d}"
                         if r.get("enabled") else "off")
                exp = f" → {r['export']['sink']}" if r.get("export") else ""
                print(f"  {r['name']:<16} {r['count']:>4}  {r['query'][:40]:<42} "
                      f"{'send' if r['send'] else 'find'} @ {sched}{exp}")
            return 0
        if action == "add":
            if not args.name or not args.query:
                print("  usage: openleads recipe add NAME \"audience query\" [--at HH:MM] "
                      "[--send] [--export SINK] [--context PITCH]", file=sys.stderr)
                return 2
            hour, minute = _parse_hhmm(args.at) if args.at else (9, 0)
            spec = {"query": " ".join(args.query), "count": args.count or 25,
                    "context": args.context or "", "send": bool(args.send),
                    "verified_only": not args.include_risky, "enabled": bool(args.at),
                    "send_hour": hour, "send_minute": minute,
                    "export": {"sink": args.export, "target": args.target or ""}
                    if args.export else None}
            recipes.save(args.name, spec, db=db)
            print(ui.c(f"  ✓ saved recipe '{args.name}'", ui.GREY))
            if args.at:
                print(ui.c(f"  scheduled {hour:02d}:{minute:02d} daily — run "
                           f"`openleads schedule --at {hour:02d}:{minute:02d}` to arm the device",
                           ui.FAINT))
            return 0
        if action in ("rm", "remove", "delete"):
            ok = recipes.delete(args.name, db=db)
            print(("  ✓ removed " if ok else "  ✗ no such recipe: ") + str(args.name))
            return 0 if ok else 1
        if action == "run":
            spec = recipes.get(args.name, db=db)
            if not spec:
                print(f"[!] no such recipe: {args.name}", file=sys.stderr)
                return 2
            live = bool(args.live)
            print(ui.c(f"  running recipe '{args.name}' — {'LIVE' if live else 'dry-run'}",
                       ui.WHITE, ui.BOLD))
            res = recipes.run(spec, db=db, dry_run=not live,
                              on_progress=lambda k, p: print(f"  ◆ {p}", file=sys.stderr)
                              if k == "phase" else None)
            print(ui.rule())
            print(f"  found {res['found']} · drafted {res['drafted']} · sent {res['sent']}")
            return 0
        print(f"[!] unknown recipe action: {action}", file=sys.stderr)
        return 2
    finally:
        db.close()


def cmd_watch(args) -> int:
    """Standing alerts: deliver only newly-matching leads on each run."""
    from openleads.automate import watch
    db = DB()
    try:
        action = (args.action or "list").lower()
        if action == "list":
            ws = watch.list_watchers(db)
            if not ws:
                print("  no watchers — add one: openleads watch add NAME \"new agencies in Miami\"")
                return 0
            for name, spec in ws.items():
                print(f"  {name:<16} {spec.get('query','')[:42]:<44} "
                      f"→ {spec.get('sink','csv')}  ({len(spec.get('seen', []))} seen)")
            return 0
        if action == "add":
            watch.save_watcher(db, args.name, " ".join(args.query or []),
                               sink=args.sink or "csv", target=args.target or "",
                               count=args.count or 25)
            print(ui.c(f"  ✓ watching '{args.name}'", ui.GREY))
            return 0
        if action in ("rm", "remove", "delete"):
            ok = watch.delete_watcher(db, args.name)
            print(("  ✓ removed " if ok else "  ✗ no such watcher: ") + str(args.name))
            return 0 if ok else 1
        if action == "run":
            live = bool(args.live)
            summary = watch.tick(db, dry_run=not live)
            print(f"  watchers: {summary['watchers_run']} · new leads: {summary['new_total']}"
                  + ("" if live else "  (dry-run — add --live to deliver)"))
            return 0
        print(f"[!] unknown watch action: {action}", file=sys.stderr)
        return 2
    finally:
        db.close()


def cmd_init(args) -> int:
    """Friendly first-run onboarding: identity, mailbox, a first search."""
    from openleads import settings
    from openleads.emails import netcheck
    print(ui.banner())
    print(ui.c("  Welcome to OpenLeads — let's get you set up. Press Enter to skip any step.\n",
               ui.GREY))

    def ask(prompt, key, secret=False):
        cur = settings.get(key)
        shown = settings.mask(cur) if (secret and cur) else (cur or "")
        suffix = f" [{shown}]" if shown else ""
        try:
            val = input(ui.c(f"  {prompt}{suffix}: ", ui.WHITE)).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if val:
            try:
                settings.set(key, val)
            except (KeyError, ValueError) as e:
                print(ui.c(f"    (skipped: {e})", ui.FAINT))

    ask("Your name (for the From header)", "sender_name")
    ask("What you're reaching out about (one line)", "sender_context")
    print(ui.c("\n  Mailbox (optional — needed only to send). App password, not your login.",
               ui.FAINT))
    ask("SMTP user (email)", "smtp_user")
    ask("SMTP app password", "smtp_pass", secret=True)
    print()
    port25 = "open" if netcheck.port25_open() else "blocked (engine compensates)"
    print(ui.status_line([("port 25", port25),
                          ("mailbox", settings.get("smtp_user") or "not set")]))
    print(ui.c("\n  Try it now:", ui.WHITE, ui.BOLD))
    print(ui.c("    openleads find \"marketing agencies in Miami\"", ui.GREY))
    print(ui.c("    openleads \"30 fintech founders, verified only\"   (chat)", ui.GREY))
    print(ui.c("    openleads web                                      (dashboard)\n", ui.GREY))
    return 0


def _parse_hhmm(text: str):
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?$", (text or "").strip())
    if not m:
        return 9, 0
    return int(m.group(1)), int(m.group(2) or 0)


def cmd_drip(args) -> int:
    """Run one drip cycle: fire due scheduled campaigns + sequence follow-ups."""
    from openleads.automate import scheduler
    live = bool(getattr(args, "live", False))
    print(ui.c(f"  drip — {'LIVE' if live else 'dry-run'}", ui.WHITE, ui.BOLD))

    def on_progress(kind, payload):
        if kind == "campaign":
            print(ui.c(f"  ◆ running campaign: {payload}", ui.FAINT))
        elif kind == "send":
            print(f"  {payload.status:>7} → {payload.email}")

    summary = scheduler.tick(dry_run=not live, on_progress=on_progress)
    print(ui.rule())
    print(f"  campaigns: {summary['campaigns_run']} · campaign sends: {summary['campaign_sent']}"
          f" · follow-ups due: {summary['due']} · sent: {summary['sent']}")
    if not live:
        print(ui.c("  dry-run — add --live to actually send", ui.FAINT))
    return 0


def cmd_schedule(args) -> int:
    """Install / remove / inspect on-device daily sending."""
    from openleads.automate import scheduler
    action = (args.action or "status").lower()
    if action in ("off", "remove", "uninstall", "stop"):
        res = scheduler.uninstall()
        print(("  ✓ " if res.get("ok") else "  ✗ ") + str(res.get("detail")))
        return 0 if res.get("ok") else 1
    if action == "status":
        st = scheduler.status()
        state = "installed" if st["installed"] else "not installed"
        print(f"  on-device automation: {state} ({st['kind']})")
        print(ui.c("  openleads schedule --at 09:00   to install", ui.FAINT))
        print(ui.c("  openleads schedule off          to remove", ui.FAINT))
        return 0
    # default: install at --at HH:MM (or the bare action if it's a time)
    at = args.at or (action if re.match(r"^\d{1,2}(:\d{2})?$", action) else "09:00")
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?$", at)
    if not m:
        print("  usage: openleads schedule --at HH:MM   (or: openleads schedule off)",
              file=sys.stderr)
        return 2
    hour, minute = int(m.group(1)), int(m.group(2) or 0)
    res = scheduler.install(hour, minute)
    print(("  ✓ " if res.get("ok") else "  ✗ ") + str(res.get("detail")))
    from openleads.automate.sendtime import SendPolicy, describe
    print(ui.c("  " + describe(SendPolicy()), ui.FAINT))
    return 0 if res.get("ok") else 1


def cmd_assistant(args) -> int:
    """One-shot natural-language campaign setup: 'send 50 emails to … at 9am'."""
    from openleads import assistant
    text = " ".join(args.text or []).strip()
    if not text:
        print("  usage: openleads assistant \"send 50 emails to fintech founders at 9am\"",
              file=sys.stderr)
        return 2
    act, mode = assistant.interpret(text)
    print(ui.c(f"  assistant ({mode}) — {act.summary()}", ui.WHITE))
    print(ui.rule())

    def on_progress(kind, payload):
        if kind == "lead":
            print("  " + ui.lead_line(payload, 0, act.count))

    result = assistant.execute(act, dry_run=True,
                               install_schedule=bool(getattr(args, "install", False)),
                               on_progress=on_progress)
    print(ui.rule())
    print("  " + str(result.get("message")))
    if result.get("drafts"):
        print(ui.c(f"  drafted {len(result['drafts'])} emails — previewed (dry-run).", ui.GREY))
    if act.send_hour is not None and not getattr(args, "install", False):
        print(ui.c(f"  add --install to schedule on-device daily at "
                   f"{act.send_hour:02d}:{act.send_minute:02d}", ui.FAINT))
    return 0 if result.get("ok") else 1


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
    p.add_argument("--no-people", action="store_true",
                   help="don't expand companies into people via team-page discovery")
    p.add_argument("--no-cache", action="store_true", help="bypass the cache")
    p.add_argument("--max-companies", type=int, help="scan budget")
    if with_output:
        p.add_argument("--format", choices=["csv", "json", "ndjson"], help="output format")
        p.add_argument("-o", "--out", help="output path ('-' for stdout)")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="openleads",
        description="Free, open-source Apollo alternative — one search box fans out across "
                    "public sources (local businesses, startups, companies, devs…), finds "
                    "the people, verifies emails, and automates outreach. Keyless, local, $0.",
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

    asst = sub.add_parser("assistant", help='one-shot NL setup ("send 50 emails to … at 9am")')
    asst.add_argument("text", nargs="*", help="what to do, in plain English")
    asst.add_argument("--install", action="store_true",
                      help="also install the on-device daily schedule")
    asst.set_defaults(func=cmd_assistant)

    sc = sub.add_parser("schedule", help="install/remove on-device daily sending")
    sc.add_argument("action", nargs="?", help="HH:MM to install · 'off' · 'status' (default)")
    sc.add_argument("--at", help="time to send daily, HH:MM (default 09:00)")
    sc.set_defaults(func=cmd_schedule)

    dp = sub.add_parser("drip", help="run one drip cycle (due campaigns + follow-ups)")
    dp.add_argument("--live", action="store_true", help="actually send (default: dry-run)")
    dp.set_defaults(func=cmd_drip)

    en = sub.add_parser("enrich", help="enrich a CSV of people/companies into verified emails")
    en.add_argument("file", help="path to a CSV with name/company/domain/email columns")
    en.add_argument("--deep", action="store_true", help="deeper ground-truth harvesting")
    en.add_argument("-o", "--out", help="output path (default enriched.csv)")
    en.set_defaults(func=cmd_enrich)

    ex = sub.add_parser("export", help="export your CRM to a sink")
    ex.add_argument("sink", choices=["csv", "json", "ndjson", "sheets", "webhook",
                                     "notion", "airtable"], help="where to send the leads")
    ex.add_argument("--target", help="file path or URL (sink-dependent)")
    ex.add_argument("--from", dest="from_file", help="export a leads CSV instead of the CRM")
    ex.add_argument("--status", help="CRM status filter (new/sent/replied/…)")
    ex.add_argument("--limit", type=int, default=1000)
    ex.set_defaults(func=cmd_export)

    rc = sub.add_parser("recipe", help="save/run automation recipes (ICP+message+schedule)")
    rc.add_argument("action", nargs="?", default="list",
                    help="list (default) · add · run · rm")
    rc.add_argument("name", nargs="?", help="recipe name")
    rc.add_argument("query", nargs="*", help='audience, e.g. "agencies in Miami"')
    rc.add_argument("--at", help="schedule time HH:MM (also enables the schedule)")
    rc.add_argument("-n", "--count", type=int, help="how many leads")
    rc.add_argument("--context", help="what to pitch (frames drafts)")
    rc.add_argument("--send", action="store_true", help="this recipe sends (not just finds)")
    rc.add_argument("--include-risky", action="store_true", help="also target risky-tier")
    rc.add_argument("--export", help="export sink to run after finding")
    rc.add_argument("--target", help="export target (path/URL)")
    rc.add_argument("--live", action="store_true", help="for `run`: actually send")
    rc.set_defaults(func=cmd_recipe)

    wt = sub.add_parser("watch", help="standing alerts: deliver only new matching leads")
    wt.add_argument("action", nargs="?", default="list", help="list · add · run · rm")
    wt.add_argument("name", nargs="?", help="watcher name")
    wt.add_argument("query", nargs="*", help='what to watch for')
    wt.add_argument("--sink", help="export sink for new matches (default csv)")
    wt.add_argument("--target", help="export target (path/URL)")
    wt.add_argument("-n", "--count", type=int, help="how many to check per run")
    wt.add_argument("--live", action="store_true", help="for `run`: actually deliver")
    wt.set_defaults(func=cmd_watch)

    it = sub.add_parser("init", help="friendly first-run setup (identity, mailbox, first search)")
    it.set_defaults(func=cmd_init)

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
