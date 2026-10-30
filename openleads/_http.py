"""
Tiny stdlib HTTP helpers shared by sources. Optionally dataset-cached.

Keeps every source free of urllib boilerplate while honoring the cache (so a
large dataset like the YC dump is fetched once per day, not per run).

v3.1: shorter default timeout (no more multi-minute silent waits) and a small
ring buffer of recent failures so the engine/CLI can *surface* why a source
returned nothing instead of failing silently.

v5.1 makes every call **resilient and budget-aware**:

* transient failures (HTTP 429/502/503/504, timeouts, dropped connections) are
  retried with a short, deterministic backoff that honors ``Retry-After`` — other
  4xx, DNS and TLS errors are not (retrying them only burns the budget);
* each attempt's timeout is clamped to what is left of the run's deadline
  (:mod:`openleads._concurrency`), and no request starts after it;
* a ``validate`` hook rejects responses that parsed fine but are useless (an
  Overpass error remark, a bot-challenge page) so they are never cached.

:func:`_open` is the single network seam: the tests replace it, and :func:`request`
(retry + deadline) is what every other module calls.
"""
from __future__ import annotations

import contextvars
import email.utils
import http.client
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request
import zlib
from collections import deque
from contextlib import contextmanager

from openleads import _concurrency, runreport
from openleads._concurrency import BudgetExhausted
from openleads.config import USER_AGENT

# Fast by default: a dead/slow endpoint should fail in seconds, not minutes.
DEFAULT_TIMEOUT = 15
# Statuses that mean "try again shortly" rather than "this will never work".
RETRY_STATUSES = frozenset({429, 502, 503, 504})
# Backoff before retry 1, 2, … (seconds), plus 0–25% deterministic jitter per URL.
BACKOFF = (0.75, 1.5)
RETRY_AFTER_CAP = 8.0
# Never hand urllib a timeout shorter than this (it would just fail spuriously).
MIN_TIMEOUT = 0.5


def _env_int(name: str, default: int, lo: int = 0, hi: int = 5) -> int:
    try:
        return max(lo, min(hi, int(os.environ.get(name, default))))
    except (TypeError, ValueError):
        return default


# Retries per request after the first attempt (OPENLEADS_HTTP_RETRIES, 0–5).
MAX_RETRIES = _env_int("OPENLEADS_HTTP_RETRIES", 2)

# Patchable so tests (and callers) never actually sleep.
_sleep = time.sleep

_errors: deque = deque(maxlen=40)
_lock = threading.Lock()

# Everything a request can raise that means "this fetch failed" (never a bug).
FETCH_ERRORS = (urllib.error.URLError, OSError, ValueError, http.client.HTTPException)


def _record(url: str, reason: str, exc: BaseException | None = None) -> None:
    """Remember a failed request (ring buffer) and report it to the current run."""
    with _lock:
        _errors.append((url, reason))
    if isinstance(exc, BudgetExhausted):
        # Not an error. Only the run's own deadline counts as "ran out of time";
        # a step's shorter window closing (e.g. the Overpass slice) does not.
        if _concurrency.run_out():
            runreport.deadline_hit()
    else:
        runreport.http_error(url, reason)


def recent_errors() -> list:
    """The most recent request failures (url, reason) — for surfacing to users."""
    with _lock:
        return list(_errors)


def clear_errors() -> None:
    with _lock:
        _errors.clear()


def _open(url: str, headers: dict | None = None, timeout: float = DEFAULT_TIMEOUT,
          data: bytes | None = None) -> str:
    """The raw transport: one HTTP attempt, body decoded as text. Raises on failure."""
    h = {"User-Agent": USER_AGENT}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h, data=data,
                                 method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def _reason(e: Exception) -> str:
    if isinstance(e, BudgetExhausted):
        return "skipped: time budget reached"
    if isinstance(e, urllib.error.HTTPError):
        code = e.code
        hint = {403: "rate-limited or forbidden", 404: "not found",
                429: "rate-limited", 406: "rejected", 503: "service unavailable",
                504: "gateway timeout"}.get(code, "")
        return f"HTTP {code}" + (f" ({hint})" if hint else "")
    if isinstance(e, urllib.error.URLError):
        return f"network error: {getattr(e, 'reason', e)}"
    if isinstance(e, (socket.timeout, TimeoutError)):
        return "timed out"
    return f"{type(e).__name__}: {e}"


def is_transient(e: Exception) -> bool:
    """True for failures worth retrying: 429/502/503/504, timeouts, dropped connections.

    DNS failures, TLS errors, other 4xx and refusals (like the test suite's network
    block) are permanent for the length of a run, so they are never retried.
    """
    if isinstance(e, BudgetExhausted):
        return False
    if isinstance(e, urllib.error.HTTPError):
        return e.code in RETRY_STATUSES
    if isinstance(e, urllib.error.URLError):
        e = e.reason if isinstance(e.reason, BaseException) else None
        if e is None:
            return False
    return isinstance(e, (socket.timeout, TimeoutError, ConnectionResetError,
                          ConnectionAbortedError, http.client.RemoteDisconnected))


def _retry_after(e: Exception):
    """Seconds from a ``Retry-After`` header (delta or HTTP date), or None."""
    hdrs = getattr(e, "headers", None) or getattr(e, "hdrs", None)
    raw = None
    try:
        raw = hdrs.get("Retry-After") if hdrs is not None else None
    except Exception:  # noqa: BLE001 — odd header containers
        raw = None
    if not raw:
        return None
    raw = str(raw).strip()
    if raw.isdigit():
        return float(raw)
    try:
        when = email.utils.parsedate_to_datetime(raw)
        return max(0.0, when.timestamp() - time.time())
    except (TypeError, ValueError, IndexError, OverflowError):
        return None


def retry_delay(url: str, attempt: int, e: Exception | None = None) -> float:
    """Backoff before retry ``attempt`` (0-based): 0.75s, 1.5s, … + 0–25% jitter.

    The jitter is derived from the URL (crc32), so it spreads concurrent retries
    without making runs nondeterministic. A ``Retry-After`` header wins (≤8s).
    """
    ra = _retry_after(e) if e is not None else None
    if ra is not None:
        return min(RETRY_AFTER_CAP, ra)
    base = BACKOFF[min(attempt, len(BACKOFF) - 1)] * (2 ** max(0, attempt - len(BACKOFF) + 1))
    jitter = (zlib.crc32(url.encode("utf-8", "ignore")) % 1000) / 1000.0 * 0.25
    return round(base * (1.0 + jitter), 3)


def request(url: str, headers: dict | None = None, timeout: float = DEFAULT_TIMEOUT,
            data: bytes | None = None, retries: int | None = None) -> str:
    """Fetch ``url`` as text with retries and the run deadline. Raises on failure.

    * Each attempt's timeout is ``min(timeout, time left)`` (never under 0.5s);
      after the deadline it raises :class:`BudgetExhausted` without connecting.
    * Transient failures (:func:`is_transient`) are retried up to ``retries``
      times (default ``MAX_RETRIES``), never sleeping past the deadline.
    * POSTs are never replayed (a webhook may have acted on the first one).
    """
    tries = MAX_RETRIES if retries is None else max(0, int(retries))
    if data is not None:
        tries = 0
    attempt = 0
    while True:
        left = _concurrency.remaining()
        if left <= 0:
            raise BudgetExhausted(f"time budget reached before fetching {url}")
        t = max(MIN_TIMEOUT, min(float(timeout), left))
        try:
            return _open(url, headers, t, data=data)
        except FETCH_ERRORS as e:
            if attempt >= tries or not is_transient(e):
                raise
            delay = retry_delay(url, attempt, e)
            if delay >= _concurrency.remaining() - MIN_TIMEOUT:
                raise            # waiting would blow the budget; report this failure
            _sleep(delay)
            attempt += 1


# --- validators ------------------------------------------------------------- #
def looks_like_challenge(text: str) -> str | None:
    """Reason string if ``text`` is a bot-challenge interstitial, else None.

    Cloudflare's "Just a moment…" / ``cf-chl`` pages and small CAPTCHA walls parse
    as HTML but contain nothing about the business; caching one would hide the
    real page for a day. A normal page that merely loads a CAPTCHA widget on its
    contact form is large, so the CAPTCHA check only fires on small pages or when
    the page title itself is the challenge.
    """
    head = (text or "")[:2048].lower()
    if "cf-chl" in head or "<title>just a moment" in head:
        return "bot-challenge page"
    if "captcha" in head:
        title = head.split("<title", 1)[1].split("</title>", 1)[0] if "<title" in head else ""
        if "captcha" in title or "robot" in title or len(text) < 16384:
            return "captcha page"
    return None


_DEFAULT = object()     # "use the default validator for this call"


def _stale(cache, ttl_ns, url):
    """A recently expired cached value to fall back on when the live fetch failed."""
    if cache is None or not ttl_ns or ttl_ns not in STALE_NAMESPACES:
        return None
    try:
        value = cache.get(ttl_ns, url, max_stale=STALE_SECONDS)
    except TypeError:       # a cache without stale support
        return None
    if value is not None:
        runreport.fallback("stale cache")
    return value


# Namespaces whose expired rows are still worth serving when the source is down.
STALE_NAMESPACES = ("dataset", "geo")
STALE_SECONDS = 7 * 86400


# Run-scoped memo of URLs that failed *permanently* in this run (404, DNS, TLS…),
# so the next caller in the same run (another person at the same domain) doesn't
# fetch a dead page again. Transient failures are not memoized.
_DEAD: contextvars.ContextVar = contextvars.ContextVar("openleads_http_dead", default=None)


@contextmanager
def run_scope():
    """Scope one search run: within it, a permanently failed URL is fetched once."""
    token = _DEAD.set((threading.Lock(), set()))
    try:
        yield
    finally:
        _DEAD.reset(token)


def _dead(url: str, add: bool = False) -> bool:
    memo = _DEAD.get()
    if memo is None:
        return False
    lock, urls = memo
    with lock:
        if add:
            urls.add(url)
            return True
        return url in urls


def _fetch(url, headers, timeout, cache, ttl_ns, data, validate, retries, parse):
    use_cache = cache is not None and bool(ttl_ns) and data is None
    if use_cache:
        hit = cache.get(ttl_ns, url)
        if hit is not None:
            return hit
    if data is None and _dead(url):
        return _stale(cache, ttl_ns, url) if use_cache else None
    try:
        value = parse(request(url, headers, timeout, data=data, retries=retries))
    except FETCH_ERRORS as e:
        _record(url, _reason(e), e)
        if data is None and not is_transient(e) and not isinstance(e, BudgetExhausted):
            _dead(url, add=True)
        return _stale(cache, ttl_ns, url) if use_cache else None
    reason = validate(value) if validate else None
    if reason:
        _record(url, f"rejected: {reason}")
        return _stale(cache, ttl_ns, url) if use_cache else None
    if use_cache:
        cache.set(ttl_ns, url, value)
    return value


def get_text(url: str, headers: dict | None = None, timeout: float = DEFAULT_TIMEOUT,
             cache=None, ttl_ns: str | None = None, data: bytes | None = None,
             validate=_DEFAULT, retries: int | None = None) -> str | None:
    """GET a URL as text. Returns None on any error (recorded). Cached under ``ttl_ns``.

    ``validate(text)`` may return a reason string to reject the response (recorded
    as ``rejected: <reason>``, never cached). GETs default to rejecting bot-challenge
    pages; pass ``validate=None`` to accept anything.
    """
    if validate is _DEFAULT:
        validate = looks_like_challenge if data is None else None
    return _fetch(url, headers, timeout, cache, ttl_ns, data, validate, retries,
                  lambda raw: raw)


def get_json(url: str, headers: dict | None = None, timeout: float = DEFAULT_TIMEOUT,
             cache=None, ttl_ns: str | None = None, data: bytes | None = None,
             validate=None, retries: int | None = None):
    """GET/POST a URL and parse JSON. Returns None on any error (recorded).

    ``validate(parsed)`` may return a reason string to reject the response.
    """
    return _fetch(url, headers, timeout, cache, ttl_ns, data, validate, retries, json.loads)
