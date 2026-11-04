"""
The node catalog — every step a workflow can use.

A node type declares its typed parameters, its input/output ports and a run
function ``run(ctx, params, items) -> {port: items}``. Items are lead dicts, the
same shape ``openleads find --format json`` prints, so data flows between nodes
the way n8n passes items. Ports that receive no items don't wake the next node.

Effects are honest about the run mode (see :mod:`.runtime`):

* a **test run** never sends, never exports, never notifies and never changes the
  workspace; nodes that would say what they *would* have done;
* a **real run** writes to the workspace and exports, but **Send** only sends when
  the run is live (the workflow is switched to live, or ``--live`` was passed).
  Otherwise sends are previews, exactly like ``openleads run`` without ``--live``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Callable

from openleads.automate.workflow.runtime import item_key, lead_dict, public_item

# --------------------------------------------------------------------------- #
# Catalog types                                                                #
# --------------------------------------------------------------------------- #
GROUPS = ("Triggers", "Leads", "Logic", "Outreach", "Workspace", "Output")


@dataclass
class Param:
    key: str
    label: str
    kind: str = "text"   # text|textarea|number|bool|select|schedule|conditions|list|sequence|template|stage
    default: object = ""
    help: str = ""
    options: tuple = ()
    min: float | None = None
    max: float | None = None
    required: bool = False
    placeholder: str = ""

    def to_dict(self) -> dict:
        d = {"key": self.key, "label": self.label, "kind": self.kind, "default": self.default}
        for k in ("help", "placeholder"):
            if getattr(self, k):
                d[k] = getattr(self, k)
        if self.options:
            d["options"] = [{"value": o[0], "label": o[1]} if isinstance(o, tuple)
                            else {"value": o, "label": str(o)} for o in self.options]
        if self.min is not None:
            d["min"] = self.min
        if self.max is not None:
            d["max"] = self.max
        if self.required:
            d["required"] = True
        return d


@dataclass
class NodeType:
    type: str
    label: str
    group: str
    icon: str
    doc: str
    params: list = field(default_factory=list)
    inputs: tuple = ("in",)
    outputs: tuple = ("out",)
    port_labels: dict = field(default_factory=dict)
    run: Callable | None = None
    trigger: bool = False
    # What flows out: "none" (a bare trigger pulse), "leads", "drafted" (leads with a
    # draft attached) or "same" (whatever came in). Used to type-check edges.
    produces: str = "same"
    # What it needs in: "any", "leads" (real items) or "drafted".
    accepts: str = "leads"
    effect: str = "none"           # none | workspace | external | send
    # Event triggers (new leads, replies) that find nothing end the run quietly.
    quiet_when_empty: bool = False
    on_resume: Callable | None = None
    summary: Callable | None = None

    def to_dict(self) -> dict:
        return {
            "type": self.type, "label": self.label, "group": self.group, "icon": self.icon,
            "doc": self.doc, "params": [p.to_dict() for p in self.params],
            "inputs": list(self.inputs), "outputs": list(self.outputs),
            "port_labels": dict(self.port_labels), "trigger": self.trigger,
            "produces": self.produces, "accepts": self.accepts, "effect": self.effect,
        }

    def defaults(self) -> dict:
        return {p.key: (list(p.default) if isinstance(p.default, list) else p.default)
                for p in self.params}


CATALOG: dict = {}


def node(type_: str, label: str, group: str, icon: str, doc: str, params=(), **kw):
    """Decorator: register ``fn`` as the run function of a node type."""
    def deco(fn):
        CATALOG[type_] = NodeType(type=type_, label=label, group=group, icon=icon, doc=doc,
                                  params=list(params), run=fn, **kw)
        return fn
    return deco


def get_type(type_: str) -> NodeType | None:
    return CATALOG.get(type_)


def catalog() -> list:
    """Every node type as JSON, grouped in palette order."""
    order = {g: i for i, g in enumerate(GROUPS)}
    return [t.to_dict() for t in sorted(CATALOG.values(), key=lambda t: order.get(t.group, 99))]


# --------------------------------------------------------------------------- #
# Lead fields for conditions                                                   #
# --------------------------------------------------------------------------- #
def _choices(pairs) -> tuple:
    return tuple((k, v) for k, v in pairs)


def _seniorities() -> tuple:
    from openleads.insights.titles import SENIORITIES
    return _choices(SENIORITIES)


def _departments() -> tuple:
    from openleads.insights.titles import DEPARTMENTS
    return _choices(DEPARTMENTS)


def _stages() -> tuple:
    from openleads.workspace.stages import CONTACT_STAGES
    return tuple((k, label) for k, label, _ in CONTACT_STAGES)


TIERS = (("safe", "Safe"), ("risky", "Risky"), ("bad", "Bad"))
EVIDENCE = (("found", "Found"), ("pattern", "Pattern"), ("guessed", "Guessed"), ("none", "None"))
GRADES = (("A", "A"), ("B", "B"), ("C", "C"), ("D", "D"))


def fields() -> list:
    """Lead fields a Filter can test: ``{key, label, kind, options?}``."""
    out = [
        ("tier", "Email tier", "enum", TIERS),
        ("evidence", "Email evidence", "enum", EVIDENCE),
        ("fit_grade", "Fit grade", "enum", GRADES),
        ("fit_score", "Fit score", "number", ()),
        ("confidence_pct", "Email confidence %", "number", ()),
        ("seniority", "Seniority", "enum", _seniorities()),
        ("department", "Department", "enum", _departments()),
        ("stage", "Stage", "enum", _stages()),
        ("industry", "Industry", "text", ()),
        ("title", "Job title", "text", ()),
        ("organization", "Company", "text", ()),
        ("country", "Country", "text", ()),
        ("city", "City", "text", ()),
        ("company_size", "Company size", "text", ()),
        ("source", "Source", "text", ()),
        ("tags", "Tags", "text", ()),
        ("has_phone", "Has a phone number", "bool", ()),
        ("has_linkedin", "Has LinkedIn", "bool", ()),
        ("has_email", "Has an email", "bool", ()),
        ("contacted", "Contacted before", "bool", ()),
    ]
    return [{"key": k, "label": label, "kind": kind,
             **({"options": [{"value": a, "label": b} for a, b in opts]} if opts else {})}
            for k, label, kind, opts in out]


FIELD_KEYS = ("tier", "evidence", "fit_grade", "fit_score", "confidence_pct", "seniority",
              "department", "stage", "industry", "title", "organization", "country", "city",
              "company_size", "source", "tags", "has_phone", "has_linkedin", "has_email",
              "contacted")
OPS = (("is", "is"), ("is_not", "is not"), ("in", "is one of"), ("not_in", "is none of"),
       ("contains", "contains"), ("not_contains", "does not contain"),
       ("gte", "at least"), ("lte", "at most"), ("is_true", "is yes"), ("is_false", "is no"),
       ("empty", "is empty"), ("not_empty", "is not empty"))
OP_KEYS = tuple(k for k, _ in OPS)
_UNARY = ("is_true", "is_false", "empty", "not_empty")


def _db_row(ctx, email: str) -> dict:
    """The workspace row for ``email`` (cached per run)."""
    cache = ctx.vars.setdefault("_rows", {})
    if email not in cache:
        cache[email] = (ctx.db.get_lead(email) if (ctx.db is not None and email) else None) or {}
    return cache[email]


def _tags(ctx, email: str) -> list:
    cache = ctx.vars.setdefault("_tags", {})
    if email not in cache:
        from openleads.workspace import tags
        cache[email] = tags.for_contact(ctx.db, email) if (ctx.db is not None and email) else []
    return cache[email]


def _fit(item: dict, ctx) -> int:
    if item.get("fit_score") not in (None, ""):
        try:
            return int(item["fit_score"])
        except (TypeError, ValueError):
            return 0
    return int(_db_row(ctx, item.get("email", "")).get("fit_score") or 0)


def field_value(item: dict, key: str, ctx):
    """The value of a condition field for one item."""
    email = (item.get("email") or "").lower()
    if key == "fit_score":
        return _fit(item, ctx)
    if key == "fit_grade":
        from openleads.workspace.scoring import grade
        return grade(_fit(item, ctx))
    if key == "has_phone":
        return bool(item.get("phone"))
    if key == "has_linkedin":
        return bool(item.get("linkedin_url") or (item.get("socials") or {}).get("linkedin"))
    if key == "has_email":
        return bool(email)
    if key == "stage":
        return item.get("stage") or _db_row(ctx, email).get("stage") or "new"
    if key == "tags":
        return list(item.get("tags") or []) or _tags(ctx, email)
    if key == "contacted":
        return bool(item.get("last_contacted") or _db_row(ctx, email).get("last_contacted"))
    if key == "evidence":
        if item.get("evidence"):
            return item["evidence"]
        from openleads.models import evidence_of
        return evidence_of(email, item.get("signals")) if email else "none"
    if key == "tier":
        return item.get("tier") or "bad"
    return item.get(key, "")


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _split_csv(v) -> list:
    if isinstance(v, (list, tuple)):
        return [str(x).strip().lower() for x in v if str(x).strip()]
    return [x.strip().lower() for x in str(v or "").split(",") if x.strip()]


def check(cond: dict, item: dict, ctx) -> bool:
    """Evaluate one ``{field, op, value}`` condition against an item (pure apart from DB reads)."""
    op = cond.get("op") or "is"
    v = field_value(item, cond.get("field") or "", ctx)
    target = cond.get("value", "")
    if op == "is_true":
        return bool(v)
    if op == "is_false":
        return not v
    if op == "empty":
        return v in (None, "", [], 0) or v is False
    if op == "not_empty":
        return not (v in (None, "", [], 0) or v is False)
    if op in ("gte", "lte"):
        a, b = _num(v), _num(target)
        return a >= b if op == "gte" else a <= b
    if isinstance(v, list):
        vals = [str(x).lower() for x in v]
        wanted = _split_csv(target)
        if op in ("is", "in", "contains"):
            return any(w in vals for w in wanted) if op != "contains" else \
                any(w in x for w in wanted for x in vals)
        if op in ("is_not", "not_in"):
            return not any(w in vals for w in wanted)
        if op == "not_contains":
            return not any(w in x for w in wanted for x in vals)
        return False
    text = str(v if v is not None else "").lower()
    if isinstance(v, bool):
        text = "yes" if v else "no"
    if op == "is":
        return text == str(target).strip().lower()
    if op == "is_not":
        return text != str(target).strip().lower()
    if op == "in":
        return text in _split_csv(target)
    if op == "not_in":
        return text not in _split_csv(target)
    if op == "contains":
        return str(target).strip().lower() in text
    if op == "not_contains":
        return str(target).strip().lower() not in text
    return False


def describe_condition(cond: dict) -> str:
    labels = {f["key"]: f["label"] for f in fields()}
    ops = dict(OPS)
    f = labels.get(cond.get("field"), cond.get("field") or "?")
    op = cond.get("op") or "is"
    if op in _UNARY:
        return f"{f} {ops.get(op, op)}"
    return f"{f} {ops.get(op, op)} {cond.get('value', '')}"


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #
def _emails(items) -> list:
    out, seen = [], set()
    for it in items:
        e = (it.get("email") or "").lower().strip()
        if e and e not in seen:
            seen.add(e)
            out.append(e)
    return out


def _ensure_saved(ctx, items) -> list:
    """Make sure every item with an email exists in the workspace; return the emails."""
    emails = []
    for it in items:
        e = (it.get("email") or "").lower().strip()
        if not e:
            continue
        if not _db_row(ctx, e):
            ctx.db.upsert_lead(public_item(it))
            ctx.vars.setdefault("_rows", {}).pop(e, None)
        emails.append(e)
    return list(dict.fromkeys(emails))


def _save_found(ctx, leads) -> list:
    """Upsert found leads, rescore them and return item dicts with fit + stage."""
    items = []
    for ld in leads:
        d = lead_dict(ld)
        if ctx.db is not None and d.get("email"):
            ctx.db.upsert_lead(ld.to_dict() if hasattr(ld, "to_dict") else public_item(d))
        items.append(d)
    emails = _emails(items)
    if ctx.db is not None and emails:
        from openleads.workspace import scoring
        scoring.rescore(ctx.db, emails)
        rows = {r["email"]: r for r in ctx.db.query(
            f"SELECT email, fit_score, stage FROM leads WHERE email IN "
            f"({','.join('?' for _ in emails)})", emails)}
        for it in items:
            r = rows.get(it.get("email", ""))
            if r:
                it["fit_score"] = r.get("fit_score") or 0
                it["stage"] = r.get("stage") or "new"
    return items


def _render(text: str, item: dict) -> str:
    from openleads.workspace import templates as tplmod
    out, _ = tplmod.render(text or "", tplmod.context_for(item))
    return out


def _progress_handler(ctx, counter: list):
    def on_progress(kind, payload):
        if kind == "phase":
            ctx.phase(str(payload))
        elif kind == "lead":
            counter[0] += 1
            ctx.emit({"type": "progress", "node": ctx.node.get("id", ""), "count": counter[0]})
    return on_progress


def _would(ctx, text: str) -> None:
    ctx.note(f"test run: would {text}")


# --------------------------------------------------------------------------- #
# Triggers                                                                     #
# --------------------------------------------------------------------------- #
@node("trigger.manual", "Manual", "Triggers", "hand",
      "Runs when you press Test run or Run, or call `openleads workflow run NAME`.",
      inputs=(), trigger=True, produces="none", accepts="any")
def run_manual(ctx, params, items):
    return {"out": [lead_dict(x) for x in (ctx.trigger.get("items") or [])]}


@node("trigger.schedule", "Schedule", "Triggers", "clock",
      "Runs on a schedule once the workflow is active and `openleads schedule on` is "
      "installed. Plain English or cron: `weekdays 9am`, `every 2h`, `0 9 * * 1-5`.",
      params=[Param("schedule", "When it runs", "schedule", "weekdays 09:00", required=True,
                    help="Plain English or cron.", placeholder="weekdays 09:00")],
      inputs=(), trigger=True, produces="none", accepts="any")
def run_schedule(ctx, params, items):
    return {"out": []}


@node("trigger.new_leads", "New leads", "Triggers", "radar",
      "Searches on a schedule and passes on only leads at companies it hasn't seen "
      "before, like a watcher. The first run remembers everything it finds.",
      params=[Param("query", "Watch for", "text", "", required=True,
                    placeholder="new dental clinics in Austin"),
              Param("count", "Leads to check", "number", 25, min=1, max=500),
              Param("schedule", "How often", "schedule", "daily 09:00", required=True)],
      inputs=(), trigger=True, produces="leads", accepts="any", quiet_when_empty=True)
def run_new_leads(ctx, params, items):
    from openleads.automate import watch
    from openleads.automate.recipes import BACKGROUND_BUDGET
    q = ctx.svc("parse_query")(params.get("query") or "")
    q.count = int(params.get("count") or 25)
    q.budget = BACKGROUND_BUDGET
    counter = [0]
    leads = ctx.svc("build_leads")(q, cache=ctx.cache, db=ctx.db,
                                   on_progress=_progress_handler(ctx, counter))
    key = f"seen:{ctx.node['id']}"
    seen = set(ctx.state.get(key) or [])
    new, domains = watch.diff_new(leads, seen)
    if not ctx.test:
        ctx.state[key] = sorted(seen | set(domains))
    ctx.note(f"{len(new)} new of {len(leads)} found")
    return {"out": _save_found(ctx, new)}


@node("trigger.reply", "Reply received", "Triggers", "reply",
      "Fires for each contact who replied since the last run. Replies come from the "
      "inbox scan the scheduler runs on every wake-up (IMAP), or from marking a contact "
      "as replied yourself.",
      params=[Param("scan_inbox", "Scan the inbox first", "bool", True,
                    help="Checks IMAP for new replies before looking (real runs only)."),
              Param("lookback_days", "First run looks back", "number", 7, min=0, max=90,
                    help="Days of replies the very first run picks up.")],
      inputs=(), trigger=True, produces="leads", accepts="any", quiet_when_empty=True)
def run_reply(ctx, params, items):
    if params.get("scan_inbox") and not ctx.test:
        res = ctx.svc("inbox_scan")(ctx.db) or {}
        if res.get("replied"):
            ctx.note(f"inbox scan found {res['replied']} new replies")
    key = f"since:{ctx.node['id']}"
    now = ctx.timestamp()
    since = ctx.state.get(key)
    if since is None:
        since = now - float(params.get("lookback_days") or 0) * 86400
    rows = ctx.db.query(
        "SELECT ref AS email, MAX(ts) AS ts FROM activity WHERE ref_type='contact' "
        "AND kind='replied' AND ts > ? GROUP BY ref ORDER BY ts", (float(since),))
    out = []
    for r in rows:
        lead = ctx.db.get_lead(r["email"])
        if lead:
            d = lead_dict({k: v for k, v in lead.items() if k != "data"})
            d["replied_at"] = r["ts"]
            out.append(d)
    if not ctx.test:
        ctx.state[key] = max([float(since)] + [float(r["ts"]) for r in rows]) if rows else now
    ctx.note(f"{len(out)} replies")
    return {"out": out}


# --------------------------------------------------------------------------- #
# Leads                                                                        #
# --------------------------------------------------------------------------- #
@node("find", "Find leads", "Leads", "find",
      "Searches the sources that fit your sentence, verifies every address and saves "
      "the leads to People. Optional filters narrow the search.",
      params=[Param("query", "Audience", "text", "", required=True,
                    placeholder="marketing agencies in Miami",
                    help="Describe who you want. The engine picks the sources."),
              Param("count", "Leads per run", "number", 25, min=1, max=1000),
              Param("verified_only", "Deliverable (safe) leads only", "bool", True),
              Param("location", "Location", "text", "", placeholder="Austin, TX"),
              Param("industry", "Industry", "text", ""),
              Param("title", "Job title", "text", "", placeholder="founder"),
              Param("seniority", "Seniority", "text", "",
                    help="Comma separated: owner, founder, c_suite, vp, director…")],
      produces="leads", accepts="any")
def run_find(ctx, params, items):
    from openleads.automate.recipes import BACKGROUND_BUDGET
    q = ctx.svc("parse_query")(params.get("query") or "")
    q.count = int(params.get("count") or 25)
    q.verified_only = bool(params.get("verified_only", True))
    q.budget = BACKGROUND_BUDGET
    for key in ("location", "industry", "title"):
        if params.get(key):
            setattr(q, key, str(params[key]).strip())
    if params.get("seniority"):
        q.seniority = _split_csv(params["seniority"])
    ctx.vars.setdefault("campaign", q.keyword or "default")
    ctx.phase("finding & verifying leads…")
    counter = [0]
    leads = ctx.svc("build_leads")(q, cache=ctx.cache, db=ctx.db,
                                   on_progress=_progress_handler(ctx, counter))
    out = _save_found(ctx, leads)
    safe = sum(1 for x in out if x.get("tier") == "safe")
    ctx.note(f"found {len(out)} leads, {safe} safe")
    return {"out": out}


@node("contacts", "Load contacts", "Leads", "users",
      "Pulls contacts already in your workspace: by stage, tag, list, fit, and when "
      "you last emailed them. Use it to re-engage or follow up.",
      params=[Param("stage", "Stage", "stage", "", help="Leave empty for any stage."),
              Param("tag", "Tag", "text", ""),
              Param("list", "List", "list", ""),
              Param("min_fit", "Minimum fit score", "number", 0, min=0, max=100),
              Param("contacted", "Last emailed", "select", "any",
                    options=(("any", "Any time or never"), ("never", "Never"),
                             ("ever", "At least once"), ("older", "More than N days ago"))),
              Param("days", "N days", "number", 30, min=1, max=3650),
              Param("limit", "At most", "number", 100, min=1, max=500)],
      produces="leads", accepts="any")
def run_contacts(ctx, params, items):
    from openleads.workspace import lists, people
    f: dict = {}
    if params.get("stage"):
        f["stage"] = [params["stage"]]
    if params.get("tag"):
        f["tags"] = [params["tag"]]
    if params.get("list"):
        lst = lists.by_name(ctx.db, str(params["list"]), "people")
        if not lst:
            ctx.note(f"no list named '{params['list']}'")
            return {"out": []}
        f["list_id"] = [str(lst["id"])]
    if params.get("min_fit"):
        f["fit_min"] = int(params["min_fit"])
    mode = params.get("contacted") or "any"
    if mode in ("never", "ever"):
        f["contacted"] = mode
    elif mode == "older":
        f["contacted"] = "ever"
    limit = max(1, min(int(params.get("limit") or 100), 500))
    rows = people.search(ctx.db, f, sort="fit", per_page=500 if mode == "older" else limit)["rows"]
    if mode == "older":
        cutoff = ctx.timestamp() - float(params.get("days") or 30) * 86400
        rows = [r for r in rows if (r.get("last_contacted") or 0) < cutoff]
    out = [lead_dict(r) for r in rows[:limit]]
    for it in out:
        it["lists"] = [x["name"] if isinstance(x, dict) else x for x in it.get("lists") or []]
        it.pop("sequence", None)
    ctx.note(f"loaded {len(out)} contacts")
    return {"out": out}


@node("enrich", "Enrich CSV or list", "Leads", "upload",
      "Finds and verifies emails for people you already know: rows of a CSV file, a "
      "workspace list, or the items coming in (name plus company or domain).",
      params=[Param("source", "Rows from", "select", "input",
                    options=(("input", "Incoming items"), ("csv", "A CSV file"),
                             ("list", "A workspace list"))),
              Param("path", "CSV file", "text", "", placeholder="~/leads/people.csv"),
              Param("list", "List", "list", ""),
              Param("deep", "Deep search", "bool", False,
                    help="Slower: reads more pages to confirm each address.")],
      produces="leads", accepts="any")
def run_enrich(ctx, params, items):
    src = params.get("source") or "input"
    if src == "csv":
        from pathlib import Path

        from openleads import enrich
        path = Path(str(params.get("path") or "")).expanduser()
        if not str(params.get("path") or "").strip():
            raise ValueError("Enrich needs a CSV file path")
        if not path.is_file():
            raise ValueError(f"no such CSV file: {path}")
        rows = enrich.read_rows(str(path))
    elif src == "list":
        from openleads.workspace import lists
        lst = lists.by_name(ctx.db, str(params.get("list") or ""), "people")
        if not lst:
            raise ValueError(f"no list named '{params.get('list')}'")
        rows = [ctx.db.get_lead(e) or {"email": e} for e in lists.members(ctx.db, lst["id"])]
    else:
        rows = items
    rows = [{k: v for k, v in dict(r).items() if k != "data"} for r in rows]
    ctx.phase(f"enriching {len(rows)} rows…")
    counter = [0]
    leads = ctx.svc("enrich_rows")(rows, cache=ctx.cache, db=None if ctx.test else ctx.db,
                                   deep=bool(params.get("deep")),
                                   on_progress=_progress_handler(ctx, counter))
    out = [lead_dict(ld) for ld in leads]
    ctx.note(f"enriched {len(out)} rows, {sum(1 for x in out if x.get('tier') == 'safe')} safe")
    return {"out": out}


@node("lookup_company", "Look up company", "Leads", "building",
      "Reads each company's homepage once: industry, size, phone, socials and tech "
      "stack. Fills blanks on the items and, on real runs, on the company record.",
      params=[Param("max", "Companies per run", "number", 25, min=1, max=200)])
def run_lookup(ctx, params, items):
    limit = int(params.get("max") or 25)
    profiles: dict = {}
    for it in items:
        d = it.get("domain") or ""
        if d and d not in profiles and len(profiles) < limit:
            profiles[d] = ctx.svc("fetch_profile")(d, cache=ctx.cache) or {}
    out = []
    for it in items:
        it = dict(it)
        p = profiles.get(it.get("domain") or "") or {}
        if p and not p.get("error"):
            for src, dst in (("industry", "industry"), ("description", "description"),
                             ("size", "company_size"), ("employees", "employees")):
                if p.get(src) and not it.get(dst):
                    it[dst] = p[src]
            if p.get("phone") and not it.get("phone"):
                it["phone"] = p["phone"]
            if p.get("technologies"):
                it["technologies"] = list(p["technologies"])
            if p.get("socials"):
                it["socials"] = {**(p.get("socials") or {}), **(it.get("socials") or {})}
        out.append(it)
    ok = [d for d, p in profiles.items() if p and not p.get("error")]
    if not ctx.test and ctx.db is not None:
        from openleads.workspace import companies
        for d in ok:
            companies.apply_profile(ctx.db, d, profiles[d])
    ctx.note(f"looked up {len(profiles)} companies, {len(ok)} answered")
    return {"out": out}


@node("verify", "Verify emails", "Leads", "shield",
      "Re-checks each address and updates its tier (safe, risky, bad) and confidence. "
      "Leads from Find are already verified; use this for lists and imports.",
      params=[Param("skip_verified", "Skip addresses that already have a tier", "bool", False)])
def run_verify(ctx, params, items):
    out = []
    checked = 0
    for it in items:
        it = dict(it)
        email = it.get("email") or ""
        if email and not (params.get("skip_verified") and it.get("tier") in ("safe", "risky", "bad")):
            res = ctx.svc("verify_address")(email, cache=ctx.cache, db=ctx.db)
            it.update({"tier": res.tier, "score": res.score, "confidence": res.confidence,
                       "reasons": list(res.reasons or [])})
            if getattr(res, "signals", None) is not None:
                it["signals"] = res.signals
            checked += 1
        out.append(it)
    ctx.note(f"verified {checked} addresses")
    return {"out": out}


# --------------------------------------------------------------------------- #
# Logic                                                                        #
# --------------------------------------------------------------------------- #
@node("filter", "Filter (if)", "Logic", "filter",
      "Splits items on conditions about the lead: tier, evidence, fit grade, seniority, "
      "industry, stage, tags, has a phone… Matching items leave by *true*, the rest by "
      "*false*.",
      params=[Param("match", "Pass when", "select", "all",
                    options=(("all", "All conditions match"), ("any", "Any condition matches"))),
              Param("conditions", "Conditions", "conditions",
                    [{"field": "tier", "op": "is", "value": "safe"}])],
      outputs=("true", "false"), port_labels={"true": "true", "false": "false"})
def run_filter(ctx, params, items):
    conds = [c for c in (params.get("conditions") or []) if c.get("field")]
    match_any = params.get("match") == "any"
    yes, no = [], []
    for it in items:
        if not conds:
            ok = True
        elif match_any:
            ok = any(check(c, it, ctx) for c in conds)
        else:
            ok = all(check(c, it, ctx) for c in conds)
        (yes if ok else no).append(it)
    return {"true": yes, "false": no}


@node("split_tier", "Split by tier", "Logic", "layers",
      "Routes each lead by its email tier: *safe* (deliverable), *risky* (a guess that "
      "may bounce) and *bad* (don't email).",
      outputs=("safe", "risky", "bad"),
      port_labels={"safe": "safe", "risky": "risky", "bad": "bad"})
def run_split(ctx, params, items):
    out: dict = {"safe": [], "risky": [], "bad": []}
    for it in items:
        tier = it.get("tier") if it.get("tier") in out else "bad"
        if not it.get("email"):
            tier = "bad"
        out[tier].append(it)
    return out


@node("dedupe", "Skip contacted", "Logic", "merge",
      "Drops duplicates and anyone you shouldn't email again: already contacted, "
      "suppressed (bounced, unsubscribed, do not contact) or already in a sequence.",
      params=[Param("skip_contacted", "Skip anyone already emailed", "bool", True),
              Param("within_days", "Only if emailed in the last N days", "number", 0, min=0,
                    max=3650, help="0 means ever."),
              Param("skip_in_sequence", "Skip anyone in a sequence", "bool", True),
              Param("per_company", "One lead per company", "bool", False)])
def run_dedupe(ctx, params, items):
    seen, domains, out = set(), set(), []
    dropped = {"duplicate": 0, "contacted": 0, "suppressed": 0, "sequence": 0, "company": 0}
    cutoff = 0.0
    if int(params.get("within_days") or 0) > 0:
        cutoff = ctx.timestamp() - int(params["within_days"]) * 86400
    in_seq: set = set()
    if params.get("skip_in_sequence") and ctx.db is not None:
        in_seq = {r["email"] for r in ctx.db.query(
            "SELECT email FROM enrollments WHERE status IN ('active', 'paused')")}
    for it in items:
        key = item_key(it)
        email = (it.get("email") or "").lower()
        if key in seen:
            dropped["duplicate"] += 1
            continue
        seen.add(key)
        if email and ctx.db is not None:
            row = _db_row(ctx, email)
            if ctx.db.is_suppressed(email) or row.get("stage") in ("do_not_contact", "bad_data"):
                dropped["suppressed"] += 1
                continue
            if params.get("skip_contacted", True):
                last = row.get("last_contacted")
                if last and float(last) >= cutoff:
                    dropped["contacted"] += 1
                    continue
            if email in in_seq:
                dropped["sequence"] += 1
                continue
        if params.get("per_company"):
            d = it.get("domain") or ""
            if d and d in domains:
                dropped["company"] += 1
                continue
            domains.add(d)
        out.append(it)
    parts = [f"{n} {k}" for k, n in dropped.items() if n]
    ctx.note(f"kept {len(out)}" + (f", dropped {', '.join(parts)}" if parts else ""))
    return {"out": out}


@node("limit", "Limit", "Logic", "minus",
      "Keeps the first N items, optionally the best first by fit or email confidence.",
      params=[Param("max", "Keep at most", "number", 25, min=1, max=10000),
              Param("sort_by", "Best first by", "select", "",
                    options=(("", "Keep the current order"), ("fit_score", "Fit score"),
                             ("confidence_pct", "Email confidence")))])
def run_limit(ctx, params, items):
    key = params.get("sort_by") or ""
    rows = list(items)
    if key == "fit_score":
        rows.sort(key=lambda it: -_fit(it, ctx))
    elif key:
        rows.sort(key=lambda it: -_num(it.get(key)))
    return {"out": rows[:max(1, int(params.get("max") or 25))]}


# --------------------------------------------------------------------------- #
# Outreach                                                                     #
# --------------------------------------------------------------------------- #
@node("write", "Write email", "Outreach", "compose",
      "Drafts a short, plain-text, spam-checked email for each lead with an address, "
      "with your AI key if one is set, or from a saved template.",
      params=[Param("pitch", "What you are offering", "textarea", "",
                    placeholder="our local SEO service for dental clinics",
                    help="One line is enough. Empty uses the pitch from Settings."),
              Param("template", "Use a saved template", "template", "",
                    help="Leave empty to write each email for the lead.")],
      produces="drafted")
def run_write(ctx, params, items):
    out = []
    for it in items:
        if not it.get("email"):
            continue
        it = dict(it)
        it["draft"] = ctx.svc("write_email")(it, pitch=params.get("pitch") or "",
                                             template=params.get("template") or "", db=ctx.db)
        out.append(it)
        ctx.emit({"type": "progress", "node": ctx.node.get("id", ""), "count": len(out)})
    ctx.note(f"wrote {len(out)} drafts")
    return {"out": out}


def _stop_on_reply(ctx, params, items):
    """When a Wait wakes, drop anyone who replied, bounced or opted out meanwhile."""
    if not params.get("stop_on_reply", True):
        return items
    stop_stages = {"replied", "interested", "meeting", "customer", "not_interested",
                   "do_not_contact", "bad_data"}
    keep = []
    for it in items:
        email = (it.get("email") or "").lower()
        row = (ctx.db.get_lead(email) if email else None) or {}
        if row.get("status") in ("replied", "bounced", "unsubscribed", "do_not_contact") \
                or row.get("stage") in stop_stages or (email and ctx.db.is_suppressed(email)):
            continue
        keep.append(it)
    return keep


@node("wait", "Wait", "Outreach", "clock",
      "Holds items for a while, then sends them on. Items wait in the database, so "
      "nothing needs to stay open: the scheduler wakes them on its next run. Anyone "
      "who replies in the meantime is dropped.",
      params=[Param("days", "Wait days", "number", 3, min=0, max=365),
              Param("hours", "Plus hours", "number", 0, min=0, max=23),
              Param("business_hours", "Resume inside business hours", "bool", True,
                    help="Weekdays 08:00 to 11:00 and 13:00 to 16:00."),
              Param("stop_on_reply", "Drop anyone who replied", "bool", True)],
      on_resume=_stop_on_reply)
def run_wait(ctx, params, items):
    seconds = float(params.get("days") or 0) * 86400 + float(params.get("hours") or 0) * 3600
    wake = ctx.now + timedelta(seconds=seconds)
    if params.get("business_hours", True):
        wake = ctx.svc("next_send_slot")(wake)
    when = wake.strftime("%a %d %b %H:%M")
    if ctx.test:
        _would(ctx, f"hold {len(items)} items until {when}; passing them on now")
        return {"out": items}
    ctx.park(items, wake.timestamp())
    ctx.note(f"{len(items)} waiting until {when}")
    return {"out": []}


@node("send", "Send", "Outreach", "send",
      "Sends each draft from your mailbox inside your warmup cap, skipping suppressed "
      "addresses. Previews unless the run is live. Live sends outside business hours "
      "wait for the next send window.",
      params=[Param("campaign", "Campaign name", "text", "",
                    help="Groups the sends in reports. Empty uses the search keyword."),
              Param("respect_window", "Only send inside business hours", "bool", True),
              Param("followups", "Start the follow-up sequence", "bool", False,
                    help="The classic follow-ups the drip sends to non-repliers.")],
      accepts="drafted", effect="send")
def run_send(ctx, params, items):
    drafts, by_email = [], {}
    for it in items:
        d = it.get("draft")
        if not d:
            d = ctx.svc("write_email")(it, db=ctx.db)
        d = {**d, "email": d.get("email") or it.get("email", "")}
        drafts.append(d)
        by_email[d["email"].lower()] = it
    campaign = params.get("campaign") or ctx.vars.get("campaign") or f"wf:{ctx.name}"
    if ctx.test:
        out = []
        for d in drafts:
            reason = ctx.db.is_suppressed(d["email"]) if ctx.db is not None else None
            it = dict(by_email[d["email"].lower()])
            it["send"] = {"status": "skipped" if reason else "preview",
                          "detail": f"suppressed: {reason}" if reason else "test run"}
            if not reason:
                out.append(it)
        ctx.vars["previewed"] = ctx.vars.get("previewed", 0) + len(out)
        _would(ctx, f"send {len(out)} emails (nothing was sent)")
        return {"out": out}
    if ctx.live and params.get("respect_window", True) and not ctx.svc("in_send_window")(ctx.now):
        slot = ctx.svc("next_send_slot")(ctx.now)
        ctx.park([dict(by_email[d["email"].lower()]) for d in drafts], slot.timestamp())
        ctx.note(f"outside the send window: {len(drafts)} waiting until "
                 f"{slot.strftime('%a %d %b %H:%M')}")
        ctx.vars["parked_send"] = len(drafts)
        return {"out": []}
    results = ctx.svc("send_drafts")(drafts, dry_run=not ctx.live, db=ctx.db, campaign=campaign,
                                     on_progress=lambda r: ctx.emit(
                                         {"type": "send", "node": ctx.node.get("id", ""),
                                          "result": r.to_dict() if hasattr(r, "to_dict") else r}))
    out, counts = [], {}
    for r in results:
        status = r.status if hasattr(r, "status") else r.get("status")
        email = (r.email if hasattr(r, "email") else r.get("email", "")).lower()
        counts[status] = counts.get(status, 0) + 1
        it = dict(by_email.get(email) or {"email": email})
        it["send"] = {"status": status,
                      "detail": (r.detail or r.error) if hasattr(r, "detail") else r.get("detail", "")}
        if status in ("sent", "preview"):
            out.append(it)
    ctx.vars["sent"] = ctx.vars.get("sent", 0) + counts.get("sent", 0)
    ctx.vars["previewed"] = ctx.vars.get("previewed", 0) + counts.get("preview", 0)
    ctx.note(", ".join(f"{n} {k}" for k, n in sorted(counts.items())) or "nothing to send")
    return {"out": out}


# --------------------------------------------------------------------------- #
# Workspace                                                                    #
# --------------------------------------------------------------------------- #
@node("add_to_list", "Add to list", "Workspace", "list",
      "Adds each contact to a people list, creating the list if it doesn't exist.",
      params=[Param("list", "List", "list", "", required=True, placeholder="Hot leads")],
      effect="workspace")
def run_add_to_list(ctx, params, items):
    name = str(params.get("list") or "").strip()
    emails = _emails(items)
    if ctx.test:
        _would(ctx, f"add {len(emails)} contacts to '{name}'")
        return {"out": items}
    from openleads.workspace import lists
    _ensure_saved(ctx, items)
    lst = lists.ensure(ctx.db, name, "people")
    n = lists.add(ctx.db, lst["id"], emails)
    ctx.note(f"added {n} to '{lst['name']}'")
    return {"out": items}


@node("enroll", "Enroll in sequence", "Workspace", "sequence",
      "Enrolls each contact in a sequence. The sequence's own rules apply: suppressed, "
      "risky (unless allowed) and already-enrolled contacts are skipped.",
      params=[Param("sequence", "Sequence", "sequence", "", required=True),
              Param("force", "Re-enroll people who finished it before", "bool", False)],
      effect="workspace")
def run_enroll(ctx, params, items):
    from openleads.workspace import sequences
    name = params.get("sequence") or ""
    seq = sequences.get(ctx.db, name)
    if not seq:
        raise ValueError(f"no sequence named '{name}'")
    emails = _emails(items)
    if ctx.test:
        _would(ctx, f"enroll {len(emails)} contacts in '{seq['name']}'")
        return {"out": items}
    _ensure_saved(ctx, items)
    res = sequences.enroll(ctx.db, seq["id"], emails, force=bool(params.get("force")))
    enrolled = set(res.get("enrolled") or [])
    ctx.note(f"enrolled {len(enrolled)}, skipped {len(res.get('skipped') or [])}")
    return {"out": [it for it in items if (it.get("email") or "").lower() in enrolled]}


@node("set_stage", "Set stage", "Workspace", "flag",
      "Moves each contact to a stage (approaching, interested, meeting…).",
      params=[Param("stage", "Stage", "stage", "interested", required=True)],
      effect="workspace")
def run_set_stage(ctx, params, items):
    stage = params.get("stage") or ""
    emails = _emails(items)
    if ctx.test:
        _would(ctx, f"move {len(emails)} contacts to {stage}")
        return {"out": items}
    from openleads.workspace import people
    _ensure_saved(ctx, items)
    n = people.bulk(ctx.db, emails, "stage", stage)["count"]
    ctx.note(f"moved {n} to {stage}")
    return {"out": [{**it, "stage": stage} for it in items]}


@node("create_task", "Create task", "Workspace", "task",
      "Creates a task per contact: a call, an email, a LinkedIn touch or a to-do. "
      "Titles can use {{first_name}}, {{company}}, {{title}}.",
      params=[Param("title", "Title", "text", "Follow up with {{first_name}}", required=True),
              Param("kind", "Kind", "select", "todo",
                    options=(("call", "Call"), ("email", "Email"), ("linkedin", "LinkedIn"),
                             ("todo", "To-do"))),
              Param("due", "Due", "text", "tomorrow",
                    help="now, today, tomorrow, +3d, mon, or a date."),
              Param("priority", "Priority", "select", "normal",
                    options=(("low", "Low"), ("normal", "Normal"), ("high", "High"))),
              Param("note", "Note", "textarea", "")],
      effect="workspace")
def run_create_task(ctx, params, items):
    from openleads.workspace import tasks
    tasks.parse_due(params.get("due") or None, ctx.timestamp())   # validate early
    titles = [(it, _render(params.get("title") or "Follow up", it)) for it in items
              if it.get("email")]
    if ctx.test:
        sample = titles[0][1] if titles else ""
        _would(ctx, f"create {len(titles)} tasks" + (f", like “{sample}”" if sample else ""))
        return {"out": items}
    _ensure_saved(ctx, items)
    made = 0
    for it, title in titles:
        email = it["email"].lower()
        if ctx.db.query_one("SELECT 1 FROM tasks WHERE contact=? AND status='open' AND title=?",
                            (email, title)):
            continue
        tasks.create(ctx.db, title, kind=params.get("kind") or "todo", contact=email,
                     due=params.get("due") or None, note=_render(params.get("note") or "", it),
                     priority=params.get("priority") or "normal")
        made += 1
    ctx.note(f"created {made} tasks")
    return {"out": items}


@node("tag", "Tag", "Workspace", "tag",
      "Adds (or removes) tags on each contact.",
      params=[Param("tags", "Tags", "text", "", required=True, placeholder="q4, warm",
                    help="Comma separated."),
              Param("remove", "Remove these tags instead", "bool", False)],
      effect="workspace")
def run_tag(ctx, params, items):
    names = [t.strip() for t in str(params.get("tags") or "").split(",") if t.strip()]
    emails = _emails(items)
    verb = "untag" if params.get("remove") else "tag"
    if ctx.test:
        _would(ctx, f"{verb} {len(emails)} contacts: {', '.join(names)}")
        return {"out": items}
    from openleads.workspace import tags
    _ensure_saved(ctx, items)
    fn = tags.remove if params.get("remove") else tags.add
    n = fn(ctx.db, emails, names)
    ctx.note(f"{verb}ged {n}")
    return {"out": items}


# --------------------------------------------------------------------------- #
# Output                                                                       #
# --------------------------------------------------------------------------- #
def _sinks() -> tuple:
    from openleads.automate.exporters import SINKS
    labels = {"csv": "CSV file", "json": "JSON file", "ndjson": "NDJSON file",
              "sheets": "Google Sheets (CSV)", "webhook": "Webhook (n8n, Zapier, Make)",
              "notion": "Notion", "airtable": "Airtable", "hubspot": "HubSpot"}
    return tuple((s, labels.get(s, s)) for s in SINKS)


@node("export", "Export", "Output", "table",
      "Pushes the items somewhere else: a CSV or JSON file, Google Sheets, a webhook, "
      "Notion, Airtable or HubSpot. Test runs never export.",
      params=[Param("sink", "Send leads to", "select", "csv", options=_sinks()),
              Param("target", "Target", "text", "",
                    help="A file path or webhook URL. Notion, Airtable and HubSpot use "
                         "their keys from Settings.")],
      effect="external")
def run_export(ctx, params, items):
    sink = params.get("sink") or "csv"
    if ctx.test:
        _would(ctx, f"export {len(items)} leads to {sink}")
        return {"out": items}
    res = ctx.svc("export")([public_item(it) for it in items], sink=sink,
                            target=params.get("target") or None)
    if not res.get("ok", True):
        raise RuntimeError(f"export to {sink} failed: {res.get('error') or 'unknown error'}")
    ctx.vars["exported"] = ctx.vars.get("exported", 0) + int(res.get("count", len(items)) or 0)
    ctx.vars.setdefault("exports", []).append({k: v for k, v in res.items()
                                               if isinstance(v, (str, int, float, bool))})
    ctx.note(f"exported {res.get('count', len(items))} to {sink}"
             + (f" ({res['target']})" if res.get("target") else ""))
    return {"out": items}


@node("notify", "Notify", "Output", "bolt",
      "Tells you what happened: a desktop notification, a JSON POST to a webhook "
      "(Slack, Discord, ntfy), or both. {count} and {workflow} fill in.",
      params=[Param("title", "Title", "text", "OpenLeads: {workflow}"),
              Param("message", "Message", "text", "{count} leads ready"),
              Param("channel", "Channel", "select", "desktop",
                    options=(("desktop", "Desktop"), ("webhook", "Webhook"), ("both", "Both"))),
              Param("url", "Webhook URL", "text", "",
                    help="Empty uses notify_webhook from Settings.")],
      accepts="any", effect="external")
def run_notify(ctx, params, items):
    names = ", ".join((it.get("name") or it.get("email") or "") for it in items[:5])
    values = {"count": len(items), "workflow": ctx.name, "names": names}

    def fill(text):
        try:
            return str(text or "").format(**values)
        except (KeyError, ValueError, IndexError):
            return str(text or "")
    title, message = fill(params.get("title")), fill(params.get("message"))
    if ctx.test:
        _would(ctx, f"notify “{title}: {message}”")
        return {"out": items}
    res = ctx.svc("notify")(title, message, channel=params.get("channel") or "desktop",
                            url=params.get("url") or "")
    ctx.note(f"notified ({', '.join(k for k, v in (res or {}).items() if v) or 'nothing set up'})")
    return {"out": items}

