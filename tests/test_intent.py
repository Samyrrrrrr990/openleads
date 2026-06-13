"""Tests for the rule-based intent parser (deterministic, no network/LLM).

v4: the parser no longer hard-pins a vertical source (the federation layer routes
across sources). It extracts the *signals* — count, location, keyword, format,
verified — and only pins ``domains`` for a typed domain. Source routing is covered
in ``test_federation.py``.
"""
from openleads.intent import rule_parse


def test_fintech_founders_verified():
    q = rule_parse("find 50 fintech founders, verified only")
    assert q.source is None              # federation routes (yc/hn), not a hard pin
    assert q.count == 50
    assert q.verified_only is True
    assert "fintech" in (q.keyword or "")
    assert q.fmt == "csv"


def test_doctors_in_california():
    q = rule_parse("pediatricians in California")
    assert q.source is None
    assert q.location == "California"
    assert q.verified_only is False


def test_researchers_ndjson():
    q = rule_parse("20 machine learning researchers as ndjson")
    assert q.source is None
    assert q.count == 20
    assert q.fmt == "ndjson"
    assert "machine learning" in (q.keyword or "")


def test_developers_with_location():
    q = rule_parse("open source rust developers in Berlin")
    assert q.source is None
    assert q.location == "Berlin"
    assert "rust" in (q.keyword or "")


def test_json_format_detected():
    assert rule_parse("founders as json").fmt == "json"
    # ndjson must not be mistaken for json
    assert rule_parse("founders ndjson").fmt == "ndjson"


def test_count_clamped_and_default():
    assert rule_parse("find founders").count == 20      # default
    assert rule_parse("find 99999 founders").count == 1000  # clamp


def test_empty_text():
    q = rule_parse("")
    assert q.source is None
    assert q.count == 20


def test_verified_only_phrasings():
    assert rule_parse("founders, only verified").verified_only
    assert rule_parse("verified founders").verified_only
    assert not rule_parse("founders").verified_only
