"""Companies (accounts)."""
import pytest

from openleads.db import DB
from openleads.workspace import companies, lists, notes


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    for r in [
        dict(email="jane@acme.example", first_name="Jane", title="CEO", organization="Acme",
             tier="safe", industry="Software", employees="37", country="US",
             technologies=["HubSpot", "WordPress"]),
        dict(email="john@acme.example", first_name="John", title="Engineer",
             organization="Acme", tier="risky"),
        dict(email="info@beta.example", organization="Beta Dental", tier="safe",
             industry="Dental", country="US", phone="+15125550100", technologies=["Zocdoc"]),
        dict(email="hello@gamma.example", organization="Gamma", tier="safe", country="DE"),
    ]:
        d.upsert_lead(r)
    yield d
    d.close()


def test_search_counts_people_and_filters(db):
    res = companies.search(db, {}, sort="people")
    assert [r["domain"] for r in res["rows"]][0] == "acme.example"
    acme = res["rows"][0]
    assert (acme["people"], acme["safe"], acme["company_size"]) == (2, 1, "11-50")
    assert acme["technologies"] == ["HubSpot", "WordPress"]
    assert companies.search(db, {"technologies": "Zocdoc"})["total"] == 1
    assert companies.search(db, {"industry": ["Dental", "Software"]})["total"] == 2
    assert companies.search(db, {"industry": ["(none)"]})["total"] == 1
    assert companies.search(db, {"has_phone": True})["rows"][0]["domain"] == "beta.example"
    assert companies.search(db, {"min_people": 2})["total"] == 1
    assert companies.search(db, {"q": "dental"})["total"] == 1
    assert [r["domain"] for r in companies.search(db, {}, sort="name", direction="asc")["rows"]] == [
        "acme.example", "beta.example", "gamma.example"]


def test_facets_include_top_technologies(db):
    f = companies.facets(db, {"country": "US"})
    assert {r["value"] for r in f["technologies"]} == {"HubSpot", "WordPress", "Zocdoc"}
    assert {r["value"]: r["count"] for r in f["country"]} == {"US": 2, "DE": 1}
    assert f["total"] == 2


def test_detail_update_and_stage_log(db):
    notes.add(db, "company", "acme.example", "Renewal in March")
    d = companies.detail(db, "ACME.example")
    assert [p["email"] for p in d["people"]] == ["jane@acme.example", "john@acme.example"]
    assert d["notes"][0]["body"] == "Renewal in March"
    acc = companies.update(db, "acme.example", {"stage": "opportunity", "employees": "250"})
    assert acc["stage"] == "opportunity" and acc["company_size"] == "201-500"
    assert companies.detail(db, "acme.example")["timeline"][0]["kind"] == "stage"
    with pytest.raises(ValueError):
        companies.update(db, "acme.example", {"stage": "nope"})
    assert companies.detail(db, "nobody.example") is None


def test_apply_profile_fills_blanks_and_replaces_tech(db):
    profile = {"name": "Gamma GmbH", "description": "Gears.", "industry": "Manufacturing",
               "phone": "+49301234567", "technologies": ["Shopify"], "size": "51-200",
               "employees": "120", "socials": {"linkedin": "https://www.linkedin.com/company/g"},
               "address": {"city": "Berlin", "country": "DE"}, "founded": "1999"}
    acc = companies.apply_profile(db, "gamma.example", profile)
    assert acc["name"] == "Gamma"                      # existing name kept
    assert acc["industry"] == "Manufacturing" and acc["founded"] == "1999"
    assert acc["technologies"] == ["Shopify"] and acc["profiled"]
    assert acc["linkedin_url"].endswith("/company/g")
    assert "gamma.example" not in companies.needs_profile(db)
    assert companies.apply_profile(db, "gamma.example", {"error": "x"})["name"] == "Gamma"
    fresh = companies.apply_profile(db, "new.example", {"name": "New Co", "technologies": []})
    assert fresh["name"] == "New Co" and fresh["people"] == 0


def test_create_bulk_delete(db):
    c = companies.create(db, "https://www.Delta.example/about", "Delta", industry="Legal")
    assert c["domain"] == "delta.example" and c["industry"] == "Legal"
    with pytest.raises(ValueError):
        companies.create(db, "delta.example")
    with pytest.raises(ValueError):
        companies.create(db, "not a domain")
    assert companies.bulk(db, ["acme.example", "beta.example"], "stage", "engaged")["count"] == 2
    assert companies.bulk(db, ["acme.example"], "list", {"name": "Targets"})["count"] == 1
    assert lists.by_name(db, "Targets", "companies")["count"] == 1
    assert companies.bulk(db, ["delta.example"], "delete")["count"] == 1
    assert companies.get(db, "delta.example") is None
    with pytest.raises(ValueError):
        companies.bulk(db, ["acme.example"], "explode")
