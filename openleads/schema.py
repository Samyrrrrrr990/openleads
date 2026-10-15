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


# --------------------------------------------------------------------------- #
# v3 — the workspace: accounts, lists, tags, notes, activity, tasks, deals,     #
#      templates, sequences + enrollments, saved searches                      #
# --------------------------------------------------------------------------- #
WORKSPACE_SQL = """
CREATE TABLE IF NOT EXISTS accounts (
    domain TEXT PRIMARY KEY, name TEXT DEFAULT '', website TEXT DEFAULT '',
    industry TEXT DEFAULT '', employees TEXT DEFAULT '', company_size TEXT DEFAULT '',
    city TEXT DEFAULT '', state TEXT DEFAULT '', country TEXT DEFAULT '',
    phone TEXT DEFAULT '', description TEXT DEFAULT '', linkedin_url TEXT DEFAULT '',
    twitter_url TEXT DEFAULT '', facebook_url TEXT DEFAULT '', instagram_url TEXT DEFAULT '',
    technologies TEXT DEFAULT '', founded TEXT DEFAULT '', stage TEXT DEFAULT 'prospect',
    owner TEXT DEFAULT '', source TEXT DEFAULT '', profiled REAL, data TEXT DEFAULT '{}',
    created REAL, updated REAL
);
CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts (name);
CREATE INDEX IF NOT EXISTS idx_accounts_industry ON accounts (industry);
CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE,
    kind TEXT NOT NULL DEFAULT 'people', description TEXT DEFAULT '', color TEXT DEFAULT '',
    created REAL, updated REAL, UNIQUE (kind, name)
);
CREATE TABLE IF NOT EXISTS list_members (
    list_id INTEGER NOT NULL, ref TEXT NOT NULL, added REAL, PRIMARY KEY (list_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_list_members_ref ON list_members (ref);
CREATE TABLE IF NOT EXISTS contact_tags (
    email TEXT NOT NULL, tag TEXT NOT NULL COLLATE NOCASE, PRIMARY KEY (email, tag)
);
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON contact_tags (tag);
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ref_type TEXT NOT NULL, ref TEXT NOT NULL,
    body TEXT NOT NULL, pinned INTEGER DEFAULT 0, created REAL, updated REAL
);
CREATE INDEX IF NOT EXISTS idx_notes_ref ON notes (ref_type, ref);
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ref_type TEXT NOT NULL, ref TEXT NOT NULL,
    kind TEXT NOT NULL, summary TEXT DEFAULT '', data TEXT DEFAULT '{}', ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_ref ON activity (ref_type, ref, ts);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity (ts);
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'todo',
    title TEXT NOT NULL, note TEXT DEFAULT '', contact TEXT DEFAULT '', account TEXT DEFAULT '',
    deal_id INTEGER, due REAL, priority TEXT DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'open',
    sequence_id INTEGER, enrollment_id INTEGER, step INTEGER, created REAL, completed REAL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks (status, due);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks (contact);
CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, account TEXT DEFAULT '',
    contact TEXT DEFAULT '', stage TEXT NOT NULL DEFAULT 'qualify', amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD', close_date TEXT DEFAULT '', owner TEXT DEFAULT '',
    note TEXT DEFAULT '', position REAL DEFAULT 0, created REAL, updated REAL, closed REAL
);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals (stage);
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    subject TEXT DEFAULT '', body TEXT DEFAULT '', category TEXT DEFAULT '',
    used INTEGER DEFAULT 0, created REAL, updated REAL
);
CREATE TABLE IF NOT EXISTS sequences (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    status TEXT NOT NULL DEFAULT 'paused', steps TEXT NOT NULL DEFAULT '[]',
    settings TEXT NOT NULL DEFAULT '{}', created REAL, updated REAL
);
CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sequence_id INTEGER NOT NULL, email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', step INTEGER NOT NULL DEFAULT 0, next_due REAL,
    task_id INTEGER, errors INTEGER DEFAULT 0, last_error TEXT DEFAULT '',
    thread_subject TEXT DEFAULT '', enrolled REAL, last_step_at REAL, finished REAL,
    UNIQUE (sequence_id, email)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_due ON enrollments (status, next_due);
CREATE INDEX IF NOT EXISTS idx_enrollments_email ON enrollments (email);
CREATE TABLE IF NOT EXISTS saved_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'people',
    filters TEXT NOT NULL DEFAULT '{}', created REAL, UNIQUE (kind, name)
);
"""


def tech_column(technologies) -> str:
    """Technologies as '|A|B|' so a filter can match one exactly with LIKE '%|A|%'."""
    names = [str(t).strip() for t in (technologies or []) if str(t).strip()]
    return "|" + "|".join(names) + "|" if names else ""


def account_fields(lead: dict) -> dict:
    """Company columns derivable from one contact/lead dict (empty strings when unknown)."""
    from openleads.insights import companysize
    socials = lead.get("socials") or {}
    return {
        "name": lead.get("organization", "") or "",
        "website": lead.get("website", "") or "",
        "industry": lead.get("industry", "") or "",
        "employees": str(lead.get("employees", "") or ""),
        "company_size": lead.get("company_size") or companysize.bucket(lead.get("employees")),
        "city": lead.get("city", "") or "", "state": lead.get("state", "") or "",
        "country": lead.get("country", "") or "",
        "phone": lead.get("phone", "") if not lead.get("first_name") else "",
        "description": lead.get("description", "") or "",
        "linkedin_url": socials.get("linkedin", "") or "",
        "twitter_url": socials.get("twitter", "") or "",
        "facebook_url": socials.get("facebook", "") or "",
        "instagram_url": socials.get("instagram", "") or "",
        "technologies": tech_column(lead.get("technologies")),
        "source": lead.get("source", "") or "",
    }


def sync_account(conn, domain: str, lead: dict, now: float) -> None:
    """Create the account for ``domain`` or fill its blank fields from ``lead``."""
    from openleads.emails.permute import is_free_provider
    domain = (domain or "").lower().strip()
    if not domain or is_free_provider(domain):
        return
    vals = account_fields(lead)
    cols = list(vals)
    fills = ", ".join(f"{c} = CASE WHEN COALESCE({c}, '') = '' THEN excluded.{c} ELSE {c} END"
                      for c in cols)
    conn.execute(
        f"INSERT INTO accounts (domain, {', '.join(cols)}, created, updated) "
        f"VALUES (?, {', '.join('?' for _ in cols)}, ?, ?) "
        f"ON CONFLICT(domain) DO UPDATE SET {fills}, updated = excluded.updated",
        (domain, *vals.values(), now, now))


@register(3, "workspace tables + account backfill")
def _m3_workspace(conn):
    import json as _json
    import time as _time
    for stmt in WORKSPACE_SQL.split(";"):
        if stmt.strip():
            conn.execute(stmt)
    now = _time.time()
    for domain, data, org in conn.execute(
            "SELECT domain, data, organization FROM leads WHERE COALESCE(domain,'') != ''"
            ).fetchall():
        try:
            lead = _json.loads(data or "{}")
        except ValueError:
            lead = {}
        lead.setdefault("organization", org or "")
        sync_account(conn, domain, lead, now)
