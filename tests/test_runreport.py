"""Per-source run report: isolation, attribution, statuses, hints (offline)."""
import json
import time
import urllib.error

import pytest

from openleads import _http, bench, engine, federation, runreport
from openleads.models import EmailResult, Entity, Query
from openleads.runreport import SearchReport, SourceReport
from openleads.sources import get_registry


class _Src:
    kind, vertical, description = "people", "t", "t"
    cache = None

    def __init__(self, name, search):
        self.name = name
        self._search = search

    def search(self, q):
        return self._search(q)


def _ok(name, domain, **kw):
    return EmailResult(email=f"{name.split()[0].lower()}@{domain}", tier="safe", score=90,
                       signals={"groundtruth_exact": True})


@pytest.fixture()
def no_network_extras(monkeypatch):
    monkeypatch.setattr(engine, "find_email", _ok)
    monkeypatch.setattr(federation, "find_people", lambda d, **kw: [])
    monkeypatch.setattr(federation.groundtruth, "harvest_from_site", lambda d, **kw: [])
    monkeypatch.setattr(_http, "_sleep", lambda s: None)


def test_one_raising_source_fails_alone(monkeypatch, no_network_extras):
    def fail_open(url, *a, **kw):
        raise urllib.error.HTTPError(url, 500, "boom", {}, None)
    monkeypatch.setattr(_http, "_open", fail_open)

    def good(q):
        for i in range(2):
            yield Entity(full_name=f"Ada{i} Lee", domain=f"good{i}.example")

    def bad(q):
        _http.get_json("https://api.bad.example/v1/search")
        raise RuntimeError("parser exploded")
        yield  # pragma: no cover

    srcs = {"good": _Src("good", good), "bad": _Src("bad", bad)}
    monkeypatch.setattr(federation, "plan", lambda q: ["good", "bad"])
    monkeypatch.setattr(federation, "get_source", lambda n: srcs.get(n))
    events = []
    rep = SearchReport()
    leads = engine.build_leads(Query(count=5, budget=0, company_profile=False), report=rep,
                               on_progress=lambda k, p: events.append((k, p)))
    assert len(leads) == 2
    g, b = rep.sources["good"], rep.sources["bad"]
    assert (g.status, g.entities, g.leads) == ("ok", 2, 2)
    assert b.status == "failed" and b.leads == 0
    assert b.errors[0] == "api.bad.example: HTTP 500"
    assert "RuntimeError: parser exploded" in b.errors
    assert all(lead.source == "good" for lead in leads)
    kinds = [k for k, _ in events]
    assert kinds.count("source") == 2 and kinds[-1] == "report"
    assert rep.stop_reason == "exhausted" and rep.plan == ["good", "bad"]
    assert json.dumps(rep.to_dict())            # JSON-ready


def test_pinned_source_goes_through_the_same_wrapper(monkeypatch, no_network_extras):
    get_registry(reload=True)["pinfake"] = _Src(
        "pinfake", lambda q: iter([Entity(full_name="Ada Lee", domain="a.example")]))
    rep = SearchReport()
    leads = engine.build_leads(Query(source="pinfake", count=3, budget=0), report=rep)
    assert leads[0].source == "pinfake"          # empty source filled with the name
    assert rep.plan_reasons == {"pinfake": "pinned with --source"}
    assert rep.sources["pinfake"].status == "ok" and rep.sources["pinfake"].leads == 1


def test_budget_stop_marks_running_sources_timeout(monkeypatch, no_network_extras):
    def slow(q):
        while True:
            time.sleep(0.05)
            yield Entity(full_name="", domain="")
    get_registry(reload=True)["slowfake"] = _Src("slowfake", slow)
    rep = SearchReport()
    engine.build_leads(Query(source="slowfake", count=10_000, budget=1, max_companies=10_000),
                       report=rep)
    assert rep.stop_reason == "budget"
    assert rep.sources["slowfake"].status == "timeout"
    assert any("--budget" in h for h in rep.hints())


@pytest.mark.parametrize("kw,status", [
    ({}, "skipped"),
    ({"started": True, "finished": True}, "empty"),
    ({"started": True, "finished": True, "errors": ["x: HTTP 503"]}, "failed"),
    ({"started": True, "finished": True, "entities": 3}, "ok"),
    ({"started": True, "finished": True, "entities": 3, "fallbacks": ["stale cache"]}, "degraded"),
    ({"started": True, "finished": True, "entities": 3, "hit_deadline": True}, "timeout"),
])
def test_status_rules(kw, status):
    assert SourceReport(name="s", **kw).settle("exhausted") == status


def test_unfinished_source_at_budget_is_timeout_and_at_count_is_ok():
    assert SourceReport(name="s", started=True, entities=4).settle("budget") == "timeout"
    assert SourceReport(name="s", started=True, entities=4).settle("count_reached") == "ok"


def test_http_errors_are_routed_sensibly():
    rep = SearchReport()
    with runreport.activate(rep):
        runreport.http_error("https://acme.example/team", "HTTP 404 (not found)")
        runreport.http_error("https://acme.example/", "network error: timed out")
        runreport.http_error("https://dns.google/resolve?name=x", "timed out")
        with runreport.active_source("local"):
            runreport.http_error("https://overpass-api.de/api/interpreter?x", "HTTP 429")
            runreport.fallback("overpass→nominatim")
            runreport.note("geocode: gazetteer (Austin)")
    assert rep.site_errors == 1                       # 404 ignored, the timeout counted
    assert rep.errors == ["dns.google: timed out"]
    sr = rep.sources["local"]
    assert sr.errors == ["overpass-api.de: HTTP 429"]
    assert sr.fallbacks == ["overpass→nominatim"] and "gazetteer" in sr.note


def test_helpers_are_noops_outside_a_run():
    runreport.note("x")
    runreport.error("x")
    runreport.fallback("x")
    runreport.flag("x")
    runreport.http_error("https://a.example/", "HTTP 500")
    assert runreport.current() is None


def test_hints_explain_short_results():
    rep = SearchReport(requested=10, leads=2, budget=30, stop_reason="budget",
                       query={"verified_only": True})
    rep.flags.update({"geocode_failed", "overpass_fallback"})
    rep.dropped["not_safe"] = 5
    text = " | ".join(rep.hints())
    assert "--location" in text and "OpenStreetMap is busy" in text
    assert "raise it with --budget" in text and "drop --verified-only" in text
    assert SearchReport(requested=2, leads=2).hints() == []


def test_capture_collects_the_report_without_passing_it(no_network_extras):
    get_registry(reload=True)["capfake"] = _Src(
        "capfake", lambda q: iter([Entity(full_name="Ada Lee", domain="a.example")]))
    with runreport.capture() as cap:
        engine.build_leads(Query(source="capfake", count=1, budget=0))
    assert cap.report is not None and cap.report.leads == 1
    assert "1/1 leads" in cap.report.summary()


def test_status_lines_and_problem():
    rep = SearchReport(requested=5)
    rep.source("local").__dict__.update(started=True, finished=True, entities=0,
                                        errors=["nominatim.openstreetmap.org: timed out"])
    rep.finish("exhausted")
    assert rep.sources["local"].status == "failed"
    assert rep.problem() == "local: failed — nominatim.openstreetmap.org: timed out"
    assert rep.status_lines()[0].startswith("local")


def test_bench_fills_error_from_the_report(monkeypatch):
    def fake_build(q, cache=None, db=None, report=None):
        sr = report.source("local")
        sr.started = sr.finished = True
        sr.errors.append("nominatim.openstreetmap.org: timed out")
        report.requested = q.count
        report.finish("exhausted")
        return []
    monkeypatch.setattr(bench, "build_leads", fake_build)
    s = bench.score_query("dentists in Austin", count=5, budget=10)
    assert s.leads == 0 and "local: failed" in s.error
    assert s.sources == {"local": "failed"} and "0/5 leads" in s.notes
