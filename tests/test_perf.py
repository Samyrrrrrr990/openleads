"""Latency guards: the parallelism that makes a search fast stays in place.

Each test runs on FakeNet routes with real (short) delays and asserts wall time,
so a change that serializes the work again fails here instead of only showing up
in the nightly live benchmark. ``bench/latency.py`` is the full-size version.
"""
import json
import threading
import time

import fakenet

import openleads
from openleads import _concurrency, _http, federation
from openleads.models import Entity, Query
from openleads.sources import local


def _world(monkeypatch, main_delay):
    n = fakenet.install(monkeypatch)
    n.add(r"overpass-api\.de", fakenet.OVERPASS_OK, delay=main_delay)
    n.add(r"overpass\.private\.coffee", fakenet.OVERPASS_OK, delay=0.3)
    n.add(r"overpass\.kumi\.systems", fakenet.OVERPASS_OK, delay=0.3)
    n.add(r"type=MX", fakenet.doh_mx(), delay=0.05)
    n.add(r"type=TXT", fakenet.DOH_TXT_SPF_DMARC, delay=0.05)
    n.add(r"gravatar\.com", fakenet.status(404))
    n.add(r"\.example(/|$)", fakenet.business_site, delay=0.05)
    return n


def test_a_hanging_overpass_main_is_hedged_by_a_mirror(monkeypatch):
    """The main instance hangs; the second mirror is asked after HEDGE_DELAY and
    wins. Sequential mirror attempts waited out the main one's whole timeout."""
    n = _world(monkeypatch, main_delay=600)
    t0 = time.monotonic()
    res = openleads.find("dentists in Austin", count=3, budget=40, use_cache=False)
    elapsed = time.monotonic() - t0
    assert len(res) == 3
    assert elapsed < local.HEDGE_DELAY + 3.0, elapsed       # was ~9s (per-mirror timeout)
    assert len(n.hits(r"overpass")) == 2                   # never more than two asked
    assert res.report.sources["local"].status == "ok"      # the loser is not an error


def test_hedge_waits_before_asking_a_second_mirror(monkeypatch):
    """A mirror that answers within HEDGE_DELAY is the only one asked."""
    n = fakenet.install(monkeypatch)
    n.add(r"a\.example", '{"elements": []}', delay=0.2)
    n.add(r"b\.example", '{"elements": [{"id": 2}]}')
    assert local.run_overpass("q", mirrors=("https://a.example/i", "https://b.example/i")) \
        == {"elements": []}
    assert [u.split("/")[2] for u in n.calls] == ["a.example"]


def test_hedged_overpass_keeps_two_in_flight_after_a_failure(monkeypatch):
    n = fakenet.install(monkeypatch)
    n.add(r"a\.example", fakenet.status(429))
    n.add(r"b\.example", '{"elements": [{"id": 2}]}', delay=0.3)
    n.add(r"c\.example", '{"elements": [{"id": 3}]}', delay=0.1)
    reasons = []
    out = local.run_overpass("q", reasons=reasons, mirrors=(
        "https://a.example/i", "https://b.example/i", "https://c.example/i"))
    assert out == {"elements": [{"id": 3}]}                # c started when a failed
    assert reasons == ["a.example: HTTP 429 (rate-limited)"]


class _SlowSource:
    """A source whose first entity takes ``delay`` seconds (its big fetch)."""

    def __init__(self, name, delay):
        self.name, self.delay, self.cache = name, delay, None

    def search(self, query):
        time.sleep(self.delay)
        for i in range(3):
            yield Entity(full_name=f"Ada Lovelace{i}", organization=self.name,
                         domain=f"{self.name}{i}.example", source=self.name)


def test_every_planned_source_starts_at_once(monkeypatch):
    sources = {"one": _SlowSource("one", 0.6), "two": _SlowSource("two", 0.6),
               "three": _SlowSource("three", 0.6)}
    monkeypatch.setattr(federation, "plan", lambda q: list(sources))
    monkeypatch.setattr(federation, "get_source", sources.get)
    t0 = time.monotonic()
    ents = list(federation.search(Query(keyword="x"), discover_people=False))
    elapsed = time.monotonic() - t0
    assert [e.organization for e in ents[:3]] == ["one", "two", "three"]   # order kept
    assert len(ents) == 9
    assert elapsed < 1.2, elapsed                          # was 1.8s one after the other


def test_closing_during_a_prefetch_never_runs_the_stream_twice():
    started, release = threading.Event(), threading.Event()
    closed = []

    def stream():
        try:
            started.set()
            release.wait(2)
            yield 1
            yield 2
        finally:
            closed.append(True)

    pf = federation._Prefetch("s", stream())
    started.wait(2)
    pf.close()                     # the worker is still inside next(): close later
    assert closed == []
    release.set()
    for _ in range(50):
        if closed:
            break
        time.sleep(0.02)
    assert closed == [True]


def test_team_page_discovery_stops_once_enough_people_are_found(monkeypatch):
    team = ("<h3>Maria Garcia</h3><p>Owner</p><h3>James Chen</h3><p>Office Manager</p>"
            "<h3>Linda Patel</h3><p>Marketing Lead</p>")
    n = fakenet.install(monkeypatch)
    n.add(r"/team$", team, delay=0.05)
    n.add(r"\.example/", fakenet.status(404), delay=1.5)
    t0 = time.monotonic()
    out = federation.expand_company(Entity(full_name="", organization="Acme", domain="acme.example"))
    assert [e.full_name for e in out] == ["Maria Garcia", "James Chen", "Linda Patel"]
    assert time.monotonic() - t0 < 1.0                     # didn't wait for 11 more paths


def test_dns_resolvers_are_asked_concurrently(monkeypatch):
    from openleads.emails import mx
    n = fakenet.install(monkeypatch)
    n.add(r"type=MX", fakenet.doh_mx(), delay=0.4)
    n.add(r"type=TXT", fakenet.DOH_TXT_SPF_DMARC, delay=0.4)
    t0 = time.monotonic()
    info = mx.lookup("acme.example")
    health = mx.dns_health("acme.example")
    assert info["agreement"] and info["resolvers_ok"] == 2
    assert health["spf_present"] and health["dmarc_present"]
    assert time.monotonic() - t0 < 1.3                     # 2 round trips, not 4


def test_leftover_work_stops_when_the_run_returns(monkeypatch):
    """A search that has its leads must not keep crawling until its deadline."""
    els = [{"type": "node", "id": i, "tags": {"amenity": "dentist", "name": f"Dental {i}",
                                               "website": f"https://d{i}.example"}}
           for i in range(1, 21)]
    els[0]["tags"]["contact:email"] = "info@d1.example"
    n = fakenet.install(monkeypatch)
    n.add(r"overpass", json.dumps({"elements": els}))
    n.add(r"type=MX", fakenet.doh_mx())
    n.add(r"type=TXT", fakenet.DOH_TXT_SPF_DMARC)
    n.add(r"\.example/?$", fakenet.business_site)
    n.add(r".", fakenet.status(404), delay=0.4)            # team pages: slow 404s
    res = openleads.find("dentists in Austin", count=1, budget=60, use_cache=False)
    assert len(res) == 1
    before = len(n.calls)
    time.sleep(1.5)
    # Only requests already on the wire may land; before, the expansions kept
    # crawling team pages (and starting new ones) until the 60s deadline.
    assert len(n.calls) - before <= 3


def test_lifetime_zeroes_the_budget_for_work_left_behind():
    seen = []
    with _concurrency.deadline(60), _concurrency.lifetime():
        ctx_fn = _concurrency.submit(_concurrency.Pool(1), lambda: None)
        ctx_fn.result(1)
        assert _concurrency.remaining() > 50
        pool = _concurrency.Pool(1)
        gate = threading.Event()

        def later():
            gate.wait(2)
            seen.append(_concurrency.remaining())
            try:
                _http.request("https://x.example/")
            except _concurrency.BudgetExhausted:
                seen.append("refused")
        fut = _concurrency.submit(pool, later)
    gate.set()
    fut.result(2)
    assert seen == [0.0, "refused"]


def test_pool_runs_in_order_and_honours_cancel():
    pool = _concurrency.Pool(1)
    gate = threading.Event()
    out = []
    first = pool.submit(lambda: gate.wait(2) and out.append(1))
    second = pool.submit(out.append, 2)
    third = pool.submit(out.append, 3)
    assert second.cancel()
    gate.set()
    third.result(2)
    first.result(2)
    assert out == [1, 3]
    pool.shutdown(wait=True)
    assert all(not t.is_alive() for t in pool._threads)
    assert all(t.daemon for t in pool._threads)


def test_gather_keeps_order_and_swallows_errors():
    def boom():
        raise ValueError("x")
    t0 = time.monotonic()
    out = _concurrency.gather([lambda: time.sleep(0.3) or "a", boom,
                               lambda: time.sleep(0.3) or "c"], default="-")
    assert out == ["a", "-", "c"]
    assert time.monotonic() - t0 < 0.55


def test_a_hanging_site_is_skipped_after_two_timeouts_in_a_run(monkeypatch):
    n = fakenet.install(monkeypatch)
    n.add(r"hang\.example", "<html></html>", delay=5)
    n.add(r"api\.example", "{}", delay=5)
    with _http.run_scope():
        for path in ("/team", "/about"):
            assert _http.get_text(f"https://hang.example{path}", timeout=0.2, retries=0) is None
        t0 = time.monotonic()
        assert _http.get_text("https://www.hang.example/", timeout=0.2) is None
        assert time.monotonic() - t0 < 0.1                 # skipped, not waited for
        for _ in range(3):                                 # APIs are never skipped
            assert _http.get_json("https://api.example/x", timeout=0.2, retries=0) is None
    assert len(n.hits(r"hang\.example")) == 2
    assert len(n.hits(r"api\.example")) == 3
    assert "skipped: site keeps timing out" in _http.recent_errors()[-4][1]
    with _http.run_scope():                                # a new run asks again
        assert _http.get_text("https://hang.example/", timeout=0.2, retries=0) is None
    assert len(n.hits(r"hang\.example")) == 3
