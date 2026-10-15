"""
Notes — what you learned on a call, why a deal stalled, who the champion is.

Attached to a contact (email), a company (domain) or a deal (id). Pinned notes sort
first. Adding a note also writes a timeline event so it shows in the activity feed.
"""
from __future__ import annotations

import time

from openleads.workspace import activity

REF_TYPES = ("contact", "company", "deal")
MAX_LEN = 20000


def _ref(ref) -> str:
    return str(ref or "").lower().strip()


def add(db, ref_type: str, ref, body: str, pinned: bool = False) -> dict:
    if ref_type not in REF_TYPES:
        raise ValueError(f"ref_type must be one of {REF_TYPES}")
    body = (body or "").strip()[:MAX_LEN]
    if not body or not _ref(ref):
        raise ValueError("a note needs text and something to attach to")
    now = time.time()
    cur = db.execute(
        "INSERT INTO notes (ref_type, ref, body, pinned, created, updated) VALUES (?,?,?,?,?,?)",
        (ref_type, _ref(ref), body, 1 if pinned else 0, now, now))
    activity.log(db, ref_type, ref, "note", body[:140], {"note_id": cur.lastrowid})
    return get(db, cur.lastrowid)


def get(db, note_id) -> dict | None:
    return db.query_one("SELECT * FROM notes WHERE id=?", (int(note_id),))


def for_ref(db, ref_type: str, ref) -> list:
    return db.query("SELECT * FROM notes WHERE ref_type=? AND ref=? "
                    "ORDER BY pinned DESC, created DESC", (ref_type, _ref(ref)))


def update(db, note_id, body: str | None = None, pinned: bool | None = None) -> dict | None:
    note = get(db, note_id)
    if not note:
        return None
    if body is not None:
        body = body.strip()[:MAX_LEN]
        if not body:
            raise ValueError("a note can't be empty")
        db.execute("UPDATE notes SET body=?, updated=? WHERE id=?", (body, time.time(), note["id"]))
    if pinned is not None:
        db.execute("UPDATE notes SET pinned=? WHERE id=?", (1 if pinned else 0, note["id"]))
    return get(db, note["id"])


def delete(db, note_id) -> bool:
    return db.execute("DELETE FROM notes WHERE id=?", (int(note_id),)).rowcount > 0


def count_for(db, ref_type: str, refs) -> dict:
    refs = sorted({_ref(r) for r in refs or [] if _ref(r)})
    out = {r: 0 for r in refs}
    for i in range(0, len(refs), 500):
        chunk = refs[i:i + 500]
        marks = ",".join("?" for _ in chunk)
        for r in db.query(f"SELECT ref, COUNT(*) AS n FROM notes WHERE ref_type=? AND ref IN "
                          f"({marks}) GROUP BY ref", (ref_type, *chunk)):
            out[r["ref"]] = r["n"]
    return out
