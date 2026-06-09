"""
A tiny, dependency-free cache built on stdlib ``sqlite3``.

Values are JSON-serialized and stored per namespace with a per-namespace TTL:

* ``mx``      — MX lookup results, 7 days
* ``verify``  — SMTP verification outcomes, 14 days
* ``dataset`` — large source fetches (e.g. the YC dump), 1 day

A cache hit short-circuits the network, which is both a big speedup on re-runs
and the polite thing to do to mail servers. Disable with ``--no-cache``.
"""
from __future__ import annotations

import json
import sqlite3
import time

from openleads.config import cache_path

DAY = 86400
DEFAULT_TTLS = {"mx": 7 * DAY, "verify": 14 * DAY, "dataset": 1 * DAY}


class Cache:
    def __init__(self, path=None, ttls: dict | None = None):
        self.path = str(path) if path else str(cache_path())
        self.ttls = dict(DEFAULT_TTLS)
        if ttls:
            self.ttls.update(ttls)
        self._conn = sqlite3.connect(self.path)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS cache ("
            "  ns TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL,"
            "  ts REAL NOT NULL, PRIMARY KEY (ns, k))"
        )
        self._conn.commit()

    def ttl_for(self, ns: str) -> int:
        return self.ttls.get(ns, DAY)

    def get(self, ns: str, key: str):
        """Return the cached value for (ns, key) if fresh, else None."""
        row = self._conn.execute(
            "SELECT v, ts FROM cache WHERE ns=? AND k=?", (ns, key)
        ).fetchone()
        if not row:
            return None
        value_json, ts = row
        if time.time() - ts > self.ttl_for(ns):
            self._conn.execute("DELETE FROM cache WHERE ns=? AND k=?", (ns, key))
            self._conn.commit()
            return None
        try:
            return json.loads(value_json)
        except (ValueError, TypeError):
            return None

    def set(self, ns: str, key: str, value) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO cache (ns, k, v, ts) VALUES (?, ?, ?, ?)",
            (ns, key, json.dumps(value), time.time()),
        )
        self._conn.commit()

    def clear(self) -> int:
        """Delete all cached rows. Returns how many were removed."""
        cur = self._conn.execute("SELECT COUNT(*) FROM cache")
        n = cur.fetchone()[0]
        self._conn.execute("DELETE FROM cache")
        self._conn.commit()
        return n

    def info(self) -> dict:
        """Counts per namespace, for ``openleads cache info``."""
        rows = self._conn.execute(
            "SELECT ns, COUNT(*) FROM cache GROUP BY ns"
        ).fetchall()
        return {"path": self.path, "counts": {ns: c for ns, c in rows}}

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass
