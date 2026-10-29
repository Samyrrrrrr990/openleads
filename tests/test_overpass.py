"""Overpass: lean QL, mirrors, breaker, no cached error remarks (offline)."""
import urllib.error
import urllib.parse

from openleads import _concurrency, _http, runreport
from openleads.models import Query
from openleads.sources import local

GOLDEN = """[out:json][timeout:20];
(
  nwr["amenity"="dentist"][~"^(website|contact:website|email|contact:email)$"~"."](30.1,-97.9,30.4,-97.6);
  nwr["healthcare"="dentist"][~"^(website|contact:website|email|contact:email)$"~"."](30.1,-97.9,30.4,-97.6);
);
out tags center 50;"""


def test_golden_query():
    ql = local.build_overpass_query([("amenity", "dentist"), ("healthcare", "dentist")],
                                    "(30.1,-97.9,30.4,-97.6)", limit=50, timeout=20)
    assert ql == GOLDEN


def test_wildcard_selector_and_name_filter():
    ql = local.build_overpass_query([("shop", "*")], "(1,2,3,4)", name_filter="acme")
    assert 'nwr["shop"]["name"~"acme",i][~"^(website|' in ql


class _Cache:
    def __init__(self):
        self.d = {}

    def get(self, ns, key, max_stale=0):
        return self.d.get((ns, key))

    def set(self, ns, key, value):
        self.d[(ns, key)] = value


def _host(url):
    return urllib.parse.urlsplit(url).hostname


def test_error_remark_is_never_cached_and_next_mirror_answers(monkeypatch):
    calls = []

    def fake(url, headers=None, timeout=None, data=None):
        calls.append(_host(url))
        if _host(url) == "a.example":
            return '{"elements": [], "remark": "runtime error: Query timed out in \\"query\\""}'
        return '{"elements": [{"id": 1, "tags": {"name": "X", "website": "https://x.example"}}]}'
    monkeypatch.setattr(_http, "_open", fake)
    cache = _Cache()
    data = local.run_overpass("q", cache=cache, mirrors=("https://a.example/i", "https://b.example/i"))
    assert data["elements"][0]["id"] == 1
    assert calls == ["a.example", "b.example"]
    assert [k[1] for k in cache.d] == ["https://b.example/i?data=q"]   # only the good one


def test_429_moves_to_the_next_mirror_without_sleeping(monkeypatch):
    calls, sleeps = [], []
    monkeypatch.setattr(_http, "_sleep", sleeps.append)
    monkeypatch.setattr(local, "_sleep", sleeps.append)

    def fake(url, headers=None, timeout=None, data=None):
        calls.append(_host(url))
        if _host(url) == "a.example":
            raise urllib.error.HTTPError(url, 429, "slow down", {}, None)
        return '{"elements": []}'
    monkeypatch.setattr(_http, "_open", fake)
    assert local.run_overpass("q", mirrors=("https://a.example/i", "https://b.example/i")) \
        == {"elements": []}
    assert calls == ["a.example", "b.example"] and sleeps == []


def test_second_round_only_when_time_allows(monkeypatch):
    calls = []

    def down(url, headers=None, timeout=None, data=None):
        calls.append(_host(url))
        raise urllib.error.HTTPError(url, 504, "gateway timeout", {}, None)
    monkeypatch.setattr(_http, "_open", down)
    reasons = []
    assert local.run_overpass("q1", mirrors=("https://a.example/i",), reasons=reasons) is None
    assert calls == ["a.example", "a.example"]            # no deadline: one more round
    assert reasons[0].startswith("a.example: HTTP 504")
    local.BREAKER.reset()
    calls.clear()
    with _concurrency.deadline(10):                        # <20s left: no second round
        local.run_overpass("q2", mirrors=("https://a.example/i",))
    assert calls == ["a.example"]


def test_breaker_skips_a_failing_host(monkeypatch):
    calls = []

    def fake(url, headers=None, timeout=None, data=None):
        calls.append(_host(url))
        if _host(url) == "a.example":
            raise urllib.error.HTTPError(url, 503, "busy", {}, None)
        return '{"elements": []}'
    monkeypatch.setattr(_http, "_open", fake)
    monkeypatch.setattr(_http, "MAX_RETRIES", 0)
    mirrors = ("https://a.example/i", "https://b.example/i")
    for q in ("q1", "q2", "q3"):
        local.run_overpass(q, mirrors=mirrors)
    assert calls == ["a.example", "b.example", "a.example", "b.example", "b.example"]
    assert not local.BREAKER.allow("a.example")


def test_breaker_reopens_after_cooldown():
    br = local.CircuitBreaker(threshold=2, cooldown=0.0)
    br.failure("h")
    br.failure("h")
    assert br.allow("h")                     # cooldown elapsed immediately
    br2 = local.CircuitBreaker(threshold=2, cooldown=60)
    br2.failure("h")
    assert br2.allow("h")
    br2.failure("h")
    assert not br2.allow("h")
    br2.success("h")
    assert br2.allow("h")


def test_mirrors_from_env(monkeypatch):
    monkeypatch.setenv("OPENLEADS_OVERPASS_URLS", "https://o1.example/api, https://o2.example/api")
    assert local.overpass_mirrors() == ("https://o1.example/api", "https://o2.example/api")
    monkeypatch.delenv("OPENLEADS_OVERPASS_URLS")
    assert len(local.overpass_mirrors()) == 3


def test_results_put_published_emails_first():
    els = [{"id": 9, "tags": {"name": "B", "website": "https://b.example"}},
           {"id": 5, "tags": {"name": "A", "website": "https://a.example"}},
           {"id": 7, "tags": {"name": "C", "email": "hi@c.example"}}]
    assert [e["id"] for e in local.rank_elements(els)] == [7, 5, 9]


def test_local_search_falls_back_to_nominatim_and_says_why(monkeypatch):
    nominatim = []

    def fake(url, headers=None, timeout=None, data=None):
        if "nominatim" in url:
            nominatim.append(url)
            return ('[{"osm_id": 3, "name": "KC Dental", "category": "amenity", '
                    '"type": "dentist", "extratags": {"website": "https://kc.example"}}]')
        raise urllib.error.HTTPError(url, 429, "busy", {}, None)
    monkeypatch.setattr(_http, "_open", fake)
    monkeypatch.setattr("openleads.discover.geo._throttle", lambda: None)
    rep = runreport.SearchReport()
    with runreport.activate(rep), runreport.active_source("local"):
        ents = list(local.LocalSource().search(Query(keyword="dentist", location="Austin, TX")))
    assert [e.organization for e in ents] == ["KC Dental"]
    assert nominatim and all("bounded=1" in u and "viewbox=" in u for u in nominatim)
    sr = rep.sources["local"]
    assert sr.fallbacks[0].startswith("overpass→nominatim (HTTP 429")
    assert "overpass_fallback" in rep.flags and "gazetteer" in sr.note

