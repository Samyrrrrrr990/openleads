"""Home dashboard numbers and data health."""
import time

import pytest

from openleads.db import DB
from openleads.workspace import deals, lists, stats, tasks


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    d.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "last_name": "Doe",
                   "title": "VP Sales", "tier": "safe", "signals": {"groundtruth_exact": True}})
    d.upsert_lead({"email": "info@beta.example", "organization": "Beta", "tier": "risky"})
    d.upsert_lead({"email": "jane.doe@acme.example", "first_name": "Jane", "last_name": "Doe"})
    yield d
    d.close()


def test_home_numbers(db):
    db.record_touch("jane@acme.example", "sent")
    db.set_status("jane@acme.example", "sent")
    db.set_status("jane@acme.example", "replied")
    tasks.create(db, "Call", due=time.time() - 3 * 86400)
    deals.create(db, "Acme", stage="proposal", amount=1000)
    lists.create(db, "L")
    h = stats.home(db)
    assert h["contacts"]["total"] == 3 and h["contacts"]["new_today"] == 3
    assert h["companies"]["total"] == 2 and h["lists"]["total"] == 1
    e = h["emails"]
    assert (e["sent_today"], e["contacted"], e["replied"], e["reply_rate"]) == (1, 1, 1, 100.0)
    assert h["tasks"]["overdue"] == 1
    assert h["deals"]["weighted"] == 500.0
    assert len(h["series"]["sent"]) == 30 and h["series"]["sent"][-1]["count"] == 1
    assert h["series"]["replied"][-1]["count"] == 1 and h["series"]["added"][-1]["count"] == 3
    funnel = {f["key"]: f["count"] for f in h["funnel"]}
    assert funnel["replied"] == 1 and funnel["new"] == 2
    assert sum(h["grades"].values()) == 3
    kinds = [a["kind"] for a in h["activity"]]
    assert kinds[0] == "deal_created" and {"replied", "stage", "email_sent"} <= set(kinds)
    assert "created" not in kinds                          # bulk adds stay out of the feed
    check = {c["key"]: c["done"] for c in h["checklist"]}
    assert check["search"] and check["list"] and not check["sequence"]


def test_health_report(db):
    r = stats.health(db)
    checks = {c["key"]: c for c in r["checks"]}
    assert r["total"] == 3
    assert checks["unverified"]["count"] == 2 and checks["unverified"]["filter"]["tier"]
    assert checks["guessed"]["count"] == 2 and checks["company_only"]["count"] == 1
    assert r["duplicates"] == {"groups": 1, "contacts": 1}
    assert r["unprofiled_companies"] == 2


def test_recommended_are_strong_untouched_verified_and_free(db):
    from openleads.workspace import scoring, sequences
    for email, title, tier in (("ceo@gamma.example", "CEO", "safe"),
                               ("vp@gamma.example", "VP of Sales", "safe"),
                               ("eng@gamma.example", "Engineer", "safe"),
                               ("cto@gamma.example", "CTO", "risky")):
        db.upsert_lead({"email": email, "first_name": email[:3].upper(), "title": title,
                        "tier": tier, "organization": "Gamma",
                        "signals": {"groundtruth_exact": True}})    # found → +10
    scoring.rescore(db)
    rec = stats.recommended(db)
    emails = [r["email"] for r in rec["rows"]]
    assert "ceo@gamma.example" in emails and "eng@gamma.example" not in emails   # weak fit
    assert "cto@gamma.example" not in emails                                      # not safe
    assert emails == sorted(emails, key=lambda e: -db.get_lead(e)["fit_score"])
    s = sequences.create(db, "S", sequences.starter_steps())
    sequences.enroll(db, s["id"], ["ceo@gamma.example"])
    assert "ceo@gamma.example" not in [r["email"] for r in stats.recommended(db)["rows"]]
    db.record_touch("vp@gamma.example", "sent")
    db.set_status("vp@gamma.example", "sent")
    assert stats.recommended(db)["total"] == rec["total"] - 2
    assert stats.home(db)["recommended"]["filters"]["contacted"] == "never"


def test_reply_breakdown_by_persona(db):
    for email, title, replied in (("a@x.example", "VP of Sales", True),
                                  ("b@x.example", "VP of Marketing", False),
                                  ("c@x.example", "Software Engineer", False),
                                  ("d@x.example", "Engineering Manager", False)):
        db.upsert_lead({"email": email, "first_name": email[0], "title": title})
        db.record_touch(email, "sent")
        db.set_status(email, "sent")
        if replied:
            db.set_status(email, "replied")
    db.upsert_lead({"email": "never@x.example", "title": "CEO"})       # not contacted: ignored
    b = stats.reply_breakdown(db)
    vp = next(r for r in b["seniority"] if r["value"] == "vp")
    assert vp == {"value": "vp", "contacted": 2, "replied": 1, "rate": 50.0}
    assert not any(r["value"] == "c_suite" for r in b["seniority"])
    sales = next(r for r in b["department"] if r["value"] == "sales")
    assert sales["rate"] == 100.0
    assert set(b) == set(stats.BREAKDOWNS)
    assert stats.reply_breakdown(db, min_contacted=2)["department"] == \
        [r for r in b["department"] if r["contacted"] >= 2]
