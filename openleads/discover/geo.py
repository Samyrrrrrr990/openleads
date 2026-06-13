"""
Place name → geography, via OpenStreetMap's free, keyless Nominatim service.

The local-business source needs to turn "Miami", "Austin, TX" or "Berlin" into a
bounding box it can hand to Overpass. Nominatim does exactly that at $0 with no
key (we just send a polite User-Agent and cache aggressively, per their usage
policy). ``bbox_from_result`` is pure so it unit-tests without the network.
"""
from __future__ import annotations

import urllib.parse
from typing import NamedTuple

from openleads._http import get_json

NOMINATIM = "https://nominatim.openstreetmap.org/search"
# Nominatim's usage policy asks for an identifying User-Agent with contact info.
_UA = {"User-Agent": "openleads/4.0 (+https://github.com/Samyrrrrrr990/openleads)"}


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
