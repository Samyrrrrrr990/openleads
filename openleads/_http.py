"""
Tiny stdlib HTTP helpers shared by sources. Optionally dataset-cached.

Keeps every source free of urllib boilerplate while honoring the cache (so a
large dataset like the YC dump is fetched once per day, not per run).

v3.1: shorter default timeout (no more multi-minute silent waits) and a small
ring buffer of recent failures so the engine/CLI can *surface* why a source
returned nothing instead of failing silently.
"""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from collections import deque

from openleads.config import USER_AGENT

# Fast by default: a dead/slow endpoint should fail in seconds, not minutes.
DEFAULT_TIMEOUT = 15

_errors: deque = deque(maxlen=40)
_lock = threading.Lock()


def _record(url: str, reason: str) -> None:
    with _lock:
        _errors.append((url, reason))


def recent_errors() -> list:
    """The most recent request failures (url, reason) — for surfacing to users."""
    with _lock:
        return list(_errors)


def clear_errors() -> None:
    with _lock:
        _errors.clear()


def _open(url: str, headers: dict | None = None, timeout: int = DEFAULT_TIMEOUT,
          data: bytes | None = None) -> str:
    h = {"User-Agent": USER_AGENT}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h, data=data,
                                 method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def _reason(e: Exception) -> str:
    if isinstance(e, urllib.error.HTTPError):
        code = e.code
        hint = {403: "rate-limited or forbidden", 404: "not found",
                429: "rate-limited", 406: "rejected", 503: "service unavailable"}.get(code, "")
        return f"HTTP {code}" + (f" ({hint})" if hint else "")
    if isinstance(e, urllib.error.URLError):
        return f"network error: {getattr(e, 'reason', e)}"
    return f"{type(e).__name__}: {e}"


def get_text(url: str, headers: dict | None = None, timeout: int = DEFAULT_TIMEOUT,
             cache=None, ttl_ns: str | None = None, data: bytes | None = None) -> str | None:
    """GET a URL as text. Returns None on any error (recorded). Cached under ``ttl_ns``."""
    if cache and ttl_ns and data is None:
        hit = cache.get(ttl_ns, url)
        if hit is not None:
            return hit
    try:
        text = _open(url, headers, timeout, data=data)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError) as e:
        _record(url, _reason(e))
        return None
    if cache and ttl_ns and data is None:
        cache.set(ttl_ns, url, text)
    return text


def get_json(url: str, headers: dict | None = None, timeout: int = DEFAULT_TIMEOUT,
             cache=None, ttl_ns: str | None = None, data: bytes | None = None):
    """GET/POST a URL and parse JSON. Returns None on any error (recorded)."""
    if cache and ttl_ns and data is None:
        hit = cache.get(ttl_ns, url)
        if hit is not None:
            return hit
    try:
        raw = _open(url, headers, timeout, data=data)
        result = json.loads(raw)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError) as e:
        _record(url, _reason(e))
        return None
    if cache and ttl_ns and data is None:
        cache.set(ttl_ns, url, result)
    return result
