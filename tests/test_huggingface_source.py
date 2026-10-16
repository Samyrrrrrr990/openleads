"""Hub contract regression tests: synthetic fixtures, no live requests."""
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import pytest

from openleads.models import Query
from openleads.sources.huggingface import HuggingFaceSource, parse_models, parse_profile


def test_hub_arrays_and_missing_author_use_repo_id():
    assert parse_models([
        {"id": "alice/bert"}, {"author": "ALICE"}, {"modelId": "bob/data"},
        None, "invalid", {"author": 42}, {"author": "../escape"}, {"id": "no-namespace"},
    ]) == ["alice", "bob"]


@pytest.mark.parametrize("data", [None, "bad", 42, {}, {"results": None}, {"results": "bad"}])
def test_malformed_lists_are_empty(data):
    assert parse_models(data) == []


def test_documented_overview_shape():
    entity = parse_profile("alice", {
        "type": "user", "user": "alice", "fullname": "Alice Example",
        "orgs": [{"name": "sample", "fullname": "Sample Research"}, {"name": "sample", "fullname": "Sample Research"}],
        "details": "Public work: [GitHub](https://github.com/alice)",
    })
    assert entity is not None
    assert entity.full_name == "Alice Example"
    assert entity.organization == "Sample Research"
    assert entity.links["github"] == "https://github.com/alice"
    assert entity.domain == ""
    assert "public_email" not in entity.extra


@pytest.mark.parametrize("profile", [
    None, [], {}, {"error": "Not Found"}, {"type": "org", "fullname": "Example"},
    {"fullname": 42}, {"fullname": "Example", "serviceAccount": {"org": "sample"}},
    {"fullname": "Example", "user": "different-user"},
])
def test_invalid_nonperson_and_mismatched_profiles_are_skipped(profile):
    assert parse_profile("alice", profile) is None


def test_unsafe_links_and_inconsistent_types_are_not_used():
    entity = parse_profile("alice", {
        "fullname": "Alice Example", "website": "javascript:alert(1)",
        "github": "https://github.com.evil.invalid/alice", "orgs": "bad", "location": [],
    })
    assert entity is not None
    assert entity.website == "https://huggingface.co/alice"
    assert "github" not in entity.links
    assert entity.organization == ""
    assert entity.location == ""


def test_search_uses_arrays_overview_cache_and_deduplicated_authors():
    source = HuggingFaceSource()
    source.cache = object()

    def response(url, **kwargs):
        assert kwargs == {"cache": source.cache, "ttl_ns": "dataset"}
        parsed = urlsplit(url)
        if parsed.path in {"/api/models", "/api/datasets"}:
            assert parse_qs(parsed.query)["search"] == ["bert & vision"]
            return [{"id": "alice/model"}, {"id": "alice/data"}, {"author": "bob"}]
        if parsed.path == "/api/users/alice/overview":
            return {"fullname": "Alice Example", "type": "user", "user": "alice"}
        if parsed.path == "/api/users/bob/overview":
            return None  # unavailable or an organization, not a person
        raise AssertionError(url)

    with patch("openleads.sources.huggingface.get_json", side_effect=response) as fetch:
        result = list(source.search(Query(keyword="bert & vision", count=1)))
    assert [e.full_name for e in result] == ["Alice Example"]
    assert fetch.call_count == 4


def test_profile_requests_and_results_are_bounded():
    def response(url, **kwargs):
        parsed = urlsplit(url)
        if parsed.path in {"/api/models", "/api/datasets"}:
            return [{"id": f"person{i}/model"} for i in range(100)]
        return {"fullname": "Synthetic Example"}

    with patch("openleads.sources.huggingface.get_json", side_effect=response) as fetch:
        result = list(HuggingFaceSource().search(Query(keyword="bert", count=2)))
    assert len(result) == 2
    assert fetch.call_count == 22  # two catalogs plus the bounded 20 profiles


@pytest.mark.parametrize("query", [Query(), Query(keyword="bert", count=0)])
def test_empty_query_or_zero_count_does_not_fetch(query):
    with patch("openleads.sources.huggingface.get_json") as fetch:
        assert list(HuggingFaceSource().search(query)) == []
        fetch.assert_not_called()


def test_http_failure_degrades_to_empty_results():
    with patch("openleads.sources.huggingface.get_json", return_value=None):
        assert list(HuggingFaceSource().search(Query(keyword="bert"))) == []
