"""
The OpenLeads assistant — say what you want in one line, it configures the campaign.

This is the Apollo-style chatbot, free and local. Tell it:

    "send 50 emails to fintech founders for my dev-tools startup at 9am"
    "reach out to 30 rust developers in Berlin about our hiring tool, weekday mornings"
    "schedule 100 emails to YC founders tomorrow morning"

and it produces a structured :class:`Action` (who to find, how many, what to pitch,
when to send), then *executes* it: finds + drafts the emails, schedules the on-device
daily send at the requested hour, and previews everything before anything goes live.

Two interpreters, same :class:`Action` schema:

* :func:`rule_interpret` — pure, deterministic, **no key needed** (extends the
  existing intent parser with count/time/goal extraction). Always available at $0.
* :func:`llm_interpret` — a free OpenRouter model fills the same JSON schema for
  richer, messier phrasing. Used only when ``OPENROUTER_API_KEY`` is set; its output
  is validated against the schema and falls back to the rule parser on any doubt.

Nothing is sent without explicit confirmation; ``execute`` defaults to a dry-run.
"""
from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass

from openleads import intent
from openleads.config import openrouter_key
from openleads.models import Query

# Verbs that mean "send/configure a campaign" rather than "just search".
_ACTION_VERBS = ("send", "email", "e-mail", "reach out", "reachout", "schedule",
                 "set up", "setup", "configure", "blast", "drip", "follow up", "message")
_SCHEDULE_VERBS = ("schedule", "set up", "setup", "configure", "every", "daily")


@dataclass
class Action:
    """A parsed instruction the assistant can execute or explain."""

    intent: str = "search"          # search | campaign | schedule | unknown
    query: str = ""                 # the audience/search phrase ("fintech founders")
    count: int = 25
    send_hour: int | None = None    # 0–23 local hour to send (None = now/ad-hoc)
    send_minute: int = 0
    context: str = ""               # what to pitch (frames the drafts)
    campaign: str = "assistant"
    verified_only: bool = True
    weekday_only: bool = True
    source: str | None = None

    def to_query(self) -> Query:
        q, _ = intent.parse(self.query) if self.query else (Query(), "rule")
        q.count = self.count
        q.verified_only = self.verified_only
        if self.source:
            q.source = self.source
        return q

    def summary(self) -> str:
        when = (f"{self.send_hour:02d}:{self.send_minute:02d} daily"
                if self.send_hour is not None else "on demand")
        pitch = f' pitching "{self.context}"' if self.context else ""
        return (f"{self.intent}: {self.count} → {self.query or 'auto'}{pitch}; "
                f"send {when}" + (" (verified only)" if self.verified_only else ""))


# --- time parsing ------------------------------------------------------------- #
_NAMED_TIMES = {"morning": (9, 0), "noon": (12, 0), "midday": (12, 0),
                "afternoon": (13, 0), "evening": (17, 0)}


def parse_time(text: str) -> tuple[int, int] | None:
    """Extract a send time → (hour, minute), or None. Handles 9am, 2:30pm, 14:00, morning."""
    low = text.lower()
    m = re.search(r"\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", low) \
        or re.search(r"\b(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b", low) \
        or re.search(r"\b(\d{1,2})\s*(am|pm)\b", low)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2)) if (m.lastindex and m.group(2)) else 0
        ampm = m.group(m.lastindex) if m.lastindex else None
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    for word, (h, mm) in _NAMED_TIMES.items():
        if re.search(rf"\b{word}\b", low):   # \b so 'noon' doesn't match 'afternoon'
            return h, mm
    return None


# --- goal / pitch extraction -------------------------------------------------- #
# Word boundaries on the stop words so "tool" isn't read as the "to" delimiter.
_GOAL_RE = re.compile(
    r"\b(?:for|about|promoting|promote|pitching|pitch|regarding|re:|selling|offering)\s+"
    r"(.+?)(?=\s+(?:to|at|every|on)\b|[,.]|$)", re.I)


def parse_goal(text: str) -> str:
    m = _GOAL_RE.search(text or "")
    return m.group(1).strip(" .,:") if m else ""


# --- audience extraction ------------------------------------------------------ #
def parse_audience(text: str) -> str:
    """The 'who to email' phrase: prefer the segment after 'to ', else a cleaned residual."""
    low = text or ""
    m = re.search(r"\bto\s+(.+?)(?=\s+(?:for|about|at|every|on)\b|[,.]|$)", low, re.I)
    if m:
        return m.group(1).strip(" .,:")
    # Fall back: strip leading verb + count + goal + time, keep the rest.
    residual = re.sub(r"\b\d+\b", " ", low)
    residual = _GOAL_RE.sub(" ", residual)
    residual = re.sub(r"\bat\s+\d.*$", " ", residual, flags=re.I)
    for v in _ACTION_VERBS + ("emails", "email", "leads", "people", "to", "me"):
        residual = re.sub(rf"\b{re.escape(v)}\b", " ", residual, flags=re.I)
    return re.sub(r"\s+", " ", residual).strip(" .,:")


def _detect_intent(text: str) -> str:
    low = f" {text.lower()} "
    if any(f" {v} " in low or low.strip().startswith(v) for v in _SCHEDULE_VERBS):
        if any(v in low for v in (" schedule", " every", " daily", " set up", " setup")):
            return "schedule"
    if any(f" {v} " in low or low.strip().startswith(v) for v in _ACTION_VERBS):
        return "campaign"
    return "search"


# --- the rule interpreter (always available) ---------------------------------- #
def rule_interpret(text: str) -> Action:
    """Deterministically parse an instruction into an :class:`Action`. Never raises."""
    text = (text or "").strip()
    act = Action()
    if not text:
        act.intent = "unknown"
        return act
    act.intent = _detect_intent(text)
    cnt = re.search(r"\b(\d{1,4})\b", text)
    if cnt:
        act.count = max(1, min(int(cnt.group(1)), 1000))
    t = parse_time(text)
    if t:
        act.send_hour, act.send_minute = t
    act.context = parse_goal(text)
    audience = parse_audience(text) if act.intent != "search" else text
    act.query = audience or text
    # Let the search parser pick a source/verified flag from the audience phrase.
    q = intent.rule_parse(act.query)
    act.source = q.source
    if q.verified_only:
        act.verified_only = True
    return act


# --- the LLM interpreter (optional, free OpenRouter) -------------------------- #
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
LLM_MODEL = "openai/gpt-oss-120b:free"

_SYSTEM = (
    "You turn a sales/outreach instruction into a compact JSON object with keys: "
    "intent (search|campaign|schedule), query (the audience to find, e.g. 'fintech "
    "founders'), count (int), send_hour (0-23 or null), send_minute (int), context "
    "(what to pitch, or ''), verified_only (bool). Respond with ONLY the JSON object."
)


def llm_interpret(text: str, timeout: int = 30) -> Action | None:
    """Interpret via a free OpenRouter model. Returns None if unavailable/on error."""
    key = openrouter_key()
    if not key:
        return None
    body = json.dumps({
        "model": LLM_MODEL, "temperature": 0,
        "messages": [{"role": "system", "content": _SYSTEM},
                     {"role": "user", "content": text}],
    }).encode()
    req = urllib.request.Request(
        OPENROUTER_URL, data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.load(r)
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(re.search(r"\{.*\}", content, re.DOTALL).group(0))
    except Exception:
        return None
    return action_from_dict(parsed)


def action_from_dict(d: dict) -> Action | None:
    """Validate a raw dict into an Action (used by the LLM path). None if unusable."""
    if not isinstance(d, dict):
        return None
    act = Action()
    if d.get("intent") in ("search", "campaign", "schedule"):
        act.intent = d["intent"]
    try:
        act.count = max(1, min(int(d.get("count") or 25), 1000))
    except (TypeError, ValueError):
        pass
    sh = d.get("send_hour")
    if isinstance(sh, (int, float)) and 0 <= int(sh) <= 23:
        act.send_hour = int(sh)
    try:
        act.send_minute = max(0, min(int(d.get("send_minute") or 0), 59))
    except (TypeError, ValueError):
        pass
    for f in ("query", "context"):
        v = d.get(f)
        if isinstance(v, str):
            setattr(act, f, v.strip())
    act.verified_only = bool(d.get("verified_only", True))
    if not act.query:
        return None
    q = intent.rule_parse(act.query)
    act.source = q.source
    return act


def interpret(text: str, allow_llm: bool = True) -> tuple[Action, str]:
    """Interpret ``text`` → ``(Action, mode)`` where mode is 'rule' or 'llm'."""
    if allow_llm and openrouter_key():
        a = llm_interpret(text)
        if a is not None:
            return a, "llm"
    return rule_interpret(text), "rule"


# --- execution ---------------------------------------------------------------- #
def execute(action: Action, db=None, dry_run: bool = True, install_schedule: bool = True,
            on_progress=None) -> dict:
    """Run an :class:`Action`. Campaigns/schedules are saved + previewed; nothing
    sends for real unless ``dry_run=False``."""
    from openleads.automate import pipeline, scheduler
    on_progress = on_progress or (lambda *_: None)

    if action.intent == "unknown" or not action.query:
        return {"ok": False, "message": "I couldn't tell what to do — try 'send 50 "
                "emails to fintech founders for <your pitch> at 9am'."}

    overrides = {"sender_context": action.context} if action.context else None

    if action.intent in ("campaign", "schedule"):
        spec = {"query": action.query, "count": action.count, "context": action.context,
                "send_hour": action.send_hour if action.send_hour is not None else 9,
                "send_minute": action.send_minute, "enabled": True,
                "verified_only": action.verified_only}
        scheduler.save_scheduled_campaign(action.campaign, spec, db=db)
        installed = None
        if action.intent == "schedule" and install_schedule:
            installed = scheduler.install(spec["send_hour"], spec["send_minute"])
        # Always preview (dry-run) so the user sees the emails before they go out.
        out = pipeline.quick(action.query, count=action.count, send=True,
                             dry_run=True, overrides=overrides, on_progress=on_progress)
        return {"ok": True, "intent": action.intent, "action": action,
                "spec": spec, "installed": installed,
                "leads": out.get("leads", []), "drafts": out.get("drafts", []),
                "preview": out.get("results", []),
                "message": f"Configured: {action.summary()}."}

    # search
    out = pipeline.quick(action.query, count=action.count, send=False,
                         dry_run=dry_run, overrides=overrides, on_progress=on_progress)
    return {"ok": True, "intent": "search", "action": action,
            "leads": out.get("leads", []), "drafts": out.get("drafts", []),
            "message": f"Found {len(out.get('leads', []))} leads."}
