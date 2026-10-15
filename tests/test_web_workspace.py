"""Workspace API end to end through the real server (network stubbed)."""
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from openleads.db import DB
from openleads.web.server import Handler


@pytest.fixture(scope="module")
def base(tmp_path_factory):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


@pytest.fixture(autouse=True)
def seed(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    db = DB()
    for r in [
        dict(email="jane@acme.example", first_name="Jane", last_name="Doe", title="VP of Sales",
             organization="Acme", tier="safe", score=95, source="yc", city="Austin",
             technologies=["HubSpot"], signals={"groundtruth_exact": True}),
        dict(email="john@acme.example", first_name="John", last_name="Roe", title="Engineer",
             organization="Acme", tier="risky", score=60, source="yc"),
        dict(email="ann@beta.example", first_name="Ann", last_name="Poe", title="Head of Growth",
             organization="Beta", tier="safe", score=88, source="local"),
    ]:
        db.upsert_lead(r)
    db.close()
    yield


def get(base, path):
    try:
        with urllib.request.urlopen(base + path, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def post(base, path, body):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def stream(base, path, body):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return [json.loads(line) for line in r if line.strip()]


def test_meta_and_home(base):
    _, m = get(base, "/api/meta")
    assert m["contact_stages"][0]["key"] == "new" and m["seniorities"][0]["key"] == "owner"
    assert "auto_email" in [s["key"] for s in m["step_types"]] and "HubSpot" in m["technologies"]
    _, h = get(base, "/api/home")
    assert h["contacts"]["total"] == 3 and len(h["series"]["sent"]) == 30
    _, hl = get(base, "/api/health")
    assert hl["total"] == 3


def test_people_search_facets_detail_update_bulk(base):
    _, r = post(base, "/api/people/search", {"filters": {"tier": ["safe"]}, "sort": "name",
                                             "direction": "asc", "facets": True})
    assert [x["email"] for x in r["rows"]] == ["ann@beta.example", "jane@acme.example"]
    assert {f["value"] for f in r["facets"]["tier"]} == {"safe", "risky"}
    _, d = get(base, "/api/people/get?email=jane%40acme.example")
    assert d["contact"]["seniority"] == "vp" and d["account"]["technologies"] == ["HubSpot"]
    status, err = get(base, "/api/people/get?email=nobody%40x.example")
    assert status == 400 and err["error"] == "no such contact"
    _, u = post(base, "/api/people/update", {"email": "jane@acme.example",
                                             "fields": {"stage": "interested"}})
    assert u["contact"]["stage"] == "interested"
    status, err = post(base, "/api/people/update", {"email": "jane@acme.example",
                                                    "fields": {"stage": "moon"}})
    assert status == 400 and "unknown stage" in err["error"]
    _, b = post(base, "/api/people/bulk", {"all": True, "filters": {"q": "acme"},
                                           "action": "tag", "value": "q4"})
    assert b["count"] == 2
    _, t = post(base, "/api/people/tags", {"email": "ann@beta.example", "tags": ["vip"]})
    assert t["tags"] == ["vip"]
    _, c = post(base, "/api/people/create", {"contact": {"email": "new@delta.example",
                                                         "first_name": "Nia"}})
    assert c["contact"]["source"] == "manual"


def test_companies_endpoints(base, monkeypatch):
    _, r = post(base, "/api/companies/search", {"facets": True})
    assert r["rows"][0]["domain"] == "acme.example" and r["rows"][0]["people"] == 2
    assert r["facets"]["technologies"][0]["value"] == "HubSpot"
    _, d = get(base, "/api/companies/get?domain=acme.example")
    assert len(d["people"]) == 2
    _, u = post(base, "/api/companies/update", {"domain": "acme.example",
                                                "fields": {"stage": "engaged"}})
    assert u["company"]["stage"] == "engaged"
    profile = {"domain": "beta.example", "name": "Beta", "technologies": ["Shopify"],
               "socials": {}, "phones": [], "address": {}}
    monkeypatch.setattr("openleads.insights.company.fetch_profile",
                        lambda d, cache=None, refresh=False, timeout=8: dict(profile, domain=d))
    _, pr = post(base, "/api/companies/profile", {"domain": "beta.example"})
    assert pr["ok"] and pr["company"]["technologies"] == ["Shopify"]
    events = stream(base, "/api/companies/enrich", {"domains": ["acme.example"]})
    assert events[-1] == {"type": "done", "count": 1, "profiled": 1}
    _, c = post(base, "/api/companies/create", {"domain": "gamma.example", "name": "Gamma"})
    assert c["company"]["name"] == "Gamma"
    _, b = post(base, "/api/companies/bulk", {"domains": ["gamma.example"], "action": "delete"})
    assert b["count"] == 1


def test_lists_tags_notes_activity(base):
    _, s = post(base, "/api/lists/save", {"name": "Q4", "color": "teal"})
    lid = s["list"]["id"]
    _, a = post(base, "/api/lists/add", {"id": lid, "all": True, "filters": {"tier": "safe"}})
    assert a["added"] == 2 and a["list"]["count"] == 2
    _, a2 = post(base, "/api/lists/add", {"name": "Fresh", "emails": ["john@acme.example"]})
    assert a2["list"]["name"] == "Fresh" and a2["added"] == 1
    _, ls = get(base, "/api/lists")
    assert {x["name"] for x in ls["lists"]} == {"Q4", "Fresh"}
    status, err = post(base, "/api/lists/save", {"name": "q4"})
    assert status == 400
    _, rm = post(base, "/api/lists/remove", {"id": lid, "refs": ["ann@beta.example"]})
    assert rm["removed"] == 1
    post(base, "/api/people/bulk", {"emails": ["jane@acme.example"], "action": "tag",
                                    "value": "hot"})
    _, tg = get(base, "/api/tags")
    assert tg["tags"] == [{"tag": "hot", "count": 1}]
    _, rn = post(base, "/api/tags/rename", {"old": "hot", "new": "warm"})
    assert rn["count"] == 1
    _, n = post(base, "/api/notes/add", {"ref_type": "contact", "ref": "jane@acme.example",
                                         "body": "Prefers mornings"})
    _, n2 = post(base, "/api/notes/update", {"id": n["note"]["id"], "pinned": True})
    assert n2["note"]["pinned"] == 1
    _, tl = get(base, "/api/activity?ref_type=contact&ref=jane%40acme.example")
    assert tl["activity"][0]["kind"] == "note"
    _, feed = get(base, "/api/activity?limit=5")
    assert len(feed["activity"]) <= 5
    assert post(base, "/api/notes/delete", {"id": n["note"]["id"]})[1]["ok"]
    assert post(base, "/api/lists/delete", {"id": lid})[1]["ok"]


def test_tasks_and_deals(base):
    _, t = post(base, "/api/tasks/save", {"title": "Call Jane", "kind": "call",
                                          "contact": "jane@acme.example", "due": "today"})
    tid = t["task"]["id"]
    _, lst = get(base, "/api/tasks?bucket=today")
    assert lst["tasks"][0]["contact_name"] == "Jane Doe" and lst["counts"]["today"] == 1
    status, _ = get(base, "/api/tasks?bucket=someday")
    assert status == 400
    _, done = post(base, "/api/tasks/complete", {"id": tid})
    assert done["task"]["status"] == "done" and done["counts"]["done_today"] == 1
    assert post(base, "/api/tasks/reopen", {"id": tid})[1]["task"]["status"] == "open"
    _, upd = post(base, "/api/tasks/save", {"id": tid, "title": "Call Jane back"})
    assert upd["task"]["title"] == "Call Jane back"
    assert post(base, "/api/tasks/delete", {"id": tid})[1]["ok"]
    _, d = post(base, "/api/deals/save", {"name": "Acme pilot", "contact": "jane@acme.example",
                                          "amount": "12k"})
    did = d["deal"]["id"]
    assert d["deal"]["amount"] == 12000.0 and d["deal"]["account"] == "acme.example"
    _, mv = post(base, "/api/deals/move", {"id": did, "stage": "won"})
    assert mv["deal"]["stage"] == "won"
    _, board = get(base, "/api/deals")
    assert board["totals"]["won_value"] == 12000.0
    _, p = get(base, "/api/people/get?email=jane%40acme.example")
    assert p["contact"]["stage"] == "customer" and p["deals"][0]["name"] == "Acme pilot"
    status, _ = post(base, "/api/deals/move", {"id": did, "stage": "partying"})
    assert status == 400
    assert post(base, "/api/deals/delete", {"id": did})[1]["ok"]
