"""A failed DNS lookup is "couldn't check", never "no MX" — and is never cached."""
import urllib.error

import pytest

from openleads import engine
from openleads.emails import mx, resolve
from openleads.models import Entity, Query
from openleads.sources import get_registry


class _DictCache:
    def __init__(self):
        self.d = {}

    def get(self, ns, key, max_stale=0):
        return self.d.get((ns, key))

    def set(self, ns, key, value):
        self.d[(ns, key)] = value


def _dns_down(url, timeout=15):
    raise urllib.error.URLError("network error: SERVFAIL upstream")


@pytest.fixture()
def offline_signals(monkeypatch):
    monkeypatch.setattr(resolve.netcheck, "port25_open", lambda: False)
    monkeypatch.setattr(resolve.gravatar, "has_gravatar", lambda e, cache=None: None)
    monkeypatch.setattr(resolve.groundtruth, "harvest_from_site", lambda d, cache=None: [])


@pytest.mark.parametrize("reply,status,hosts", [
    ({"Status": 0, "Answer": [{"type": 15, "data": "10 mx.a.example."}]}, "ok", ["mx.a.example"]),
    ({"Status": 0}, "nomx", []),
    ({"Status": 3}, "nxdomain", []),
    ({"Status": 2}, "error", []),
    ("garbage", "error", []),
])
def test_resolver_answers(reply, status, hosts):
    assert mx._answer(reply) == (status, hosts)


def test_both_resolvers_failing_is_an_error_not_no_mx(monkeypatch):
    monkeypatch.setattr(mx, "_query", _dns_down)
    info = mx.lookup("acme.example")
    assert info["status"] == "error" and info["hosts"] == []
    assert len(info["errors"]) == 2 and mx.is_unknown(info)


def test_one_resolver_answering_is_enough(monkeypatch):
    def half(url, timeout=15):
        if "dns.google" in url:
            raise urllib.error.URLError("down")
        return {"Status": 0, "Answer": [{"type": 15, "data": "5 mx.acme.example."}]}
    monkeypatch.setattr(mx, "_query", half)
    info = mx.lookup("acme.example")
    assert info["status"] == "ok" and info["hosts"] == ["mx.acme.example"]


def test_dns_error_is_risky_and_never_cached(monkeypatch, offline_signals):
    monkeypatch.setattr(mx, "_query", _dns_down)
    cache = _DictCache()
    res = resolve.find_email("Ada Lovelace", "acme.example", cache=cache)
    assert res.tier == "risky" and res.email
    assert "couldn't check the mail server" in res.reasons[0]
    assert 20 <= res.confidence_pct <= 40
    assert ("mx", "acme.example") not in cache.d
    assert ("mx", "dnshealth:acme.example") not in cache.d
    v = resolve.verify_address("ada@acme.example", cache=cache)
    assert v.tier == "risky" and cache.d == {}


def test_published_address_survives_a_dns_error(monkeypatch, offline_signals):
    monkeypatch.setattr(mx, "_query", _dns_down)
    res = resolve.find_email("", "shop.example", known_email="hello@shop.example")
    assert res.email == "hello@shop.example" and res.tier == "risky"
    assert res.signals["groundtruth_exact"] and res.confidence_pct == 60


def test_nxdomain_is_bad_and_cached(monkeypatch, offline_signals):
    monkeypatch.setattr(mx, "_query", lambda url, timeout=15: {"Status": 3})
    cache = _DictCache()
    res = resolve.find_email("Ada Lovelace", "gone.example", cache=cache)
    assert res.tier == "bad" and "no mail server" in res.reasons[0]
    assert cache.d[("mx", "gone.example")]["status"] == "nxdomain"


def test_old_cached_entries_without_status_still_work(offline_signals):
    cache = _DictCache()
    cache.set("mx", "old.example", {"hosts": [], "resolvers_ok": 0, "agreement": False})
    assert resolve.find_email("Ada Lovelace", "old.example", cache=cache).tier == "bad"


def test_dns_health_failure_is_not_cached(monkeypatch):
    monkeypatch.setattr(mx, "_query", _dns_down)
    cache = _DictCache()
    assert mx.dns_health("acme.example", cache=cache)["spf_present"] is False
    assert cache.d == {}
    monkeypatch.setattr(mx, "_query", lambda url, timeout=15: {
        "Status": 0, "Answer": [{"type": 16, "data": '"v=spf1 include:_spf.google.com ~all"'}]})
    assert mx.dns_health("acme.example", cache=cache)["spf_present"] is True
    assert ("mx", "dnshealth:acme.example") in cache.d


def test_engine_keeps_leads_when_dns_is_down(monkeypatch, offline_signals):
    monkeypatch.setattr(mx, "_query", _dns_down)

    class Src:
        name, kind, vertical, description = "dnsfake", "people", "t", "t"
        cache = None

        def search(self, q):
            yield Entity(full_name="Ada Lovelace", domain="acme.example", source="dnsfake")
    get_registry(reload=True)["dnsfake"] = Src()
    leads = engine.build_leads(Query(source="dnsfake", count=3, budget=0, company_profile=False))
    assert len(leads) == 1 and leads[0].tier == "risky"
