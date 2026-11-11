"""
Replies: keep what people wrote, sort it, and know when you've answered.

:func:`openleads.outreach.inbox.scan` calls :func:`record` for every reply from a
known contact. The reply is kept on the contact's timeline (activity ``reply``,
with the subject, a snippet of the new text, a category and the Message-ID), so
Today can show it and nothing is stored twice.

Sorting is simple rules for now: bounce, out of office, unsubscribe, not
interested, and everything else "needs you". A reply stops waiting once you've
answered it (a later email to that address, or your reply found in the Sent
folder), marked it done, or snoozed it.
"""
from __future__ import annotations

import html
import re
import time

from openleads.workspace import activity

CATEGORIES = ("needs_you", "not_interested", "unsubscribe", "out_of_office", "bounce")

_OOO_SUBJECT = ("automatic reply", "auto:", "autoreply", "auto-reply", "out of office")
_OOO_BODY = ("out of office", "out of the office", "on leave", "away until",
             "limited access to email", "currently away", "on vacation")
_UNSUB = ("unsubscribe", "remove me", "take me off", "stop emailing", "stop contacting",
          "do not contact", "don't contact", "don't email", "do not email")
_NOT_INTERESTED = ("not interested", "no thanks", "no thank you", "not a fit",
                   "we're all set", "we are all set", "not a good fit")
_WROTE_RE = re.compile(r"^\s*on .{4,200}wrote:\s*$", re.I)
_TAG_RE = re.compile(r"<[^>]+>")


def new_text(body: str) -> str:
    """The part of a reply the person just wrote: no quoted history, no signature."""
    out = []
    for line in (body or "").replace("\r\n", "\n").split("\n"):
        if line.rstrip() in ("--", "-- ") or _WROTE_RE.match(line):
            break
        if line.lstrip().startswith(">"):
            continue
        out.append(line)
    return "\n".join(out).strip()


def html_text(markup: str) -> str:
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", markup or "")
    return html.unescape(_TAG_RE.sub("", text)).strip()


def snippet(body: str, limit: int = 200) -> str:
    text = " ".join(new_text(body).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def classify(subject: str, body: str, from_header: str = "") -> str:
    from openleads.outreach.inbox import is_bounce
    if from_header and is_bounce(from_header, subject or ""):
        return "bounce"
    subj = (subject or "").strip().lower()
    text = new_text(body).lower().replace("’", "'")
    if subj.startswith(_OOO_SUBJECT) or any(p in text for p in _OOO_BODY):
        return "out_of_office"
    if any(p in text for p in _UNSUB):
        return "unsubscribe"
    if any(p in text for p in _NOT_INTERESTED):
        return "not_interested"
    return "needs_you"


def _norm(email: str) -> str:
    return (email or "").strip().lower()


def record(db, email: str, subject: str, body: str, message_id: str, received: float,
           from_header: str = "") -> dict | None:
    """Keep one reply on the contact's timeline. ``None`` if it's already there."""
    email = _norm(email)
    if message_id and db.scalar(
            "SELECT 1 FROM activity WHERE ref_type='contact' AND ref=? AND kind='reply' "
            "AND json_extract(data, '$.message_id')=?", (email, message_id)):
        return None
    category = classify(subject, body, from_header)
    data = {"subject": subject or "", "snippet": snippet(body), "category": category,
            "message_id": message_id or "", "received": float(received)}
    activity.log(db, "contact", email, "reply", data["snippet"] or subject or "", data,
                 ts=float(received))
    if category == "unsubscribe":
        db.suppress(email, "asked to unsubscribe")
    return {"email": email, **data}


def _close_reply_task(db, email: str) -> None:
    """The automatic "Reply to <name>" task is the same job as the reply: close it too."""
    from openleads.workspace import tasks
    for row in db.query("SELECT id FROM tasks WHERE contact=? AND status='open' "
                        "AND title LIKE 'Reply to %'", (email,)):
        tasks.complete(db, row["id"])


def mark_answered(db, email: str, when: float) -> None:
    email = _norm(email)
    _close_reply_task(db, email)
    if not db.scalar("SELECT 1 FROM activity WHERE ref_type='contact' AND ref=? "
                     "AND kind='you_replied' AND ts=?", (email, float(when))):
        activity.log(db, "contact", email, "you_replied", "You replied", ts=float(when))


def mark_done(db, email: str, now: float | None = None) -> None:
    _close_reply_task(db, _norm(email))
    activity.log(db, "contact", _norm(email), "reply_done", "Marked handled",
                 ts=time.time() if now is None else float(now))


def waiting(db, now: float | None = None) -> list:
    """Replies that still need you, oldest first: the latest one per contact."""
    import json
    now = time.time() if now is None else now
    rows = db.query(
        "SELECT a.ref AS email, a.data, a.ts FROM activity a "
        "WHERE a.ref_type='contact' AND a.kind='reply' AND a.ts = ("
        "  SELECT MAX(b.ts) FROM activity b WHERE b.ref_type='contact' AND b.ref=a.ref "
        "  AND b.kind='reply') ORDER BY a.ts ASC, a.id ASC")
    out = []
    for r in rows:
        try:
            data = json.loads(r["data"] or "{}")
        except ValueError:
            data = {}
        if data.get("category") != "needs_you":
            continue
        email, ts = r["email"], float(r["ts"])
        handled = db.scalar(
            "SELECT 1 FROM activity WHERE ref_type='contact' AND ref=? "
            "AND kind IN ('you_replied', 'reply_done') AND ts > ? "
            "UNION SELECT 1 FROM touches WHERE email=? AND status='sent' AND ts > ?",
            (email, ts, email, ts))
        if handled:
            continue
        if float(db.kv_get(f"snooze.reply.{email}", 0) or 0) > now:
            continue
        lead = db.get_lead(email) or {}
        out.append({"email": email, "name": lead.get("name") or "",
                    "organization": lead.get("organization") or "",
                    "subject": data.get("subject", ""), "snippet": data.get("snippet", ""),
                    "received": ts, "message_id": data.get("message_id", "")})
    return out
