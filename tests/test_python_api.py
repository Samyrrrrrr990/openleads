"""openleads.find / find_email / verify — the Python API (offline)."""
import csv
import json
import subprocess
import sys

import pytest

import openleads
from openleads import engine
from openleads.api import SearchResult
from openleads.emails import resolve
from openleads.models import EmailResult, Entity, Lead
from openleads.sources import get_registry


class _Src:
    name, kind, vertical, description = "apifake", "people", "test people", "t"
    cache = None

    def search(self, q):
        yield Entity(full_name="Ada Lovelace", title="CTO", organization="Acme",
                     domain="acme.example")
        yield Entity(full_name="", organization="Beta", domain="beta.example")


@pytest.fixture()
def fake_source(monkeypatch):
    get_registry(reload=True)["apifake"] = _Src()
    monkeypatch.setattr(engine, "find_email", lambda name, domain, **kw: EmailResult(
        email=f"{(name.split() or ['info'])[0].lower()}@{domain}", tier="safe", score=95,
        signals={"groundtruth_exact": True}))


def test_import_openleads_stays_light():
    code = ("import sys, openleads; assert callable(openleads.find); "
            "assert 'openleads.engine' not in sys.modules, sorted(sys.modules)")
    subprocess.run([sys.executable, "-c", code], check=True)


def test_find_returns_a_list_with_query_and_report(fake_source, tmp_path):
    seen = []
    res = openleads.find("anything", source="apifake", count=5, budget=0,
                         company_profile=False, use_cache=False, on_lead=seen.append)
    assert isinstance(res, SearchResult) and isinstance(res, list)
    assert [ld.email for ld in res] == ["ada@acme.example", "info@beta.example"]
    assert all(isinstance(ld, Lead) for ld in seen) and len(seen) == 2
    assert res.query.source == "apifake" and res.query.count == 5
    assert res.report.sources["apifake"].status == "ok"
    assert "2/5 leads" in res.report.summary() and "SearchResult" in repr(res)
    assert res.to_dicts()[0]["contact_type"] == "person"
    assert json.loads(res.to_json())[1]["vertical"] == "test people"

    csv_path = res.write(str(tmp_path / "out.csv"))
    rows = list(csv.DictReader(open(csv_path, encoding="utf-8")))
    assert rows[0]["Email"] == "ada@acme.example"
    assert json.load(open(res.write(str(tmp_path / "out.json")), encoding="utf-8"))[0]["email"]
    lines = open(res.write(str(tmp_path / "out.jsonl")), encoding="utf-8").read().splitlines()
    assert len(lines) == 2 and json.loads(lines[1])["organization"] == "Beta"


def test_find_rejects_unknown_options_helpfully():
    with pytest.raises(ValueError, match="did you mean 'local'"):
        openleads.find("dentists", source="locl")
    with pytest.raises(ValueError, match="unknown seniority"):
        openleads.find("dentists", seniority="boss")


def test_find_email_and_verify(monkeypatch):
    monkeypatch.setattr(resolve, "_mx_lookup", lambda d, c: {
        "hosts": ["mx.apitest.example"], "resolvers_ok": 2, "agreement": True, "status": "ok"})
    monkeypatch.setattr(resolve.mxmod, "dns_health", lambda d, cache=None: {
        "spf_present": True, "dmarc_present": True, "dmarc_policy": "reject"})
    monkeypatch.setattr(resolve.netcheck, "port25_open", lambda: False)
    monkeypatch.setattr(resolve.gravatar, "has_gravatar", lambda e, cache=None: False)
    monkeypatch.setattr(resolve.groundtruth, "harvest_from_site",
                        lambda d, cache=None: ["grace.hopper@apitest.example"])
    r = openleads.find_email("Ada Lovelace", "https://apitest.example/", use_cache=False)
    assert r.email == "ada.lovelace@apitest.example" and r.tier == "safe"
    v = openleads.verify("ada@apitest.example", use_cache=False)
    assert v.tier in ("safe", "risky") and v.email == "ada@apitest.example"
