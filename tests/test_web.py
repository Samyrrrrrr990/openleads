"""
Web dashboard tests — boot the real stdlib server in-process and exercise the
API + static serving. Network is stubbed so these stay fast and deterministic.
"""
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from openleads.models import EmailResult, Lead
from openleads.web.server import Handler


@pytest.fixture(scope="module")
def server():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{port}"
    httpd.shutdown()
    httpd.server_close()


def _get(base, path):
    with urllib.request.urlopen(base + path, timeout=10) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def _post(base, path, body):
    req = urllib.request.Request(
        base + path, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, r.read()


def _stream(base, path, body):
    req = urllib.request.Request(
        base + path, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    events = []
    with urllib.request.urlopen(req, timeout=15) as r:
        for raw in r:
            line = raw.decode().strip()
            if line:
                events.append(json.loads(line))
    return events


# --- static -------------------------------------------------------------- #
def test_serves_index(server):
    status, ctype, body = _get(server, "/")
    assert status == 200
    assert "text/html" in ctype
    assert b"OpenLeads" in body


def test_serves_assets(server):
    for path, frag in (("/styles.css", "text/css"), ("/app.js", "javascript")):
        status, ctype, _ = _get(server, path)
        assert status == 200 and frag in ctype


def test_security_headers(server):
    with urllib.request.urlopen(server + "/", timeout=10) as r:
        assert "Content-Security-Policy" in r.headers
        assert r.headers.get("X-Content-Type-Options") == "nosniff"


def test_spa_fallback(server):
    status, ctype, body = _get(server, "/some/deep/route")
    assert status == 200 and "text/html" in ctype  # unknown path → index


def test_path_traversal_blocked(server):
    # must NOT escape the static dir; falls back to index instead of a system file
    status, ctype, body = _get(server, "/../../../../etc/hosts")
    assert status == 200 and "text/html" in ctype and b"OpenLeads" in body


# --- read API ------------------------------------------------------------ #
def test_state(server):
    status, _, body = _get(server, "/api/state")
    d = json.loads(body)
    assert status == 200
    assert d["version"] == "3.1.0"
    assert isinstance(d["sources"], list) and len(d["sources"]) >= 5
    assert "crm" in d and "settings" in d


def test_sources(server):
    _, _, body = _get(server, "/api/sources")
    names = {s["name"] for s in json.loads(body)["sources"]}
    assert {"yc", "github", "npi"} <= names


def test_providers(server):
    _, _, body = _get(server, "/api/providers")
    presets = json.loads(body)["presets"]
    assert "gmail" in presets and presets["gmail"]["host"]


def test_unknown_api_404(server):
    with pytest.raises(urllib.error.HTTPError) as e:
        _get(server, "/api/nope")
    assert e.value.code == 404


# --- write/settings (network-free) --------------------------------------- #
def test_settings_roundtrip(server):
    status, body = _post(server, "/api/settings", {"values": {"sender_name": "Ada L"}})
    r = json.loads(body)
    assert status == 200 and "sender_name" in r["applied"]
    # read back
    _, _, body = _get(server, "/api/settings")
    items = {s["key"]: s for s in json.loads(body)["settings"]}
    assert items["sender_name"]["value"] == "Ada L"


def test_write_drafts_template(server):
    lead = {"email": "ada@example.com", "first_name": "Ada", "organization": "Acme"}
    status, body = _post(server, "/api/write", {"leads": [lead]})
    r = json.loads(body)
    assert status == 200 and len(r["drafts"]) == 1
    assert r["drafts"][0]["subject"] and r["drafts"][0]["body"]


# --- streaming find (engine stubbed) ------------------------------------- #
def test_find_streams_leads(server, monkeypatch):
    def fake_build_leads(query, cache=None, db=None, on_progress=None):
        on_progress("phase", "searching…")
        leads = []
        for i, tier in enumerate(("safe", "risky")):
            ld = Lead(first_name=f"P{i}", email=f"p{i}@acme.io", organization="Acme",
                      tier=tier, score=90 - i, source="yc")
            leads.append(ld)
            on_progress("lead", ld)
        return leads

    monkeypatch.setattr("openleads.engine.build_leads", fake_build_leads)
    events = _stream(server, "/api/find", {"query": "founders", "count": 2})
    types = [e["type"] for e in events]
    assert "lead" in types and types[-1] == "done"
    done = events[-1]
    assert done["count"] == 2 and done["safe"] == 1 and done["risky"] == 1


# --- streaming send dry-run (no SMTP, no network) ------------------------ #
def test_send_dry_run_streams(server):
    draft = {"email": "ada@example.com", "subject": "Hi", "body": "Hello Ada,\n\nnote."}
    events = _stream(server, "/api/send", {"drafts": [draft], "live": False})
    types = [e["type"] for e in events]
    assert types[-1] == "done"
    done = events[-1]
    assert done["preview"] == 1 and done["live"] is False


def test_verify_resolver_used(server, monkeypatch):
    def fake_verify(email, cache=None, db=None, deep=False):
        return EmailResult(email=email, confidence="verified", score=88,
                           tier="safe", reasons=["stubbed"])
    monkeypatch.setattr("openleads.emails.resolve.verify_address", fake_verify)
    status, body = _post(server, "/api/verify", {"emails": ["ada@acme.io"]})
    r = json.loads(body)
    assert status == 200 and r["results"][0]["tier"] == "safe"
