"""The demo workspace: invented, reserved-domain data that fills every page."""
from openleads import demo
from openleads.db import DB
from openleads.workspace import duplicates, stats


def test_seed_fills_every_page_with_invented_data(tmp_path):
    db = DB(tmp_path / "demo.db")
    counts = demo.seed(db, now=1_790_000_000.0)
    emails = [r["email"] for r in db.query("SELECT email FROM leads")]
    assert len(emails) == counts["contacts"] + 2              # + two planted duplicates
    assert all(e.endswith(".example") for e in emails)        # reserved TLD, undeliverable
    domains = {r["domain"] for r in db.query("SELECT domain FROM accounts")}
    assert all(d.endswith(".example") for d in domains)
    assert db.scalar("SELECT COUNT(*) FROM enrollments WHERE status='active'") > 0
    assert db.scalar("SELECT COUNT(*) FROM tasks WHERE status='open'") == counts["tasks"]
    assert {r["stage"] for r in db.query("SELECT stage FROM deals")} >= {"qualify", "won", "lost"}
    assert len(duplicates.find(db)) == 2
    home = stats.home(db, now=1_790_000_000.0)
    assert home["emails"]["sent_30d"] > 0 and home["emails"]["replied"] > 0
    assert sum(home["grades"].values()) == len(emails)
    db.close()


def test_seed_is_deterministic(tmp_path):
    a, b = DB(tmp_path / "a.db"), DB(tmp_path / "b.db")
    demo.seed(a, now=1_790_000_000.0)
    demo.seed(b, now=1_790_000_000.0)
    q = "SELECT email, tier, stage, fit_score FROM leads ORDER BY email"
    assert a.query(q) == b.query(q)
    a.close()
    b.close()
