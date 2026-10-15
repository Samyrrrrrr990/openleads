"""
The activity log — one timeline of everything that happened to a contact, company
or deal: found by a search, stage changed, note added, emailed, replied, added to a
list, enrolled in a sequence, task completed, deal moved.

Workspace modules call :func:`log` as they change things. Sent emails already live
in the ``touches`` table, so :func:`timeline` merges them in rather than storing
them twice.
"""
from __future__ import annotations

import json
import time

# kind → (label, icon) for the UI. Unknown kinds still render with their key.
KINDS = {
    "created": ("Added to CRM", "plus"),
    "found": ("Found by a search", "find"),
    "imported": ("Imported", "upload"),
    "updated": ("Details updated", "edit"),
    "stage": ("Stage changed", "flag"),
    "note": ("Note", "note"),
    "tag": ("Tagged", "tag"),
    "list_add": ("Added to list", "list"),
    "list_remove": ("Removed from list", "list"),
    "enrolled": ("Enrolled in sequence", "sequence"),
    "sequence_step": ("Sequence step", "sequence"),
    "sequence_done": ("Finished sequence", "sequence"),
    "sequence_stopped": ("Left sequence", "sequence"),
    "task_created": ("Task created", "task"),
    "task_done": ("Task completed", "check"),
    "deal_created": ("Deal created", "deal"),
    "deal_stage": ("Deal moved", "deal"),
    "email_sent": ("Email sent", "send"),
    "email_error": ("Email failed", "x"),
    "email_skipped": ("Email skipped", "x"),
    "replied": ("Replied", "reply"),
    "bounced": ("Bounced", "x"),
    "merged": ("Merged duplicate", "merge"),
    "enriched": ("Enriched", "spark"),
}


def log(db, ref_type: str, ref: str, kind: str, summary: str = "", data: dict | None = None,
        ts: float | None = None) -> int:
    """Append one event. ``ref`` is an email, a domain or a deal id (as text)."""
    cur = db.execute(
        "INSERT INTO activity (ref_type, ref, kind, summary, data, ts) VALUES (?,?,?,?,?,?)",
        (ref_type, _norm(ref), kind, summary or "", json.dumps(data or {}),
         ts if ts is not None else time.time()))
    return cur.lastrowid


def log_many(db, ref_type: str, refs, kind: str, summary: str = "",
             data: dict | None = None) -> int:
    now = time.time()
    payload = json.dumps(data or {})
    return db.executemany(
        "INSERT INTO activity (ref_type, ref, kind, summary, data, ts) VALUES (?,?,?,?,?,?)",
        [(ref_type, _norm(r), kind, summary or "", payload, now) for r in refs])


def _norm(ref) -> str:
    return str(ref or "").lower().strip()


def _row(r: dict) -> dict:
    try:
        r["data"] = json.loads(r.get("data") or "{}")
    except (ValueError, TypeError):
        r["data"] = {}
    label, icon = KINDS.get(r["kind"], (r["kind"].replace("_", " ").capitalize(), "dot"))
    r["label"], r["icon"] = label, icon
    return r


def _touch_rows(db, where: str, params, limit: int) -> list:
    rows = db.query(
        "SELECT id, email, campaign, step, subject, status, error, ts FROM touches "
        f"WHERE status IN ('sent', 'error', 'skipped') AND {where} ORDER BY ts DESC LIMIT ?",
        (*params, limit))
    out = []
    for t in rows:
        out.append(_row({
            "id": f"t{t['id']}", "ref_type": "contact", "ref": t["email"],
            "kind": f"email_{t['status']}", "summary": t["subject"] or "",
            "data": json.dumps({"campaign": t["campaign"], "step": t["step"],
                                "error": t["error"] or ""}),
            "ts": t["ts"]}))
    return out


def timeline(db, ref_type: str, ref: str, limit: int = 100) -> list:
    """Newest-first events for one record. Contacts include their sent emails."""
    ref = _norm(ref)
    rows = [_row(r) for r in db.query(
        "SELECT * FROM activity WHERE ref_type=? AND ref=? ORDER BY ts DESC, id DESC LIMIT ?",
        (ref_type, ref, limit))]
    if ref_type == "contact":
        rows += _touch_rows(db, "email=?", (ref,), limit)
    elif ref_type == "company":
        # A company's timeline is its own events plus everything its people did.
        rows += [_row(r) for r in db.query(
            "SELECT a.* FROM activity a JOIN leads l ON a.ref = l.email "
            "WHERE a.ref_type='contact' AND l.domain=? ORDER BY a.ts DESC LIMIT ?",
            (ref, limit))]
        rows += _touch_rows(db, "email IN (SELECT email FROM leads WHERE domain=?)",
                            (ref,), limit)
    rows.sort(key=lambda r: r["ts"], reverse=True)
    return rows[:limit]


# A search adds dozens of contacts at once; the home feed would drown in them.
FEED_EXCLUDE = ("created", "updated")


def recent(db, limit: int = 50, kinds=None, exclude=FEED_EXCLUDE) -> list:
    """The workspace-wide feed (home page), newest first."""
    if kinds:
        marks = ",".join("?" for _ in kinds)
        rows = db.query(f"SELECT * FROM activity WHERE kind IN ({marks}) "
                        "ORDER BY ts DESC, id DESC LIMIT ?", (*kinds, limit))
    else:
        ex = list(exclude or ()) or ["\x00"]
        marks = ",".join("?" for _ in ex)
        rows = db.query(f"SELECT * FROM activity WHERE kind NOT IN ({marks}) "
                        "ORDER BY ts DESC, id DESC LIMIT ?", (*ex, limit))
    out = [_row(r) for r in rows]
    if not kinds or any(k.startswith("email_") for k in kinds):
        out += _touch_rows(db, "1=1", (), limit)
    out.sort(key=lambda r: r["ts"], reverse=True)
    names = _names(db, {r["ref"] for r in out if r["ref_type"] == "contact"})
    for r in out:
        if r["ref_type"] == "contact":
            r["name"] = names.get(r["ref"], "")
    return out[:limit]


def _names(db, emails) -> dict:
    emails = list(emails)
    if not emails:
        return {}
    out = {}
    for i in range(0, len(emails), 500):
        chunk = emails[i:i + 500]
        marks = ",".join("?" for _ in chunk)
        for r in db.query(f"SELECT email, name, organization FROM leads WHERE email IN ({marks})",
                          chunk):
            out[r["email"]] = r["name"] or r["organization"] or ""
    return out
