"""The Hunter-style `domains` source + its intent routing (network-free)."""
from openleads import intent
from openleads.models import Query
from openleads.sources import domains as dom


def test_parse_domains_from_mixed_text():
    out = dom.parse_domains("acme.com, https://www.stripe.com/jobs  example.org")
    assert out == ["acme.com", "stripe.com", "example.org"]


def test_parse_domains_rejects_non_domains():
    assert dom.parse_domains("hello world foo@bar") == []


def test_address_to_entity_person_vs_role():
    person = dom.address_to_entity("ada.lovelace@acme.com", "acme.com")
    assert person.full_name == "Ada Lovelace"
    assert person.extra["public_email"] == "ada.lovelace@acme.com"
    assert not person.extra["role_address"]

    role = dom.address_to_entity("info@acme.com", "acme.com")
    assert role.full_name == ""
    assert role.extra["role_address"]


def test_domains_source_emits_ground_truth(monkeypatch):
    src = dom.DomainsSource()
    monkeypatch.setattr(dom.groundtruth, "harvest_from_site",
                        lambda domain, cache=None: ["ada.lovelace@acme.com", "info@acme.com"])
    ents = list(src.search(Query(source="domains", keyword="acme.com")))
    assert len(ents) == 2
    # The real person sorts before the role address.
    assert ents[0].full_name == "Ada Lovelace"
    assert all(e.extra.get("public_email") for e in ents)


def test_intent_routes_domain_query_to_domains_source():
    q = intent.rule_parse("find emails at acme.com")
    assert q.source == "domains"
    assert q.keyword == "acme.com"


def test_intent_plain_request_is_not_a_domain():
    q = intent.rule_parse("fintech founders verified only")
    assert q.source != "domains"


def test_detect_domains_ignores_abbreviations():
    assert intent.detect_domains("we, inc. are hiring") == []
    assert intent.detect_domains("see acme.io and beta.ai") == ["acme.io", "beta.ai"]
