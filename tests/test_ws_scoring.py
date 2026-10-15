"""ICP fit scoring."""
import pytest

from openleads.db import DB
from openleads.workspace import scoring

JANE = {"email": "jane@acme.example", "seniority": "vp", "department": "marketing",
        "title": "VP of Growth Marketing", "industry": "Dental", "city": "Austin", "state": "TX",
        "company_size": "11-50", "tier": "safe", "evidence": "found", "phone": "+15125550100",
        "linkedin_url": "https://www.linkedin.com/in/jane"}


def test_default_model_ranks_by_seniority_and_reachability():
    s, parts = scoring.explain(JANE)
    assert s == 25 + 25 + 10 + 5 + 5 == 70
    assert ("seniority: vp", 25) in parts
    assert scoring.score({"seniority": "entry", "tier": "risky"}) == 11
    assert scoring.grade(80) == "A" and scoring.grade(60) == "B" and scoring.grade(10) == "D"


def test_custom_icp_and_cap():
    model = {"departments": {"marketing": 20}, "titles": [{"keyword": "growth", "points": 10}],
             "industries": {"dental": 15}, "locations": [{"match": "tx", "points": 10}],
             "company_sizes": {"11-50": 10}, "technologies": {"HubSpot": 10}}
    s, parts = scoring.explain(JANE, model, technologies=["HubSpot", "WordPress"])
    assert s == 100                                       # capped
    reasons = dict(parts)
    assert reasons["department: marketing"] == 20 and reasons["uses HubSpot"] == 10
    assert reasons["industry: Dental"] == 15 and reasons["location: tx"] == 10
    assert scoring.score({"seniority": "intern"}, {"seniority": {"intern": -50}}) == 0


def test_normalize_rejects_junk():
    m = scoring.normalize_model({"seniority": {"vp": "40.4"}, "titles": [{"keyword": " "},
                                {"keyword": "ops", "points": 5}], "bogus": 1})
    assert m["seniority"] == {"vp": 40} and m["titles"] == [{"keyword": "ops", "points": 5}]
    assert "bogus" not in m and m["email"]["safe"] == 25
    with pytest.raises(ValueError):
        scoring.normalize_model({"has_phone": "lots"})


def test_rescore_and_distribution(tmp_path):
    db = DB(tmp_path / "w.db")
    db.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "title": "VP of Sales",
                    "tier": "safe", "technologies": ["HubSpot"]})
    db.upsert_lead({"email": "bob@acme.example", "first_name": "Bob", "title": "Engineer",
                    "tier": "risky"})
    assert scoring.rescore(db) == 2
    assert db.get_lead("jane@acme.example")["fit_score"] == 50
    scoring.save_model(db, {"technologies": {"HubSpot": 30}})
    assert scoring.rescore(db, ["jane@acme.example"]) == 1
    assert db.get_lead("jane@acme.example")["fit_score"] == 80
    assert scoring.rescore(db) == 1                       # bob also uses acme's HubSpot
    assert scoring.distribution(db) == {"A": 1, "B": 0, "C": 1, "D": 0}
    assert scoring.get_model(db)["technologies"] == {"HubSpot": 30}
    sim = scoring.simulate(db, {"technologies": {}, "titles": [{"keyword": "engineer",
                                                                 "points": 60}]})
    assert sim["distribution"] == {"A": 0, "B": 1, "C": 1, "D": 0} and sim["changed"] == 2
    assert sim["top"][0]["email"] == "bob@acme.example" and sim["top"][0]["grade"] == "B"
    assert db.get_lead("jane@acme.example")["fit_score"] == 80      # nothing saved
    db.close()
