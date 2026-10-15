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


def call(name: str, args: dict) -> dict:
    """Run one workspace tool against the local database."""
    from openleads.db import DB
    db = DB()
    try:
        return HANDLERS[name](db, args or {})
    finally:
        db.close()
