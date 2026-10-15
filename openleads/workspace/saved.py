"""
Saved searches — a named set of People or Companies filters you come back to
("VPs of sales in Texas, never contacted"). Stored as the same filter dict
:func:`openleads.workspace.people.search` takes, so a saved search is just a bookmark.
"""
from __future__ import annotations

import json
import time

KINDS = ("people", "companies")


def _decode(row: dict | None) -> dict | None:
    if row:
        try:
            row["filters"] = json.loads(row.get("filters") or "{}")
        except ValueError:
            row["filters"] = {}
    return row


def _clean(filters: dict) -> dict:
    """Drop empty values so a saved search stays readable."""
    return {k: v for k, v in (filters or {}).items() if v not in (None, "", [], {}, False)}


def save(db, name: str, filters: dict, kind: str = "people") -> dict:
    """Create or overwrite the saved search ``name``."""
    name = " ".join(str(name or "").split())[:80]
    if not name:
        raise ValueError("a saved search needs a name")
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    db.execute("INSERT INTO saved_searches (name, kind, filters, created) VALUES (?,?,?,?) "
               "ON CONFLICT(kind, name) DO UPDATE SET filters=excluded.filters",
               (name, kind, json.dumps(_clean(filters)), time.time()))
    return get(db, name, kind)


def get(db, ident, kind: str = "people") -> dict | None:
    try:
        return _decode(db.query_one("SELECT * FROM saved_searches WHERE id=?", (int(ident),)))
    except (TypeError, ValueError):
        return _decode(db.query_one("SELECT * FROM saved_searches WHERE name=? AND kind=?",
                                    (str(ident), kind)))


def list_saved(db, kind: str | None = None) -> list:
    if kind:
        rows = db.query("SELECT * FROM saved_searches WHERE kind=? ORDER BY name COLLATE NOCASE",
                        (kind,))
    else:
        rows = db.query("SELECT * FROM saved_searches ORDER BY kind, name COLLATE NOCASE")
    return [_decode(r) for r in rows]


def delete(db, ident, kind: str = "people") -> bool:
    row = get(db, ident, kind)
    return bool(row) and db.execute("DELETE FROM saved_searches WHERE id=?",
                                    (row["id"],)).rowcount > 0


def run(db, ident, kind: str = "people", **kw) -> dict:
    """Execute a saved search and return the page of results."""
    row = get(db, ident, kind)
    if not row:
        raise ValueError("no such saved search")
    if row["kind"] == "companies":
        from openleads.workspace import companies
        return companies.search(db, row["filters"], **kw)
    from openleads.workspace import people
    return people.search(db, row["filters"], **kw)
