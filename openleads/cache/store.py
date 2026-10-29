"""
A tiny, dependency-free cache built on stdlib ``sqlite3``.

Values are JSON-serialized and stored per namespace with a per-namespace TTL:

* ``mx``      — MX lookup results, 7 days
* ``verify``  — SMTP verification outcomes, 14 days
* ``dataset`` — large source fetches (e.g. the YC dump), 1 day
* ``profile`` — parsed company profiles (tech stack, socials, phones), 14 days
* ``geo``     — place name → bounding box (Nominatim), 90 days

A cache hit short-circuits the network, which is both a big speedup on re-runs
and the polite thing to do to mail servers. Disable with ``--no-cache``.

Expired rows are not deleted on read: when a source is down, a recently expired
value (``get(..., max_stale=…)``) beats nothing. Rows that expired more than
``PRUNE_AFTER`` ago are pruned when the cache is opened.

:class:`MemoryCache` is the same interface kept in memory for one run — the
engine uses it under ``--no-cache`` so each URL is still fetched only once per
run while nothing is written to disk.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time

from openleads.config import cache_path

DAY = 86400
DEFAULT_TTLS = {"mx": 7 * DAY, "verify": 14 * DAY, "dataset": 1 * DAY, "profile": 14 * DAY,
                "geo": 90 * DAY}
# Rows that expired longer ago than this are deleted when the cache is opened.
PRUNE_AFTER = 30 * DAY


class Cache:
    def __init__(self, path=None, ttls: dict | None = None):
        self.path = str(path) if path else str(cache_path())
        self.ttls = dict(DEFAULT_TTLS)
        if ttls:
            self.ttls.update(ttls)
        # The engine resolves leads concurrently, so this connection is shared
        # across threads — open it cross-thread and serialize calls with a lock.
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS cache ("
            "  ns TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL,"
            "  ts REAL NOT NULL, PRIMARY KEY (ns, k))"
        )
        self._conn.commit()
        self.prune()

    def ttl_for(self, ns: str) -> int:
        return self.ttls.get(ns, DAY)

    def get(self, ns: str, key: str, max_stale: float = 0):
        """Return the cached value for (ns, key) if fresh, else None.

        ``max_stale`` (seconds) also accepts a row that expired at most that long
        ago — for falling back on recent data when the live source fails.
        """
        with self._lock:
            row = self._conn.execute(
                "SELECT v, ts FROM cache WHERE ns=? AND k=?", (ns, key)
            ).fetchone()
        if not row:
            return None
        value_json, ts = row
        if time.time() - ts > self.ttl_for(ns) + max(0, max_stale or 0):
            return None
        try:
            return json.loads(value_json)
        except (ValueError, TypeError):
            return None

    def set(self, ns: str, key: str, value) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO cache (ns, k, v, ts) VALUES (?, ?, ?, ?)",
                (ns, key, json.dumps(value), time.time()),
            )
            self._conn.commit()

    def prune(self) -> int:
        """Delete rows that expired more than ``PRUNE_AFTER`` ago. Returns how many."""
        now = time.time()
        removed = 0
        with self._lock:
            try:
                for ns in {r[0] for r in self._conn.execute("SELECT DISTINCT ns FROM cache")}:
                    cur = self._conn.execute(
                        "DELETE FROM cache WHERE ns=? AND ts < ?",
                        (ns, now - self.ttl_for(ns) - PRUNE_AFTER))
                    removed += max(0, cur.rowcount or 0)
                self._conn.commit()
            except sqlite3.DatabaseError:
                pass        # a read-only or busy cache file is still usable
        return removed

    def clear(self) -> int:
        """Delete all cached rows. Returns how many were removed."""
        with self._lock:
            cur = self._conn.execute("SELECT COUNT(*) FROM cache")
            n = cur.fetchone()[0]
            self._conn.execute("DELETE FROM cache")
            self._conn.commit()
        return n

    def info(self) -> dict:
        """Counts per namespace, for ``openleads cache info``."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT ns, COUNT(*) FROM cache GROUP BY ns"
            ).fetchall()
        return {"path": self.path, "counts": {ns: c for ns, c in rows}}

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass


class MemoryCache:
    """In-memory, run-scoped stand-in for :class:`Cache` (same get/set/close).

    Values never expire and are never persisted: it exists so a ``--no-cache`` run
    still fetches each URL once instead of once per lead that needs it. Always
    truthy, so ``if cache:`` guards treat it as a real cache.
    """

    path = ":memory:"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: dict = {}

    def __bool__(self) -> bool:
        return True

    def ttl_for(self, ns: str) -> int:
        return DEFAULT_TTLS.get(ns, DAY)

    def get(self, ns: str, key: str, max_stale: float = 0):
        with self._lock:
            hit = self._data.get((ns, key))
        # Hand back a copy: callers may mutate what they get (the SQLite cache
        # returns a fresh object on every read, so they're allowed to).
        return json.loads(hit) if hit is not None else None

    def set(self, ns: str, key: str, value) -> None:
        with self._lock:
            self._data[(ns, key)] = json.dumps(value)

    def prune(self) -> int:
        return 0

    def clear(self) -> int:
        with self._lock:
            n = len(self._data)
            self._data.clear()
        return n

    def info(self) -> dict:
        counts: dict = {}
        with self._lock:
            for ns, _ in self._data:
                counts[ns] = counts.get(ns, 0) + 1
        return {"path": self.path, "counts": counts}

    def close(self) -> None:
        pass
