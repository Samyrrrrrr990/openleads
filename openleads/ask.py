"""
Say what you want, see the plan, run it.

``openleads "find 30 rust devs in Berlin and email them about our hiring tool"``
goes through :func:`make_plan`, which turns the request into one of:

* ``find``: a plain search, run straight away like ``openleads find``;
* ``workflow``: a 5.2 workflow graph (find, write, send / enroll, or a saved
  schedule), shown step by step and run only on a yes;
* ``unsupported``: an edit that has its own command (tag, move a deal, add a
  task...), answered with that command.

Without ``--live`` a campaign's emails wait in the approval queue (``openleads
today``); with ``--live`` they send now. Nothing here invents numbers:
:func:`answer` only repeats what the run reported.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

from openleads import assistant, intent
from openleads.models import Query


@dataclass
class Plan:
    text: str
    kind: str                       # "find" | "workflow" | "unsupported"
    query: Query | None = None
    graph: dict | None = None       # a valid 5.2 workflow graph
    steps: list = field(default_factory=list)
    confirm: bool = False           # True if it sends, schedules or changes the workspace
    suggestion: str = ""            # for "unsupported": the command to use instead
    schedule: str = ""              # for scheduled workflows: "weekdays 09:00"

    def to_dict(self) -> dict:
        out = asdict(self)
        out["query"] = asdict(self.query) if self.query is not None else None
        return out


# --- reading the request -------------------------------------------------------- #
_UNSUPPORTED = (
    (re.compile(r"^\s*tag\b", re.I), "openleads people tag <email> --add <tag>"),
    (re.compile(r"^\s*move\b", re.I), "openleads deals move <id> --to <stage>"),
    (re.compile(r"^\s*create (?:a )?task\b|^\s*add (?:a )?task\b", re.I),
     'openleads tasks add "<title>" --due tomorrow'),
    (re.compile(r"^\s*(?:add a )?note\b", re.I), 'openleads people note <email> "<text>"'),
    (re.compile(r"^\s*mark\b", re.I), "openleads people stage <email> --to <stage>"),
)
_ENROLL_RE = re.compile(r"\b(?:add|enroll|put)\b.+?\b(?:in|into|to)\b (?:my |the )?"
                        r"(?P<name>[\w .'-]+?) sequence\b", re.I)
_TIME_RE = re.compile(r"\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bat\s+(\d{1,2}):(\d{2})\b",
                      re.I)
_COUNT_RE = re.compile(r"(?<![:\d])\b(\d{1,4})\b(?!\s*(?:am|pm|:\d))", re.I)
_GOAL_RE = re.compile(r"\b(?:about|pitching|offering|to pitch|to offer|re:?)\s+(.+?)\s*$", re.I)
_WEEKDAY_RE = re.compile(r"\b(?:every\s+)?(?:weekday|weekdays|business day|work ?day)s?\b|"
                         r"\bmon(?:day)?\s*(?:-|to|through)\s*fri(?:day)?\b", re.I)
_DAILY_RE = re.compile(r"\b(?:daily|every\s+day|every\s+morning|each\s+day)\b", re.I)
_NOISE = re.compile(
    r"\b(?:please|can you|could you|i want to|i'd like to|let's|schedule|set up|setup|"
    r"every|each|daily|weekdays?|mornings?|find|search for|look for|get me|get|email|e-mail|"
    r"send|message|reach out to|reach out|contact|emails?|leads|people|them|and|to|me|"
    r"automatically|first)\b", re.I)


def _count(text: str, default: int = 25) -> int:
    m = _COUNT_RE.search(_TIME_RE.sub(" ", text))
    return max(1, min(int(m.group(1)), 1000)) if m else default


def _time(text: str) -> tuple | None:
    m = _TIME_RE.search(text)
    if not m:
        return None
    if m.group(4):
        return int(m.group(4)) % 24, int(m.group(5))
    hour, minute, ampm = int(m.group(1)), int(m.group(2) or 0), m.group(3).lower()
    if ampm == "pm" and hour < 12:
        hour += 12
    if ampm == "am" and hour == 12:
        hour = 0
    return hour % 24, minute % 60


def _goal(text: str) -> str:
    m = _GOAL_RE.search(_TIME_RE.sub(" ", text))
    if not m:
        return ""
    goal = re.split(r"\s+(?:every|each|daily|on weekdays)\b", m.group(1), flags=re.I)[0]
    return goal.strip(" .,:;")


def _audience(text: str) -> str:
    t = _TIME_RE.sub(" ", text)
    t = _GOAL_RE.sub(" ", t)
    t = _ENROLL_RE.sub(lambda m: m.group(0).replace(f"{m.group('name')} sequence", " "), t)
    t = re.sub(r"\b(?:add|enroll|put)\b|\b(?:in|into)\s+(?:my|the)\b|\bmy\b", " ", t, flags=re.I)
    t = _WEEKDAY_RE.sub(" ", t)
    t = re.sub(r"\b\d{1,4}\b", " ", t)
    t = _NOISE.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip(" .,:;-")
    return re.sub(r"^(?:in|to|for|of)\s+", "", t)


def _query(audience: str, count: int) -> Query:
    q = intent.parse(audience, allow_llm=False)[0] if audience else Query()
    q.count = count
    q.verified_only = True
    return q


def _slug(text: str, limit: int = 48) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:limit].strip("-") or "ask"


def _n(id_: str, type_: str, x: int, **params) -> dict:
    return {"id": id_, "type": type_, "params": params, "position": {"x": x, "y": 200}}


def _chain(nodes: list) -> list:
    return [{"from": a["id"], "from_port": "safe" if a["type"] == "split_tier" else "out",
             "to": b["id"]} for a, b in zip(nodes, nodes[1:])]


def _graph(name: str, nodes: list, active: bool = False, live: bool = False,
           description: str = "") -> dict:
    from openleads.automate.workflow import graph
    return graph.normalize({"name": name, "description": description, "active": active,
                            "live": live, "nodes": nodes, "edges": _chain(nodes)})


def _find_line(q: Query, audience: str, verified: bool | None = None) -> str:
    src = f" ({q.source})" if getattr(q, "source", None) else ""
    verified = q.verified_only if verified is None else verified
    return f"Find      {q.count} {audience}{src}" + (", deliverable emails only" if verified else "")


def make_plan(text: str, *, live: bool = False, sequence_names: list | None = None) -> Plan:
    """Turn a request into a :class:`Plan`. Never runs anything."""
    text = " ".join(str(text or "").split())
    for pattern, hint in _UNSUPPORTED:
        if pattern.search(text):
            return Plan(text, "unsupported", suggestion=hint,
                        steps=[f"This one has its own command: {hint}"])

    count, audience, goal = _count(text), _audience(text), _goal(text)
    m = _ENROLL_RE.search(text)
    if m and audience:
        name = m.group("name").strip()
        if sequence_names is not None:
            match = next((s for s in sequence_names if s.lower() == name.lower()), None)
            if not match:
                return Plan(text, "unsupported", suggestion="openleads seq list",
                            steps=[f"There's no sequence called {name!r}. "
                                   "See yours with: openleads seq list"])
            name = match
        q = _query(audience, count)
        nodes = [_n("trigger", "trigger.manual", 40), _n("find", "find", 280, query=audience,
                                                         count=count, verified_only=True),
                 _n("enroll", "enroll", 520, sequence=name)]
        return Plan(text, "workflow", query=q, confirm=True,
                    graph=_graph(f"ask-{_slug(audience)}", nodes, description=text),
                    steps=[_find_line(q, audience), f"Enroll    them in the {name} sequence "
                                                    "(its steps run on their schedule)"])

    action = assistant.rule_interpret(text)
    if action.intent == "search" or action.intent == "unknown":
        q = intent.parse(text, allow_llm=False)[0]
        return Plan(text, "find", query=q, steps=[_find_line(q, text)])

    audience = audience or action.query
    q = _query(audience, count)
    pitch = goal or action.context
    write = _n("write", "write", 0, pitch=pitch)
    if action.intent == "schedule":
        hm = _time(text) or (9, 0)
        days = "daily" if (_DAILY_RE.search(text) and not _WEEKDAY_RE.search(text)) else "weekdays"
        when = f"{days} {hm[0]:02d}:{hm[1]:02d}"
        nodes = [_n("trigger", "trigger.schedule", 40, schedule=when),
                 _n("find", "find", 280, query=audience, count=count, verified_only=False),
                 _n("split", "split_tier", 520),
                 _n("dedupe", "dedupe", 760, skip_contacted=True),
                 {**write, "position": {"x": 1000, "y": 200}},
                 # Not live: queue for approval, as the plan says. Live: the
                 # approve_first_emails setting decides (unattended sends).
                 _n("send", "send", 1240, approve="auto" if live else "always")]
        name = f"{_slug(action.campaign if action.campaign != 'assistant' else '')}-" \
               f"{_slug(audience)}".strip("-")
        g = _graph(name or _slug(audience), nodes, active=True, live=live, description=text)
        how = ("send live, inside your warmup cap" if live else
               "go into your approval queue (openleads today)")
        return Plan(text, "workflow", query=q, graph=g, confirm=True, schedule=when, steps=[
            f"Schedule  {when.replace('weekdays', 'every weekday at').replace('daily', 'every day at')}",
            _find_line(q, audience, verified=False).replace("Find     ", "Find      up to"),
            "Keep      only deliverable (safe) emails",
            "Skip      anyone you've already emailed",
            f"Write     an email about {pitch}" if pitch else "Write     an email for each lead",
            f"Then      the emails {how}"])

    nodes = [_n("trigger", "trigger.manual", 40),
             _n("find", "find", 280, query=audience, count=count, verified_only=True),
             _n("dedupe", "dedupe", 520, skip_contacted=True),
             {**write, "position": {"x": 760, "y": 200}},
             _n("send", "send", 1000, approve="never" if live else "always", respect_window=False)]
    g = _graph(f"ask-{_slug(audience)}", nodes, description=text)
    last = ("Send      them now from your mailbox (live)" if live else
            "Queue     them for you to approve in openleads today (nothing sends yet)")
    return Plan(text, "workflow", query=q, graph=g, confirm=True, steps=[
        _find_line(q, audience),
        "Skip      anyone you've already emailed",
        f"Write     an email to each about {pitch}" if pitch else "Write     an email to each",
        last])


# --- running it --------------------------------------------------------------- #
def _sequence_names(db) -> list:
    try:
        return [r["name"] for r in db.query("SELECT name FROM sequences")]
    except Exception:
        return []


def save_plan(plan: Plan, name: str, db=None) -> dict:
    """Keep a workflow plan as a named workflow (``openleads workflow``, the dashboard)."""
    from openleads.automate.workflow import store
    from openleads.db import DB
    if plan.kind != "workflow" or not plan.graph:
        raise ValueError("only a workflow plan can be saved")
    own = db is None
    db = db or DB()
    try:
        return store.save(db, {**plan.graph, "name": _slug(name, 60)})
    finally:
        if own:
            db.close()


def run_plan(plan: Plan, *, live: bool = False, db=None, emit=None) -> dict:
    """Run a plan. Schedules are saved, not run. Returns plain counts for :func:`answer`."""
    from openleads.db import DB
    out = {"ok": False, "leads": 0, "verified": 0, "drafts_waiting": 0, "sent": 0,
           "workflow": "", "message": ""}
    if plan.kind == "unsupported":
        return {**out, "message": f"Use: {plan.suggestion}"}
    own = db is None
    db = db or DB()
    try:
        if plan.kind == "find":
            from openleads.engine import build_leads
            leads = build_leads(plan.query, db=db)
            safe = sum(1 for lead in leads if getattr(lead, "tier", "") == "safe")
            return {**out, "ok": True, "leads": len(leads), "verified": safe}
        if plan.schedule:
            saved = save_plan(plan, plan.graph["name"], db=db)
            return {**out, "ok": True, "workflow": saved["name"], "scheduled": plan.schedule}
        from openleads.automate.workflow import executor
        res = executor.run(plan.graph, db=db, mode="run", live=live, trigger_label="ask",
                           emit=emit)
        s = res.get("summary") or {}
        ok = res.get("status") == "ok"
        return {**out, "ok": ok, "leads": int(s.get("found", 0)),
                "verified": int(s.get("found", 0)),
                "drafts_waiting": int(s.get("queued", 0)), "sent": int(s.get("sent", 0)),
                "workflow": res.get("workflow", ""),
                "message": "" if ok else (res.get("error") or "the run stopped")}
    finally:
        if own:
            db.close()


def _n_of(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def answer(result: dict) -> str:
    """One or two plain sentences. Every number comes from ``result``."""
    if not result.get("ok"):
        return f"That didn't work: {result.get('message') or 'the run stopped'}."
    if result.get("scheduled"):
        return (f"Saved as workflow {result.get('workflow')}; it runs {result['scheduled']}. "
                "See it with: openleads workflow ls")
    leads = int(result.get("leads") or 0)
    if not leads:
        return "Found no one for that. Try a broader audience or another place."
    verified = result.get("verified")
    found = f"Found {_n_of(leads, 'lead', 'leads')}"
    if verified not in (None, leads):
        found += f", {verified} with a verified email"
    parts = [found + "."]
    if result.get("drafts_waiting"):
        parts.append(f"{_n_of(int(result['drafts_waiting']), 'draft is', 'drafts are')} waiting "
                     "for your yes: openleads today")
    if result.get("sent"):
        parts.append(f"Sent {_n_of(int(result['sent']), 'email', 'emails')}.")
    return " ".join(parts)
