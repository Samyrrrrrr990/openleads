"""People search, facets, edits and bulk actions."""
import pytest

from openleads.db import DB
from openleads.workspace import lists, people, tags


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    rows = [
        dict(email="jane@acme.example", first_name="Jane", last_name="Doe", title="VP of Sales",
             organization="Acme", tier="safe", score=95, source="yc", city="Austin",
             country="US", phone="+15125550100", signals={"groundtruth_exact": True},
             technologies=["HubSpot"]),
        dict(email="john@acme.example", first_name="John", last_name="Roe",
             title="Software Engineer", organization="Acme", tier="risky", score=60,
             source="yc", city="Austin", country="US"),
        dict(email="ann@beta.example", first_name="Ann", last_name="Poe", title="Head of Growth",
             organization="Beta", tier="safe", score=88, source="local", city="Berlin",
             country="DE", linkedin_url="https://www.linkedin.com/in/annpoe",
             signals={"observed_pattern": True}),
        dict(email="info@gamma.example", title="Team / contact address", organization="Gamma",
             tier="safe", score=80, source="local", city="Miami", country="US"),
    ]
    for r in rows:
        d.upsert_lead(r)
    yield d
    d.close()


def _emails(res):
    return [r["email"] for r in res["rows"]]


def test_free_text_and_exact_filters(db):
    assert _emails(people.search(db, {"q": "acme"}, sort="name", direction="asc")) == [
        "jane@acme.example", "john@acme.example"]
    assert _emails(people.search(db, {"seniority": ["vp", "head"]}, sort="name",
                                 direction="asc")) == ["ann@beta.example", "jane@acme.example"]
    assert _emails(people.search(db, {"department": "engineering"})) == ["john@acme.example"]
    assert people.search(db, {"tier": "safe", "country": ["US"]})["total"] == 2
    assert _emails(people.search(db, {"seniority": ["(none)"]})) == ["info@gamma.example"]
    assert _emails(people.search(db, {"evidence": "pattern"})) == ["ann@beta.example"]
    assert _emails(people.search(db, {"title": "growth, engineer"}, sort="email")) == [
        "john@acme.example", "ann@beta.example"]
    assert _emails(people.search(db, {"location": "berl"})) == ["ann@beta.example"]
    assert _emails(people.search(db, {"has_phone": True})) == ["jane@acme.example"]
    assert _emails(people.search(db, {"has_linkedin": "1"})) == ["ann@beta.example"]
    assert "jane@acme.example" not in _emails(people.search(db, {"has_phone": "no"}))
    assert "ann@beta.example" not in _emails(people.search(db, {"has_linkedin": "no"}))
    assert people.search(db, {"has_phone": False})["total"] == people.search(db, {})["total"]
    assert people.search(db, {"technologies": ["HubSpot"]})["total"] == 2  # both at acme
    assert people.search(db, {"score_min": 85, "score_max": 90})["total"] == 1
    assert people.search(db, {"domain": "ACME.example"})["total"] == 2


def test_sort_and_pagination(db):
    res = people.search(db, {}, sort="score", direction="desc", page=1, per_page=3)
    assert res["total"] == 4 and res["pages"] == 2
    assert _emails(res) == ["jane@acme.example", "ann@beta.example", "info@gamma.example"]
    assert _emails(people.search(db, {}, sort="score", page=2, per_page=3)) == ["john@acme.example"]
    assert _emails(people.search(db, {}, sort="seniority", direction="asc", per_page=2)) == [
        "jane@acme.example", "ann@beta.example"]
    assert people.search(db, {}, sort="bogus")["total"] == 4      # unknown sort → default


def test_tags_lists_contacted_and_sequence_filters(db):
    tags.add(db, ["jane@acme.example", "ann@beta.example"], "hot")
    q4 = lists.create(db, "Q4")
    lists.add(db, q4["id"], ["john@acme.example"])
    assert people.search(db, {"tags": "hot"})["total"] == 2
    assert _emails(people.search(db, {"list_id": q4["id"]})) == ["john@acme.example"]
    assert people.search(db, {"not_list_id": q4["id"]})["total"] == 3
    db.record_touch("jane@acme.example", "sent")
    assert _emails(people.search(db, {"contacted": "7d"})) == ["jane@acme.example"]
    assert people.search(db, {"contacted": "never"})["total"] == 3
    db.execute("INSERT INTO sequences (name) VALUES ('s')")
    db.execute("INSERT INTO enrollments (sequence_id, email, status) VALUES (1,'ann@beta.example','active')")
    assert _emails(people.search(db, {"sequence": "any"})) == ["ann@beta.example"]
    assert _emails(people.search(db, {"sequence": 1})) == ["ann@beta.example"]
    assert people.search(db, {"sequence": "none"})["total"] == 3
    row = people.get(db, "ann@beta.example")
    assert row["tags"] == ["hot"] and row["sequence"]["name"] == "s"
    assert people.search(db, {"created_within": 1})["total"] == 4


def test_facets_ignore_their_own_filter(db):
    f = people.facets(db, {"tier": ["safe"]})
    tiers = {r["value"]: r["count"] for r in f["tier"]}
    assert tiers == {"safe": 3, "risky": 1}               # own filter ignored
    sources = {r["value"]: r["count"] for r in f["source"]}
    assert sources == {"local": 2, "yc": 1}               # other filters applied
    assert f["total"] == 3


def test_update_edits_stick_across_refind(db):
    out = people.update(db, "jane@acme.example", {"title": "CRO", "stage": "interested",
                                                  "bogus": "x"})
    assert out["title"] == "CRO" and out["stage"] == "interested"
    db.upsert_lead(dict(email="jane@acme.example", first_name="Jane", last_name="Doe",
                        title="VP of Sales", organization="Acme", tier="safe"))
    again = people.get(db, "jane@acme.example")
    assert again["title"] == "CRO" and again["stage"] == "interested"
    with pytest.raises(ValueError):
        people.update(db, "jane@acme.example", {"stage": "on-the-moon"})
    assert people.update(db, "nobody@x.example", {"title": "x"}) is None


def test_create_and_detail(db):
    c = people.create(db, {"email": "New@Delta.example", "first_name": "Nia",
                           "title": "Director of Ops", "tags": "imported"})
    assert c["email"] == "new@delta.example" and c["source"] == "manual"
    assert c["seniority"] == "director" and c["tags"] == ["imported"]
    with pytest.raises(ValueError):
        people.create(db, {"email": "new@delta.example"})
    with pytest.raises(ValueError):
        people.create(db, {"email": "not-an-email"})
    d = people.detail(db, "jane@acme.example")
    assert d["contact"]["email"] == "jane@acme.example"
    assert d["account"]["technologies"] == ["HubSpot"] and d["account"]["people"] == 2
    assert d["timeline"][-1]["kind"] == "created"
    assert people.detail(db, "nobody@x.example") is None


def test_bulk_actions_and_delete(db):
    everyone = people.matching_emails(db, {})
    assert len(everyone) == 4
    assert people.bulk(db, everyone, "stage", "approaching")["count"] == 4
    assert people.bulk(db, everyone, "stage", "approaching")["count"] == 0   # no-op
    assert people.bulk(db, ["jane@acme.example"], "owner", "sam")["count"] == 1
    assert people.bulk(db, everyone, "tag", "q4")["count"] == 4
    assert people.bulk(db, ["jane@acme.example"], "list", {"name": "Hot list"})["count"] == 1
    assert lists.by_name(db, "Hot list")["count"] == 1
    assert people.bulk(db, ["john@acme.example"], "do_not_contact")["count"] == 1
    assert db.is_suppressed("john@acme.example") == "do_not_contact"
    assert people.bulk(db, ["john@acme.example"], "delete")["count"] == 1
    assert people.get(db, "john@acme.example") is None
    assert db.is_suppressed("john@acme.example")              # suppression survives
    with pytest.raises(ValueError):
        people.bulk(db, everyone, "explode")
    assert people.bulk(db, [], "tag", "x")["count"] == 0


def test_list_filter_accepts_one_or_many_ids(db):
    a, b = lists.create(db, "A"), lists.create(db, "B")
    lists.add(db, a["id"], ["jane@acme.example"])
    lists.add(db, b["id"], ["ann@beta.example"])
    assert people.search(db, {"list_id": [str(a["id"]), str(b["id"])]})["total"] == 2
    assert people.search(db, {"list_id": f"{a['id']}"})["total"] == 1
    assert people.search(db, {"list_id": []})["total"] == 4          # empty = no filter
    assert people.search(db, {"list_id": ["junk"]})["total"] == 4
    assert people.search(db, {"not_list_id": [a["id"], b["id"]]})["total"] == 2
