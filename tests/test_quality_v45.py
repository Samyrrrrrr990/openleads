"""v4.5 lead-quality regressions, taken from real searches that returned junk."""
import time

from openleads import engine, federation
from openleads.discover import geo, people
from openleads.intent import rule_parse
from openleads.models import EmailResult, Entity, Lead, Query
from openleads.sources import local, npi


# --- headings and orgs must never become people ------------------------------ #
def test_strict_gate_rejects_headings_seen_in_real_runs():
    for junk in ("Refund Policy", "Featured Article", "Sun Peaks", "Google Pages",
                 "HSBC North America", "Grant Programs"):
        assert not people.looks_like_person_name(junk, strict=True), junk


def test_strict_gate_keeps_real_names():
    for name in ("Joey Burzynski", "Mark Smith", "Dr. Sarah Lee", "Ji-Hoon Park",
                 "Priya Patel", "Mehmet Yilmaz"):
        assert people.looks_like_person_name(name, strict=True), name


def test_page_text_headings_are_not_extracted():
    html = """
    <h3>Refund Policy</h3><p>Account Manager</p>
    <h3>Featured Article</h3><p>Head of Content</p>
    <h3>Jane Smith</h3><p>Head of Growth</p>
    """
    names = {p["name"] for p in people.extract_people(html)}
    assert names == {"Jane Smith"}


def test_title_that_repeats_the_name_is_dropped():
    html = ('<script type="application/ld+json">{"@type":"Person",'
            '"name":"Paulo Mazini","jobTitle":"Paulo Mazini"}</script>')
    out = people.extract_people(html)
    assert out and out[0]["title"] == "Team member"


def test_role_words_match_whole_words_only():
    assert not people._is_title("Header Navigation")   # "head" inside "header"
    assert people._is_title("Head of Growth")


def test_clean_person_name_drops_honorifics_and_post_nominals():
    assert federation.clean_person_name("Dr. Paulo Mazini") == "Paulo Mazini"
    assert federation.clean_person_name("David Josse K.C.") == "David Josse"
    assert federation.clean_person_name("Jane Doe, DDS") == "Jane Doe"


def test_person_entity_uses_clean_name():
    company = Entity(full_name="", organization="Aloha Dental", domain="aloha-dental.com", title="Dentist")
    p = federation._person_entity(company, "Dr. Rohit Chaudhari", "Dr. Rohit Chaudhari")
    assert p.full_name == "Rohit Chaudhari"
    assert p.title == "Dentist"          # name-as-title replaced by the company's


# --- routing ------------------------------------------------------------------ #
def test_dentists_in_austin_routes_to_local_with_dentist_tags():
    q = rule_parse("dentists in Austin")
    assert federation.plan(q) == ["local"]
    term = local.category_term(q)
    assert ("amenity", "dentist") in local.category_selectors(term)


def test_health_without_place_still_uses_npi():
    assert federation.plan(rule_parse("pediatricians")) == ["npi"]


def test_npi_taxonomy_from_free_text():
    assert npi.taxonomy_for("dentists in Austin") == "Dentist"
    assert npi.taxonomy_for("pediatricians in California") == "Pediatrics"
    assert npi.taxonomy_for("bakers") == ""


# --- Overpass outage fallback ------------------------------------------------- #
def test_run_overpass_falls_through_mirrors(monkeypatch):
    calls = []

    def fake(url, **kw):
        calls.append(url)
        return None if len(calls) == 1 else {"elements": [{"id": 1}]}

    monkeypatch.setattr(local, "get_json", fake)
    assert local.run_overpass("q", mirrors=("https://a/x", "https://b/x")) == {"elements": [{"id": 1}]}
    assert len(calls) == 2


def test_run_overpass_treats_runtime_error_remark_as_failure(monkeypatch):
    monkeypatch.setattr(local, "get_json", lambda url, **kw: {
        "elements": [], "remark": "runtime error: Query timed out"})
    assert local.run_overpass("q", mirrors=("https://a/x",)) is None


def test_nominatim_pois_become_overpass_elements(monkeypatch):
    monkeypatch.setattr(geo, "_throttle", lambda: None)
    monkeypatch.setattr(geo, "get_json", lambda url, **kw: [{
        "osm_id": 7, "name": "KC Dental", "category": "amenity", "type": "dentist",
        "extratags": {"website": "https://kcdentalaustin.com"},
        "address": {"city": "Austin", "country_code": "us"},
    }])
    els = geo.search_pois("amenity", "dentist", "Austin")
    ents = local.extract_businesses({"elements": els})
    assert ents[0].organization == "KC Dental"
    assert ents[0].domain == "kcdentalaustin.com"
    assert ents[0].extra["city"] == "Austin"


# --- honest output ------------------------------------------------------------ #
def test_evidence_labels():
    assert Lead(email="a@b.com", signals={"groundtruth_exact": True}).evidence == "found"
    assert Lead(email="a@b.com", signals={"smtp_verified": True}).evidence == "found"
    assert Lead(email="a@b.com", signals={"smtp_verified": True, "catch_all": True}).evidence \
        == "guessed"
    assert Lead(email="a@b.com", signals={"observed_pattern": True}).evidence == "pattern"
    assert Lead(email="a@b.com", signals={}).evidence == "guessed"
    assert Lead(email="").evidence == "none"


def test_csv_row_has_evidence_column():
    row = Lead(email="a@b.com", signals={"groundtruth_exact": True}).to_csv_row()
    assert row["Email Evidence"] == "found"


# --- speed -------------------------------------------------------------------- #
def test_ordered_parallel_keeps_order():
    def slow(x):
        time.sleep(0.02 * (5 - x))
        return x
    assert list(federation._ordered_parallel(slow, range(5), 3)) == [0, 1, 2, 3, 4]


def test_engine_stops_at_time_budget(monkeypatch):
    def endless(query, cache, db, on_progress):
        def gen():
            while True:
                time.sleep(0.05)
                yield Entity(full_name="Jane Smith", domain="")
        return gen(), "test"

    monkeypatch.setattr(engine, "_entity_stream", endless)
    monkeypatch.setattr(engine, "find_email", lambda *a, **k: EmailResult())
    phases = []
    q = Query(count=10_000, budget=1, max_companies=10_000)
    t0 = time.monotonic()
    engine.build_leads(q, on_progress=lambda k, p: phases.append(p) if k == "phase" else None)
    assert time.monotonic() - t0 < 5
    assert any("time budget" in str(p) for p in phases)


# --- researchers: topic search over works, not author names -------------------- #
def test_work_authors_are_deduped_and_name_order_fixed():
    from openleads.sources import openalex
    data = {"results": [
        {"title": "Paper A", "authorships": [
            {"author": {"id": "A1", "display_name": "Jakubův, Jan"},
             "institutions": [{"id": "I1", "display_name": "CTU", "country_code": "CZ"}]},
            {"author": {"id": "A2", "display_name": "Ada Lovelace"}, "institutions": []}]},
        {"title": "Paper B", "authorships": [
            {"author": {"id": "A1", "display_name": "Jakubův, Jan"}, "institutions": []}]},
    ]}
    ents = openalex.parse_work_authors(data)
    assert [e.full_name for e in ents] == ["Jan Jakubův", "Ada Lovelace"]
    assert ents[0].extra["institution_id"] == "I1"


def test_institution_homepages_use_the_api_not_the_website(monkeypatch):
    from openleads.sources import openalex
    urls = []

    def fake(url, **kw):
        urls.append(url)
        return {"results": [{"id": "https://openalex.org/I1", "homepage_url": "https://ctu.cz"}]}

    monkeypatch.setattr(openalex, "get_json", fake)
    src = openalex.OpenAlexSource()
    homes = src._homepages(["https://openalex.org/I1", "https://openalex.org/I1"])
    assert homes == {"https://openalex.org/I1": "https://ctu.cz"}
    assert len(urls) == 1 and urls[0].startswith("https://api.openalex.org/institutions?")


def test_sentences_and_bylines_are_not_titles():
    assert not people._is_title("economic growth ensues when people possess the freedom to")
    assert not people._is_title("CEO • Apr 29")
    assert not people._is_title("The best sales tool we have ever used.")
    assert people._is_title("VP of Sales")
    assert people._is_title("Co-founder & CEO")
