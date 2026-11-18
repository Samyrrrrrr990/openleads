"""Studio sites: storing projects, serving rendered pages at /s/<slug>/, {{site_url}}."""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from openleads import sites


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    monkeypatch.delenv("OPENLEADS_SITE_BASE_URL", raising=False)
    monkeypatch.delenv("NETLIFY_AUTH_TOKEN", raising=False)
    from openleads.db import DB
    d = DB()
    yield d
    d.close()


def _project(pid="site_abc123", name="Northwind Dental"):
    return {"id": pid, "name": name, "pages": [{"id": "p1"}, {"id": "p2"}],
            "nodes": {"a": {}, "b": {}, "c": {}}}


HTML = {"/": "<!doctype html><title>Home</title><h1>Hi</h1>",
        "/about": "<!doctype html><title>About</title>"}


def test_save_creates_then_updates(db):
    out = sites.save(db, _project(), "starter-1", "", HTML)
    assert out["slug"] == "northwind-dental"
    assert out["page_count"] == 2 and out["node_count"] == 3
    assert out["preview"] == "/s/northwind-dental/"
    assert out["url"] == ""                       # no host set, not published
    again = sites.save(db, _project(name="Renamed"), None, "", None)
    assert again["slug"] == "northwind-dental"    # the link never moves
    assert again["name"] == "Renamed"
    assert again["starter_id"] == "starter-1"     # kept when not resent
    row = sites.by_slug(db, "northwind-dental")
    assert sites.page_html(row, "/about").startswith("<!doctype")   # html kept too


def test_slugs_are_unique(db):
    a = sites.save(db, _project("site_aaaa"), None, "", HTML)
    b = sites.save(db, _project("site_bbbb"), None, "", HTML)
    assert a["slug"] != b["slug"] and b["slug"].startswith("northwind-dental")


def test_save_rejects_bad_input(db):
    with pytest.raises(ValueError):
        sites.save(db, "nope")
    with pytest.raises(ValueError):
        sites.save(db, {"id": "../x", "name": "x"})


def test_html_routes_are_cleaned(db):
    sites.save(db, _project(), None, "", {"/": "ok", "../../etc": "bad", "/a b": "bad",
                                          "/ok/page": "fine", "/x": 5})
    pages = json.loads(sites.by_slug(db, "northwind-dental")["html"])
    assert set(pages) == {"/", "/ok/page"}


def test_site_url_for_a_lead(db, monkeypatch):
    sites.save(db, _project(), None, "Owner@Northwind.example", HTML)
    assert sites.url_for_email("owner@northwind.example", db) == ""
    monkeypatch.setenv("OPENLEADS_SITE_BASE_URL", "https://demos.example.com/")
    assert sites.url_for_email("owner@northwind.example", db) == \
        "https://demos.example.com/northwind-dental/"
    assert [s["id"] for s in sites.list_sites(db, "OWNER@northwind.example")] == ["site_abc123"]


def test_site_url_in_a_template(db, monkeypatch):
    monkeypatch.setenv("OPENLEADS_SITE_BASE_URL", "https://demos.example.com")
    sites.save(db, _project(), None, "owner@northwind.example", HTML)
    from openleads.workspace import templates
    draft, missing = templates.render_draft("A new site", "Here it is: {{site_url}}",
                                            {"email": "owner@northwind.example", "name": "Ann"})
    assert "https://demos.example.com/northwind-dental/" in draft.body
    assert "site_url" not in missing


def test_rename_link_delete(db):
    sites.save(db, _project(), None, "", HTML)
    assert sites.rename(db, "site_abc123", "  New name ")["name"] == "New name"
    assert json.loads(sites.by_slug(db, "northwind-dental")["data"])["name"] == "New name"
    with pytest.raises(ValueError):
        sites.rename(db, "site_abc123", " ")
    assert sites.link_lead(db, "site_abc123", "A@B.co")["lead_email"] == "a@b.co"
    with pytest.raises(ValueError):
        sites.link_lead(db, "site_nope", "a@b.co")
    assert sites.delete(db, "site_abc123") is True
    assert sites.delete(db, "site_abc123") is False


def _lead(db, email="owner@northwind.example"):
    db.upsert_lead({"email": email, "first_name": "Ann", "name": "Ann Lee",
                    "organization": "Northwind Dental", "city": "Toronto", "tier": "safe"})


def test_log_keeps_the_newest_lines(db):
    sites.save(db, _project(), None, "", HTML)
    sites.add_log(db, "site_abc123", [{"text": "Built", "kind": "build"}, {"text": " "}])
    assert [x["text"] for x in sites.get(db, "site_abc123")["log"]] == ["Built"]
    sites.add_log(db, "site_abc123", [{"text": f"line {i}"} for i in range(200)])
    log = sites.get(db, "site_abc123")["log"]
    assert len(log) == sites.LOG_MAX and log[-1]["text"] == "line 199"
    with pytest.raises(ValueError):
        sites.add_log(db, "site_nope", [{"text": "x"}])


def test_email_offers_the_site(db, monkeypatch):
    monkeypatch.setenv("OPENLEADS_SENDER_NAME", "Sam")
    _lead(db)
    sites.save(db, _project(), None, "owner@northwind.example", HTML)
    out = sites.email_for(db, "site_abc123")
    assert out["to"] == "owner@northwind.example"
    assert out["subject"] == "A new website for Northwind Dental"
    assert out["body"].startswith("Hi Ann,") and "{{site_url}}" in out["body"]
    assert "in Toronto" in out["body"]
    assert out["can_publish"] is False


@pytest.fixture()
def fake_send(monkeypatch):
    from openleads.models import SendResult
    calls = []

    def send(drafts_, dry_run=True, db=None, campaign="", step=1, **kw):
        calls.append((drafts_[0], campaign, step))
        for d in drafts_:
            db.record_touch(d.email, "sent", subject=d.subject, campaign=campaign, step=step)
        return [SendResult(d.email, "sent", message_id="<m>") for d in drafts_]
    monkeypatch.setattr("openleads.outreach.sender.send_drafts", send)
    return calls


def test_send_needs_a_link_when_the_email_uses_one(db, fake_send):
    _lead(db)
    sites.save(db, _project(), None, "owner@northwind.example", HTML)
    with pytest.raises(ValueError, match="public link"):
        sites.send(db, "site_abc123", "Hi", "See {{site_url}}")
    assert fake_send == []


def test_send_publishes_then_sends_the_link(db, fake_send, monkeypatch):
    monkeypatch.setenv("OPENLEADS_SITE_BASE_URL", "https://demos.example.com")
    _lead(db)
    sites.save(db, _project(), None, "owner@northwind.example", HTML)
    out = sites.send(db, "site_abc123", "A site for you", "Here: {{site_url}}")
    assert out["status"] == "sent"
    [(draft, campaign, step)] = fake_send
    assert draft.body == "Here: https://demos.example.com/northwind-dental/"
    assert (campaign, step) == ("sites", 1)
    assert sites.get(db, "site_abc123")["sent"]["to"] == "owner@northwind.example"
    # a second email to the same person is a follow-up
    sites.send(db, "site_abc123", "Again", "Still here: {{site_url}}")
    assert fake_send[1][2] == 2


def test_send_refuses_a_site_with_no_lead(db, fake_send):
    sites.save(db, _project(), None, "", HTML)
    with pytest.raises(ValueError, match="isn't for a lead"):
        sites.send(db, "site_abc123", "Hi", "There")


def test_model_endpoint_waits_for_a_chosen_model(db, monkeypatch):
    from openleads.web import sites_api
    monkeypatch.setenv("OPENLEADS_AI_PROVIDER", "auto")
    out = sites_api.POST["/api/sites/ai"]({"system": "s", "user": "u"})
    assert out["ok"] is False and out["code"] == "no_model"
    with pytest.raises(ValueError):
        sites_api.POST["/api/sites/ai"]({"system": "", "user": "u"})


def test_model_endpoint_returns_the_reply(db, monkeypatch):
    from openleads import ai
    from openleads.web import sites_api
    seen = {}
    monkeypatch.setattr(ai, "chosen", lambda: ai.Model(provider="anthropic", model="m", api_key="k"))

    def chat(messages, model, **kw):
        seen.update(kw)
        return '[{"type":"SET_TEXT","nodeId":"a","text":"x"}]'
    monkeypatch.setattr(ai, "chat", chat)
    out = sites_api.POST["/api/sites/ai"]({"system": "s", "user": "u"})
    assert out["ok"] is True and out["text"].startswith("[")
    assert seen["untrusted"] is True     # lead details are other people's words


def test_publish_without_token_writes_a_folder(db, tmp_path):
    sites.save(db, _project(), None, "", HTML)
    out = sites.publish(db, "site_abc123")
    assert out["deployed"] is False
    folder = tmp_path / "sites" / "northwind-dental"
    assert out["folder"] == str(folder)
    assert (folder / "index.html").read_text().startswith("<!doctype")
    assert (folder / "about" / "index.html").is_file()


def test_publish_needs_rendered_pages(db):
    sites.save(db, _project(), None, "", None)
    with pytest.raises(ValueError):
        sites.publish(db, "site_abc123")


# --- over HTTP ------------------------------------------------------------ #
@pytest.fixture()
def server(db):
    from openleads.web.server import Handler
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def _post(base, path, body):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def test_api_save_list_and_serve(server):
    saved = _post(server, "/api/sites/save", {"project": _project(), "html": HTML})
    assert saved["slug"] == "northwind-dental"
    with urllib.request.urlopen(server + "/api/sites", timeout=10) as r:
        listed = json.loads(r.read())
    assert [s["id"] for s in listed["sites"]] == ["site_abc123"]
    for path, frag in (("/s/northwind-dental/", b"<h1>Hi</h1>"),
                       ("/s/northwind-dental/index.html", b"<h1>Hi</h1>"),
                       ("/s/northwind-dental/about/", b"About")):
        with urllib.request.urlopen(server + path, timeout=10) as r:
            assert frag in r.read()
            assert r.headers["X-Frame-Options"] == "SAMEORIGIN"
            assert "script-src 'self'" in r.headers["Content-Security-Policy"]
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(server + "/s/nobody-here/", timeout=10)
    assert e.value.code == 404
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(server + "/s/northwind-dental/missing", timeout=10)
    assert e.value.code == 404


def test_api_get_returns_the_project(server):
    _post(server, "/api/sites/save", {"project": _project()})
    with urllib.request.urlopen(server + "/api/sites/get?id=site_abc123", timeout=10) as r:
        site = json.loads(r.read())
    assert site["project"]["name"] == "Northwind Dental"
