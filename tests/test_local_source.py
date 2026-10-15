"""Tests for the OSM/Overpass local-business source + geo helpers (pure parsing)."""
from openleads.discover import geo
from openleads.models import Query
from openleads.sources import local


def test_bbox_from_result():
    bb = geo.bbox_from_result({"boundingbox": ["25.70", "25.85", "-80.30", "-80.13"]})
    assert bb is not None
    # Nominatim order is [south, north, west, east]
    assert bb.south == 25.70 and bb.north == 25.85
    assert bb.west == -80.30 and bb.east == -80.13
    assert "25.7,-80.3,25.85,-80.13" in bb.as_overpass()


def test_bbox_from_result_bad_input():
    assert geo.bbox_from_result({}) is None
    assert geo.bbox_from_result({"boundingbox": ["a", "b", "c", "d"]}) is None


def test_category_selectors_known_and_fallback():
    assert ("office", "advertising_agency") in local.category_selectors("marketing agency")
    assert ("amenity", "dentist") in local.category_selectors("dentist")
    assert ("office", "lawyer") in local.category_selectors("law firm")
    # Unknown category → generic fallback selectors
    assert local.category_selectors("zorblax widget") is local._FALLBACK_SELECTORS


def test_build_overpass_query_includes_tags_and_bbox():
    q = local.build_overpass_query([("amenity", "dentist")], "(1,2,3,4)", limit=10)
    assert '["amenity"="dentist"]' in q
    assert '["website"]' in q and '["contact:email"]' in q
    assert "(1,2,3,4)" in q
    assert "out tags center 10" in q


def test_extract_businesses_keeps_domain_and_email():
    payload = {"elements": [
        {"type": "node", "id": 1, "tags": {
            "name": "Bright Spark Marketing", "office": "advertising_agency",
            "website": "https://brightspark.com", "addr:city": "Miami"}},
        {"type": "way", "id": 2, "tags": {
            "name": "Downtown Dental", "amenity": "dentist",
            "contact:email": "hello@downtowndental.com"}},
        {"type": "node", "id": 3, "tags": {  # no website/email → dropped
            "name": "No Web Co", "office": "company"}},
        {"type": "node", "id": 4, "tags": {  # no name → dropped
            "website": "https://anon.com"}},
    ]}
    ents = local.extract_businesses(payload)
    assert [e.organization for e in ents] == ["Bright Spark Marketing", "Downtown Dental"]
    assert ents[0].domain == "brightspark.com"
    assert ents[1].domain == "downtowndental.com"
    assert ents[1].extra["public_email"] == "hello@downtowndental.com"
    assert ents[0].source == "local"


def test_extract_businesses_dedupes_by_domain():
    payload = {"elements": [
        {"type": "node", "id": 1, "tags": {"name": "A", "website": "https://x.com"}},
        {"type": "node", "id": 2, "tags": {"name": "B", "website": "https://x.com/about"}},
    ]}
    ents = local.extract_businesses(payload)
    assert len(ents) == 1


def test_local_search_no_location_yields_nothing():
    # Local search is inherently geographic; without a place it should be empty.
    assert list(local.LocalSource().search(Query(keyword="dentist"))) == []


def test_osm_social_address_and_state_tags_are_kept():
    from openleads.engine import entity_to_lead
    from openleads.models import EmailResult
    from openleads.sources.local import extract_businesses
    data = {"elements": [{"id": 7, "tags": {
        "name": "Acme Dental", "website": "https://acmedental.example",
        "addr:city": "Austin", "addr:state": "TX", "addr:street": "Congress Ave",
        "addr:housenumber": "100", "addr:postcode": "78701", "amenity": "dentist",
        "contact:facebook": "acmedental", "contact:instagram": "https://instagram.com/acme",
        "contact:twitter": "@acme_tx", "phone": "+1 512 555 0100"}}]}
    ent = extract_businesses(data)[0]
    assert ent.extra["state"] == "TX" and ent.extra["address"] == "100 Congress Ave"
    assert ent.extra["socials"] == {"facebook": "https://www.facebook.com/acmedental",
                                    "instagram": "https://www.instagram.com/acme",
                                    "twitter": "https://x.com/acme_tx"}
    ld = entity_to_lead(ent, EmailResult(email="info@acmedental.example", tier="safe"))
    assert ld.socials["facebook"].endswith("/acmedental") and ld.phone == "+15125550100"
