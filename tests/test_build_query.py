"""intent.build_query: one validated query builder for every front end."""
import pytest

from openleads import cli, intent
from openleads.models import Query


def test_words_are_parsed_and_kept():
    q = intent.build_query("15 dentists in Austin, verified only")
    assert q.text == "15 dentists in Austin, verified only"
    assert (q.count, q.location, q.verified_only) == (15, "Austin", True)


def test_overrides_win_and_none_means_keep():
    q = intent.build_query("50 fintech founders", count=5, location="Berlin", deep=None)
    assert (q.count, q.location, q.deep) == (5, "Berlin", False)
    assert intent.build_query("", keyword="dentist").keyword == "dentist"


@pytest.mark.parametrize("given,count", [(0, 1), (5000, 1000), ("7", 7)])
def test_count_is_clamped(given, count):
    assert intent.build_query("x", count=given).count == count


@pytest.mark.parametrize("given,budget", [(0, 0), (-1, 0), (3, 5), (45, 45), (10**6, 3600)])
def test_budget_is_zero_or_clamped(given, budget):
    assert intent.build_query("x", budget=given).budget == budget


def test_unknown_source_suggests_the_closest():
    with pytest.raises(intent.QueryError, match="did you mean 'local'"):
        intent.build_query("dentists", source="locl")
    with pytest.raises(ValueError):                  # still a ValueError for old callers
        intent.build_query("x", source="nope-nothing-like-it")
    assert intent.build_query("x", source="auto").source is None
    assert intent.build_query("x", source=" Local ").source == "local"


def test_role_filters_are_validated():
    q = intent.build_query("agencies in Miami", seniority="vp, Director", department=["sales"])
    assert q.seniority == ["vp", "director"] and q.department == ["sales"]
    q2 = intent.build_query("x", department="customer success")
    assert q2.department == ["customer_success"]
    with pytest.raises(intent.QueryError, match="unknown seniority 'vpp'.*did you mean 'vp'"):
        intent.build_query("x", seniority="vpp")
    with pytest.raises(intent.QueryError, match="unknown department"):
        intent.build_query("x", department="astrology")


def test_friendly_aliases():
    q = intent.build_query("x", no_cache=True, no_people=True, no_company=True,
                           format="json", budget_seconds=30)
    assert (q.use_cache, q.discover, q.company_profile, q.fmt, q.budget) == \
        (False, False, False, "json", 30)
    assert intent.build_query("x", people=False).discover is False
    with pytest.raises(intent.QueryError, match="unknown query option"):
        intent.build_query("x", colour="red")


def test_cli_reports_a_bad_source_with_a_suggestion(capsys):
    assert cli.main(["find", "dentists in Austin", "-s", "locl"]) == 2
    err = capsys.readouterr().err
    assert "did you mean 'local'" in err


def test_chat_search_keeps_the_original_words(monkeypatch):
    """N3: chat used to rebuild the Query without `text`, so the planner lost it."""
    from openleads import chat
    seen = {}

    def fake_build(q, cache=None, db=None, on_progress=None):
        seen["q"] = q
        return []
    monkeypatch.setattr(chat, "build_leads", fake_build)
    monkeypatch.setattr(chat, "openrouter_key", lambda: None)
    monkeypatch.setattr(intent, "openrouter_key", lambda: None)

    class Sess:
        source, count, fmt, verified_only, deep = None, 7, "csv", False, False
        cache = db = None
        last_leads: list = []

        def base_query(self):
            return Query(count=self.count)
    chat._run_search("dentists in Austin", Sess(), None)
    q = seen["q"]
    assert q.text == "dentists in Austin" and q.location == "Austin" and q.count == 7


def test_web_payload_errors_are_streamed_not_raised():
    from openleads.web import api
    events = []
    api.find({"query": "dentists in Austin", "source": "locl"}, events.append)
    assert events == [{"type": "error",
                       "message": "unknown source 'locl' — did you mean 'local'? "
                                  "(see `openleads sources`)"}]
