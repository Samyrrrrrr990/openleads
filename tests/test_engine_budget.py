"""The time budget is a real deadline: runs return within ~budget, keeping finished work."""
import threading
import time
import urllib.error

import pytest

from openleads import _concurrency, _http, engine
from openleads._http import get_json
from openleads.models import EmailResult, Entity, Query
from openleads.sources import get_registry


class _Src:
    name = "budgetfake"
    kind = "people"
    vertical = "test"
    description = "test"

    def __init__(self, search):
        self._search = search
        self.cache = None

    def search(self, query):
        return self._search(query)

    def info(self):
        from openleads.models import SourceInfo
        return SourceInfo(self.name, self.kind, self.description, self.vertical)


def _register(search):
    get_registry(reload=True)["budgetfake"] = _Src(search)


def _ok(name, domain, **kw):
    return EmailResult(email=f"{name.lower()}@{domain}", confidence="verified",
                       score=95, tier="safe")


def test_slow_network_cannot_overrun_the_budget(monkeypatch):
    """Every request sleeps its full timeout: the deadline clamps it and stops new ones."""
    calls = []

    def sleepy_open(url, headers=None, timeout=None, data=None):
        calls.append(timeout)
        time.sleep(timeout)
        raise urllib.error.URLError("timed out")
    monkeypatch.setattr(_http, "_open", sleepy_open)
    monkeypatch.setattr(_http, "_sleep", lambda s: None)
    monkeypatch.setattr(engine, "find_email", _ok)

    def search(query):
        i = 0
        while True:
            get_json(f"https://slow.example/{i}", timeout=25)
            yield Entity(full_name=f"P{i}", domain=f"d{i}.example", source="budgetfake")
            i += 1
    _register(search)
    phases = []
    t0 = time.monotonic()
    leads = engine.build_leads(Query(source="budgetfake", count=10, budget=1),
                               on_progress=lambda k, p: phases.append(p) if k == "phase" else None)
    took = time.monotonic() - t0
    assert took < 2.0
    assert all(t <= 1.0 for t in calls)          # 25s request clamped to the budget
    assert any("time budget" in str(p) for p in phases)
    assert len(leads) <= 1


def test_a_stuck_resolve_does_not_hold_the_run(monkeypatch):
    release = threading.Event()

    def find_email(name, domain, **kw):
        if name == "P1":
            release.wait(5)                     # entity 2 hangs
        return _ok(name, domain)
    monkeypatch.setattr(engine, "find_email", find_email)
    _register(lambda q: iter([Entity(full_name=f"P{i}", domain=f"d{i}.example",
                                     source="budgetfake") for i in range(2)]))
    try:
        t0 = time.monotonic()
        leads = engine.build_leads(Query(source="budgetfake", count=5, budget=1))
        assert time.monotonic() - t0 < 2.0
        assert [ld.email for ld in leads] == ["p0@d0.example"]
    finally:
        release.set()


def test_finished_work_is_kept_in_stream_order(monkeypatch):
    release = threading.Event()

    def find_email(name, domain, **kw):
        if name == "P0":
            release.wait(5)                     # the head hangs; the rest finish
        return _ok(name, domain)
    monkeypatch.setattr(engine, "find_email", find_email)
    _register(lambda q: iter([Entity(full_name=f"P{i}", domain=f"d{i}.example",
                                     source="budgetfake") for i in range(4)]))
    try:
        leads = engine.build_leads(Query(source="budgetfake", count=10, budget=1))
        assert [ld.first_name for ld in leads] == ["P1", "P2", "P3"]
    finally:
        release.set()


def test_leads_stream_out_before_the_source_is_done(monkeypatch):
    """A slow stream doesn't hold back leads that are already resolved."""
    monkeypatch.setattr(engine, "find_email", _ok)
    seen_at = []

    def search(query):
        yield Entity(full_name="P0", domain="d0.example", source="budgetfake")
        time.sleep(0.3)
        yield Entity(full_name="P1", domain="d1.example", source="budgetfake")
    _register(search)
    t0 = time.monotonic()
    engine.build_leads(Query(source="budgetfake", count=2, budget=0),
                       on_progress=lambda k, p: seen_at.append(time.monotonic() - t0)
                       if k == "lead" else None)
    assert seen_at[0] < 0.25 and len(seen_at) == 2


def test_a_raising_stream_ends_the_scan_not_the_run(monkeypatch):
    monkeypatch.setattr(engine, "find_email", _ok)

    def search(query):
        yield Entity(full_name="P0", domain="d0.example", source="budgetfake")
        raise RuntimeError("source exploded")
    _register(search)
    phases = []
    leads = engine.build_leads(Query(source="budgetfake", count=5, budget=0),
                               on_progress=lambda k, p: phases.append(str(p)))
    assert [ld.first_name for ld in leads] == ["P0"]


def test_closing_ordered_map_never_waits_for_running_calls():
    release = threading.Event()

    def work(x):
        if x:
            release.wait(5)
        return x
    it = _concurrency.ordered_map(work, range(6), 3)
    try:
        assert next(it) == 0
        t0 = time.monotonic()
        it.close()
        assert time.monotonic() - t0 < 0.5
    finally:
        release.set()


def test_ordered_map_raises_budget_exhausted_on_a_stuck_call(monkeypatch):
    monkeypatch.setattr(_concurrency, "GRACE_SECONDS", 0.1)
    release = threading.Event()
    try:
        with _concurrency.deadline(0.2):
            it = _concurrency.ordered_map(lambda x: release.wait(5), [1], 1)
            with pytest.raises(_concurrency.BudgetExhausted):
                list(it)
    finally:
        release.set()


def test_worker_threads_see_the_run_deadline():
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(1) as ex, _concurrency.deadline(30):
        left = _concurrency.submit(ex, _concurrency.remaining).result()
        plain = ex.submit(_concurrency.remaining).result()
    assert 0 < left <= 30 and plain == float("inf")
