"""Geocoding: bundled gazetteer first (offline), clamped boxes, resilient Nominatim."""
import math
import urllib.error
import urllib.parse
from pathlib import Path

import pytest

from openleads import _http
from openleads.discover import geo


def _radius_km(bb):
    lat = (bb.south + bb.north) / 2
    ns = (bb.north - bb.south) / 2 * 111.32
    ew = (bb.east - bb.west) / 2 * 111.32 * math.cos(math.radians(lat))
    return ns, ew


@pytest.mark.parametrize("place,name", [
    ("Austin, TX", "Austin"), ("austin texas", None), ("Austin, Texas", "Austin"),
    ("NYC", "New York"), ("New York, NY, USA", "New York"), ("SF", "San Francisco"),
    ("London, UK", "London"), ("London", "London"), ("Berlin, Germany", "Berlin"),
    ("München", "Munich"), ("Muenchen", "Munich"), ("St. Louis, MO", "St. Louis"),
    ("Washington D.C.", "Washington"), ("Cambridge, MA", "Cambridge, MA"),
    ("Cambridge", "Cambridge"), ("Birmingham, AL", "Birmingham, AL"),
    ("São Paulo", "São Paulo"), ("Sao Paulo, Brazil", "São Paulo"),
    ("London, Ontario", None), ("Portland, Maine", None), ("Paris, TX", None),
    ("Smalltown", None), ("", None),
])
def test_lookup_place(place, name):
    hit = geo.lookup_place(place)
    assert (hit.name if hit else None) == name


def test_gazetteer_hit_needs_no_network(monkeypatch):
    calls = []
    monkeypatch.setattr(_http, "_open", lambda url, *a, **k: calls.append(url))
    bb = geo.resolve_place("Austin, TX")
    assert calls == []
    assert bb.south < 30.2672 < bb.north and bb.west < -97.7431 < bb.east
    ns, ew = _radius_km(bb)
    assert 19 < ns < 21 and 19 < ew < 21


def test_clamp_bbox_limits_huge_metro_boxes():
    # Nominatim's Los Angeles county-sized box (~100 km across).
    la = geo.BBox(south=33.70, west=-118.67, north=34.34, east=-118.15)
    bb = geo.clamp_bbox(la, 34.0522, -118.2437, max_radius_km=25)
    ns, ew = _radius_km(bb)
    assert ns <= 25.01 and ew <= 25.5
    assert bb.east == la.east            # already inside the cap on that side
    small = geo.BBox(30.2, -97.8, 30.3, -97.7)
    assert geo.clamp_bbox(small, 30.25, -97.75) == small
    away = geo.clamp_bbox(geo.BBox(0.0, 0.0, 0.1, 0.1), 50.0, 10.0, max_radius_km=5)
    assert away.south < 50.0 < away.north


def test_nominatim_fallback_retries_then_caches(monkeypatch):
    class Cache:
        def __init__(self):
            self.d = {}

        def get(self, ns, key, max_stale=0):
            return self.d.get((ns, key))

        def set(self, ns, key, value):
            self.d[(ns, key)] = value

    calls = []

    def flaky(url, headers=None, timeout=None, data=None):
        calls.append((url, timeout, (headers or {}).get("User-Agent", "")))
        if len(calls) == 1:
            raise urllib.error.HTTPError(url, 503, "busy", {}, None)
        return ('[{"lat": "44.0", "lon": "-100.0", '
                '"boundingbox": ["43.0", "45.0", "-101.5", "-98.5"]}]')
    monkeypatch.setattr(_http, "_open", flaky)
    monkeypatch.setattr(_http, "_sleep", lambda s: None)
    monkeypatch.setattr(geo, "_throttle", lambda: None)
    cache = Cache()
    bb = geo.resolve_place("Pierre, South Dakota", cache=cache)
    assert len(calls) == 2 and calls[0][1] <= geo.GEOCODE_TIMEOUT
    assert "openleads" in calls[0][2]
    ns, ew = _radius_km(bb)
    assert ns <= 25.01 and ew <= 25.5      # clamped from a ~220 km box
    assert [k[0] for k in cache.d] == ["geo"]
    assert geo.resolve_place("Pierre, South Dakota", cache=cache) == bb
    assert len(calls) == 2                 # served from the 90-day geo cache


def test_unknown_place_with_geocoder_down_is_none(monkeypatch):
    monkeypatch.setattr(geo, "_throttle", lambda: None)
    assert geo.resolve_place("Smalltown, Nowhere") is None


def test_search_pois_is_bounded_to_the_box(monkeypatch):
    seen = []
    monkeypatch.setattr(geo, "_throttle", lambda: None)
    monkeypatch.setattr(geo, "get_json", lambda url, **kw: seen.append(url) or [])
    geo.search_pois("amenity", "dentist", "Austin", bbox=geo.BBox(30.0, -98.0, 30.5, -97.5))
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(seen[0]).query)
    assert qs["q"] == ["[amenity=dentist]"] and qs["bounded"] == ["1"]
    assert qs["viewbox"] == ["-98.0,30.5,-97.5,30.0"] and qs["limit"] == ["40"]


# --- the data file itself ----------------------------------------------------- #
def _rows():
    path = Path(geo.__file__).with_name("places.tsv")
    return [ln.split("\t") for ln in path.read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.startswith("#")]


def test_places_tsv_is_sane():
    rows = _rows()
    assert len(rows) >= 150
    keys = {}
    for cols in rows:
        assert len(cols) == 6, cols
        name, aliases, cc, lat, lon, radius = cols
        assert -90 <= float(lat) <= 90 and -180 <= float(lon) <= 180, name
        assert 3 <= float(radius) <= 30, name
        assert cc in geo.COUNTRY_NAMES, (name, cc)
        for key in [name] + [a for a in aliases.split(";") if a]:
            norm = geo.normalize(key)
            assert norm not in keys, f"{key!r} used by {keys.get(norm)!r} and {name!r}"
            keys[norm] = name


def test_places_tsv_ships_with_the_package():
    root = Path(geo.__file__).resolve().parents[2]
    assert "places.tsv" in (root / "pyproject.toml").read_text(encoding="utf-8")
    assert "places.tsv" in (root / "MANIFEST.in").read_text(encoding="utf-8")
