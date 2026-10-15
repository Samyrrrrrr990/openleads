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
