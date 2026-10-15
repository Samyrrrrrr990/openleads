"""
Lists — named, static groups of people or companies ("Q4 dentists", "Austin
agencies to call"). Add from a search, a selection or an import; enroll a whole list
in a sequence; export it.

A list holds references: contact emails for ``people`` lists, company domains for
``companies`` lists. Deleting a contact leaves the list consistent because members
are joined against the CRM when read.
"""
from __future__ import annotations

import time

from openleads.workspace import activity

KINDS = ("people", "companies")
COLORS = ("gray", "red", "orange", "amber", "green", "teal", "blue", "indigo", "violet", "pink")


def _ref_type(kind: str) -> str:
    return "company" if kind == "companies" else "contact"


def _refs(refs) -> list:
    if isinstance(refs, str):
        refs = [refs]
    return sorted({(r or "").lower().strip() for r in refs or [] if (r or "").strip()})


def create(db, name: str, kind: str = "people", description: str = "", color: str = "") -> dict:
    name = " ".join(str(name or "").split())[:80]
    if not name:
        raise ValueError("a list needs a name")
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    if by_name(db, name, kind):
        raise ValueError(f"a {kind} list named '{name}' already exists")
    now = time.time()
    cur = db.execute(
        "INSERT INTO lists (name, kind, description, color, created, updated) VALUES (?,?,?,?,?,?)",
        (name, kind, description or "", color if color in COLORS else "", now, now))
    return get(db, cur.lastrowid)


def ensure(db, name: str, kind: str = "people") -> dict:
    """The list called ``name``, created if it doesn't exist yet."""
    return by_name(db, name, kind) or create(db, name, kind)


_SELECT = ("SELECT l.*, (SELECT COUNT(*) FROM list_members m WHERE m.list_id = l.id) AS count "
           "FROM lists l")


def get(db, list_id) -> dict | None:
    try:
        list_id = int(list_id)
    except (TypeError, ValueError):
        return None
    return db.query_one(_SELECT + " WHERE l.id=?", (list_id,))


def by_name(db, name: str, kind: str = "people") -> dict | None:
    return db.query_one(_SELECT + " WHERE l.name=? AND l.kind=?", (name.strip(), kind))


def all_lists(db, kind: str | None = None) -> list:
    if kind:
        return db.query(_SELECT + " WHERE l.kind=? ORDER BY l.updated DESC", (kind,))
    return db.query(_SELECT + " ORDER BY l.updated DESC")


def update(db, list_id, name: str | None = None, description: str | None = None,
           color: str | None = None) -> dict | None:
    cur = get(db, list_id)
    if not cur:
        return None
    if name is not None:
        name = " ".join(name.split())[:80]
        other = by_name(db, name, cur["kind"])
        if not name or (other and other["id"] != cur["id"]):
            raise ValueError("that list name is empty or already taken")
        db.execute("UPDATE lists SET name=? WHERE id=?", (name, cur["id"]))
    if description is not None:
        db.execute("UPDATE lists SET description=? WHERE id=?", (description, cur["id"]))
    if color is not None:
        db.execute("UPDATE lists SET color=? WHERE id=?",
                   (color if color in COLORS else "", cur["id"]))
    _touch(db, cur["id"])
    return get(db, cur["id"])


def delete(db, list_id) -> bool:
    cur = get(db, list_id)
    if not cur:
        return False
    db.execute("DELETE FROM list_members WHERE list_id=?", (cur["id"],))
    db.execute("DELETE FROM lists WHERE id=?", (cur["id"],))
    return True


def _touch(db, list_id: int) -> None:
    db.execute("UPDATE lists SET updated=? WHERE id=?", (time.time(), list_id))


def add(db, list_id, refs) -> int:
    """Add members (emails or domains). Returns how many were new."""
    cur = get(db, list_id)
    refs = _refs(refs)
    if not cur or not refs:
        return 0
    before = cur["count"]
    now = time.time()
    db.executemany("INSERT OR IGNORE INTO list_members (list_id, ref, added) VALUES (?,?,?)",
                   [(cur["id"], r, now) for r in refs])
    added = get(db, cur["id"])["count"] - before
    if added:
        _touch(db, cur["id"])
        activity.log_many(db, _ref_type(cur["kind"]), refs, "list_add", cur["name"],
                          {"list_id": cur["id"]})
    return added


def remove(db, list_id, refs) -> int:
    cur = get(db, list_id)
    refs = _refs(refs)
    if not cur or not refs:
        return 0
    marks = ",".join("?" for _ in refs)
    n = db.execute(f"DELETE FROM list_members WHERE list_id=? AND ref IN ({marks})",
                   (cur["id"], *refs)).rowcount
    if n:
        _touch(db, cur["id"])
        activity.log_many(db, _ref_type(cur["kind"]), refs, "list_remove", cur["name"],
                          {"list_id": cur["id"]})
    return n


def members(db, list_id) -> list:
    return [r["ref"] for r in db.query(
        "SELECT ref FROM list_members WHERE list_id=? ORDER BY added DESC", (int(list_id),))]


def lists_for(db, ref: str) -> list:
    """The lists ``ref`` (an email or domain) belongs to."""
    return db.query("SELECT l.id, l.name, l.kind, l.color FROM lists l JOIN list_members m "
                    "ON m.list_id = l.id WHERE m.ref=? ORDER BY l.name COLLATE NOCASE",
                    ((ref or "").lower().strip(),))


def lists_for_many(db, refs) -> dict:
    refs = _refs(refs)
    out: dict = {r: [] for r in refs}
    for i in range(0, len(refs), 500):
        chunk = refs[i:i + 500]
        marks = ",".join("?" for _ in chunk)
        for r in db.query(f"SELECT m.ref, l.id, l.name, l.color FROM lists l JOIN list_members m "
                          f"ON m.list_id = l.id WHERE m.ref IN ({marks}) "
                          "ORDER BY l.name COLLATE NOCASE", chunk):
            out.setdefault(r.pop("ref"), []).append(r)
    return out
