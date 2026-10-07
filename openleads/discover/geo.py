"""
Place name → geography, via OpenStreetMap's free, keyless Nominatim service.

The local-business source needs to turn "Miami", "Austin, TX" or "Berlin" into a
bounding box it can hand to Overpass. Nominatim does exactly that at $0 with no
key (we just send a polite User-Agent and cache aggressively, per their usage
policy). ``bbox_from_result`` is pure so it unit-tests without the network.
"""
from __future__ import annotations

import threading
import time
import urllib.parse
from typing import NamedTuple

from openleads._http import get_json

NOMINATIM = "https://nominatim.openstreetmap.org/search"
# Nominatim's usage policy asks for an identifying User-Agent with contact info.
_UA = {"User-Agent": "openleads/4.5 (+https://github.com/Samyrrrrrr990/openleads)"}


class BBox(NamedTuple):
    """A geographic bounding box: south, west, north, east (decimal degrees)."""

    south: float
    west: float
    north: float
    east: float

    def as_overpass(self) -> str:
        """Render as Overpass' ``(south,west,north,east)`` bbox filter clause."""
        return f"({self.south},{self.west},{self.north},{self.east})"

    @property
    def display_name(self) -> str:  # set by resolve_place; harmless default
        return getattr(self, "_display", "")


def bbox_from_result(result: dict) -> BBox | None:
    """Turn one Nominatim result into a :class:`BBox` (pure / network-free).

    Nominatim's ``boundingbox`` is ``[south, north, west, east]`` as strings.
    """
    bb = (result or {}).get("boundingbox")
    if not bb or len(bb) != 4:
        return None
    try:
        south, north, west, east = (float(x) for x in bb)
    except (TypeError, ValueError):
        return None
    return BBox(south=south, west=west, north=north, east=east)


def resolve_place(place: str, cache=None) -> BBox | None:
    """Resolve a free-text place to a bounding box, or None if not found/parse-able."""
    place = (place or "").strip()
    if not place:
        return None
    params = urllib.parse.urlencode(
        {"q": place, "format": "jsonv2", "limit": "1", "addressdetails": "0"}
    )
    data = get_json(f"{NOMINATIM}?{params}", headers=_UA, cache=cache, ttl_ns="dataset")
    if not isinstance(data, list) or not data:
        return None
    return bbox_from_result(data[0])


# Nominatim's usage policy: at most one request per second.
_last_call = [0.0]
_throttle_lock = threading.Lock()


def _throttle() -> None:
    with _throttle_lock:
        wait = 1.1 - (time.monotonic() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.monotonic()


def search_pois(key: str, value: str, place: str, cache=None, limit: int = 50) -> list[dict]:
    """Find businesses tagged ``key=value`` in ``place`` via Nominatim.

    Returns Overpass-shaped elements (``{"id", "tags"}``) so the caller can reuse
    the same parser. This is the fallback for when every Overpass instance is
    overloaded: it returns fewer businesses (Nominatim caps at 50) but it's fast
    and rarely down.
    """
    params = urllib.parse.urlencode({
        "q": f"[{key}={value}] {place}", "format": "jsonv2", "limit": str(limit),
        "extratags": "1", "addressdetails": "1",
    })
    url = f"{NOMINATIM}?{params}"
    data = cache.get("dataset", url) if cache else None
    if data is None:
        _throttle()
        data = get_json(url, headers=_UA, cache=cache, ttl_ns="dataset")
    out: list[dict] = []
    for r in data if isinstance(data, list) else []:
        tags = dict(r.get("extratags") or {})
        if r.get("name"):
            tags.setdefault("name", r["name"])
        if r.get("category") and r.get("type"):
            tags.setdefault(r["category"], r["type"])
        addr = r.get("address") or {}
        city = addr.get("city") or addr.get("town") or addr.get("village") or ""
        if city:
            tags.setdefault("addr:city", city)
        if addr.get("country_code"):
            tags.setdefault("addr:country", addr["country_code"].upper())
        out.append({"id": r.get("osm_id", ""), "tags": tags})
    return out
