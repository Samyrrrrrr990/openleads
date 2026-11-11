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
    by: str = "rules"               # who read the request: "rules" or the model's label
    needs_yes: bool = False         # the model read more into it than the rules: a person
                                    # must say yes in a terminal (never --yes or --json)

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


# --- facts: what the request asks for --------------------------------------------- #
KINDS = ("find", "campaign", "schedule", "enroll")


def _rule_facts(text: str) -> dict:
    """Read the request with the built-in rules."""
    count, audience, goal = _count(text), _audience(text), _goal(text)
    m = _ENROLL_RE.search(text)
    if m and audience:
        return {"kind": "enroll", "audience": audience, "count": count,
                "sequence": m.group("name").strip()}
    action = assistant.rule_interpret(text)
    if action.intent in ("search", "unknown"):
        return {"kind": "find", "search": text}
    facts = {"kind": "campaign", "audience": audience or action.query, "count": count,
             "goal": goal or action.context}
    if action.intent == "schedule":
        hm = _time(text) or (9, 0)
        facts.update(kind="schedule", time=f"{hm[0]:02d}:{hm[1]:02d}",
                     days="daily" if (_DAILY_RE.search(text) and not _WEEKDAY_RE.search(text))
                     else "weekdays",
                     campaign=action.campaign if action.campaign != "assistant" else "")
    return facts


_MODEL_SYSTEM = (
    "You read one request for OpenLeads, a lead finding and cold email tool, and say what "
    "it asks for. Answer with ONE JSON object:\n"
    '{"kind": "find" | "campaign" | "schedule" | "enroll",\n'
    ' "audience": who to find, as a short search ("dental clinics in Austin"),\n'
    ' "count": how many people (1-1000, default 25),\n'
    ' "goal": what the emails are about, as a short noun phrase in the user\'s words '
    '("our route-planning API", not "pitch our route-planning API"; "" if not said),\n'
    ' "days": "weekdays" or "daily" (schedule only),\n'
    ' "time": "HH:MM" 24-hour (schedule only, default "09:00"),\n'
    ' "sequence": the sequence name (enroll only)}\n'
    "find = only look people up. campaign = find them and email them once, now. "
    "schedule = do that on a repeating schedule. enroll = find them and add them to an "
    "existing sequence. Never add facts the request doesn't contain.")


def _clean_facts(raw: dict) -> dict | None:
    """The model's answer, if every field is usable; else None (use the rules)."""
    kind = str(raw.get("kind") or "").lower()
    if kind not in KINDS:
        return None
    audience = " ".join(str(raw.get("audience") or "").split())
    if not audience or len(audience) > 200:
        return None
    try:
        count = int(raw.get("count") or 25)
    except (TypeError, ValueError):
        return None
    if not 1 <= count <= 1000:
        return None
    if kind == "find":
        return {"kind": "find", "search": audience, "count": count}
    goal = " ".join(str(raw.get("goal") or "").split())[:200]
    facts = {"kind": kind, "audience": audience, "count": count, "goal": goal}
    if kind == "schedule":
        days = str(raw.get("days") or "weekdays").lower()
        m = re.match(r"^([01]?\d|2[0-3]):([0-5]\d)$", str(raw.get("time") or "09:00").strip())
        if days not in ("weekdays", "daily") or not m:
            return None
        facts.update(days=days, time=f"{int(m.group(1)):02d}:{m.group(2)}", campaign="")
    if kind == "enroll":
        name = " ".join(str(raw.get("sequence") or "").split())
        if not name or len(name) > 80:
            return None
        facts["sequence"] = name
    return facts


def _model_facts(text: str, sequence_names: list | None) -> tuple:
    """``(facts, model label)`` from the connected model, or ``(None, "")``."""
    from openleads import ai
    m = ai.resolve()
    if m is None:
        return None, ""
    user = text if not sequence_names else (
        f"{text}\n\n(Existing sequences: {', '.join(sequence_names[:30])})")
    try:
        raw = ai.parse_json(ai.chat([{"role": "system", "content": _MODEL_SYSTEM},
                                     {"role": "user", "content": user}], m,
                                    max_tokens=300, temperature=0, timeout=ai.SHORT_JOB))
    except ai.AIError:
        return None, ""
    facts = _clean_facts(raw)
    return (facts, f"{m.provider}:{m.model}" if m.model else m.provider) if facts else (None, "")


def make_plan(text: str, *, live: bool = False, sequence_names: list | None = None,
              use_model: bool = False) -> Plan:
    """Turn a request into a :class:`Plan`. Never runs anything.

    With ``use_model`` and a connected model (:mod:`openleads.ai`), the model reads the
    request; the plan itself (graph, approval, live or not) is always built here, from
    checked fields. Any problem with the model's answer means the rules read it instead.
    """
    text = " ".join(str(text or "").split())
    for pattern, hint in _UNSUPPORTED:
        if pattern.search(text):
            return Plan(text, "unsupported", suggestion=hint,
                        steps=[f"This one has its own command: {hint}"])
    rules = _rule_facts(text)
    facts, by = (_model_facts(text, sequence_names) if use_model else (None, ""))
    facts = _guard(text, facts, rules) if facts else None
    plan = _build(text, facts or rules, live, sequence_names)
    plan.by = by if facts else "rules"
    plan.needs_yes = bool(facts) and facts["kind"] != rules["kind"] and facts["kind"] != "find"
    return plan


_SCHEDULE_CUE = re.compile(r"\b(?:every|each|daily|weekly|weekdays?|mornings?|monday|tuesday|"
                           r"wednesday|thursday|friday|schedule)\b", re.I)
MODEL_COUNT_CAP = 100


def _guard(text: str, facts: dict, rules: dict) -> dict | None:
    """The model may read a request better, never bigger: no schedule without a time or
    day in the words, no sequence you didn't name, no more people than you asked for."""
    if facts["kind"] == "schedule" and not (_SCHEDULE_CUE.search(text) or _TIME_RE.search(text)):
        return None
    if facts["kind"] == "enroll" and not re.search(r"\bsequence\b", text, re.I):
        return None
    said = _COUNT_RE.search(_TIME_RE.sub(" ", text))
    limit = int(said.group(1)) if said else MODEL_COUNT_CAP
    if facts.get("count"):
        facts = dict(facts, count=max(1, min(int(facts["count"]), limit)))
    return facts


def _build(text: str, f: dict, live: bool, sequence_names: list | None) -> Plan:
    kind = f["kind"]
    if kind == "find":
        q = intent.parse(f["search"], allow_llm=False)[0]
        if f.get("count"):
            q.count = f["count"]
        return Plan(text, "find", query=q, steps=[_find_line(q, f["search"])])

    audience, count, pitch = f["audience"], f["count"], f.get("goal") or ""
    if kind == "enroll":
        name = f["sequence"]
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

    q = _query(audience, count)
    write = _n("write", "write", 0, pitch=pitch)
    if kind == "schedule":
        when = f"{f['days']} {f['time']}"
        nodes = [_n("trigger", "trigger.schedule", 40, schedule=when),
                 _n("find", "find", 280, query=audience, count=count, verified_only=False),
                 _n("split", "split_tier", 520),
                 _n("dedupe", "dedupe", 760, skip_contacted=True),
                 {**write, "position": {"x": 1000, "y": 200}},
                 # Not live: queue for approval, as the plan says. Live: the
                 # approve_first_emails setting decides (unattended sends).
                 _n("send", "send", 1240, approve="auto" if live else "always")]
        name = f"{_slug(f.get('campaign') or '')}-{_slug(audience)}".strip("-")
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
            def progress(kind, payload):
                if emit is None:
                    return
                if kind == "phase":
                    emit({"type": "phase", "message": str(payload)})
                elif kind == "lead":
                    emit({"type": "lead", "lead": payload.to_dict()})
            leads = build_leads(plan.query, db=db, on_progress=progress)
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


def answer(result: dict, web: bool = False) -> str:
    """One or two plain sentences. Every number comes from ``result``. ``web`` leaves
    out the terminal commands (the dashboard has buttons for them)."""
    if not result.get("ok"):
        return f"That didn't work: {result.get('message') or 'the run stopped'}."
    if result.get("scheduled"):
        said = f"Saved as workflow {result.get('workflow')}; it runs {result['scheduled']}."
        return said if web else said + " See it with: openleads workflow ls"
    leads = int(result.get("leads") or 0)
    if not leads:
        return "Found no one for that. Try a broader audience or another place."
    verified = result.get("verified")
    found = f"Found {_n_of(leads, 'lead', 'leads')}"
    if verified not in (None, leads):
        found += f", {verified} with a verified email"
    parts = [found + "."]
    if result.get("drafts_waiting"):
        waiting = (f"{_n_of(int(result['drafts_waiting']), 'draft is', 'drafts are')} waiting "
                   "for your yes")
        parts.append(waiting + ("." if web else ": openleads today"))
    if result.get("sent"):
        parts.append(f"Sent {_n_of(int(result['sent']), 'email', 'emails')}.")
    return " ".join(parts)


def web_step(step: str) -> str:
    """A plan step as the dashboard shows it: the Today page instead of the command."""
    return (step.replace("approval queue (openleads today)", "approval queue on Today")
            .replace("in openleads today", "on Today"))


# --- questions about your workspace (5.4) ---------------------------------------- #
_QUESTION_RE = re.compile(r"^(?:who|what|which|how many|how much|how's|how is|how are|when|"
                          r"did|do|does|has|have|is|are|any|anything|show me what|tell me)\b",
                          re.I)
_QUESTION_SYSTEM = (
    "You answer questions about the user's OpenLeads workspace (their contacts, replies, "
    "tasks, sequences, deals and recent sends). Use ONLY the data given; if it doesn't "
    "say, answer that you can't tell from what OpenLeads has. Never invent people, numbers "
    "or dates. Answer with ONE JSON object: {\"kind\": \"answer\", \"text\": str} with a "
    "short plain answer (under 80 words, names and numbers from the data), or "
    "{\"kind\": \"search\"} if the question asks to find NEW people or companies on the web "
    "rather than about the workspace.")


_OWN_DATA_RE = re.compile(
    r"\b(?:i|i'm|i've|me|my|mine|we|our|ours|us|replied|replies|reply|contacts?|pipeline|"
    r"stages?|sequences?|deals?|tasks?|today|this week|last week|yesterday|emailed|sent|"
    r"bounced|bounces|meetings?|approve|approval|queue|workspace|openleads|interested|"
    r"customers?|booked|approaching|qualified)\b", re.I)


def is_question(text: str) -> bool:
    """A question about your own workspace (only those go to the model with a summary
    of it; "any dentists in Austin?" is a search)."""
    t = " ".join(str(text or "").split())
    if not t or re.match(r"^(?:find|search|email|send|add|schedule|enroll)\b", t, re.I):
        return False
    if not (t.endswith("?") or _QUESTION_RE.match(t)):
        return False
    return bool(_OWN_DATA_RE.search(t))


def snapshot(db, now: float | None = None, limit: int = 40) -> dict:
    """A compact picture of the workspace for answering questions (no secrets)."""
    import time as _time

    from openleads import today
    now = _time.time() if now is None else now
    b = today.briefing(db, now=now)
    week = now - 7 * 86400

    def q(sql, args=()):
        try:
            return db.query(sql, args)
        except Exception:  # noqa: BLE001 — an old workspace may lack a table
            return []
    contacts = [{"name": r.get("name") or "", "email": r["email"],
                 "company": r.get("organization") or "", "stage": r.get("stage") or "",
                 "status": r.get("status") or ""}
                for r in q("SELECT * FROM leads ORDER BY updated DESC LIMIT ?", (limit,))]
    return {
        "today": {"replies_waiting": [{"name": r.get("name"), "email": r["email"],
                                       "said": r.get("snippet")} for r in b["replies"]],
                  "emails_to_approve": b["counts"]["drafts"],
                  "tasks_due": [{"title": t.get("title"), "contact": t.get("contact")}
                                for t in b["tasks"]["overdue"] + b["tasks"]["today"]],
                  "heads_up": [h["message"] for h in b["heads_up"]]},
        "contacts_by_stage": {r["stage"] or "none": r["n"] for r in q(
            "SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage")},
        "contacts_by_status": {r["status"] or "none": r["n"] for r in q(
            "SELECT status, COUNT(*) AS n FROM leads GROUP BY status")},
        "sent_last_7_days": next((r["n"] for r in q(
            "SELECT COUNT(*) AS n FROM touches WHERE status='sent' AND ts >= ?", (week,))), 0),
        "replies_last_7_days": [{"email": r["ref"], "said": r["summary"]} for r in q(
            "SELECT ref, summary FROM activity WHERE kind='reply' AND ts >= ? "
            "ORDER BY ts DESC LIMIT 20", (week,))],
        "sequences": [{"name": r["name"], "status": r["status"], "active": r["n"]} for r in q(
            "SELECT s.name, s.status, COUNT(e.id) AS n FROM sequences s LEFT JOIN enrollments e "
            "ON e.sequence_id=s.id AND e.status='active' GROUP BY s.id")],
        "open_deals": [{"name": r["name"], "stage": r["stage"], "amount": r["amount"]} for r in q(
            "SELECT name, stage, amount FROM deals WHERE closed IS NULL ORDER BY updated DESC "
            "LIMIT 20")],
        "recent_contacts": contacts,
    }


def question(text: str, db) -> str | None:
    """Answer a question about the workspace with the connected model, or None (no
    model, not a workspace question, or the model failed: the caller searches)."""
    import json as _json

    from openleads import ai
    if not is_question(text):
        return None
    m = ai.chosen()          # never under `auto`: this sends a summary of your workspace
    if m is None:
        return None
    data = _json.dumps(snapshot(db), default=str)[:12000]
    try:
        out = ai.parse_json(ai.chat([{"role": "system", "content": _QUESTION_SYSTEM},
                                     {"role": "user", "content": f"Question: {text}\n\n"
                                                                 f"Workspace data:\n{data}"}],
                                    m, max_tokens=400, temperature=0, untrusted=True,
                                    timeout=ai.SHORT_JOB))
    except ai.AIError:
        return None
    if out.get("kind") != "answer" or not str(out.get("text") or "").strip():
        return None
    from openleads.outreach.compose import clean_dashes
    return clean_dashes(" ".join(str(out["text"]).split()))[:800]
