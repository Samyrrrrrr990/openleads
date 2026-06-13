"""Tests for the federation layer: routing, company→people expansion, dedupe."""
from openleads import federation
from openleads.models import Entity, Query


# --- routing ----------------------------------------------------------------- #
def test_plan_local_for_place_plus_category():
    assert federation.plan(Query(keyword="marketing agencies", location="Miami")) == ["local"]
    assert "local" in federation.plan(Query(keyword="dentists", location="Austin"))


def test_plan_startup_terms():
    assert federation.plan(Query(keyword="fintech founders")) == ["yc", "hn"]


def test_plan_developers():
    picks = federation.plan(Query(keyword="rust developers", location="Berlin"))
    assert "github" in picks
    assert "local" not in picks  # a dev search with a place is not a local-biz search


def test_plan_company_industry():
    picks = federation.plan(Query(keyword="video game companies"))
    assert "companies" in picks and "edgar" in picks


def test_plan_explicit_pin_short_circuits():
    assert federation.plan(Query(source="npi", keyword="anything")) == ["npi"]


def test_plan_default_when_nothing_matches():
    assert federation.plan(Query(keyword="xyzzy")) == ["yc", "hn", "companies"]


def test_plan_caps_sources():
    assert len(federation.plan(Query(keyword="founders developers companies",
                                     location="Berlin"))) <= federation.MAX_SOURCES


# --- expansion --------------------------------------------------------------- #
def test_expand_company_with_people(monkeypatch):
    monkeypatch.setattr(federation, "find_people",
                        lambda d, **kw: [{"name": "Jane Smith", "title": "CEO"},
                                         {"name": "John Doe", "title": "CTO"}])
    company = Entity(full_name="", organization="Acme", domain="acme.com",
                     website="https://acme.com", source="local")
    out = federation.expand_company(company, max_people=2)
    assert [e.full_name for e in out] == ["Jane Smith", "John Doe"]
    assert all(e.domain == "acme.com" and e.organization == "Acme" for e in out)


def test_expand_company_public_email_is_kept(monkeypatch):
    monkeypatch.setattr(federation, "find_people", lambda d, **kw: [])
    company = Entity(full_name="", organization="Acme", domain="acme.com",
                     extra={"public_email": "hi@acme.com"}, source="local")
    out = federation.expand_company(company)
    assert any(e.extra.get("public_email") == "hi@acme.com" for e in out)


def test_expand_company_harvest_fallback(monkeypatch):
    monkeypatch.setattr(federation, "find_people", lambda d, **kw: [])
    monkeypatch.setattr(federation.groundtruth, "harvest_from_site",
                        lambda d, **kw: ["info@acme.com"])
    company = Entity(full_name="", organization="Acme", domain="acme.com", source="local")
    out = federation.expand_company(company)
    assert out[0].extra["public_email"] == "info@acme.com"


def test_expand_company_already_person_passthrough():
    person = Entity(full_name="Ada Lovelace", domain="acme.com", source="github")
    assert federation.expand_company(person) == [person]


def test_expand_company_discover_off(monkeypatch):
    called = {"n": 0}

    def boom(*a, **k):
        called["n"] += 1
        return []
    monkeypatch.setattr(federation, "find_people", boom)
    monkeypatch.setattr(federation.groundtruth, "harvest_from_site", lambda d, **kw: [])
    company = Entity(full_name="", domain="acme.com", source="local")
    federation.expand_company(company, discover=False)
    assert called["n"] == 0  # discovery skipped entirely


# --- merged search + dedupe -------------------------------------------------- #
class _Fake:
    def __init__(self, name, ents):
        self.name = name
        self._ents = ents
        self.cache = None

    def search(self, query):
        yield from self._ents


def test_search_dedupes_people_across_sources(monkeypatch):
    monkeypatch.setattr(federation, "find_people",
                        lambda d, **kw: [{"name": "Jane Smith", "title": "CEO"}])
    a = _Fake("a", [Entity(full_name="", organization="Acme", domain="acme.com")])
    b = _Fake("b", [Entity(full_name="", organization="Acme", domain="acme.com")])
    monkeypatch.setattr(federation, "plan", lambda q: ["a", "b"])
    monkeypatch.setattr(federation, "get_source",
                        lambda n: {"a": a, "b": b}[n])
    out = list(federation.search(Query(count=10)))
    # Same domain+person discovered from both sources collapses to one.
    assert len(out) == 1
    assert out[0].full_name == "Jane Smith"
