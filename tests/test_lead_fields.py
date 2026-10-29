"""Lead field normalization (city, vertical, employees, contact type) and expansion rules."""
import csv
import io

import pytest

from openleads import _concurrency, federation, runreport, writers
from openleads.engine import city_of, entity_to_lead, vertical_of
from openleads.models import CSV_FIELDS, EmailResult, Entity, Lead, Query


@pytest.mark.parametrize("location,extra,city", [
    ("", {"city": "Austin"}, "Austin"),
    ("Berlin, Germany", {}, "Berlin"),
    ("Germany", {"country": "Germany"}, ""),       # Wikidata: the country is the location
    ("United States", {}, ""),
    ("Remote", {}, ""),
    ("REMOTE, US", {}, ""),
    ("San Francisco, CA, USA", {}, "San Francisco"),
])
def test_city_never_holds_a_country_or_placeholder(location, extra, city):
    assert city_of(Entity(full_name="", location=location, extra=extra)) == city


def test_vertical_falls_back_to_the_source():
    ent = Entity(full_name="Ada Lee", source="yc")
    assert vertical_of(ent) == "startup founders (Y Combinator)"
    assert vertical_of(Entity(full_name="", extra={"vertical": "x"}, source="yc")) == "x"
    assert vertical_of(Entity(full_name="", source="")) == ""


def test_yc_team_size_none_is_blank(monkeypatch):
    from openleads.sources import yc
    page = ('<div data-page="{&quot;founders&quot;: [{&quot;full_name&quot;: &quot;Ada Lee'
            '&quot;, &quot;title&quot;: &quot;CEO&quot;}]}">')
    companies = [{"name": "Acme", "slug": "acme", "website": "https://acme.example",
                  "status": "Active", "team_size": None}]
    monkeypatch.setattr(yc, "get_json", lambda *a, **k: companies)
    monkeypatch.setattr(yc, "get_text", lambda *a, **k: page)
    ent = next(iter(yc.YCSource().search(Query(count=1))))
    assert ent.extra["employees"] == ""
    assert entity_to_lead(ent, EmailResult()).employees == ""


def test_contact_type_column_is_appended_last(tmp_path):
    assert CSV_FIELDS[-1] == "Contact Type"
    person = entity_to_lead(Entity(full_name="Ada Lee", domain="a.example"), EmailResult())
    company = entity_to_lead(Entity(full_name="", domain="a.example"), EmailResult())
    assert (person.contact_type, company.contact_type) == ("person", "company")
    assert Lead(first_name="Old").kind == "person" and Lead().kind == "company"
    path = tmp_path / "leads.csv"
    writers.write_csv([person, company], str(path))
    rows = list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8"))))
    assert [r["Contact Type"] for r in rows] == ["person", "company"]
    assert company.to_dict()["contact_type"] == "company"


def test_people_do_not_inherit_the_company_label():
    company = Entity(full_name="", organization="Acme", domain="acme.example", title="Hiring")
    assert federation._person_entity(company, "Jane Smith", "").title == "Team member"
    assert federation._person_entity(company, "Jane Smith", "CTO").title == "CTO"


def test_second_company_address_is_not_deduped_away(monkeypatch):
    monkeypatch.setattr(federation, "find_people", lambda d, **kw: [])
    monkeypatch.setattr(federation.groundtruth, "harvest_from_site",
                        lambda d, **kw: ["info@acme.example", "sales@acme.example"])

    class Src:
        name, cache = "a", None

        def search(self, q):
            yield Entity(full_name="", organization="Acme", domain="acme.example")
    monkeypatch.setattr(federation, "plan", lambda q: ["a"])
    monkeypatch.setattr(federation, "get_source", lambda n: Src())
    out = list(federation.search(Query(count=10)))
    assert sorted(e.extra["public_email"] for e in out) == ["info@acme.example",
                                                           "sales@acme.example"]


def test_people_discovery_is_skipped_late_in_the_budget(monkeypatch):
    called = []
    monkeypatch.setattr(federation, "find_people", lambda d, **kw: called.append(d) or [])
    monkeypatch.setattr(federation.groundtruth, "harvest_from_site",
                        lambda d, **kw: ["info@acme.example"])
    monkeypatch.setattr(_concurrency, "fraction_left", lambda: 0.2)

    class Src:
        name, cache = "local", None

        def search(self, q):
            yield Entity(full_name="", organization="Acme", domain="acme.example")
    monkeypatch.setattr(federation, "plan", lambda q: ["local"])
    monkeypatch.setattr(federation, "get_source", lambda n: Src())
    rep = runreport.SearchReport()
    with runreport.activate(rep):
        out = list(federation.search(Query(count=10)))
    assert called == [] and out[0].extra["public_email"] == "info@acme.example"
    assert rep.sources["local"].note == "people discovery skipped (budget)"
