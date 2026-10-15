"""
Company headcount buckets — "11-50", "201-500", "10001+" — from whatever a source says.

Sources report size as a number (YC ``team_size: 37``), a range ("51-200
employees"), a floor ("1,000+") or prose ("about 120 people"). Filtering needs one
vocabulary, so :func:`bucket` maps all of them onto the LinkedIn-style ranges most
CRMs already use.
"""
from __future__ import annotations

import re

# (key, lower bound, upper bound or None)
BUCKETS = (
    ("1-10", 1, 10),
    ("11-50", 11, 50),
    ("51-200", 51, 200),
    ("201-500", 201, 500),
    ("501-1000", 501, 1000),
    ("1001-5000", 1001, 5000),
    ("5001-10000", 5001, 10000),
    ("10001+", 10001, None),
)
BUCKET_KEYS = tuple(b[0] for b in BUCKETS)

_NUM = r"(\d[\d,.\s]*\d|\d)\s*(k|thousand|m|million)?"


def _to_int(num: str, unit: str | None) -> int | None:
    digits = re.sub(r"[,\s]", "", num or "")
    if not digits:
        return None
    try:
        value = float(digits)
    except ValueError:
        return None
    unit = (unit or "").lower()
    if unit in ("k", "thousand"):
        value *= 1000
    elif unit in ("m", "million"):
        value *= 1_000_000
    return int(value)


def parse_headcount(value) -> int | None:
    """A representative headcount for ``value`` (range midpoint, floor for "N+")."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value) if value > 0 else None
    text = str(value).strip().lower()
    if not text:
        return None
    m = re.search(_NUM + r"\s*(?:-|–|—|to)\s*" + _NUM, text)
    if m:
        lo, hi = _to_int(m.group(1), m.group(2)), _to_int(m.group(3), m.group(4))
        if lo and hi and hi >= lo:
            return (lo + hi) // 2
    m = re.search(_NUM, text)
    if not m:
        return None
    n = _to_int(m.group(1), m.group(2))
    return n if n and n > 0 else None


def bucket(value) -> str:
    """The headcount bucket key for ``value`` ('' when unknown)."""
    if isinstance(value, str) and value.strip() in BUCKET_KEYS:
        return value.strip()
    n = parse_headcount(value)
    if not n:
        return ""
    for key, lo, hi in BUCKETS:
        if n >= lo and (hi is None or n <= hi):
            return key
    return ""


def bucket_range(key: str) -> tuple:
    """``(lower, upper-or-None)`` for a bucket key, for range filters."""
    for k, lo, hi in BUCKETS:
        if k == key:
            return lo, hi
    return None, None
