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
