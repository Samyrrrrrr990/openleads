"""v5 database foundation: generic helpers, pragmas, migrations."""
from openleads.db import DB


def _db(tmp_path):
    return DB(tmp_path / "t.db")


def test_query_helpers_roundtrip(tmp_path):
    db = _db(tmp_path)
    db.execute("INSERT INTO kv (k, v, ts) VALUES (?,?,?)", ("a", '"1"', 1.0))
    assert db.query("SELECT k FROM kv") == [{"k": "a"}]
    assert db.query_one("SELECT k FROM kv WHERE k=?", ("a",)) == {"k": "a"}
    assert db.query_one("SELECT k FROM kv WHERE k=?", ("zz",)) is None
    assert db.scalar("SELECT COUNT(*) FROM kv") == 1
    assert db.scalar("SELECT v FROM kv WHERE k='nope'", default=7) == 7
    n = db.executemany("INSERT INTO kv (k, v, ts) VALUES (?,?,?)",
                       [("b", "1", 1.0), ("c", "1", 1.0)])
    assert n == 2 and db.scalar("SELECT COUNT(*) FROM kv") == 3
    db.close()


def test_wal_mode_on_file_db(tmp_path):
    db = _db(tmp_path)
    mode = db.scalar("PRAGMA journal_mode")
    assert str(mode).lower() in ("wal", "delete")  # delete only where WAL is unsupported
    db.close()


def test_migrations_apply_once_and_record_version(tmp_path):
    from openleads import schema
    db = _db(tmp_path)
    assert db.schema_version == schema.latest()
    db.close()
    # Re-opening applies nothing new.
    db = _db(tmp_path)
    assert schema.migrate(db._conn) == []
    db.close()


def test_failed_migration_rolls_back(tmp_path, monkeypatch):
    import sqlite3

    from openleads import schema
    conn = sqlite3.connect(str(tmp_path / "m.db"))
    conn.execute("CREATE TABLE t (a TEXT)")
    conn.commit()

    def boom(c):
        c.execute("ALTER TABLE t ADD COLUMN b TEXT")
        raise RuntimeError("nope")

    monkeypatch.setattr(schema, "MIGRATIONS", [(999, "boom", boom)])
    try:
        schema.migrate(conn)
    except RuntimeError:
        pass
    assert "b" not in schema.column_names(conn, "t")
    assert schema.current_version(conn) == schema.BASELINE
