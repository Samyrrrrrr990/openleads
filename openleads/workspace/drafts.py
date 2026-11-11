"""
The approval queue: first emails that wait for a yes before they go.

Unattended sends (a sequence's first email, a scheduled workflow's Send, or a
one-shot ``openleads "..."`` run without ``--live``) put their drafts here instead
of sending when approval is on. Today, the dashboard and the MCP tools approve,
edit or skip them. Approving sends through the normal sender, so suppression,
warmup and the pre-send hook still apply.

Rows live in the ``drafts`` table (schema migration 5). ``ref`` says where a draft
came from: ``{"campaign", "step"}`` always, plus ``enrollment_id``/``sequence_id``
for a sequence or ``workflow``/``run_id`` for a workflow.
"""
from __future__ import annotations

import json
import time

from openleads import settings
from openleads.models import Draft

SOURCES = ("sequence", "workflow", "ask")
_GONE = ("replied", "bounced")


def approval_on(db) -> bool:
    """Whether unattended first emails wait for approval in this workspace."""
    mode = str(settings.get("approve_first_emails") or "auto").lower()
    if mode in ("on", "off"):
        return mode == "on"
    return db.kv_get("approval.default", "on") == "on"


def _row(r: dict | None) -> dict | None:
    if not r:
        return None
    out = dict(r)
    try:
        out["ref"] = json.loads(out.get("ref") or "{}")
    except ValueError:
        out["ref"] = {}
    return out


def enqueue(db, draft: Draft, source: str, ref: dict) -> dict:
    if source not in SOURCES:
        raise ValueError(f"unknown draft source: {source!r}")
    quality = (draft.quality or {}).get("score")
    cur = db.execute(
        "INSERT INTO drafts (email, subject, body, source, ref, quality, status, created) "
        "VALUES (?,?,?,?,?,?, 'waiting', ?)",
        ((draft.email or "").lower().strip(), draft.subject, draft.body, source,
         json.dumps(ref or {}), quality, time.time()))
    return get(db, cur.lastrowid)


def get(db, draft_id) -> dict | None:
    try:
        return _row(db.query_one("SELECT * FROM drafts WHERE id=?", (int(draft_id),)))
    except (TypeError, ValueError):
        return None


def waiting(db, limit: int = 50) -> list:
    rows = db.query("SELECT * FROM drafts WHERE status='waiting' ORDER BY created ASC, id ASC "
                    "LIMIT ?", (int(limit),))
    return [_row(r) for r in rows]


def count_waiting(db) -> int:
    return int(db.scalar("SELECT COUNT(*) FROM drafts WHERE status='waiting'", default=0) or 0)


def _decide(db, draft_id: int, status: str, detail: str, now: float, **fields) -> dict:
    sets = ", ".join(f"{k}=?" for k in fields)
    db.execute(f"UPDATE drafts SET status=?, detail=?, decided=?{', ' + sets if sets else ''} "
               "WHERE id=?", (status, detail, now, *fields.values(), int(draft_id)))
    return {"id": int(draft_id), "status": status, "detail": detail}


def _not_waiting(row: dict | None, draft_id) -> dict | None:
    if row is None:
        return {"id": draft_id, "status": "error", "detail": "no such draft"}
    if row["status"] != "waiting":
        return {"id": row["id"], "status": "error", "detail": f"already {row['status']}"}
    return None


def _why_not(db, row: dict) -> str:
    """A reason this draft should no longer go out, or ''."""
    lead = db.get_lead(row["email"]) or {}
    if lead.get("status") in _GONE:
        return f"contact {lead['status']} since it was queued"
    if lead.get("stage") == "do_not_contact":
        return "contact is marked do not contact"
    enr_id = row["ref"].get("enrollment_id")
    if row["source"] == "sequence" and enr_id:
        enr = db.query_one("SELECT status FROM enrollments WHERE id=?", (int(enr_id),))
        if not enr or enr["status"] != "active":
            return "contact is no longer in the sequence"
    return ""


def approve(db, draft_id, subject: str | None = None, body: str | None = None,
            now: float | None = None) -> dict:
    """Send a waiting draft (with optional edits). Never sends the same draft twice."""
    from openleads.outreach import sender
    now = time.time() if now is None else now
    row = get(db, draft_id)
    bad = _not_waiting(row, draft_id)
    if bad:
        return bad
    if subject is not None:
        row["subject"] = subject
    if body is not None:
        row["body"] = body
    why = _why_not(db, row)
    if why:
        _skip_source(db, row, now)
        return _decide(db, row["id"], "skipped", why, now)
    # Claim the row first so a second approve (another tab, a double key press)
    # finds it already taken and sends nothing.
    claimed = db.execute("UPDATE drafts SET status='sending' WHERE id=? AND status='waiting'",
                         (row["id"],)).rowcount
    if not claimed:
        return {"id": row["id"], "status": "error", "detail": "already being sent"}
    ref = row["ref"]
    draft = Draft(email=row["email"], subject=row["subject"], body=row["body"],
                  step=int(ref.get("step") or 1))
    [res] = sender.send_drafts([draft], dry_run=False, db=db,
                               campaign=ref.get("campaign") or "default",
                               step=int(ref.get("step") or 1))
    detail = res.detail or res.error or ""
    if res.status == "error" or (res.status == "skipped" and "warmup" in detail):
        # Nothing went out and it may work later (cap resets tomorrow, SMTP recovers):
        # keep the draft, with any edits, in the queue.
        db.execute("UPDATE drafts SET status='waiting', detail=?, subject=?, body=? WHERE id=?",
                   (detail, row["subject"], row["body"], row["id"]))
        return {"id": row["id"], "status": "error",
                "detail": detail or "not sent; still waiting in Today"}
    if res.status == "sent" and row["source"] == "sequence" and ref.get("enrollment_id"):
        from openleads.workspace import sequences
        sequences.approved(db, int(ref["enrollment_id"]), row["subject"], now)
    return _decide(db, row["id"], res.status, detail, now,
                   subject=row["subject"], body=row["body"])


def _skip_source(db, row: dict, now: float) -> None:
    ref = row["ref"]
    if row["source"] == "sequence" and ref.get("enrollment_id"):
        from openleads.workspace import sequences
        sequences.skipped(db, int(ref["enrollment_id"]), now)


def skip(db, draft_id, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    row = get(db, draft_id)
    bad = _not_waiting(row, draft_id)
    if bad:
        return bad
    _skip_source(db, row, now)
    return _decide(db, row["id"], "skipped", "skipped by you", now)
