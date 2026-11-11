"""
Today: the one screen that says what needs you.

:func:`briefing` gathers replies waiting for an answer, first emails waiting for
approval, tasks due today or overdue, leads found since you last looked, and a
few plain-English heads-ups (mailbox not connected, bounces climbing, a workflow
that failed). The CLI (``openleads today``), the dashboard and the MCP ``today``
tool all render this same dict.
"""
from __future__ import annotations

import time

from openleads import settings
from openleads.outreach import deliverability, replies
from openleads.workspace import drafts, tasks

DAY = 86400.0
SEEN_KEY = "today.last_seen"


def _since(db, now: float) -> float:
    try:
        return float(db.kv_get(SEEN_KEY, None) or (now - DAY))
    except (TypeError, ValueError):
        return now - DAY


def _new_leads(db, since: float) -> dict:
    count = int(db.scalar("SELECT COUNT(*) FROM leads WHERE created >= ?", (since,),
                          default=0) or 0)
    items = db.query("SELECT email, name, title, organization, tier, created FROM leads "
                     "WHERE created >= ? ORDER BY created DESC, email ASC LIMIT 10", (since,))
    return {"count": count, "items": [dict(r) for r in items]}


def _bounce_line(db, now: float) -> dict | None:
    week = now - 7 * DAY
    sends = int(db.scalar("SELECT COUNT(*) FROM touches WHERE status='sent' AND ts >= ?",
                          (week,), default=0) or 0)
    if sends < 20:
        return None
    bounced = int(db.scalar("SELECT COUNT(DISTINCT ref) FROM activity WHERE ref_type='contact' "
                            "AND kind='bounced' AND ts >= ?", (week,), default=0) or 0)
    rate = bounced / sends
    if rate <= 0.05:
        return None
    return {"level": "bad", "message": f"{round(rate * 100)}% of last week's emails bounced. "
                                       "Check your list before sending more."}


def _model_line() -> dict | None:
    """The chosen model is broken, or a subscription is here and nobody picked it."""
    from openleads import ai
    problem = ai.problem()
    if problem:
        return {"level": "warn", "message": f"Your model isn't working: {problem}"}
    if str(settings.get("ai_provider") or "auto").lower() != "auto" or ai.resolve() is not None:
        return None
    subs = [d for d in ai.detect(probe=False) if d["kind"] == "subscription"]
    if not subs:
        return None
    name = "Claude" if subs[0]["provider"] == "claude" else "ChatGPT (Codex)"
    return {"level": "info", "message": f"{name} is installed here. `openleads setup ai` lets "
                                        "OpenLeads use it to read requests, write emails and sort replies."}


def _heads_up(db, now: float) -> list:
    out = []
    if not settings.get("smtp_host"):
        out.append({"level": "warn", "message": "Mailbox not connected: nothing can send. "
                                                "Run `openleads setup`."})
    if not settings.get("imap_host"):
        out.append({"level": "info", "message": "Replies aren't being read. Add IMAP in "
                                                "`openleads setup` to see them here."})
    try:
        remaining = deliverability.warmup_status(db).get("remaining")
    except Exception:       # a broken setting must not take Today down
        remaining = None
    if remaining == 0:
        out.append({"level": "info",
                    "message": "Today's sending limit is reached; the rest go tomorrow."})
    bounce = _bounce_line(db, now)
    if bounce:
        out.append(bounce)
    from openleads.automate.workflow import store
    for run in store.runs(db, limit=20):
        if run["status"] == "error" and (run["started"] or 0) >= now - DAY:
            error = (run.get("error") or "unknown error").strip().rstrip(".")
            out.append({"level": "warn", "message": f"Workflow {run['workflow']} failed: {error}."})
    model = _model_line()
    if model:
        out.append(model)
    held = int(db.scalar("SELECT COUNT(*) FROM activity WHERE kind='presend_hold' AND ts >= ?",
                         (now - DAY,), default=0) or 0)
    if held:
        noun = "email was" if held == 1 else "emails were"
        out.append({"level": "info", "message": f"{held} {noun} held by your pre-send hook."})
    return out


def briefing(db, now: float | None = None) -> dict:
    """Everything Today shows, as plain data."""
    now = time.time() if now is None else float(now)
    waiting_replies = replies.waiting(db, now=now)
    waiting_drafts = drafts.waiting(db, limit=20)
    # A waiting reply already says "answer this person": hide its automatic
    # "Reply to <name>" task so the same job isn't listed twice.
    shown = {r["email"] for r in waiting_replies}

    def keep(t: dict) -> bool:
        return not (t.get("contact") in shown and str(t.get("title", "")).startswith("Reply to "))
    due = {b: [t for t in tasks.list_tasks(db, bucket=b, now=now) if keep(t)]
           for b in ("overdue", "today")}
    new = _new_leads(db, _since(db, now))
    return {
        "replies": waiting_replies,
        "drafts": waiting_drafts,
        "tasks": due,
        "new_leads": new,
        "heads_up": _heads_up(db, now),
        "counts": {"replies": len(waiting_replies), "drafts": drafts.count_waiting(db),
                   "tasks": len(due["overdue"]) + len(due["today"]),
                   "new_leads": new["count"]},
    }


def mark_seen(db, now: float | None = None) -> None:
    """Remember that you looked, so "new leads" starts from here next time."""
    db.kv_set(SEEN_KEY, time.time() if now is None else float(now))


def snooze(db, kind: str, ref: str, until: float) -> dict:
    """Hide a reply until ``until``, or move a task's due date there."""
    if kind == "reply":
        email = (ref or "").strip().lower()
        if not email:
            raise ValueError("snooze needs the reply's email address")
        db.kv_set(f"snooze.reply.{email}", float(until))
        return {"kind": "reply", "ref": email, "until": float(until)}
    if kind == "task":
        try:
            task = tasks.update(db, int(ref), {"due": float(until)})
        except (TypeError, ValueError):
            task = None
        if not task:
            raise ValueError(f"no task {ref}")
        return task
    raise ValueError(f"can't snooze {kind!r}: use 'reply' or 'task'")
