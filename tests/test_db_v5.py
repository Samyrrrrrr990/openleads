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


# --- migration 2: contact columns ------------------------------------------ #
import json  # noqa: E402
import sqlite3  # noqa: E402


def _old_db(path):
    """A v4.6-shaped database: baseline tables, user_version 0, some rows."""
    conn = sqlite3.connect(str(path))
    conn.executescript("""
        CREATE TABLE leads (email TEXT PRIMARY KEY, name TEXT, organization TEXT, title TEXT,
            domain TEXT, tier TEXT, score INTEGER, status TEXT, source TEXT, data TEXT,
            created REAL, updated REAL);
        CREATE TABLE touches (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL,
            campaign TEXT, step INTEGER DEFAULT 1, subject TEXT, status TEXT, message_id TEXT,
            error TEXT, ts REAL NOT NULL);
    """)
    rows = [
        ("jane@acme.example", "Jane Doe", "Acme", "VP of Sales", "acme.example", "safe", 90,
         "sent", "yc", json.dumps({"first_name": "Jane", "last_name": "Doe", "city": "Austin",
                                   "signals": {"groundtruth_exact": True}})),
        ("bob@beta.example", "Bob Roe", "Beta", "Engineer", "beta.example", "risky", 50,
         "bounced", "github", "not json"),
        ("info@gamma.example", "", "Gamma", "Team / contact address", "gamma.example",
         "safe", 80, "new", "local", json.dumps({"employees": "37"})),
    ]
    conn.executemany("INSERT INTO leads VALUES (?,?,?,?,?,?,?,?,?,?,1,1)", rows)
    conn.execute("INSERT INTO touches (email, status, ts) VALUES ('jane@acme.example','sent',111)")
    conn.commit()
    conn.close()


def test_migration_backfills_contact_columns(tmp_path):
    path = tmp_path / "old.db"
    _old_db(path)
    db = DB(path)
    jane = db.get_lead("jane@acme.example")
    assert (jane["first_name"], jane["last_name"], jane["city"]) == ("Jane", "Doe", "Austin")
    assert (jane["seniority"], jane["department"]) == ("vp", "sales")
    assert jane["stage"] == "approaching" and jane["evidence"] == "found"
    assert jane["last_contacted"] == 111
    bob = db.get_lead("bob@beta.example")
    assert (bob["first_name"], bob["last_name"]) == ("Bob", "Roe")
    assert bob["stage"] == "bad_data" and bob["evidence"] == "guessed"
    gamma = db.get_lead("info@gamma.example")
    assert gamma["seniority"] == "" and gamma["company_size"] == "11-50"
    assert gamma["stage"] == "new"
    db.close()


def test_upsert_fills_columns_and_keeps_human_fields(tmp_path):
    db = _db(tmp_path)
    lead = {"email": "Ann@Acme.example", "first_name": "Ann", "last_name": "Lee",
            "title": "Head of Growth", "organization": "Acme", "tier": "safe",
            "phone": "+15125550100", "signals": {"observed_pattern": True}}
    assert db.upsert_lead(lead) is True
    row = db.get_lead("ann@acme.example")
    assert row["seniority"] == "head" and row["department"] == "marketing"
    assert row["evidence"] == "pattern" and row["phone"] == "+15125550100"
    assert row["stage"] == "new"
    db.execute("UPDATE leads SET stage='interested', owner='sam' WHERE email=?",
               ("ann@acme.example",))
    assert db.upsert_lead({**lead, "title": "VP Growth"}) is False
    row = db.get_lead("ann@acme.example")
    assert row["seniority"] == "vp" and row["stage"] == "interested" and row["owner"] == "sam"
    db.close()


def test_status_changes_move_stage_forward_only(tmp_path):
    db = _db(tmp_path)
    db.upsert_lead({"email": "a@x.example", "first_name": "A"})
    db.record_touch("a@x.example", "sent", subject="hi")
    db.set_status("a@x.example", "sent")
    row = db.get_lead("a@x.example")
    assert row["stage"] == "approaching" and row["last_contacted"]
    db.set_status("a@x.example", "replied")
    assert db.get_lead("a@x.example")["stage"] == "replied"
    db.execute("UPDATE leads SET stage='interested' WHERE email='a@x.example'")
    db.set_status("a@x.example", "sent")          # a later follow-up
    assert db.get_lead("a@x.example")["stage"] == "interested"
    db.set_status("a@x.example", "unsubscribed")
    assert db.get_lead("a@x.example")["stage"] == "do_not_contact"
    assert db.is_suppressed("a@x.example") == "unsubscribed"
    db.close()


# --- migration 3: workspace tables + accounts ------------------------------ #
def test_workspace_tables_exist(tmp_path):
    db = _db(tmp_path)
    names = {r["name"] for r in db.query("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"accounts", "lists", "list_members", "contact_tags", "notes", "activity", "tasks",
            "deals", "templates", "sequences", "enrollments", "saved_searches"} <= names
    db.close()


def test_migration_backfills_accounts(tmp_path):
    path = tmp_path / "old.db"
    _old_db(path)
    db = DB(path)
    acc = db.query_one("SELECT * FROM accounts WHERE domain='acme.example'")
    assert acc["name"] == "Acme" and acc["stage"] == "prospect"
    assert db.query_one("SELECT company_size FROM accounts WHERE domain='gamma.example'"
                        )["company_size"] == "11-50"
    db.close()


def test_upsert_syncs_account_without_overwriting(tmp_path):
    db = _db(tmp_path)
    db.upsert_lead({"email": "info@acme.example", "organization": "Acme", "industry": "",
                    "phone": "+15125550100", "technologies": ["Shopify", "Klaviyo"],
                    "socials": {"linkedin": "https://www.linkedin.com/company/acme"}})
    acc = db.query_one("SELECT * FROM accounts WHERE domain='acme.example'")
    assert acc["phone"] == "+15125550100" and acc["technologies"] == "|Shopify|Klaviyo|"
    assert acc["linkedin_url"].endswith("/company/acme")
    db.execute("UPDATE accounts SET name='Acme Inc' WHERE domain='acme.example'")
    db.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "organization": "ACME",
                    "industry": "Retail", "phone": "+15125559999"})
    acc = db.query_one("SELECT * FROM accounts WHERE domain='acme.example'")
    assert acc["name"] == "Acme Inc"               # kept
    assert acc["industry"] == "Retail"             # filled the blank
    assert acc["phone"] == "+15125550100"          # a person's phone isn't the company's
    # Free-mail domains never become accounts.
    db.upsert_lead({"email": "someone@gmail.com", "organization": "Freelance"})
    assert db.query_one("SELECT 1 AS x FROM accounts WHERE domain='gmail.com'") is None
    db.close()
