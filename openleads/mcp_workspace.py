"""
Workspace tools for the MCP server — let an AI assistant work your CRM the way
you do in the dashboard: search people and companies, read a contact's full
record, check the pipeline and the task queue, and (with write tools) save
leads to lists, change stages, tag, take notes, create tasks and deals, and
enroll people in sequences.

Read tools carry ``readOnlyHint``; write tools change only the local
workspace (nothing here sends email — sequences send on their own schedule).
"""
from __future__ import annotations

_RO = {"readOnlyHint": True, "openWorldHint": False}
_RW = {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False}


def _obj(props: dict, required=()) -> dict:
    out = {"type": "object", "properties": props}
    if required:
        out["required"] = list(required)
    return out


_S = {"type": "string"}
_LIMIT = {"type": "integer", "minimum": 1, "maximum": 200, "default": 25}
_EMAILS = {"type": "array", "items": {"type": "string"}, "description": "Contact emails."}

TOOLS = [
    {"name": "search_contacts", "annotations": {**_RO, "title": "Search contacts"},
     "description": ("Search the people saved in your OpenLeads workspace (like Apollo's People "
                     "tab). Filter by free text (name, email, company, title), stage, email "
                     "status, seniority, department, tag, list, or minimum ICP fit score. "
                     "Returns contacts with stage, fit score (0-100) and email tier."),
     "inputSchema": _obj({
         "query": {**_S, "description": "Words to match in name, email, company or title."},
         "stage": {**_S, "description": "new, approaching, replied, interested, meeting, customer, "
                                        "not_interested, unresponsive, do_not_contact, bad_data"},
         "tier": {**_S, "description": "Email status: safe or risky."},
         "seniority": {**_S, "description": "owner, founder, c_suite, partner, vp, head, director, "
                                            "manager, senior, entry"},
         "department": {**_S, "description": "e.g. sales, marketing, engineering, executive"},
         "tag": _S, "list": {**_S, "description": "List name."},
         "fit_min": {"type": "integer", "minimum": 0, "maximum": 100},
         "never_contacted": {"type": "boolean"},
         "limit": _LIMIT})},
    {"name": "get_contact", "annotations": {**_RO, "title": "Get a contact"},
     "description": ("Everything about one contact: profile, company, tags, lists, notes, open "
                     "tasks, deals, sequences they're in, and recent activity."),
     "inputSchema": _obj({"email": _S}, ["email"])},
    {"name": "search_companies", "annotations": {**_RO, "title": "Search companies"},
     "description": ("Search companies in the workspace by text, technology they use (e.g. "
                     "HubSpot, Shopify), industry or stage. Returns people counts and tech stack."),
     "inputSchema": _obj({"query": _S, "technology": _S, "industry": _S, "stage": _S,
                          "limit": _LIMIT})},
    {"name": "get_company", "annotations": {**_RO, "title": "Get a company"},
     "description": "One company: profile, tech stack, its people, deals, open tasks and notes.",
     "inputSchema": _obj({"domain": _S}, ["domain"])},
    {"name": "list_tasks", "annotations": {**_RO, "title": "List tasks"},
     "description": "The follow-up queue (calls, emails, LinkedIn touches, to-dos) by due date.",
     "inputSchema": _obj({"bucket": {"type": "string", "enum": ["open", "overdue", "today",
                                                               "upcoming", "done"],
                                     "default": "open"}})},
    {"name": "pipeline", "annotations": {**_RO, "title": "Deal pipeline"},
     "description": ("The deal pipeline by stage with totals: open value, probability-weighted "
                     "forecast, won value and win rate."),
     "inputSchema": _obj({})},
    {"name": "list_sequences", "annotations": {**_RO, "title": "List sequences"},
     "description": "Outreach sequences with their steps, status and reply/bounce numbers.",
     "inputSchema": _obj({})},
    {"name": "workspace_stats", "annotations": {**_RO, "title": "Workspace stats"},
     "description": ("The workspace at a glance: contacts, sends, reply rate, tasks due, "
                     "pipeline, ICP grades and data-quality issues."),
     "inputSchema": _obj({})},
]


def _compact(row: dict, keys) -> dict:
    return {k: row.get(k) for k in keys if row.get(k) not in (None, "", [], {})}


_CONTACT_KEYS = ("email", "name", "title", "organization", "domain", "stage", "tier", "evidence",
                 "fit_score", "seniority", "department", "phone", "linkedin_url", "city", "state",
                 "country", "tags", "lists", "last_contacted", "source")
_COMPANY_KEYS = ("domain", "name", "industry", "company_size", "employees", "stage", "phone",
                 "city", "country", "technologies", "people", "safe", "contacted", "description")


def _contact(r: dict) -> dict:
    out = _compact(r, _CONTACT_KEYS)
    if out.get("lists"):
        out["lists"] = [x["name"] if isinstance(x, dict) else x for x in out["lists"]]
    if r.get("sequence"):
        out["sequence"] = {"name": r["sequence"]["name"], "status": r["sequence"]["status"]}
    return out


def _list_id(db, name: str):
    from openleads.workspace import lists
    lst = lists.by_name(db, name, "people") or (lists.get(db, name) if str(name).isdigit() else None)
    if not lst:
        raise ValueError(f"no people list named '{name}'")
    return lst


def _limit(args) -> int:
    return max(1, min(int(args.get("limit") or 25), 200))


def search_contacts(db, args: dict) -> dict:
    from openleads.workspace import people
    f: dict = {}
    if args.get("query"):
        f["q"] = str(args["query"])
    for key in ("stage", "tier", "seniority", "department"):
        if args.get(key):
            f[key] = [str(args[key])]
    if args.get("tag"):
        f["tags"] = [str(args["tag"])]
    if args.get("list"):
        f["list_id"] = [str(_list_id(db, str(args["list"]))["id"])]
    if args.get("fit_min") is not None:
        f["fit_min"] = int(args["fit_min"])
    if args.get("never_contacted"):
        f["contacted"] = "never"
    res = people.search(db, f, sort="fit", per_page=_limit(args))
    return {"total": res["total"], "contacts": [_contact(r) for r in res["rows"]]}


def get_contact(db, args: dict) -> dict:
    from openleads.workspace import people
    d = people.detail(db, str(args.get("email") or ""))
    if not d:
        raise ValueError(f"{args.get('email')} is not in the workspace")
    acc = d.get("account") or {}
    return {
        "contact": _contact(d["contact"]),
        "company": _compact(acc, _COMPANY_KEYS) if acc else None,
        "notes": [{"text": n["body"], "pinned": bool(n.get("pinned")), "at": n["created"]}
                  for n in d["notes"]],
        "open_tasks": [_compact(t, ("id", "kind", "title", "due", "priority"))
                       for t in d["tasks"] if t["status"] == "open"],
        "deals": [_compact(x, ("id", "name", "stage", "amount", "currency", "close_date"))
                  for x in d["deals"]],
        "sequences": [{"name": e["sequence_name"], "status": e["status"], "step": e["step"] + 1}
                      for e in d["enrollments"]],
        "suppressed": d["suppressed"] or None,
        "recent_activity": [_compact(a, ("kind", "label", "summary", "ts"))
                            for a in d["timeline"][:15]],
    }


def search_companies(db, args: dict) -> dict:
    from openleads.workspace import companies
    f: dict = {}
    if args.get("query"):
        f["q"] = str(args["query"])
    if args.get("technology"):
        f["technologies"] = [str(args["technology"])]
    for key in ("industry", "stage"):
        if args.get(key):
            f[key] = [str(args[key])]
    res = companies.search(db, f, per_page=_limit(args))
    return {"total": res["total"], "companies": [_compact(r, _COMPANY_KEYS) for r in res["rows"]]}


def get_company(db, args: dict) -> dict:
    from openleads.workspace import companies
    d = companies.detail(db, str(args.get("domain") or "").lower())
    if not d:
        raise ValueError(f"{args.get('domain')} is not in the workspace")
    return {"company": _compact(d["account"], _COMPANY_KEYS),
            "people": [_contact(p) for p in d["people"]],
            "deals": [_compact(x, ("id", "name", "stage", "amount")) for x in d["deals"]],
            "open_tasks": [_compact(t, ("id", "title", "due")) for t in d["tasks"]],
            "notes": [n["body"] for n in d["notes"]]}


def list_tasks(db, args: dict) -> dict:
    from openleads.workspace import tasks
    bucket = args.get("bucket") or "open"
    if bucket not in tasks.BUCKETS:
        raise ValueError(f"bucket must be one of {tasks.BUCKETS}")
    rows = tasks.list_tasks(db, bucket, limit=200)
    return {"counts": tasks.counts(db),
            "tasks": [_compact(t, ("id", "kind", "title", "contact", "contact_name", "due",
                                   "priority", "status", "sequence_name", "note")) for t in rows]}


def pipeline(db, args: dict) -> dict:
    from openleads.workspace import deals
    b = deals.board(db)
    return {"totals": b["totals"],
            "stages": [{"stage": c["key"], "probability": c["probability"], "count": c["count"],
                        "value": c["total"],
                        "deals": [_compact(d, ("id", "name", "amount", "currency", "account",
                                               "contact", "close_date")) for d in c["deals"]]}
                       for c in b["columns"]]}


def list_sequences(db, args: dict) -> dict:
    from openleads.workspace import sequences
    out = []
    for s in sequences.list_sequences(db):
        out.append({"id": s["id"], "name": s["name"], "status": s["status"],
                    "steps": [{"type": st["type"], "delay_days": st["delay_days"]}
                              for st in s["steps"]],
                    "stats": _compact(s["stats"], ("active", "contacted", "replied", "reply_rate",
                                                   "bounced", "due_now", "open_tasks"))})
    return {"sequences": out}


def workspace_stats(db, args: dict) -> dict:
    from openleads.workspace import stats
    h = stats.home(db, checklist=False)
    hl = stats.health(db)
    return {"contacts": h["contacts"], "emails": {k: v for k, v in h["emails"].items()
                                                  if k != "warmup"},
            "tasks": h["tasks"], "sequences": h["sequences"], "pipeline": h["deals"],
            "fit_grades": h["grades"],
            "stages": {f["key"]: f["count"] for f in h["funnel"] if f["count"]},
            "data_issues": {c["key"]: c["count"] for c in hl["checks"] if c["count"]},
            "duplicate_groups": hl["duplicates"]["groups"]}


HANDLERS = {
    "search_contacts": search_contacts, "get_contact": get_contact,
    "search_companies": search_companies, "get_company": get_company,
    "list_tasks": list_tasks, "pipeline": pipeline, "list_sequences": list_sequences,
    "workspace_stats": workspace_stats,
}


WRITE_TOOLS = [
    {"name": "save_contacts", "annotations": {**_RW, "title": "Save contacts"},
     "description": ("Save people to the workspace (e.g. results from find_leads), optionally "
                     "into a list and with tags. Existing contacts are updated without blanking "
                     "fields. Each contact needs an email; other fields are optional."),
     "inputSchema": _obj({
         "contacts": {"type": "array", "items": _obj({
             "email": _S, "first_name": _S, "last_name": _S, "name": _S, "title": _S,
             "organization": _S, "phone": _S, "linkedin_url": _S, "city": _S, "country": _S,
             "tier": _S}, ["email"])},
         "list": {**_S, "description": "Add them to this list (created if new)."},
         "tags": {"type": "array", "items": _S}}, ["contacts"])},
    {"name": "add_to_list", "annotations": {**_RW, "title": "Add to list"},
     "description": "Add saved contacts to a people list (created if it doesn't exist).",
     "inputSchema": _obj({"list": _S, "emails": _EMAILS}, ["list", "emails"])},
    {"name": "set_stage", "annotations": {**_RW, "title": "Set stage"},
     "description": ("Move contacts to a stage: new, approaching, replied, interested, meeting, "
                     "customer, not_interested, unresponsive, do_not_contact, bad_data."),
     "inputSchema": _obj({"emails": _EMAILS, "stage": _S}, ["emails", "stage"])},
    {"name": "tag_contacts", "annotations": {**_RW, "title": "Tag contacts"},
     "description": "Add (or with remove=true, remove) tags on contacts.",
     "inputSchema": _obj({"emails": _EMAILS, "tags": {"type": "array", "items": _S},
                          "remove": {"type": "boolean", "default": False}}, ["emails", "tags"])},
    {"name": "add_note", "annotations": {**_RW, "title": "Add a note"},
     "description": "Add a note to a contact's record (call notes, context, next steps).",
     "inputSchema": _obj({"email": _S, "text": _S, "pinned": {"type": "boolean"}},
                         ["email", "text"])},
    {"name": "create_task", "annotations": {**_RW, "title": "Create a task"},
     "description": ("Create a follow-up task. kind: call, email, linkedin or todo. due accepts "
                     "today, tomorrow, +3d, +2h, a weekday (fri) or YYYY-MM-DD."),
     "inputSchema": _obj({"title": _S, "contact": {**_S, "description": "Contact email."},
                          "kind": {"type": "string", "enum": ["call", "email", "linkedin", "todo"]},
                          "due": _S, "note": _S,
                          "priority": {"type": "string", "enum": ["low", "normal", "high"]}},
                         ["title"])},
    {"name": "complete_task", "annotations": {**_RW, "title": "Complete a task"},
     "description": "Mark a task done (a sequence task moves that contact to their next step).",
     "inputSchema": _obj({"id": {"type": "integer"}}, ["id"])},
    {"name": "create_deal", "annotations": {**_RW, "title": "Create a deal"},
     "description": ("Open a deal. stage: qualify, meeting, proposal, negotiation, won, lost. "
                     "amount accepts 12000, 12k or $2.5k."),
     "inputSchema": _obj({"name": _S, "contact": _S, "company": {**_S, "description": "Domain."},
                          "amount": _S, "stage": _S, "close_date": _S}, ["name"])},
    {"name": "move_deal", "annotations": {**_RW, "title": "Move a deal"},
     "description": "Move a deal to another stage (won makes its contact and company customers).",
     "inputSchema": _obj({"id": {"type": "integer"}, "stage": _S}, ["id", "stage"])},
    {"name": "enroll_in_sequence", "annotations": {**_RW, "title": "Enroll in a sequence"},
     "description": ("Add contacts (by email or a whole list) to an existing sequence. People "
                     "who are suppressed, unverified, or already in a sequence are skipped "
                     "with a reason. Nothing is sent immediately; steps run on schedule."),
     "inputSchema": _obj({"sequence": {**_S, "description": "Sequence name or id."},
                          "emails": _EMAILS, "list": _S}, ["sequence"])},
]
TOOLS += WRITE_TOOLS


def _emails(args) -> list:
    out = [str(e).lower().strip() for e in (args.get("emails") or []) if str(e).strip()]
    if not out:
        raise ValueError("emails is required")
    return out


def save_contacts(db, args: dict) -> dict:
    from openleads.workspace import lists, people, scoring, tags
    contacts = args.get("contacts") or []
    if not isinstance(contacts, list) or not contacts:
        raise ValueError("contacts must be a non-empty list")
    created, updated, saved, skipped = 0, 0, [], []
    for c in contacts[:1000]:
        email = str((c or {}).get("email") or "").lower().strip()
        if not people._EMAIL_RE.match(email):
            skipped.append({"email": email, "reason": "not a valid email"})
            continue
        row = {k: str(v) for k, v in c.items() if k in (
            "first_name", "last_name", "name", "title", "organization", "phone", "linkedin_url",
            "city", "country", "tier", "website", "industry") and v}
        if row.get("name") and not (row.get("first_name") or row.get("last_name")):
            parts = row.pop("name").split()
            row["first_name"], row["last_name"] = parts[0], " ".join(parts[1:])
        row.pop("name", None)
        if db.get_lead(email):
            people.update(db, email, {k: v for k, v in row.items() if k in people.EDITABLE})
            updated += 1
        else:
            db.upsert_lead({**row, "email": email, "source": "assistant"})
            created += 1
        saved.append(email)
    if saved:
        scoring.rescore(db, saved)
        if args.get("tags"):
            tags.add(db, saved, [str(t) for t in args["tags"]])
    lst = None
    if saved and args.get("list"):
        lst = lists.ensure(db, str(args["list"]), "people")
        lists.add(db, lst["id"], saved)
    return {"created": created, "updated": updated, "skipped": skipped,
            "list": lst["name"] if lst else None}


def add_to_list(db, args: dict) -> dict:
    from openleads.workspace import lists
    emails = [e for e in _emails(args) if db.get_lead(e)]
    lst = lists.ensure(db, str(args.get("list") or ""), "people")
    n = lists.add(db, lst["id"], emails)
    return {"list": lst["name"], "added": n, "not_in_workspace": len(_emails(args)) - len(emails)}


def set_stage(db, args: dict) -> dict:
    from openleads.workspace import people
    return {"updated": people.bulk(db, _emails(args), "stage", str(args.get("stage") or ""))["count"]}


def tag_contacts(db, args: dict) -> dict:
    from openleads.workspace import tags
    names = [str(t) for t in args.get("tags") or [] if str(t).strip()]
    if not names:
        raise ValueError("tags is required")
    fn = tags.remove if args.get("remove") else tags.add
    return {"changed": fn(db, _emails(args), names)}


def add_note(db, args: dict) -> dict:
    from openleads.workspace import notes
    email = str(args.get("email") or "").lower().strip()
    if not db.get_lead(email):
        raise ValueError(f"{email} is not in the workspace")
    n = notes.add(db, "contact", email, str(args.get("text") or ""), bool(args.get("pinned")))
    return {"note_id": n["id"]}


def create_task(db, args: dict) -> dict:
    from openleads.workspace import tasks
    t = tasks.create(db, str(args.get("title") or ""), kind=args.get("kind") or "todo",
                     contact=str(args.get("contact") or ""), due=args.get("due"),
                     note=str(args.get("note") or ""), priority=args.get("priority") or "normal")
    return _compact(t, ("id", "kind", "title", "contact", "due", "priority"))


def complete_task(db, args: dict) -> dict:
    from openleads.workspace import tasks
    t = tasks.complete(db, args.get("id"))
    if not t:
        raise ValueError(f"no task {args.get('id')}")
    return {"id": t["id"], "status": t["status"]}


def create_deal(db, args: dict) -> dict:
    from openleads.workspace import deals
    d = deals.create(db, str(args.get("name") or ""), account=str(args.get("company") or ""),
                     contact=str(args.get("contact") or ""), stage=args.get("stage") or "qualify",
                     amount=args.get("amount"), close_date=str(args.get("close_date") or ""))
    return _compact(d, ("id", "name", "stage", "amount", "account", "contact", "close_date"))


def move_deal(db, args: dict) -> dict:
    from openleads.workspace import deals
    d = deals.move(db, args.get("id"), str(args.get("stage") or ""))
    if not d:
        raise ValueError(f"no deal {args.get('id')}")
    return {"id": d["id"], "stage": d["stage"]}


def enroll_in_sequence(db, args: dict) -> dict:
    from openleads.workspace import people, sequences
    seq = sequences.get(db, args.get("sequence"))
    if not seq:
        raise ValueError(f"no sequence '{args.get('sequence')}'")
    emails = [str(e).lower() for e in args.get("emails") or []]
    if args.get("list"):
        emails += people.matching_emails(db, {"list_id": [str(_list_id(db, str(args["list"]))["id"])]})
    if not emails:
        raise ValueError("give emails or a list")
    res = sequences.enroll(db, seq["id"], emails)
    return {"sequence": seq["name"], "status": seq["status"], "enrolled": len(res["enrolled"]),
            "skipped": res["skipped"][:50]}


HANDLERS.update({
    "save_contacts": save_contacts, "add_to_list": add_to_list, "set_stage": set_stage,
    "tag_contacts": tag_contacts, "add_note": add_note, "create_task": create_task,
    "complete_task": complete_task, "create_deal": create_deal, "move_deal": move_deal,
    "enroll_in_sequence": enroll_in_sequence,
})


def call(name: str, args: dict) -> dict:
    """Run one workspace tool against the local database."""
    from openleads.db import DB
    db = DB()
    try:
        return HANDLERS[name](db, args or {})
    finally:
        db.close()
