"""
Workspace commands — the CRM side of OpenLeads from the terminal, on the same
data as the web dashboard.

``people`` · ``companies`` — search and inspect contacts and accounts, change
stages, tag, take notes. ``lists`` — build lists. ``seq`` — multi-step sequences:
create, enroll, run. ``tasks`` — the follow-up queue. ``deals`` — the pipeline.
``import`` · ``dedupe`` · ``stats`` — data in, data clean, numbers out. ``demo`` —
a throwaway workspace of invented data to try the dashboard on.
Every listing takes ``--json`` for scripting.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime

from openleads import ui
from openleads.db import DB


# --------------------------------------------------------------------------- #
# Output helpers                                                              #
# --------------------------------------------------------------------------- #
def _cut(text, width: int) -> str:
    s = str(text if text is not None else "")
    return s if len(s) <= width else s[:max(0, width - 1)] + "…"


def table(rows: list, cols: list, indent: str = "") -> str:
    """Plain aligned columns. ``cols`` is ``[(key_or_fn, header, width), ...]``."""
    if not rows:
        return ""
    head = "  ".join(ui.c(h.ljust(w), ui.FAINT) for _, h, w in cols)
    lines = [indent + head.rstrip()]
    for r in rows:
        cells = []
        for key, _, w in cols:
            v = key(r) if callable(key) else r.get(key)
            cells.append(_cut(v, w).ljust(w))
        lines.append(indent + "  ".join(cells).rstrip())
    return "\n".join(lines)


def _when(ts) -> str:
    if not ts:
        return "—"
    return datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%d")


def _dump(obj) -> None:
    print(json.dumps(obj, indent=2, default=str))


def _grade(score) -> str:
    from openleads.workspace.scoring import grade
    return grade(int(score or 0))


def _split(values) -> list:
    out = []
    for v in values or []:
        out += [x.strip() for x in str(v).split(",") if x.strip()]
    return out


def _with_db(fn):
    def run(args) -> int:
        db = DB()
        try:
            return fn(db, args)
        except ValueError as e:
            print(f"[!] {e}", file=sys.stderr)
            return 2
        finally:
            db.close()
    run.__name__ = fn.__name__
    run.__doc__ = fn.__doc__
    return run


def _resolve_list(db, value: str, kind: str = "people") -> dict:
    from openleads.workspace import lists
    lst = lists.get(db, value) if str(value).isdigit() else None
    lst = lst or lists.by_name(db, value, kind)
    if not lst:
        raise ValueError(f"no {kind} list called '{value}'")
    return lst


# --------------------------------------------------------------------------- #
# People                                                                      #
# --------------------------------------------------------------------------- #
PEOPLE_COLS = [
    (lambda r: _grade(r.get("fit_score")), "fit", 3),
    (lambda r: r.get("name") or " ".join(x for x in (r.get("first_name"), r.get("last_name")) if x),
     "name", 22),
    ("title", "title", 22),
    ("organization", "company", 20),
    ("email", "email", 36),
    ("tier", "tier", 6),
    ("stage", "stage", 12),
]


def _people_filters(db, args) -> dict:
    f: dict = {}
    if args.query:
        f["q"] = " ".join(args.query)
    for key in ("stage", "tier", "seniority", "department", "country", "source"):
        vals = _split(getattr(args, key, None))
        if vals:
            f[key] = vals
    if args.tag:
        f["tags"] = _split(args.tag)
    if args.list:
        f["list_id"] = [str(_resolve_list(db, args.list)["id"])]
    if args.fit:
        floor = {"A": 75, "B": 55, "C": 35, "D": 0}.get(args.fit.upper())
        if floor is None:
            raise ValueError("--fit takes A, B, C or D")
        f["fit_min"] = floor
    if args.never_contacted:
        f["contacted"] = "never"
    return f


PEOPLE_ACTIONS = ("ls", "list", "search", "show", "stage", "tag", "note")


@_with_db
def cmd_people(db, args) -> int:
    """List / search contacts (default), or act on them."""
    from openleads.workspace import notes, people, tags
    action = args.action
    if action and action not in PEOPLE_ACTIONS:      # `openleads people acme`
        args.query = [action] + list(args.query)
        action = "search"
    if action in (None, "ls", "list", "search"):
        filters = _people_filters(db, args)
        res = people.search(db, filters, sort=args.sort, direction="asc" if args.sort == "name" else "desc",
                            per_page=args.limit)
        if args.json:
            _dump(res)
            return 0
        if not res["rows"]:
            print("No contacts match." if filters else
                  "No contacts yet — run `openleads find …` or `openleads import file.csv`.")
            return 0
        print(table(res["rows"], PEOPLE_COLS))
        more = res["total"] - len(res["rows"])
        print(ui.c(f"\n{res['total']} contact(s)" + (f" · {more} more (use --limit)" if more > 0 else ""),
                   ui.FAINT))
        return 0
    emails = [e.lower() for e in args.query]
    if not emails:
        raise ValueError(f"`people {action}` needs at least one email")
    if action == "show":
        d = people.detail(db, emails[0])
        if not d:
            raise ValueError(f"{emails[0]} is not in your CRM")
        if args.json:
            _dump(d)
            return 0
        c = d["contact"]
        name = c.get("name") or c["email"]
        print(ui.box([ui.c(name, ui.WHITE, ui.BOLD),
                      ui.c(" at ".join(x for x in (c.get("title"), c.get("organization")) if x) or "—",
                           ui.GREY)], title=f"✦ {c['email']}", width=72))
        facts = [("stage", c.get("stage")),
                 ("email", f"{c.get('tier') or 'unverified'} · {c.get('evidence') or '—'}"),
                 ("fit", f"{_grade(c.get('fit_score'))} ({c.get('fit_score') or 0})"),
                 ("seniority", c.get("seniority")), ("department", c.get("department")),
                 ("phone", c.get("phone")), ("linkedin", c.get("linkedin_url")),
                 ("location", ", ".join(x for x in (c.get("city"), c.get("state"), c.get("country"))
                                        if x)),
                 ("tags", ", ".join(c.get("tags") or [])),
                 ("last contact", _when(c.get("last_contacted")))]
        for k, v in facts:
            if v:
                print(f"  {ui.c(k.ljust(12), ui.FAINT)} {v}")
        for e in d["enrollments"]:
            print(f"  {ui.c('sequence'.ljust(12), ui.FAINT)} {e['sequence_name']} — {e['status']}, "
                  f"step {int(e['step']) + 1}")
        for t in d["tasks"]:
            if t["status"] == "open":
                print(f"  {ui.c('task'.ljust(12), ui.FAINT)} {t['title']} (due {_when(t['due'])})")
        for n in d["notes"][:3]:
            print(f"  {ui.c('note'.ljust(12), ui.FAINT)} {_cut(n['body'], 80)}")
        if d["timeline"]:
            print(ui.c("\n  recent activity", ui.WHITE, ui.BOLD))
            for a in d["timeline"][:8]:
                print(f"  {ui.c(_when(a['ts']), ui.FAINT)}  {a['label']}"
                      + (f" — {_cut(a['summary'], 60)}" if a.get("summary") else ""))
        return 0
    if action == "stage":
        if not args.to:
            raise ValueError("pass the new stage with --to (e.g. --to interested)")
        res = people.bulk(db, emails, "stage", args.to)
        print(f"[people] {res.get('count', 0)} moved to {args.to}")
        return 0
    if action == "tag":
        tag_list = _split(args.add or []) or _split(args.remove or [])
        if not tag_list:
            raise ValueError("pass --add t1,t2 or --remove t1")
        n = (tags.remove if args.remove else tags.add)(db, emails, tag_list)
        print(f"[people] {'untagged' if args.remove else 'tagged'} {n}")
        return 0
    if action == "note":
        if len(args.query) < 2:
            raise ValueError('usage: openleads people note EMAIL "what happened"')
        email, body = args.query[0].lower(), " ".join(args.query[1:])
        if not db.get_lead(email):
            raise ValueError(f"{email} is not in your CRM")
        notes.add(db, "contact", email, body)
        print(f"[people] note added to {email}")
        return 0
    raise ValueError(f"unknown action '{action}'")


# --------------------------------------------------------------------------- #
# Companies                                                                   #
# --------------------------------------------------------------------------- #
COMPANY_COLS = [
    ("name", "company", 24), ("domain", "domain", 26), ("industry", "industry", 18),
    ("company_size", "size", 9), ("people", "people", 6), ("stage", "stage", 10),
    (lambda r: ", ".join((r.get("technologies") or [])[:3]), "tech", 30),
]


@_with_db
def cmd_companies(db, args) -> int:
    """List / search companies, or show one."""
    from openleads.workspace import companies
    if args.action == "show":
        if not args.query:
            raise ValueError("usage: openleads companies show DOMAIN")
        d = companies.detail(db, args.query[0].lower())
        if not d:
            raise ValueError(f"{args.query[0]} is not in your workspace")
        if args.json:
            _dump(d)
            return 0
        a = d["account"]
        print(ui.box([ui.c(a.get("name") or a["domain"], ui.WHITE, ui.BOLD),
                      ui.c(a.get("description") or "not profiled yet", ui.GREY)],
                     title=f"✦ {a['domain']}", width=72))
        for k in ("industry", "company_size", "employees", "phone", "city", "country", "stage"):
            if a.get(k):
                print(f"  {ui.c(k.replace('_', ' ').ljust(12), ui.FAINT)} {a[k]}")
        if a.get("technologies"):
            print(f"  {ui.c('tech'.ljust(12), ui.FAINT)} {', '.join(a['technologies'])}")
        if d.get("people"):
            print(ui.c("\n  people", ui.WHITE, ui.BOLD))
            print(table(d["people"], PEOPLE_COLS[1:3] + PEOPLE_COLS[4:5] + PEOPLE_COLS[6:], indent="  "))
        return 0
    words = list(args.query)
    if args.action and args.action not in ("ls", "list", "search"):
        words.insert(0, args.action)              # `openleads companies dental`
    f: dict = {"q": " ".join(words)} if words else {}
    if args.tech:
        f["technologies"] = _split(args.tech)
    if args.stage:
        f["stage"] = _split(args.stage)
    if args.industry:
        f["industry"] = _split(args.industry)
    res = companies.search(db, f, sort=args.sort, per_page=args.limit)
    if args.json:
        _dump(res)
        return 0
    if not res["rows"]:
        print("No companies match." if f else "No companies yet.")
        return 0
    print(table(res["rows"], COMPANY_COLS))
    print(ui.c(f"\n{res['total']} compan{'y' if res['total'] == 1 else 'ies'}", ui.FAINT))
    return 0


# --------------------------------------------------------------------------- #
# Lists                                                                       #
# --------------------------------------------------------------------------- #
@_with_db
def cmd_lists(db, args) -> int:
    """Show lists, create one, add or remove people, delete."""
    from openleads.workspace import lists, people
    kind = "companies" if args.companies else "people"
    act, rest = args.action or "ls", list(args.args)
    if act in ("ls", "list"):
        rows = lists.all_lists(db, None if args.all else kind)
        if args.json:
            _dump(rows)
            return 0
        if not rows:
            print("No lists yet — `openleads lists create \"Q4 targets\"`.")
            return 0
        print(table(rows, [("id", "id", 4), ("name", "list", 32), ("kind", "holds", 9),
                           ("count", "size", 6), (lambda r: _when(r["updated"]), "updated", 10)]))
        return 0
    if not rest:
        raise ValueError(f"usage: openleads lists {act} NAME ...")
    name, refs = rest[0], [r.lower() for r in rest[1:]]
    if act == "create":
        lst = lists.create(db, name, kind, description=args.description or "")
        print(f"[lists] created '{lst['name']}' (id {lst['id']})")
        return 0
    lst = _resolve_list(db, name, kind)
    if act == "show":
        if lst["kind"] == "companies":
            rows = [{"domain": m} for m in lists.members(db, lst["id"])]
            print("\n".join(r["domain"] for r in rows) or "(empty)")
            return 0
        res = people.search(db, {"list_id": [str(lst["id"])]}, sort="name", direction="asc",
                            per_page=args.limit)
        if args.json:
            _dump(res)
            return 0
        print(ui.c(f"{lst['name']} — {res['total']} people", ui.WHITE, ui.BOLD))
        print(table(res["rows"], PEOPLE_COLS))
        return 0
    if act == "add":
        if args.where:
            filters = {"q": args.where}
            refs += people.matching_emails(db, filters)
        if not refs:
            raise ValueError("give emails (or domains) to add, or --where 'search words'")
        n = lists.add(db, lst["id"], refs)
        print(f"[lists] added {n} to '{lst['name']}'")
        return 0
    if act in ("remove", "rm-members"):
        n = lists.remove(db, lst["id"], refs)
        print(f"[lists] removed {n} from '{lst['name']}'")
        return 0
    if act in ("delete", "rm"):
        lists.delete(db, lst["id"])
        print(f"[lists] deleted '{lst['name']}' (its people stay in your CRM)")
        return 0
    raise ValueError(f"unknown action '{act}'")


# --------------------------------------------------------------------------- #
# Sequences                                                                   #
# --------------------------------------------------------------------------- #
_STEP_LABEL = {"auto_email": "email", "manual_email": "manual email", "call": "call",
               "linkedin": "LinkedIn", "task": "task"}


def _seq(db, ref) -> dict:
    from openleads.workspace import sequences
    s = sequences.get(db, ref)
    if not s:
        raise ValueError(f"no sequence '{ref}'")
    return s


@_with_db
def cmd_seq(db, args) -> int:
    """Multi-step sequences: list, show, create, enroll, run, pause, activate."""
    from openleads.workspace import sequences
    act, rest = args.action or "ls", list(args.args)
    if act in ("ls", "list"):
        rows = sequences.list_sequences(db)
        if args.json:
            _dump(rows)
            return 0
        if not rows:
            print('No sequences yet — `openleads seq create "Q4 outbound"`.')
            return 0
        print(table(rows, [("id", "id", 4), ("name", "sequence", 28), ("status", "status", 8),
                           (lambda r: len(r["steps"]), "steps", 5),
                           (lambda r: r["stats"]["active"], "active", 6),
                           (lambda r: r["stats"]["contacted"], "contacted", 9),
                           (lambda r: f"{r['stats']['reply_rate']}%", "replies", 7),
                           (lambda r: r["stats"]["due_now"], "due", 4)]))
        return 0
    if not rest:
        raise ValueError(f"usage: openleads seq {act} ID_OR_NAME ...")
    if act == "create":
        steps = [] if args.blank else sequences.starter_steps()
        s = sequences.create(db, rest[0], steps, {"context": args.pitch or ""})
        print(f"[seq] created '{s['name']}' (id {s['id']}, {len(s['steps'])} steps, paused)")
        if steps:
            print("      edit the steps in the dashboard, then `openleads seq activate "
                  f"{s['id']}`")
        return 0
    s = _seq(db, rest[0])
    if act == "show":
        st = sequences.stats(db, s["id"])
        if args.json:
            _dump({"sequence": s, "stats": st})
            return 0
        sm = st["summary"]
        print(ui.c(f"{s['name']}  ", ui.WHITE, ui.BOLD) + ui.c(f"[{s['status']}]", ui.FAINT))
        print(f"  {sm['active']} active · {sm['contacted']} contacted · {sm['replied']} replied "
              f"({sm['reply_rate']}%) · {sm['bounced']} bounced · {sm['due_now']} due now")
        day = 0
        for i, (step, row) in enumerate(zip(s["steps"], st["steps"])):
            day += step["delay_days"]
            what = _STEP_LABEL.get(step["type"], step["type"])
            subj = (step.get("variants") or [{}])[0].get("subject") or step.get("note") or ""
            ab = f" · {len(step['variants'])} variants" if len(step.get("variants") or []) > 1 else ""
            print(f"  {i + 1}. day {day:<3} {what:<13} {_cut(subj, 40):<40} "
                  + ui.c(f"{row['waiting']} waiting · {row['sent'] or row['tasks_done']} done{ab}",
                         ui.FAINT))
        return 0
    if act == "enroll":
        from openleads.workspace import people
        emails = [e.lower() for e in rest[1:]]
        if args.list:
            lst = _resolve_list(db, args.list)
            emails += people.matching_emails(db, {"list_id": [str(lst["id"])]})
        if not emails:
            raise ValueError("give emails or --list NAME")
        res = sequences.enroll(db, s["id"], emails, force=args.force)
        print(f"[seq] enrolled {len(res['enrolled'])} in '{s['name']}'")
        for sk in res["skipped"][:20]:
            print(f"      skipped {sk['email']}: {sk['reason']}")
        if len(res["skipped"]) > 20:
            print(f"      … and {len(res['skipped']) - 20} more skipped")
        return 0
    if act in ("pause", "activate", "archive"):
        status = {"pause": "paused", "activate": "active", "archive": "archived"}[act]
        sequences.set_status(db, s["id"], status)
        print(f"[seq] '{s['name']}' is now {status}")
        return 0
    if act == "run":
        from openleads.automate.sendtime import in_send_window
        live = bool(args.live)
        if live and s["status"] != "active":
            raise ValueError(f"'{s['name']}' is {s['status']} — `openleads seq activate {s['id']}` "
                             "first (a dry run works either way)")
        out = sequences.process(db, dry_run=not live, seq_id=s["id"],
                                send_window_ok=args.now or in_send_window(datetime.now()))
        verb = "sent" if live else "would send"
        print(f"[seq] {out['due']} due · {verb} {out['sent'] if live else out['previewed']} · "
              f"{out['tasks']} task(s) · {out['waiting_window']} waiting for business hours · "
              f"{out['capped']} over the daily cap")
        if not live:
            for r in out["results"][:15]:
                print(f"      → {r['email']:<34} {_cut(r['subject'], 50)}")
            print("      (dry run — add --live to send)")
        return 0
    if act in ("delete", "rm"):
        sequences.delete(db, s["id"])
        print(f"[seq] deleted '{s['name']}'")
        return 0
    raise ValueError(f"unknown action '{act}'")


# --------------------------------------------------------------------------- #
# Tasks                                                                       #
# --------------------------------------------------------------------------- #
def _due(ts) -> str:
    if not ts:
        return "no date"
    d = datetime.fromtimestamp(float(ts))
    days = (d.date() - datetime.now().date()).days
    if days < 0:
        return f"{-days}d overdue"
    if days == 0:
        return "today " + d.strftime("%H:%M")
    if days == 1:
        return "tomorrow"
    return d.strftime("%a %b %d")


@_with_db
def cmd_tasks(db, args) -> int:
    """The call/email/LinkedIn/to-do queue: list, add, done, skip, snooze."""
    from openleads.workspace import tasks
    act, rest = args.action or "ls", list(args.args)
    if act in ("ls", "list"):
        bucket = args.bucket
        rows = tasks.list_tasks(db, bucket, kind=args.kind)
        if args.json:
            _dump({"tasks": rows, "counts": tasks.counts(db)})
            return 0
        c = tasks.counts(db)
        print(ui.c(f"{c['overdue']} overdue · {c['today']} today · {c['upcoming']} upcoming · "
                   f"{c['done_today']} done today", ui.FAINT))
        if not rows:
            print("Nothing here." if bucket != "open" else "All caught up.")
            return 0
        print(table(rows, [("id", "id", 4), ("kind", "type", 8), ("title", "task", 40),
                           (lambda r: r.get("contact_name") or r.get("contact") or "", "who", 22),
                           (lambda r: _due(r["due"]) if r["status"] == "open" else r["status"],
                            "due", 14),
                           ("priority", "pri", 6)]))
        return 0
    if act == "add":
        if not rest:
            raise ValueError('usage: openleads tasks add "Call Jane" --contact jane@acme.com --due tomorrow')
        t = tasks.create(db, " ".join(rest), kind=args.kind or "todo", contact=args.contact or "",
                         due=args.due, note=args.note or "", priority=args.priority)
        print(f"[tasks] #{t['id']} {t['title']} — {_due(t['due'])}")
        return 0
    if not rest:
        raise ValueError(f"usage: openleads tasks {act} ID [ID ...]")
    fn = {"done": tasks.complete, "skip": tasks.skip, "reopen": tasks.reopen}.get(act)
    for tid in rest:
        if act == "snooze":
            row = tasks.update(db, tid, {"due": args.due or "tomorrow"})
        elif act in ("delete", "rm"):
            row = {"id": tid} if tasks.delete(db, tid) else None
        elif fn:
            row = fn(db, tid)
        else:
            raise ValueError(f"unknown action '{act}'")
        if row is None:
            raise ValueError(f"no task #{tid}")
        verb = {"done": "done", "skip": "skipped", "reopen": "reopened", "snooze": "snoozed",
                "delete": "deleted", "rm": "deleted"}[act]
        print(f"[tasks] #{tid} {verb}" + (f" until {_due(row['due'])}" if act == "snooze" else ""))
    return 0


# --------------------------------------------------------------------------- #
# Deals                                                                       #
# --------------------------------------------------------------------------- #
def _money(v, cur: str = "USD") -> str:
    sym = {"USD": "$", "EUR": "€", "GBP": "£"}.get((cur or "USD").upper(), "")
    return f"{sym}{float(v or 0):,.0f}" + ("" if sym else f" {cur}")


@_with_db
def cmd_deals(db, args) -> int:
    """The pipeline: board summary, add, move, won, lost."""
    from openleads.workspace import deals
    act, rest = args.action or "ls", list(args.args)
    if act in ("ls", "list", "board"):
        b = deals.board(db, q=args.q)
        if args.json:
            _dump(b)
            return 0
        t = b["totals"]
        print(ui.c(f"open {_money(t['open_value'])} ({t['open_count']}) · weighted "
                   f"{_money(t['weighted'])} · won {_money(t['won_value'])} · win rate "
                   f"{t['win_rate']}%", ui.FAINT))
        for col in b["columns"]:
            if not col["deals"] and col["key"] in ("won", "lost") and not args.all:
                continue
            print(ui.c(f"\n{col['label']} ", ui.WHITE, ui.BOLD)
                  + ui.c(f"{col['count']} · {_money(col['total'])}"
                         + (f" · {col['probability']}%" if col["key"] not in ("won", "lost") else ""),
                         ui.FAINT))
            for d in col["deals"]:
                print(f"  #{d['id']:<4} {_cut(d['name'], 36):<36} {_money(d['amount'], d['currency']):>10}  "
                      f"{_cut(d.get('account_name') or d.get('account') or '', 20):<20} "
                      + ui.c(f"closes {d['close_date']}" if d.get("close_date") else "", ui.FAINT))
        return 0
    if act == "add":
        if not rest:
            raise ValueError('usage: openleads deals add "Acme — pilot" --amount 12k --contact jane@acme.com')
        d = deals.create(db, " ".join(rest), account=args.company or "", contact=args.contact or "",
                         stage=args.stage or "qualify", amount=args.amount, close_date=args.close or "")
        print(f"[deals] #{d['id']} {d['name']} — {_money(d['amount'])} in {d['stage']}")
        return 0
    if act in ("move", "won", "lost"):
        if not rest:
            raise ValueError(f"usage: openleads deals {act} ID" + (" STAGE" if act == "move" else ""))
        stage = act if act != "move" else (rest[1] if len(rest) > 1 else args.stage)
        if not stage:
            raise ValueError("which stage? e.g. `openleads deals move 3 proposal`")
        d = deals.move(db, rest[0], stage)
        if not d:
            raise ValueError(f"no deal #{rest[0]}")
        print(f"[deals] #{d['id']} {d['name']} → {d['stage']}")
        return 0
    if act in ("delete", "rm"):
        if not rest or not deals.delete(db, rest[0]):
            raise ValueError("no such deal")
        print(f"[deals] #{rest[0]} deleted")
        return 0
    raise ValueError(f"unknown action '{act}'")


# --------------------------------------------------------------------------- #
# Import, duplicates, stats, demo                                             #
# --------------------------------------------------------------------------- #
def _read_text(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    with open(path, encoding="utf-8-sig", errors="replace", newline="") as f:
        return f.read()


@_with_db
def cmd_import(db, args) -> int:
    """Import a CSV export (Apollo, HubSpot, LinkedIn, any spreadsheet) into People."""
    import csv as _csv

    from openleads.workspace import importer
    text = _read_text(args.file)
    headers, _rows = importer.parse_csv(text)
    if not headers:
        raise ValueError("no header row found — is this a CSV?")
    mapping = importer.detect_mapping(headers)
    for pair in args.map or []:
        if "=" not in pair:
            raise ValueError(f"--map takes HEADER=field, got '{pair}'")
        h, field = (x.strip() for x in pair.split("=", 1))
        if h not in headers:
            raise ValueError(f"no column '{h}' (columns: {', '.join(headers)})")
        if field and field not in importer.FIELDS:
            raise ValueError(f"unknown field '{field}' (fields: {', '.join(importer.FIELDS)})")
        if field:
            mapping[h] = field
        else:
            mapping.pop(h, None)
    pv = importer.preview(text, mapping)
    if args.preview or not args.json:
        print(ui.c(f"{args.file}: {pv['total']} rows · {pv['with_email']} with an email · "
                   f"{len(pv['needs_email'])} can be found · "
                   f"{pv['without_email'] - len(pv['needs_email'])} skipped", ui.FAINT))
        for h in headers:
            field = mapping.get(h)
            print(f"  {_cut(h, 30):<30} → {field or ui.c('(not imported)', ui.FAINT)}")
    if args.preview:
        return 0
    res = importer.import_rows(db, text, mapping, list_name=args.list or "",
                               tags=_split(args.tags or []), stage=args.stage or "",
                               source=args.source or "import")
    if args.missing_out and pv["needs_email"]:
        with open(args.missing_out, "w", newline="", encoding="utf-8") as f:
            w = _csv.DictWriter(f, fieldnames=["name", "company", "domain"])
            w.writeheader()
            w.writerows(pv["needs_email"])
    if args.json:
        _dump({**res, "needs_email": len(pv["needs_email"])})
        return 0
    print(f"[import] {res['created']} new · {res['updated']} updated · "
          f"{len(res['skipped'])} skipped · {res['no_email']} without email"
          + (f" · list '{res['list']['name']}'" if res.get("list") else ""))
    for sk in res["skipped"][:10]:
        print(f"         row {sk['row']}: {sk['email']} — {sk['reason']}")
    if pv["needs_email"]:
        if args.missing_out:
            print(f"[import] {len(pv['needs_email'])} rows without an email written to "
                  f"{args.missing_out} — find them with `openleads enrich {args.missing_out}`")
        else:
            print(f"[import] {len(pv['needs_email'])} rows have a name and company but no email; "
                  "re-run with --missing-out missing.csv, then `openleads enrich missing.csv`")
    return 0


@_with_db
def cmd_dedupe(db, args) -> int:
    """Find people who appear twice at the same company; --merge folds them together."""
    from openleads.workspace import duplicates
    groups = duplicates.find(db, limit=10000)
    if args.json and not args.merge:
        _dump(groups)
        return 0
    if not groups:
        print("No duplicates — nobody appears twice at the same company.")
        return 0
    if args.merge:
        res = duplicates.merge_all(db)
        print(f"[dedupe] merged {res['merged']} record(s) across {res['groups']} group(s)")
        return 0
    for g in groups:
        keep = g[0]
        print(ui.c(f"{keep.get('name') or keep['email']} ", ui.WHITE, ui.BOLD)
              + ui.c(f"at {keep.get('organization') or keep['domain']}", ui.FAINT))
        for i, r in enumerate(g):
            mark = ui.c("keep ", ui.GREEN) if i == 0 else ui.c("merge", ui.FAINT)
            print(f"  {mark} {r['email']:<36} {r.get('tier') or 'unverified':<10} "
                  f"{_cut(r.get('title') or '', 30)}")
    print(ui.c(f"\n{len(groups)} group(s). Merge them all with `openleads dedupe --merge` "
               "(or pick per group in the dashboard → Data health).", ui.FAINT))
    return 0


@_with_db
def cmd_stats(db, args) -> int:
    """The workspace at a glance: contacts, sends, replies, tasks, pipeline, data health."""
    from openleads.workspace import stats
    h = stats.home(db, checklist=False)
    hl = stats.health(db)
    if args.json:
        h.pop("activity", None)
        _dump({"home": h, "health": hl})
        return 0
    c, e, t, d, sq = h["contacts"], h["emails"], h["tasks"], h["deals"], h["sequences"]
    rows = [
        ("contacts", f"{c['total']} ({c['safe']} verified safe, +{c['new_7d']} this week)"),
        ("fit grades", "  ".join(f"{g} {n}" for g, n in h["grades"].items())),
        ("emails", f"{e['sent_today']} today · {e['sent_7d']} this week · {e['sent_30d']} in 30 days"),
        ("replies", (f"{e['replied']} of {e['contacted']} contacted ({e['reply_rate']}%) · "
                     f"bounces {e['bounce_rate']}%")),
        ("sequences", f"{sq['active']} active · {sq['enrolled']} people in them · {sq['due_now']} due now"),
        ("tasks", f"{t['overdue']} overdue · {t['today']} today · {t['upcoming']} upcoming"),
        ("pipeline", (f"{_money(d['open_value'])} open · {_money(d['weighted'])} weighted · "
                      f"{_money(d['won_value'])} won")),
        ("duplicates", f"{hl['duplicates']['groups']} group(s)"),
    ]
    for k, v in rows:
        print(f"  {ui.c(k.ljust(11), ui.FAINT)} {v}")
    issues = [x for x in hl["checks"] if x["count"] and x["tone"] in ("bad", "warn")]
    if issues:
        print(ui.c("\n  worth fixing", ui.WHITE, ui.BOLD))
        for x in issues:
            print(f"  {x['count']:>5}  {x['label']} ({x['pct']}%)")
    funnel = [f"{f['label']} {f['count']}" for f in h["funnel"] if f["count"]]
    if funnel:
        print(ui.c("\n  stages  ", ui.FAINT) + " · ".join(funnel))
    return 0


def cmd_demo(args) -> int:
    """Seed a throwaway workspace with invented data and open the dashboard on it."""
    import os
    import shutil
    import tempfile
    from pathlib import Path

    base = Path(args.dir).expanduser() if args.dir else Path(tempfile.gettempdir()) / "openleads-demo"
    if args.reset and base.exists():
        shutil.rmtree(base)
    real = Path(os.environ.get("OPENLEADS_HOME") or Path.home() / ".openleads").expanduser()
    if base.resolve() == real.resolve():
        print("[!] refusing to seed demo data into your real workspace; pick another --dir",
              file=sys.stderr)
        return 2
    os.environ["OPENLEADS_HOME"] = str(base)
    from openleads import demo
    db = DB()
    try:
        fresh = not db.scalar("SELECT COUNT(*) FROM leads", default=0)
        counts = demo.seed(db) if fresh else None
    finally:
        db.close()
    if counts:
        print(f"[demo] seeded {counts['contacts']} people at {counts['companies']} companies, "
              f"{counts['sequences']} sequences, {counts['tasks']} tasks and {counts['deals']} deals")
    else:
        print("[demo] reusing the existing demo workspace (add --reset for a fresh one)")
    print(f"[demo] workspace: {base}  — everything is invented (.example domains); "
          "your real data is untouched")
    if args.no_serve:
        print(f"       try: OPENLEADS_HOME={base} openleads people")
        return 0
    from openleads.web.server import serve
    return serve(port=args.port, open_browser=not args.no_open)


# --------------------------------------------------------------------------- #
# Parser                                                                      #
# --------------------------------------------------------------------------- #
def register(sub) -> None:
    """Add the workspace subcommands to the main parser."""
    pe = sub.add_parser("people", help="your contacts: search, show, stage, tag, note",
                        description="Search and work your contacts (same data as the dashboard).",
                        formatter_class=argparse.RawDescriptionHelpFormatter,
                        epilog="examples:\n"
                               "  openleads people                       # most recent\n"
                               "  openleads people search acme --fit A\n"
                               "  openleads people show jane@acme.com\n"
                               "  openleads people stage jane@acme.com --to interested\n"
                               "  openleads people tag jane@acme.com --add vip,q4\n"
                               '  openleads people note jane@acme.com "Call went well"')
    pe.add_argument("action", nargs="?", help="ls | search | show | stage | tag | note (or search words)")
    pe.add_argument("query", nargs="*", help="search words, or emails for an action")
    pe.add_argument("--stage", action="append", help="filter by stage (repeat or comma-separate)")
    pe.add_argument("--tier", action="append", help="email status: safe, risky")
    pe.add_argument("--seniority", action="append")
    pe.add_argument("--department", action="append")
    pe.add_argument("--country", action="append")
    pe.add_argument("--source", action="append")
    pe.add_argument("--tag", action="append")
    pe.add_argument("--list", help="only people in this list (name or id)")
    pe.add_argument("--fit", help="minimum ICP grade: A, B, C or D")
    pe.add_argument("--never-contacted", action="store_true")
    pe.add_argument("--sort", default="updated",
                    choices=["updated", "created", "fit", "score", "name", "last_contacted", "seniority"])
    pe.add_argument("--limit", type=int, default=25)
    pe.add_argument("--to", help="new stage for `stage`")
    pe.add_argument("--add", action="append", help="tags to add for `tag`")
    pe.add_argument("--remove", action="append", help="tags to remove for `tag`")
    pe.add_argument("--json", action="store_true")
    pe.set_defaults(func=cmd_people)

    co = sub.add_parser("companies", help="companies in your workspace: search, show")
    co.add_argument("action", nargs="?", help="ls | show | search words")
    co.add_argument("query", nargs="*")
    co.add_argument("--tech", action="append", help="uses this technology (e.g. HubSpot)")
    co.add_argument("--stage", action="append")
    co.add_argument("--industry", action="append")
    co.add_argument("--sort", default="people", choices=["people", "name", "updated", "industry", "size"])
    co.add_argument("--limit", type=int, default=25)
    co.add_argument("--json", action="store_true")
    co.set_defaults(func=cmd_companies)

    li = sub.add_parser("lists", help="static lists of people or companies",
                        description="Create lists and add people to them (by email or search).",
                        formatter_class=argparse.RawDescriptionHelpFormatter,
                        epilog="examples:\n"
                               "  openleads lists\n"
                               '  openleads lists create "Q4 dentists"\n'
                               '  openleads lists add "Q4 dentists" jane@acme.com bob@beta.io\n'
                               '  openleads lists add "Q4 dentists" --where dental\n'
                               '  openleads lists show "Q4 dentists"')
    li.add_argument("action", nargs="?", choices=["ls", "list", "create", "show", "add", "remove",
                                                  "delete", "rm"])
    li.add_argument("args", nargs="*", help="list name, then emails or domains")
    li.add_argument("--companies", action="store_true", help="company lists instead of people")
    li.add_argument("--all", action="store_true", help="people and company lists")
    li.add_argument("--where", help="add everyone matching these search words")
    li.add_argument("--description")
    li.add_argument("--limit", type=int, default=50)
    li.add_argument("--json", action="store_true")
    li.set_defaults(func=cmd_lists)

    sq = sub.add_parser("seq", aliases=["sequences"], help="multi-step sequences: create, enroll, run",
                        description="Multi-step, multi-channel sequences (same as the dashboard).",
                        formatter_class=argparse.RawDescriptionHelpFormatter,
                        epilog="examples:\n"
                               "  openleads seq\n"
                               '  openleads seq create "Q4 outbound" --pitch "We fix X for Y"\n'
                               '  openleads seq enroll "Q4 outbound" --list "Q4 dentists"\n'
                               "  openleads seq activate 1\n"
                               "  openleads seq run 1            # dry run\n"
                               "  openleads seq run 1 --live")
    sq.add_argument("action", nargs="?", choices=["ls", "list", "show", "create", "enroll", "pause",
                                                  "activate", "archive", "run", "delete", "rm"])
    sq.add_argument("args", nargs="*", help="sequence id or name, then emails for enroll")
    sq.add_argument("--list", help="enroll everyone in this list")
    sq.add_argument("--force", action="store_true", help="enroll unverified emails too")
    sq.add_argument("--blank", action="store_true", help="create without the 5-step starter")
    sq.add_argument("--pitch", help="one line about your offer for {{sender_context}}")
    sq.add_argument("--live", action="store_true", help="actually send (run)")
    sq.add_argument("--now", action="store_true", help="ignore business hours (run)")
    sq.add_argument("--json", action="store_true")
    sq.set_defaults(func=cmd_seq)

    tk = sub.add_parser("tasks", help="your call / email / LinkedIn / to-do queue",
                        formatter_class=argparse.RawDescriptionHelpFormatter,
                        epilog="examples:\n"
                               "  openleads tasks                       # everything open\n"
                               "  openleads tasks --bucket today\n"
                               '  openleads tasks add "Call Jane" --contact jane@acme.com --kind call --due tomorrow\n'
                               "  openleads tasks done 4 5\n"
                               "  openleads tasks snooze 6 --due +3d")
    tk.add_argument("action", nargs="?", choices=["ls", "list", "add", "done", "skip", "reopen",
                                                  "snooze", "delete", "rm"])
    tk.add_argument("args", nargs="*", help="task ids, or the title for add")
    tk.add_argument("--bucket", default="open",
                    choices=["open", "overdue", "today", "upcoming", "nodate", "done", "all"])
    tk.add_argument("--kind", choices=["call", "email", "linkedin", "todo"])
    tk.add_argument("--contact", help="contact email for add")
    tk.add_argument("--due", help="today, tomorrow, +3d, +2h, fri, 2026-11-02")
    tk.add_argument("--note")
    tk.add_argument("--priority", default="normal", choices=["low", "normal", "high"])
    tk.add_argument("--json", action="store_true")
    tk.set_defaults(func=cmd_tasks)

    dl = sub.add_parser("deals", help="your pipeline: board, add, move, won, lost",
                        formatter_class=argparse.RawDescriptionHelpFormatter,
                        epilog="examples:\n"
                               "  openleads deals\n"
                               '  openleads deals add "Acme — annual" --amount 12k --contact jane@acme.com\n'
                               "  openleads deals move 3 proposal\n"
                               "  openleads deals won 3")
    dl.add_argument("action", nargs="?", choices=["ls", "list", "board", "add", "move", "won",
                                                  "lost", "delete", "rm"])
    dl.add_argument("args", nargs="*", help="deal id (+ stage), or the name for add")
    dl.add_argument("--amount", help="12000, 12k, $2.5k")
    dl.add_argument("--stage", choices=["qualify", "meeting", "proposal", "negotiation", "won", "lost"])
    dl.add_argument("--contact")
    dl.add_argument("--company", help="company domain")
    dl.add_argument("--close", help="expected close date YYYY-MM-DD")
    dl.add_argument("--q", help="filter by name or company")
    dl.add_argument("--all", action="store_true", help="show empty Won/Lost columns too")
    dl.add_argument("--json", action="store_true")
    dl.set_defaults(func=cmd_deals)

    im = sub.add_parser("import", help="import a CSV (Apollo, HubSpot, LinkedIn, any spreadsheet)",
                        formatter_class=argparse.RawDescriptionHelpFormatter,
                        epilog="examples:\n"
                               "  openleads import apollo-export.csv --preview\n"
                               '  openleads import contacts.csv --list "Conference leads" --tags event,q4\n'
                               '  openleads import sheet.csv --map "Work Email=email" --map "Notes="')
    im.add_argument("file", help="CSV file (or - for stdin)")
    im.add_argument("--preview", action="store_true", help="show the column mapping and stop")
    im.add_argument("--map", action="append", metavar="HEADER=field",
                    help="override a column's field (empty field = don't import)")
    im.add_argument("--list", help="add the imported people to this list (created if new)")
    im.add_argument("--tags", action="append", help="tags for every imported person")
    im.add_argument("--stage", help="stage for people whose row has none")
    im.add_argument("--source", help="source label (default: import)")
    im.add_argument("--missing-out", metavar="CSV", help="write rows that need an email here")
    im.add_argument("--json", action="store_true")
    im.set_defaults(func=cmd_import)

    dd = sub.add_parser("dedupe", help="find (and --merge) people who appear twice")
    dd.add_argument("--merge", action="store_true", help="merge every group into its best record")
    dd.add_argument("--json", action="store_true")
    dd.set_defaults(func=cmd_dedupe)

    st = sub.add_parser("stats", help="the workspace at a glance")
    st.add_argument("--json", action="store_true")
    st.set_defaults(func=cmd_stats)

    dm = sub.add_parser("demo", help="try the dashboard on an invented demo workspace")
    dm.add_argument("--dir", help="where to keep the demo workspace (default: a temp folder)")
    dm.add_argument("--reset", action="store_true", help="start from a fresh demo")
    dm.add_argument("--port", type=int, default=8788)
    dm.add_argument("--no-open", action="store_true", help="don't open a browser")
    dm.add_argument("--no-serve", action="store_true", help="seed only, don't start the dashboard")
    dm.set_defaults(func=cmd_demo)
