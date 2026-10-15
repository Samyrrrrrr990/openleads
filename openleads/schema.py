"""
Versioned schema migrations for the application database (``openleads.db``).

The baseline tables (v1) are created by :meth:`openleads.db.DB._init`. Every later
change is a numbered migration here, applied once, in order, inside a transaction,
and recorded in SQLite's ``PRAGMA user_version``. A user upgrading from any older
release gets every step they missed; a fresh install runs them all on first open.

Rules for adding a migration:

* append a ``(version, description, fn)`` tuple with the next number;
* never edit or reorder a migration that has shipped;
* keep it additive (new tables/columns/indexes, backfills) so older data survives.
"""
from __future__ import annotations

import sqlite3
from typing import Callable

BASELINE = 1


def current_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0] or 0)


def _set_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute(f"PRAGMA user_version = {int(version)}")


def column_names(conn: sqlite3.Connection, table: str) -> set:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def add_columns(conn: sqlite3.Connection, table: str, columns: list) -> None:
    """``ALTER TABLE ADD COLUMN`` for each ``(name, decl)`` not already present."""
    have = column_names(conn, table)
    for name, decl in columns:
        if name not in have:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")


# (version, description, fn(conn)). Appended to by later releases; see module doc.
MIGRATIONS: list = []


def register(version: int, description: str) -> Callable:
    """Decorator: register ``fn`` as migration ``version``."""
    def deco(fn):
        MIGRATIONS.append((version, description, fn))
        MIGRATIONS.sort(key=lambda m: m[0])
        return fn
    return deco


def latest() -> int:
    return max([BASELINE] + [m[0] for m in MIGRATIONS])


def migrate(conn: sqlite3.Connection) -> list:
    """Apply every pending migration. Returns the versions applied (in order)."""
    applied = []
    version = current_version(conn)
    if version < BASELINE:
        _set_version(conn, BASELINE)
        conn.commit()
        version = BASELINE
    for number, _desc, fn in MIGRATIONS:
        if number <= version:
            continue
        try:
            # Take the write lock first, then re-check: the scheduler and the
            # dashboard may open the database at the same moment.
            conn.execute("BEGIN IMMEDIATE")
            version = current_version(conn)
            if number <= version:
                conn.commit()
                continue
            fn(conn)
            _set_version(conn, number)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        applied.append(number)
        version = number
    return applied


# --------------------------------------------------------------------------- #
# v2 — structured contact columns (filterable without parsing JSON)           #
# --------------------------------------------------------------------------- #
CONTACT_COLUMNS = [
    ("first_name", "TEXT DEFAULT ''"), ("last_name", "TEXT DEFAULT ''"),
    ("city", "TEXT DEFAULT ''"), ("state", "TEXT DEFAULT ''"), ("country", "TEXT DEFAULT ''"),
    ("phone", "TEXT DEFAULT ''"), ("linkedin_url", "TEXT DEFAULT ''"),
    ("website", "TEXT DEFAULT ''"), ("industry", "TEXT DEFAULT ''"),
    ("employees", "TEXT DEFAULT ''"), ("company_size", "TEXT DEFAULT ''"),
    ("seniority", "TEXT DEFAULT ''"), ("department", "TEXT DEFAULT ''"),
    ("evidence", "TEXT DEFAULT ''"), ("confidence_pct", "INTEGER DEFAULT 0"),
    ("stage", "TEXT DEFAULT 'new'"), ("owner", "TEXT DEFAULT ''"),
    ("last_contacted", "REAL"), ("fit_score", "INTEGER DEFAULT 0"),
]


def contact_fields(lead: dict) -> dict:
    """The structured column values for a lead dict (shared by upsert + backfill)."""
    import json as _json

    from openleads.insights import companysize
    from openleads.insights.titles import classify
    from openleads.models import evidence_of
    d = lead or {}
    if isinstance(d.get("data"), str):
        try:
            d = {**_json.loads(d["data"] or "{}"), **{k: v for k, v in d.items() if v}}
        except ValueError:
            pass
    first, last = d.get("first_name", ""), d.get("last_name", "")
    if not (first or last) and d.get("name"):
        parts = str(d["name"]).split()
        first, last = (parts[0], " ".join(parts[1:])) if parts else ("", "")
    seniority, department = d.get("seniority", ""), d.get("department", "")
    if not (seniority or department) and (first or last):
        seniority, department = classify(d.get("title", ""))
    email = d.get("email", "")
    evidence = d.get("evidence") or (evidence_of(email, d.get("signals")) if email else "")
    return {
        "first_name": first or "", "last_name": last or "",
        "city": d.get("city", "") or "", "state": d.get("state", "") or "",
        "country": d.get("country", "") or "", "phone": d.get("phone", "") or "",
        "linkedin_url": d.get("linkedin_url", "") or "", "website": d.get("website", "") or "",
        "industry": d.get("industry", "") or "", "employees": str(d.get("employees", "") or ""),
        "company_size": d.get("company_size") or companysize.bucket(d.get("employees", "")),
        "seniority": seniority or "", "department": department or "",
        "evidence": evidence or "", "confidence_pct": _int(d.get("confidence_pct")),
    }


def _int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


@register(2, "structured contact columns + backfill")
def _m2_contact_columns(conn):
    from openleads.workspace.stages import STATUS_TO_STAGE
    add_columns(conn, "leads", CONTACT_COLUMNS)
    rows = conn.execute("SELECT email, name, title, status, data FROM leads").fetchall()
    for email, name, title, status, data in rows:
        vals = contact_fields({"email": email, "name": name, "title": title, "data": data})
        vals["stage"] = STATUS_TO_STAGE.get(status or "new", "new")
        sets = ", ".join(f"{k}=?" for k in vals)
        conn.execute(f"UPDATE leads SET {sets} WHERE email=?", (*vals.values(), email))
    conn.execute(
        "UPDATE leads SET last_contacted = (SELECT MAX(ts) FROM touches t "
        "WHERE t.email = leads.email AND t.status = 'sent')")
    for col in ("domain", "stage", "seniority", "department", "created", "organization",
                "tier", "source"):
        conn.execute(f"CREATE INDEX IF NOT EXISTS idx_leads_{col} ON leads ({col})")
