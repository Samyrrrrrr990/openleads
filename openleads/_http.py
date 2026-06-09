"""
Tiny stdlib HTTP helpers shared by sources. Optionally dataset-cached.

Keeps every source free of urllib boilerplate while honoring the cache (so a
large dataset like the YC dump is fetched once per day, not per run).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

from openleads.config import USER_AGENT


def _open(url: str, headers: dict | None = None, timeout: int = 60) -> str:
    h = {"User-Agent": USER_AGENT}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def get_text(url: str, headers: dict | None = None, timeout: int = 60,
             cache=None, ttl_ns: str | None = None) -> str | None:
    """GET a URL as text. Returns None on any error. Cached under ``ttl_ns`` if given."""
    if cache and ttl_ns:
        hit = cache.get(ttl_ns, url)
        if hit is not None:
            return hit
    try:
        text = _open(url, headers, timeout)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError):
        return None
    if cache and ttl_ns:
        cache.set(ttl_ns, url, text)
    return text


def get_json(url: str, headers: dict | None = None, timeout: int = 60,
             cache=None, ttl_ns: str | None = None):
    """GET a URL and parse JSON. Returns None on any error. Cached under ``ttl_ns`` if given."""
    if cache and ttl_ns:
        hit = cache.get(ttl_ns, url)
        if hit is not None:
            return hit
    try:
        data = json.loads(_open(url, headers, timeout))
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError):
        return None
    if cache and ttl_ns:
        cache.set(ttl_ns, url, data)
    return data
