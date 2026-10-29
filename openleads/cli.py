"""
Command-line interface.

``openleads --help`` groups the commands by purpose (see :data:`COMMAND_GROUPS`):
Find · Outreach · Automate · Workspace (:mod:`openleads.cli_workspace`) · Setup ·
Legacy. ``find`` keeps stdout clean for data: with ``--format json``/``ndjson`` or
``-o -`` every progress line goes to stderr.

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
from openleads.runreport import SearchReport
from openleads.sources import get_source, list_sources


# --------------------------------------------------------------------------- #
# Query building                                                              #
# --------------------------------------------------------------------------- #
def _query_from_args(args) -> Query:
    """Free text + flags → a validated Query (flags win; see intent.build_query)."""
    text = " ".join(getattr(args, "query", []) or []).strip()

    def flag(name):                 # store_true flags: only an explicit "on" overrides
        return True if getattr(args, name, False) else None

    return intent.build_query(
        text,
        source=getattr(args, "source", None), industry=getattr(args, "industry", None),
        location=getattr(args, "location", None), title=getattr(args, "title", None),
        keyword=getattr(args, "keyword", None), fmt=getattr(args, "format", None),
        out=getattr(args, "out", None), count=getattr(args, "count", None),
        verified_only=flag("verified_only"), deep=flag("deep"),
        no_people=flag("no_people"), no_company=flag("no_company"),
        max_companies=getattr(args, "max_companies", None),
        budget=getattr(args, "budget", None),
        seniority=getattr(args, "seniority", None) or None,
        department=getattr(args, "department", None) or None,
        use_cache=not getattr(args, "no_cache", False),
    )


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
def _leads_to_stdout(q: Query) -> bool:
    """True when the leads themselves are written to stdout (so UI must not be)."""
    return q.out == "-" or (q.out is None and q.fmt in ("json", "ndjson"))


def explain_plan(q: Query) -> list:
    """Lines describing how a query was understood and where it will search."""
    from openleads import federation
    shown = {k: v for k, v in (
        ("text", q.text), ("source", q.source or "auto"), ("count", q.count),
        ("location", q.location), ("keyword", q.keyword), ("industry", q.industry),
        ("title", q.title), ("verified_only", q.verified_only or None),
        ("seniority", ",".join(q.seniority) or None),
        ("department", ",".join(q.department) or None),
        ("budget", f"{q.budget}s" if q.budget else "no limit"),
        ("people", None if q.discover else "off"), ("deep", q.deep or None),
    ) if v not in (None, "")}
    lines = ["query    " + " · ".join(f"{k}={v!r}" if k == "text" else f"{k}={v}"
                                     for k, v in shown.items())]
    names = federation.plan(q)
    reasons = federation.plan_reasons(q, names)
    for i, name in enumerate(names):
        lines.append(("plan     " if i == 0 else "         ") + f"{name:<10} {reasons.get(name, '')}")
    return lines


def _report_lines(report) -> list:
    lines = [ui.c("  ◆ " + report.summary(), ui.FAINT)]
    lines += ["    " + ln for ln in report.status_lines()]
    for hint in report.hints():
        lines.append(ui.c("  → " + hint, ui.GREY))
    return lines


def cmd_find(args) -> int:
    q = _query_from_args(args)
    if q.fmt == "jsonl":
        q.fmt = "ndjson"
    to_stdout = _leads_to_stdout(q)
    quiet = bool(getattr(args, "quiet", False))
    explain = bool(getattr(args, "explain", False))
    # When the leads go to stdout (json/ndjson, or -o -), every UI line goes to
    # stderr so `openleads find … --format json | jq` gets clean JSON.
    out = sys.stderr if to_stdout else sys.stdout

    def say(text: str = "") -> None:
        if not quiet:
            print(text, file=out)

    if explain:
        for line in explain_plan(q):
            print(ui.c("  " + line, ui.GREY), file=out)
    if not quiet:
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
        say(ui.box(body, title="✦ openleads", width=64))
    progress = {"n": 0}

    def on_progress(kind, payload):
        if kind == "phase":
            say(ui.c(f"  ◆ {payload}", ui.FAINT))
        elif kind == "lead":
            progress["n"] += 1
            say(ui.lead_line(payload, progress["n"], q.count))

    report = SearchReport()
    cache = Cache() if q.use_cache else None
    db = DB()
    try:
        leads = build_leads(q, cache=cache, db=db, on_progress=on_progress, report=report)
    except ValueError as e:
        print(f"[!] {e}", file=sys.stderr)
        return 2
    finally:
        if cache:
            cache.close()
        db.close()

    if getattr(args, "report", None):
        import json as _json
        with open(args.report, "w", encoding="utf-8") as f:
            _json.dump(report.to_dict(), f, indent=2, default=str)
    # A short result always says why (per-source status + what to try), on stderr.
    if explain or len(leads) < q.count:
        stream = out if explain else sys.stderr
        for line in _report_lines(report):
            print(line, file=stream)

    if not leads:
        if to_stdout and q.fmt == "json":
            print("[]")                        # keep pipes valid; exit code still says "none"
        print("[!] No leads produced. Try without --verified-only or a broader query.",
              file=sys.stderr)
        return 1
    say(ui.summary_line(leads))
    writers.write(leads, fmt=q.fmt, path=q.out)
    dest = q.out or writers.DEFAULT_PATHS.get(q.fmt, "stdout")
    say(ui.c(f"  ↳ wrote {len(leads)} leads → {dest}\n", ui.GREY))
    return 0


def cmd_bench(args) -> int:
    """Run the live benchmark suite and print a scoreboard."""
    from openleads import bench
    queries = [" ".join(args.query)] if args.query else None
    repeat = max(1, getattr(args, "repeat", 1) or 1)
    print(ui.c(f"  live benchmark · {len(queries or bench.SUITE)} queries · "
               f"{args.count} leads each · {args.budget}s budget each"
               + (f" · {repeat} runs each (median shown)" if repeat > 1 else "") + "\n",
               ui.FAINT))

    def on_result(s):
        flag = ui.c("  ✗ " + s.error, ui.RED) if s.error else (
            ui.c("  · " + s.problem, ui.FAINT) if s.problem else "")
        spread = (f" [{s.leads_range[0]}–{s.leads_range[2]}]"
                  if repeat > 1 and s.leads_range else "")
        print(f"  {s.query[:34]:<34} {s.leads:>3} leads{spread}  {s.people:>3} people  "
              f"{s.found + s.pattern:>3} evidence  {s.junk_names:>2} junk  {s.seconds:>5}s{flag}")

    cache = None if args.no_cache else Cache()
    db = DB()     # pattern learning on, exactly like `openleads find`
    try:
        rep = bench.run(queries, count=args.count, budget=args.budget, cache=cache, db=db,
                        on_result=on_result, repeat=repeat)
    finally:
        if cache:
            cache.close()
        db.close()
    t = rep["totals"]
    print(ui.rule())
    print(f"  fill {t['fill_rate']:.0%} · evidence {t['evidence_rate']:.0%} · "
          f"junk {t['junk_rate']:.0%} · median {t['median_seconds']}s")
    bench.save(rep, args.json, args.markdown)
    return 0


def cmd_company(args) -> int:
    """Look up one company: profile, tech stack, socials, phones, and its people."""
    import json as _json

    from openleads.discover.people import find_people
    from openleads.insights.company import fetch_profile
    from openleads.insights.phones import display
    from openleads.insights.techstack import by_category
    from openleads.insights.titles import classify, label_department, label_seniority
    domain = args.domain.lower().replace("https://", "").replace("http://", "").strip("/")
    cache = None if args.no_cache else Cache()
    try:
        prof = fetch_profile(domain, cache=cache, refresh=args.no_cache)
        people = [] if args.no_people else find_people(domain, cache=cache, limit=args.people)
    finally:
        if cache:
            cache.close()
    if args.json or getattr(args, "format", None) == "json":
        print(_json.dumps({"profile": prof, "people": people}, indent=2))
        return 0 if not prof.get("error") else 1
    if prof.get("error"):
        print(f"[!] {domain}: {prof['error']}", file=sys.stderr)
        return 1
    print(ui.box([ui.c(prof.get("name") or domain, ui.WHITE, ui.BOLD),
                  ui.c(prof.get("description") or "no description", ui.GREY)],
                 title=f"✦ {domain}", width=72))
    facts = [("industry", prof.get("industry")), ("size", prof.get("size")),
             ("founded", prof.get("founded")),
             ("phone", ", ".join(display(p) for p in prof.get("phones") or [])),
             ("address", ", ".join(v for v in (prof.get("address") or {}).values()))]
    for k, v in facts:
        if v:
            print(f"  {ui.c(k.ljust(10), ui.FAINT)} {v}")
    for net, url in (prof.get("socials") or {}).items():
        print(f"  {ui.c(net.ljust(10), ui.FAINT)} {url}")
    grouped = by_category(prof.get("tech") or [])
    if grouped:
        print(ui.c("\n  tech stack", ui.WHITE, ui.BOLD))
        for cat, names in sorted(grouped.items()):
            print(f"  {ui.c(cat.ljust(22), ui.FAINT)} {', '.join(names)}")
    if people:
        print(ui.c("\n  people", ui.WHITE, ui.BOLD))
        for p in people:
            sen, dep = classify(p["title"])
            tag = " · ".join(x for x in (label_seniority(sen), label_department(dep)) if x)
            print(f"  {p['name']:<28} {p['title'][:34]:<34} {ui.c(tag, ui.FAINT)}")
    return 0


def cmd_mcp(args) -> int:
    """Run the MCP server on stdio (for Claude Desktop, Cursor, …)."""
    from openleads import mcp
    return mcp.serve()


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
    from openleads.models import evidence_of
    cache = Cache()
    results = []
    try:
        for email in args.emails:
            res = verify_address(email, cache=cache)
            if getattr(args, "json", False):
                results.append({"email": email, "tier": res.tier, "score": res.score,
                                "confidence_pct": res.confidence_pct,
                                "evidence": evidence_of(res.email, res.signals),
                                "reasons": res.reasons})
                continue
            tag = ui.TAGS.get(res.confidence, "  ?")
            print(f"{tag} {email:<34} {res.tier:<6} score {res.score:<3} "
                  f"{'· ' + res.reasons[0] if res.reasons else ''}")
    finally:
        cache.close()
    if getattr(args, "json", False):
        import json as _json
        print(_json.dumps(results, indent=2))
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
    except ValueError as e:             # e.g. an unknown source, like `run`
        print(f"[!] {e}", file=sys.stderr)
        return 2
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
                sched = recipes.describe_schedule(r)
                exp = f" → {r['export']['sink']}" if r.get("export") else ""
                print(f"  {r['name']:<16} {r['count']:>4}  {r['query'][:40]:<42} "
                      f"{'send' if r['send'] else 'find'} · {sched}{exp}")
            return 0
        if action == "add":
            if not args.name or not args.query:
                print("  usage: openleads recipe add NAME \"audience query\" [--every \"weekdays 9am\"] "
                      "[--send] [--export SINK] [--context PITCH]", file=sys.stderr)
                return 2
            hour, minute = _parse_hhmm(args.at) if args.at else (9, 0)
            every = getattr(args, "every", None)
            if every:
                from openleads.automate import schedule as schedmod
                try:
                    schedmod.parse(every)
                except schedmod.ScheduleError as e:
                    print(f"[!] {e}", file=sys.stderr)
                    return 2
            spec = {"query": " ".join(args.query), "count": args.count or 25,
                    "context": args.context or "", "send": bool(args.send),
                    "verified_only": not args.include_risky,
                    "enabled": bool(args.at or every),
                    "send_hour": hour, "send_minute": minute, "schedule": every,
                    "export": {"sink": args.export, "target": args.target or ""}
                    if args.export else None}
            recipes.save(args.name, spec, db=db)
            print(ui.c(f"  ✓ saved recipe '{args.name}'", ui.GREY))
            if args.at or every:
                when = recipes.describe_schedule(recipes.get(args.name, db=db) or {})
                print(ui.c(f"  scheduled {when} — run `openleads schedule on` once to arm "
                           "this device", ui.FAINT))
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
            if getattr(args, "every", None):
                from openleads.automate import schedule as schedmod
                try:
                    schedmod.parse(args.every)
                except schedmod.ScheduleError as e:
                    print(f"[!] {e}", file=sys.stderr)
                    return 2
            watch.save_watcher(db, args.name, " ".join(args.query or []),
                               sink=args.sink or "csv", target=args.target or "",
                               count=args.count or 25,
                               schedule=getattr(args, "every", None))
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
    print(f"  recipes: {summary['campaigns_run']} · recipe sends: {summary['campaign_sent']}"
          f" · watchers: {summary['watchers_run']} · follow-ups due: {summary['due']}"
          f" · sent: {summary['sent']}")
    seq = summary.get("sequences") or {}
    if seq.get("due"):
        verb = "sent" if live else "previewed"
        print(f"  sequences: {seq.get('due', 0)} due · {seq.get('sent', 0) or seq.get('previewed', 0)}"
              f" {verb} · {seq.get('tasks', 0)} tasks"
              + (f" · {seq['waiting_window']} waiting for the send window"
                 if seq.get("waiting_window") else ""))
    if summary.get("failed"):
        print(ui.c(f"  {summary['failed']} job(s) failed — see `openleads runs`", ui.RED))
    if not live:
        print(ui.c("  dry-run — add --live to actually send", ui.FAINT))
    return 0


def cmd_schedule(args) -> int:
    """Install / remove / inspect the on-device automation agent."""
    from openleads.automate import recipes, scheduler
    from openleads.automate import schedule as schedmod
    action = (args.action or "status").lower()
    if action in ("off", "remove", "uninstall", "stop"):
        res = scheduler.uninstall()
        print(("  ✓ " if res.get("ok") else "  ✗ ") + str(res.get("detail")))
        return 0 if res.get("ok") else 1
    if action == "status":
        st = scheduler.status()
        state = f"installed ({st.get('mode') or st['kind']})" if st["installed"] else "not installed"
        print(f"  on-device automation: {state} · {st['kind']}")
        db = DB()
        try:
            rows = [r for r in recipes.list_recipes(db) if r.get("enabled")]
        finally:
            db.close()
        from datetime import datetime
        now = datetime.now()
        for r in rows:
            try:
                sched = schedmod.from_spec(r)
            except schedmod.ScheduleError:
                sched = None
            nxt = sched.next(now) if sched else None
            when = nxt.strftime("%a %d %b %H:%M") if nxt else "—"
            print(f"  {r['name']:<16} {recipes.describe_schedule(r):<24} next: {when}")
        if not st["installed"]:
            print(ui.c("  openleads schedule on         install (wakes every 15 min, runs what's due)",
                       ui.FAINT))
        print(ui.c("  openleads schedule off        remove", ui.FAINT))
        return 0
    if action in ("on", "install", "start", "enable"):
        res = scheduler.install(every_minutes=args.every_minutes or scheduler.HEARTBEAT_MINUTES)
    else:
        # Legacy: a fixed daily time (`schedule 09:00` or `schedule --at 09:00`).
        at = args.at or action
        m = re.match(r"^(\d{1,2})(?::(\d{2}))?$", at)
        if not m:
            print("  usage: openleads schedule on | off | status | HH:MM", file=sys.stderr)
            return 2
        res = scheduler.install(int(m.group(1)), int(m.group(2) or 0))
    print(("  ✓ " if res.get("ok") else "  ✗ ") + str(res.get("detail")))
    from openleads.automate.sendtime import SendPolicy, describe
    print(ui.c("  " + describe(SendPolicy()), ui.FAINT))
    return 0 if res.get("ok") else 1


def cmd_runs(args) -> int:
    """Show the history of scheduled runs."""
    from openleads.automate import history
    rows = history.recent(args.limit)
    if not rows:
        print("  no runs yet — scheduled jobs log here once `openleads schedule on` is active")
        return 0
    for r in rows:
        mark = ui.c("✓", ui.GREEN) if r.get("ok") else ui.c("✗", ui.RED)
        det = r.get("error") or " · ".join(f"{k} {v}" for k, v in (r.get("detail") or {}).items()
                                           if k in ("found", "sent", "new", "due", "total"))
        print(f"  {mark} {r.get('at', ''):<19}  {r.get('kind', ''):<10} {r.get('name', ''):<16} "
              f"{r.get('seconds', 0):>6}s  {det}")
    return 0


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
    p.add_argument("--budget", type=int, metavar="SECONDS",
                   help="stop searching after this many seconds (default 90; 0 = no limit)")
    p.add_argument("--seniority", metavar="LIST",
                   help="keep only these seniorities, e.g. vp,director,head (see `openleads people --help`)")
    p.add_argument("--department", metavar="LIST",
                   help="keep only these departments, e.g. marketing,sales")
    p.add_argument("--no-company", action="store_true",
                   help="skip company profiles (tech stack, socials, phone) for speed")
    if with_output:
        p.add_argument("--format", choices=["csv", "json", "ndjson", "jsonl", "apollo", "hubspot"],
                       help="output format (json/ndjson go to stdout; apollo/hubspot: "
                            "CRM-ready CSV columns)")
        p.add_argument("-o", "--out", help="output path ('-' for stdout)")


# The top-level help lists commands by what they're for, not alphabetically.
QUICK_START = (
    ('openleads find "dentists in Austin"', "find people + verified emails"),
    ('openleads find "fintech founders" -n 25 -o leads.csv', "save them as a CSV"),
    ('openleads find "agencies in Miami" --format json | jq', "pipe clean JSON"),
    ("openleads web", "the local dashboard"),
    ("openleads", "chat: just type what you want"),
)
COMMAND_GROUPS = (
    ("Find", ("find", "company", "verify", "enrich", "sources")),
    ("Outreach", ("write", "run", "inbox", "drip")),
    ("Automate", ("recipe", "watch", "schedule", "runs", "assistant")),
    ("Workspace", ("people", "companies", "lists", "seq", "tasks", "deals", "import",
                   "export", "dedupe", "stats", "backup", "demo")),
    ("Setup", ("init", "config", "doctor", "cache", "web", "chat", "mcp", "bench")),
    ("Legacy", ("send", "crm", "campaign")),
)
_LEGACY_NOTES = {"send": "= run", "campaign": "v2"}


class _Registrar:
    """Wraps ``add_subparsers()`` so commands carry their one-line help into the
    grouped epilog instead of argparse's flat alphabetical list."""

    def __init__(self, sub) -> None:
        self._sub = sub
        self.help: dict = {}
        self.aliases: set = set()

    def add_parser(self, name, **kw):
        text = kw.pop("help", None)
        if text:
            self.help[name] = text
            kw.setdefault("description", text[:1].upper() + text[1:] + ".")
        self.aliases.update(kw.get("aliases", ()))
        return self._sub.add_parser(name, **kw)

    @property
    def choices(self) -> dict:
        return self._sub.choices


def _grouped_help(helps: dict) -> str:
    width = max(len(cmd) for cmd, _ in QUICK_START)
    lines = ["quick start:"]
    lines += [f"  {cmd:<{width}}  {what}" for cmd, what in QUICK_START]
    listed = set()
    for title, names in COMMAND_GROUPS:
        lines += ["", f"{title.lower()}:"]
        for name in names:
            listed.add(name)
            text = helps.get(name, "")
            note = _LEGACY_NOTES.get(name)
            if note:
                text = f"{text} ({note})" if text else note
            lines.append(f"  {name:<10} {text}")
    extra = [n for n in helps if n not in listed]
    if extra:                                  # anything registered later still shows
        lines += ["", "more:"] + [f"  {n:<10} {helps[n]}" for n in extra]
    lines += ["", "Run `openleads <command> --help` for a command's options."]
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="openleads",
        description="Free, open-source Apollo alternative — one search box fans out across\n"
                    "public sources (local businesses, startups, companies, devs…), finds the\n"
                    "people, verifies emails, and automates outreach. Keyless, local, $0.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--version", action="version", version=f"openleads {__version__}")
    sub = _Registrar(p.add_subparsers(dest="command", metavar="<command>",
                                      help="one of the commands listed below"))

    f = sub.add_parser("find", help="find + verify leads")
    _add_query_flags(f)
    f.add_argument("-q", "--quiet", action="store_true",
                   help="no progress output (errors and the short-result report still go to stderr)")
    f.add_argument("--explain", action="store_true",
                   help="show how the query was understood, which sources run and why, "
                        "and the per-source report at the end")
    f.add_argument("--report", metavar="FILE",
                   help="write the run report (per-source status, timings, hints) as JSON")
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

    co = sub.add_parser("company", help="look up a company: tech stack, socials, phones, people")
    co.add_argument("domain", help="company domain, e.g. acme.com")
    co.add_argument("--json", action="store_true", help="print JSON")
    co.add_argument("--format", choices=["text", "json"], help="output format (json = --json)")
    co.add_argument("--people", type=int, default=10, help="max people from the team page")
    co.add_argument("--no-people", action="store_true", help="skip the team-page crawl")
    co.add_argument("--no-cache", action="store_true", help="refetch instead of using the cache")
    co.set_defaults(func=cmd_company)

    mc = sub.add_parser("mcp", help="run as an MCP server (Claude Desktop, Cursor, Claude Code)")
    mc.set_defaults(func=cmd_mcp)

    bn = sub.add_parser("bench", help="run real queries against live sources and score them")
    bn.add_argument("query", nargs="*", help="one query to score (default: the full suite)")
    bn.add_argument("-n", "--count", type=int, default=10, help="leads per query (default 10)")
    bn.add_argument("--budget", type=int, default=60, help="seconds per query (default 60)")
    bn.add_argument("--repeat", type=int, default=1, metavar="N",
                    help="run each query N times; report the median run and min–max")
    bn.add_argument("--json", help="write the full report as JSON")
    bn.add_argument("--markdown", help="write a Markdown scoreboard")
    bn.add_argument("--no-cache", action="store_true", help="bypass the cache")
    bn.set_defaults(func=cmd_bench)

    s = sub.add_parser("sources", help="list/inspect available sources")
    s.add_argument("subject", nargs="?", help="'list' (default) or 'info'")
    s.add_argument("name", nargs="?", help="source name for 'info'")
    s.set_defaults(func=cmd_sources)

    v = sub.add_parser("verify", help="verify one or more concrete email addresses")
    v.add_argument("emails", nargs="+")
    v.add_argument("--json", action="store_true", help="print JSON (one object per address)")
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

    sc = sub.add_parser("schedule", help="install/remove the on-device automation agent")
    sc.add_argument("action", nargs="?",
                    help="'on' (heartbeat) · 'off' · 'status' (default) · HH:MM (fixed daily)")
    sc.add_argument("--at", help="legacy: one fixed daily run at HH:MM")
    sc.add_argument("--every-minutes", type=int, help="heartbeat interval (default 15)")

    rn = sub.add_parser("runs", help="history of scheduled runs (recipes, watchers, follow-ups)")
    rn.add_argument("-n", "--limit", type=int, default=20)
    rn.set_defaults(func=cmd_runs)
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
    rc.add_argument("--at", help="run daily at HH:MM (also enables the schedule)")
    rc.add_argument("--every", metavar="SCHEDULE",
                    help='when to run: "weekdays 9am", "every 2h", "mon,thu 14:00", or cron')
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
    wt.add_argument("--every", metavar="SCHEDULE",
                    help='when to check (default "daily 09:00"), e.g. "every 6h"')
    wt.add_argument("--live", action="store_true", help="for `run`: actually deliver")
    wt.set_defaults(func=cmd_watch)

    it = sub.add_parser("init", help="friendly first-run setup (identity, mailbox, first search)")
    it.set_defaults(func=cmd_init)

    cp = sub.add_parser("campaign", help="cold-email companion")
    cp.add_argument("rest", nargs=argparse.REMAINDER)
    cp.set_defaults(func=cmd_campaign)

    from openleads import cli_workspace
    cli_workspace.register(sub)
    p.epilog = _grouped_help(sub.help)
    p._registrar = sub          # for tests / tooling: every registered command
    return p


def _utf8_streams() -> None:
    """Windows pipes default to cp1252, which can't print ▌ ✦ ◆; use UTF-8 instead."""
    for stream in (sys.stdout, sys.stderr):
        enc = (getattr(stream, "encoding", "") or "").lower().replace("-", "")
        if enc != "utf8" and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


def main(argv=None) -> int:
    _utf8_streams()
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    if not argv:
        return cmd_chat(argparse.Namespace())  # bare `openleads` → chat
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    try:
        return args.func(args)
    except intent.QueryError as e:          # unknown source, bad --seniority, …
        print(f"[!] {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
