"""Per-run memo, stale-on-error cache, and run-to-run determinism (all offline)."""
import random
import time
import urllib.error
from collections import Counter

from openleads import _http, engine
from openleads.cache.store import PRUNE_AFTER, Cache, MemoryCache
from openleads.emails import resolve
from openleads.models import EmailResult, Entity, Query
from openleads.sources import get_registry, yc


class _Src:
    kind, vertical, description = "people", "t", "t"
    cache = None

    def __init__(self, name, ents):
        self.name = name
        self._ents = ents

    def search(self, q):
        yield from self._ents


# --- MemoryCache / Cache ------------------------------------------------------- #
def test_memory_cache_is_truthy_and_returns_copies():
    c = MemoryCache()
    assert bool(c) and c.get("dataset", "k") is None
    c.set("dataset", "k", {"a": [1]})
    got = c.get("dataset", "k")
    got["a"].append(2)
    assert c.get("dataset", "k") == {"a": [1]}


def test_expired_rows_are_kept_for_stale_reads(tmp_path):
    c = Cache(path=tmp_path / "c.db", ttls={"dataset": 0})
    c.set("dataset", "u", {"elements": [1]})
    time.sleep(0.01)
    assert c.get("dataset", "u") is None                       # expired
    assert c.get("dataset", "u", max_stale=3600) == {"elements": [1]}   # still on disk


def test_long_expired_rows_are_pruned_on_open(tmp_path):
    c = Cache(path=tmp_path / "c.db")
    c.set("dataset", "old", 1)
    c.set("dataset", "new", 2)
    c._conn.execute("UPDATE cache SET ts = ? WHERE k = 'old'",
                    (time.time() - PRUNE_AFTER - 2 * 86400,))
    c._conn.commit()
    c.close()
    c = Cache(path=tmp_path / "c.db")
    assert c.info()["counts"] == {"dataset": 1}
    assert c.get("dataset", "new") == 2


def test_failed_fetch_falls_back_to_recent_stale_data(tmp_path, monkeypatch):
    c = Cache(path=tmp_path / "c.db", ttls={"dataset": 0})
    c.set("dataset", "https://op.example/q", {"elements": ["cached"]})
    time.sleep(0.01)

    def down(url, *a, **kw):
        raise urllib.error.HTTPError(url, 404, "gone", {}, None)
    monkeypatch.setattr(_http, "_open", down)
    assert _http.get_json("https://op.example/q", cache=c, ttl_ns="dataset") == \
        {"elements": ["cached"]}
    # Namespaces where stale data would be wrong (e.g. MX) never fall back.
    c.set("profile", "https://op.example/q", {"x": 1})
    assert _http._stale(c, "profile", "https://op.example/q") is None


# --- each URL once per run ------------------------------------------------------ #
def _router(calls):
    def fake_open(url, headers=None, timeout=None, data=None):
        calls[url] += 1
        if "type=MX" in url:
            return '{"Status": 0, "Answer": [{"type": 15, "data": "10 mx.acme.example."}]}'
        if "type=TXT" in url:
            return '{"Status": 0}'
        if url.rstrip("/") == "https://acme.example":
            return "<html><title>Acme</title><p>hello</p></html>"
        raise urllib.error.HTTPError(url, 404, "not found", {}, None)
    return fake_open


def test_a_no_cache_run_fetches_each_url_once(monkeypatch):
    calls = Counter()
    monkeypatch.setattr(_http, "_open", _router(calls))
    monkeypatch.setattr(resolve.netcheck, "port25_open", lambda: False)
    people = [Entity(full_name=n, domain="acme.example", source="memofake")
              for n in ("Ada Lovelace", "Grace Hopper", "Alan Turing")]
    get_registry(reload=True)["memofake"] = _Src("memofake", people)
    leads = engine.build_leads(Query(source="memofake", count=3, budget=0, use_cache=False))
    assert len(leads) == 3
    repeated = {u: n for u, n in calls.items() if n > 1}
    assert repeated == {}, repeated
    assert any("type=MX" in u for u in calls)


# --- determinism ------------------------------------------------------------------ #
def test_same_domain_people_resolve_in_stream_order(monkeypatch):
    """Whoever resolves first teaches the pattern; stream order must decide that."""
    names = ["Zed Alpha", "Ada Byron", "Mia Cole"]

    def run_once():
        learned = {}

        def find_email(name, domain, **kw):
            time.sleep(random.random() * 0.02)
            first, last = name.lower().split()
            if domain not in learned:
                learned[domain] = "flast" if first > "m" else "first.last"
            local = f"{first[0]}{last}" if learned[domain] == "flast" else f"{first}.{last}"
            return EmailResult(email=f"{local}@{domain}", tier="safe", score=90)
        monkeypatch.setattr(engine, "find_email", find_email)
        get_registry(reload=True)["orderfake"] = _Src(
            "orderfake", [Entity(full_name=n, domain="acme.example", source="orderfake")
                          for n in names])
        return [ld.email for ld in engine.build_leads(
            Query(source="orderfake", count=3, budget=0, company_profile=False))]

    runs = [run_once() for _ in range(5)]
    assert all(r == runs[0] for r in runs)
    assert runs[0] == ["zalpha@acme.example", "abyron@acme.example", "mcole@acme.example"]


def test_yc_sample_order_is_stable_per_query():
    companies = [{"name": f"C{i}", "website": f"https://c{i}.example", "status": "Active",
                  "team_size": 10, "industry": "Fintech"} for i in range(30)]
    q = Query(text="fintech founders", keyword="fintech")
    a = [c["name"] for c in yc.filter_companies(companies, q)]
    b = [c["name"] for c in yc.filter_companies(companies, q)]
    assert a == b and sorted(a) == sorted(c["name"] for c in companies)
    other = [c["name"] for c in yc.filter_companies(companies, q.replace(seed=7))]
    assert other == [c["name"] for c in yc.filter_companies(companies, q.replace(seed=7))]


def test_only_permanent_failures_are_memoized_within_a_run(monkeypatch):
    calls = Counter()

    def fake(url, headers=None, timeout=None, data=None):
        calls[url] += 1
        code = 503 if "busy" in url else 404
        raise urllib.error.HTTPError(url, code, "x", {}, None)
    monkeypatch.setattr(_http, "_open", fake)
    monkeypatch.setattr(_http, "MAX_RETRIES", 0)
    with _http.run_scope():
        for _ in range(2):
            _http.get_text("https://busy.example/")     # transient: may succeed later
            _http.get_text("https://gone.example/")     # permanent: once per run
    assert calls == {"https://busy.example/": 2, "https://gone.example/": 1}
    _http.get_text("https://gone.example/")             # a new run tries again
    assert calls["https://gone.example/"] == 2
