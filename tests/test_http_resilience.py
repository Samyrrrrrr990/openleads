"""_http: retries with backoff, validation, and the run deadline (all offline)."""
import socket
import time
import urllib.error

import pytest

from openleads import _concurrency, _http


def _err(code, headers=None):
    return urllib.error.HTTPError("https://x.example/", code, "err", headers or {}, None)


class _Script:
    """A fake ``_open`` that plays back a list of outcomes (exceptions or bodies)."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def __call__(self, url, headers=None, timeout=None, data=None):
        self.calls.append({"url": url, "timeout": timeout, "data": data})
        out = self.outcomes.pop(0) if self.outcomes else self.outcomes_last
        if isinstance(out, BaseException):
            raise out
        return out

    outcomes_last = "{}"


class _DictCache:
    def __init__(self):
        self.d = {}

    def get(self, ns, key, max_stale=0):
        return self.d.get((ns, key))

    def set(self, ns, key, value):
        self.d[(ns, key)] = value


@pytest.fixture()
def sleeps(monkeypatch):
    got = []
    monkeypatch.setattr(_http, "_sleep", got.append)
    monkeypatch.setattr(_http, "MAX_RETRIES", 2)
    return got


def test_transient_errors_are_retried_with_backoff(monkeypatch, sleeps):
    fake = _Script(_err(503), _err(503), '{"ok": 1}')
    monkeypatch.setattr(_http, "_open", fake)
    assert _http.get_json("https://api.example/x") == {"ok": 1}
    assert len(fake.calls) == 3
    assert len(sleeps) == 2
    assert 0.75 <= sleeps[0] <= 0.75 * 1.25 and 1.5 <= sleeps[1] <= 1.5 * 1.25


def test_jitter_is_deterministic_per_url():
    a = _http.retry_delay("https://a.example/", 0)
    assert a == _http.retry_delay("https://a.example/", 0)
    assert 0.75 <= a <= 0.9375


def test_gives_up_after_max_retries(monkeypatch, sleeps):
    fake = _Script(_err(429), _err(429), _err(429), "{}")
    monkeypatch.setattr(_http, "_open", fake)
    assert _http.get_json("https://api.example/y") is None
    assert len(fake.calls) == 3          # 1 + 2 retries
    assert "HTTP 429" in _http.recent_errors()[-1][1]


def test_404_is_not_retried(monkeypatch, sleeps):
    fake = _Script(_err(404), "{}")
    monkeypatch.setattr(_http, "_open", fake)
    assert _http.get_text("https://site.example/team") is None
    assert len(fake.calls) == 1 and sleeps == []


def test_network_refusal_is_not_retried(monkeypatch, sleeps):
    calls = []

    def refuse(url, *a, **kw):
        calls.append(url)
        raise urllib.error.URLError(f"network disabled in tests: {url}")
    monkeypatch.setattr(_http, "_open", refuse)
    assert _http.get_json("https://api.example/z") is None
    assert len(calls) == 1 and sleeps == []


def test_dns_failure_is_not_retried_but_timeouts_are(monkeypatch, sleeps):
    dns = _Script(urllib.error.URLError(socket.gaierror(-2, "Name or service not known")))
    monkeypatch.setattr(_http, "_open", dns)
    assert _http.get_text("https://nowhere.example/") is None
    assert len(dns.calls) == 1
    slow = _Script(socket.timeout("timed out"), urllib.error.URLError(socket.timeout("t")), "ok")
    monkeypatch.setattr(_http, "_open", slow)
    assert _http.get_text("https://slow.example/", validate=None) == "ok"
    assert len(slow.calls) == 3


def test_retry_after_is_honored_and_capped(monkeypatch, sleeps):
    fake = _Script(_err(429, {"Retry-After": "3"}), _err(503, {"Retry-After": "120"}), "{}")
    monkeypatch.setattr(_http, "_open", fake)
    assert _http.get_json("https://api.example/ra") == {}
    assert sleeps == [3.0, _http.RETRY_AFTER_CAP]


def test_posts_are_never_replayed(monkeypatch, sleeps):
    fake = _Script(_err(503), "ok")
    monkeypatch.setattr(_http, "_open", fake)
    assert _http.get_text("https://hook.example/", data=b"{}") is None
    assert len(fake.calls) == 1


def test_rejected_response_is_never_cached(monkeypatch, sleeps):
    monkeypatch.setattr(_http, "_open", _Script('{"remark": "runtime error: timeout"}'))
    cache = _DictCache()

    def check(d):
        return "overpass error" if "error" in str(d.get("remark", "")) else None
    assert _http.get_json("https://op.example/q", cache=cache, ttl_ns="dataset",
                          validate=check) is None
    assert cache.d == {}
    assert _http.recent_errors()[-1][1] == "rejected: overpass error"
    # A good response is cached as before.
    monkeypatch.setattr(_http, "_open", _Script('{"elements": []}'))
    assert _http.get_json("https://op.example/q", cache=cache, ttl_ns="dataset",
                          validate=check) == {"elements": []}
    assert cache.d == {("dataset", "https://op.example/q"): {"elements": []}}


def test_bot_challenge_pages_are_rejected_by_default(monkeypatch, sleeps):
    cf = "<html><head><title>Just a moment...</title><script src='/cdn-cgi/cf-chl'></script>"
    monkeypatch.setattr(_http, "_open", _Script(cf))
    cache = _DictCache()
    assert _http.get_text("https://shop.example/", cache=cache, ttl_ns="dataset") is None
    assert cache.d == {}
    # A real page that loads a CAPTCHA widget for its contact form is fine.
    real = ("<html><head><title>Contact us</title>"
            "<script src='https://www.google.com/recaptcha/api.js'></script></head>"
            + "<p>Write to hello@shop.example</p>" * 800 + "</html>")
    monkeypatch.setattr(_http, "_open", _Script(real))
    assert _http.get_text("https://shop.example/contact") == real
    assert _http.looks_like_challenge("<title>Verify you are human: CAPTCHA</title>")


# --- the run deadline ---------------------------------------------------------- #
def test_timeout_is_clamped_to_the_deadline(monkeypatch, sleeps):
    fake = _Script("ok")
    monkeypatch.setattr(_http, "_open", fake)
    with _concurrency.deadline(2):
        _http.get_text("https://a.example/", timeout=25, validate=None)
    assert 0.5 <= fake.calls[0]["timeout"] <= 2


def test_no_request_starts_after_the_deadline(monkeypatch, sleeps):
    fake = _Script("ok")
    monkeypatch.setattr(_http, "_open", fake)
    with _concurrency.deadline(0.01):
        time.sleep(0.02)
        assert _http.get_text("https://late.example/") is None
        with pytest.raises(_concurrency.BudgetExhausted):
            _http.request("https://late.example/")
    assert fake.calls == []
    assert "time budget" in _http.recent_errors()[-1][1]


def test_never_sleeps_past_the_deadline(monkeypatch, sleeps):
    fake = _Script(_err(503), "ok")
    monkeypatch.setattr(_http, "_open", fake)
    with _concurrency.deadline(1):
        assert _http.get_text("https://busy.example/") is None   # 0.75s+ wait won't fit
    assert sleeps == [] and len(fake.calls) == 1


def test_nested_deadline_never_extends_the_outer_one():
    with _concurrency.deadline(1):
        with _concurrency.deadline(100):
            assert _concurrency.remaining() <= 1
        with _concurrency.deadline(0):
            assert _concurrency.remaining() <= 1
    assert _concurrency.remaining() == float("inf")


# --- one seam: DoH and Gravatar use it too ------------------------------------- #
def test_mx_and_gravatar_go_through_the_http_seam(monkeypatch, sleeps):
    from openleads.emails import gravatar, mx
    seen = []

    def fake(url, headers=None, timeout=None, data=None):
        seen.append(url)
        if "gravatar" in url:
            raise _err(404)
        return '{"Status": 0, "Answer": [{"type": 15, "data": "10 mx.acme.example."}]}'
    monkeypatch.setattr(_http, "_open", fake)
    assert mx.lookup("acme.example")["hosts"] == ["mx.acme.example"]
    assert gravatar.has_gravatar("ada@acme.example") is False
    assert any("dns.google" in u for u in seen) and any("gravatar" in u for u in seen)
