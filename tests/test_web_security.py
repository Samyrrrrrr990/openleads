"""The dashboard refuses cross-site, DNS-rebinding and non-JSON requests."""
import http.client
import json
import threading
from http.server import ThreadingHTTPServer

import pytest

from openleads.web import server as srv


@pytest.fixture(scope="module")
def port():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), srv.Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


def _req(port, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    h = {"Host": f"127.0.0.1:{port}"}
    h.update(headers or {})
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    conn.request(method, path, body=data, headers=h)
    r = conn.getresponse()
    out = r.status, dict(r.getheaders()), r.read()
    conn.close()
    return out


def test_same_origin_json_post_is_allowed(port):
    status, _, body = _req(port, "POST", "/api/settings", {"values": {}},
                           {"Content-Type": "application/json",
                            "Origin": f"http://127.0.0.1:{port}",
                            "Sec-Fetch-Site": "same-origin"})
    assert status == 200 and "applied" in json.loads(body)


def test_text_plain_post_is_refused(port):
    # The classic CSRF shape: a "simple" cross-site form/fetch with text/plain.
    status, _, body = _req(port, "POST", "/api/export",
                           json.dumps({"sink": "webhook", "target": "https://evil.example"}).encode(),
                           {"Content-Type": "text/plain"})
    assert status == 415 and b"JSON" in body


def test_cross_site_origin_is_refused(port):
    status, _, _ = _req(port, "POST", "/api/settings", {"values": {}},
                        {"Content-Type": "application/json", "Origin": "https://evil.example"})
    assert status == 403
    status, _, _ = _req(port, "POST", "/api/settings", {"values": {}},
                        {"Content-Type": "application/json", "Origin": "null"})
    assert status == 403


def test_sec_fetch_site_cross_site_is_refused_even_for_get(port):
    status, _, _ = _req(port, "GET", "/api/state", headers={"Sec-Fetch-Site": "cross-site"})
    assert status == 403


def test_dns_rebinding_host_is_refused(port):
    status, _, body = _req(port, "GET", "/api/state", headers={"Host": f"evil.example:{port}"})
    assert status == 403 and b"host not allowed" in body


def test_localhost_and_extra_allowed_hosts(port, monkeypatch):
    status, _, _ = _req(port, "GET", "/api/sources", headers={"Host": f"localhost:{port}"})
    assert status == 200
    monkeypatch.setenv("OPENLEADS_ALLOWED_HOSTS", "leads.home.arpa")
    status, _, _ = _req(port, "GET", "/api/sources", headers={"Host": "leads.home.arpa"})
    assert status == 200


def test_oversized_and_malformed_bodies(port):
    status, _, _ = _req(port, "POST", "/api/settings", b"{",
                        {"Content-Type": "application/json"})
    assert status == 400
    status, _, _ = _req(port, "POST", "/api/settings", b"[1,2]",
                        {"Content-Type": "application/json"})
    assert status == 400
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.putrequest("POST", "/api/settings", skip_host=True)
    conn.putheader("Host", f"127.0.0.1:{port}")
    conn.putheader("Content-Type", "application/json")
    conn.putheader("Content-Length", str(srv.MAX_BODY + 1))
    conn.endheaders()
    r = conn.getresponse()
    assert r.status == 413
    conn.close()


def test_hardening_headers(port):
    _, headers, _ = _req(port, "GET", "/")
    assert headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]


def test_get_handlers_receive_query_params(port):
    status, _, body = _req(port, "GET", "/api/crm?limit=3")
    assert status == 200 and "overview" in json.loads(body)


def test_host_parsing():
    assert srv.host_name("127.0.0.1:8787") == "127.0.0.1"
    assert srv.host_name("[::1]:8787") == "[::1]"
    assert srv.host_name("LOCALHOST") == "localhost"
    assert srv.is_same_origin("http://127.0.0.1:8787", "127.0.0.1:8787")
    assert not srv.is_same_origin("http://127.0.0.1:9999", "127.0.0.1:8787")
