"""
The OpenLeads application database — one small stdlib ``sqlite3`` file that turns
a one-shot finder into a stateful outreach machine.

Distinct from the network *cache* (``openleads/cache/store.py``): this is durable
user data that compounds across runs. It lives at ``~/.openleads/openleads.db``
and holds:

* ``patterns``    — per-domain learned email patterns (the deliverability flywheel:
                    once we see one real address at a domain, every future guess
                    there gets smarter).
* ``leads``       — a lightweight local CRM of everyone you've found.
* ``touches``     — every email attempt (for follow-ups, warmup math, reporting).
* ``suppression`` — addresses we must never contact (bounced/unsubscribed/dupes).
* ``campaigns``   — named outreach runs + their state.
* ``kv``          — misc state (warmup counters, last-run, …).

All methods are safe to call repeatedly; tables are created on first use.
"""
from __future__ import annotations

import json
import sqlite3
import time
from datetime import date, datetime
from pathlib import Path

from openleads.config import home

# Suppression / status vocabulary (kept small + explicit).
STATUS_NEW = "new"
STATUS_QUEUED = "queued"
STATUS_SENT = "sent"
STATUS_REPLIED = "replied"
STATUS_BOUNCED = "bounced"
STATUS_UNSUB = "unsubscribed"
STATUS_DNC = "do_not_contact"

SUPPRESSED_STATUSES = {STATUS_BOUNCED, STATUS_UNSUB, STATUS_DNC}


def db_path() -> Path:
    return home() / "openleads.db"


class DB:
    """Durable user state. Open one per process; ``close()`` when done."""

    def __init__(self, path=None):
        self.path = str(path) if path else str(db_path())
        self._conn = sqlite3.connect(self.path)
        self._conn.row_factory = sqlite3.Row
        self._init()

    def _init(self) -> None:
        c = self._conn
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS patterns (
                domain TEXT NOT NULL, pattern TEXT NOT NULL,
                support INTEGER NOT NULL DEFAULT 1, updated REAL NOT NULL,
                PRIMARY KEY (domain, pattern)
            );
            CREATE TABLE IF NOT EXISTS leads (
                email TEXT PRIMARY KEY, name TEXT, organization TEXT, title TEXT,
                domain TEXT, tier TEXT, score INTEGER, status TEXT, source TEXT,
                data TEXT, created REAL, updated REAL
            );
            CREATE TABLE IF NOT EXISTS touches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL, campaign TEXT, step INTEGER DEFAULT 1,
                subject TEXT, status TEXT, message_id TEXT, error TEXT, ts REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS suppression (
                email TEXT PRIMARY KEY, reason TEXT, ts REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS campaigns (
                name TEXT PRIMARY KEY, data TEXT, created REAL, updated REAL
            );
            CREATE TABLE IF NOT EXISTS kv (
                k TEXT PRIMARY KEY, v TEXT, ts REAL
            );
            CREATE INDEX IF NOT EXISTS idx_touches_email ON touches (email);
            CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
            """
        )
        c.commit()

    # --- patterns (deliverability flywheel) -------------------------------- #
    def learn_pattern(self, domain: str, pattern: str) -> None:
        """Record/strengthen a learned local-part pattern for ``domain``."""
        domain = (domain or "").lower().strip()
        if not domain or not pattern:
            return
        self._conn.execute(
            "INSERT INTO patterns (domain, pattern, support, updated) VALUES (?,?,1,?) "
            "ON CONFLICT(domain, pattern) DO UPDATE SET support = support + 1, updated = ?",
            (domain, pattern, time.time(), time.time()),
        )
        self._conn.commit()

    def patterns_for(self, domain: str) -> list[dict]:
        """Learned patterns for ``domain``, strongest first."""
        rows = self._conn.execute(
            "SELECT pattern, support FROM patterns WHERE domain=? ORDER BY support DESC",
            ((domain or "").lower().strip(),),
        ).fetchall()
        return [dict(r) for r in rows]

    # --- suppression ------------------------------------------------------- #
    def suppress(self, email: str, reason: str) -> None:
        email = (email or "").lower().strip()
        if not email:
            return
        self._conn.execute(
            "INSERT OR REPLACE INTO suppression (email, reason, ts) VALUES (?,?,?)",
            (email, reason, time.time()),
        )
        self._conn.commit()

    def is_suppressed(self, email: str) -> str | None:
        row = self._conn.execute(
            "SELECT reason FROM suppression WHERE email=?", ((email or "").lower().strip(),)
        ).fetchone()
        return row["reason"] if row else None

    def list_suppressed(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT email, reason, ts FROM suppression ORDER BY ts DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    # --- leads (local CRM) ------------------------------------------------- #
    def upsert_lead(self, lead: dict) -> bool:
        """Insert/update a lead by email. Returns True if newly inserted."""
        email = (lead.get("email") or "").lower().strip()
        if not email:
            return False
        now = time.time()
        existing = self._conn.execute(
            "SELECT email, status FROM leads WHERE email=?", (email,)
        ).fetchone()
        name = (f"{lead.get('first_name','')} {lead.get('last_name','')}").strip() \
            or lead.get("name", "")
        domain = lead.get("domain") or (email.split("@", 1)[1] if "@" in email else "")
        row = (
            email, name, lead.get("organization", ""), lead.get("title", ""), domain,
            lead.get("tier", ""), int(lead.get("score", 0) or 0),
            lead.get("status") or (existing["status"] if existing else STATUS_NEW),
            lead.get("source", ""), json.dumps(lead),
        )
        if existing:
            self._conn.execute(
                "UPDATE leads SET name=?, organization=?, title=?, domain=?, tier=?, "
                "score=?, status=?, source=?, data=?, updated=? WHERE email=?",
                (row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8],
                 row[9], now, email),
            )
            self._conn.commit()
            return False
        self._conn.execute(
            "INSERT INTO leads (email, name, organization, title, domain, tier, score, "
            "status, source, data, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (email, row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8],
             row[9], now, now),
        )
        self._conn.commit()
        return True

    def get_lead(self, email: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM leads WHERE email=?", ((email or "").lower().strip(),)
        ).fetchone()
        return dict(row) if row else None

    def set_status(self, email: str, status: str) -> None:
        self._conn.execute(
            "UPDATE leads SET status=?, updated=? WHERE email=?",
            (status, time.time(), (email or "").lower().strip()),
        )
        self._conn.commit()
        if status in SUPPRESSED_STATUSES:
            self.suppress(email, status)

    def list_leads(self, status: str | None = None, limit: int = 1000) -> list[dict]:
        if status:
            rows = self._conn.execute(
                "SELECT * FROM leads WHERE status=? ORDER BY updated DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM leads ORDER BY updated DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def lead_counts(self) -> dict:
        rows = self._conn.execute(
            "SELECT status, COUNT(*) AS n FROM leads GROUP BY status"
        ).fetchall()
        return {r["status"]: r["n"] for r in rows}

    # --- touches (send log) ------------------------------------------------ #
    def record_touch(self, email: str, status: str, subject: str = "",
                     campaign: str = "", step: int = 1, message_id: str = "",
                     error: str = "") -> None:
        self._conn.execute(
            "INSERT INTO touches (email, campaign, step, subject, status, message_id, "
            "error, ts) VALUES (?,?,?,?,?,?,?,?)",
            ((email or "").lower().strip(), campaign, step, subject, status,
             message_id, error, time.time()),
        )
        self._conn.commit()

    def touches_for(self, email: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM touches WHERE email=? ORDER BY ts ASC",
            ((email or "").lower().strip(),),
        ).fetchall()
        return [dict(r) for r in rows]

    def sent_today(self) -> int:
        """How many emails were actually sent since local midnight (for warmup caps)."""
        start = datetime.combine(date.today(), datetime.min.time()).timestamp()
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM touches WHERE status=? AND ts>=?",
            (STATUS_SENT, start),
        ).fetchone()
        return row["n"] if row else 0

    def sent_total(self) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM touches WHERE status=?", (STATUS_SENT,)
        ).fetchone()
        return row["n"] if row else 0

    def first_send_date(self) -> date | None:
        row = self._conn.execute(
            "SELECT MIN(ts) AS t FROM touches WHERE status=?", (STATUS_SENT,)
        ).fetchone()
        if not row or not row["t"]:
            return None
        return datetime.fromtimestamp(row["t"]).date()

    # --- key/value state --------------------------------------------------- #
    def kv_get(self, key: str, default=None):
        row = self._conn.execute("SELECT v FROM kv WHERE k=?", (key,)).fetchone()
        if not row:
            return default
        try:
            return json.loads(row["v"])
        except (ValueError, TypeError):
            return default

    def kv_set(self, key: str, value) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO kv (k, v, ts) VALUES (?,?,?)",
            (key, json.dumps(value), time.time()),
        )
        self._conn.commit()

    # --- campaigns --------------------------------------------------------- #
    def save_campaign(self, name: str, data: dict) -> None:
        now = time.time()
        self._conn.execute(
            "INSERT INTO campaigns (name, data, created, updated) VALUES (?,?,?,?) "
            "ON CONFLICT(name) DO UPDATE SET data=?, updated=?",
            (name, json.dumps(data), now, now, json.dumps(data), now),
        )
        self._conn.commit()

    def list_campaigns(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT name, data, created, updated FROM campaigns ORDER BY updated DESC"
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            try:
                d["data"] = json.loads(d["data"])
            except (ValueError, TypeError):
                d["data"] = {}
            out.append(d)
        return out

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass
