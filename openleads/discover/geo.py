"""
Place name → geography: a bundled gazetteer first, OpenStreetMap's Nominatim second.

The local-business source needs to turn "Miami", "Austin, TX" or "Berlin" into a
bounding box it can hand to Overpass. Most searches name a major metro, so a small
bundled table (``places.tsv``, ~190 metros worldwide) answers them **offline**:
no network call, no rate limit, no 15-second Nominatim timeout that used to turn
"dentists in Austin" into zero results. Anything else goes to Nominatim (free,
keyless; we send an identifying User-Agent, throttle to 1 request/s and cache
answers for 90 days, per its usage policy).

Metro boxes from Nominatim can span a whole county ("Los Angeles" is ~100 km
across) and make Overpass time out, so every box is clamped to a radius around
the place's centre (:func:`clamp_bbox`).

``bbox_from_result`` and the gazetteer lookup are pure, so they unit-test without
the network.
"""
from __future__ import annotations

import math
import re
import threading
import time
import unicodedata
import urllib.parse
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple

from openleads import runreport
from openleads._http import get_json
from openleads.config import APP_USER_AGENT

NOMINATIM = "https://nominatim.openstreetmap.org/search"
# Nominatim's usage policy asks for an identifying User-Agent with contact info.
_UA = {"User-Agent": APP_USER_AGENT}
GEOCODE_TIMEOUT = 8
# Overpass gets slow (and times out) on boxes much larger than a city centre.
MAX_RADIUS_KM = 25
_KM_PER_DEG_LAT = 111.32


class BBox(NamedTuple):
    """A geographic bounding box: south, west, north, east (decimal degrees)."""

    south: float
    west: float
    north: float
    east: float

    def as_overpass(self) -> str:
        """Render as Overpass' ``(south,west,north,east)`` bbox filter clause."""
        return f"({self.south},{self.west},{self.north},{self.east})"

    def as_viewbox(self) -> str:
        """Render as Nominatim's ``viewbox`` parameter (``west,north,east,south``)."""
        return f"{self.west},{self.north},{self.east},{self.south}"

    @property
    def display_name(self) -> str:  # set by resolve_place; harmless default
        return getattr(self, "_display", "")


class Place(NamedTuple):
    """One gazetteer entry."""

    name: str
    country: str
    lat: float
    lon: float
    radius_km: float


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


def bbox_around(lat: float, lon: float, radius_km: float) -> BBox:
    """A square box of half-width ``radius_km`` centred on ``(lat, lon)``."""
    dlat = radius_km / _KM_PER_DEG_LAT
    dlon = radius_km / (_KM_PER_DEG_LAT * max(0.01, math.cos(math.radians(lat))))
    return BBox(south=round(lat - dlat, 5), west=round(lon - dlon, 5),
                north=round(lat + dlat, 5), east=round(lon + dlon, 5))


def clamp_bbox(bbox: BBox, lat: float, lon: float,
               max_radius_km: float = MAX_RADIUS_KM) -> BBox:
    """Shrink ``bbox`` to at most ``max_radius_km`` around ``(lat, lon)``.

    A box that is already smaller is returned unchanged; one that doesn't contain
    the centre at all is replaced by the box around the centre.
    """
    cap = bbox_around(lat, lon, max_radius_km)
    out = BBox(south=max(bbox.south, cap.south), west=max(bbox.west, cap.west),
               north=min(bbox.north, cap.north), east=min(bbox.east, cap.east))
    if out.south >= out.north or out.west >= out.east:
        return cap
    return out


# --- the bundled gazetteer ----------------------------------------------------- #
COUNTRY_NAMES = {
    "US": ("usa", "us", "united states", "united states of america", "america"),
    "GB": ("uk", "united kingdom", "great britain", "britain", "england", "scotland",
           "wales", "northern ireland", "gb"),
    "CA": ("canada",), "MX": ("mexico", "méxico"), "BR": ("brazil", "brasil"),
    "AR": ("argentina",), "CL": ("chile",), "CO": ("colombia",), "PE": ("peru", "perú"),
    "UY": ("uruguay",), "IE": ("ireland",), "FR": ("france",),
    "DE": ("germany", "deutschland"), "NL": ("netherlands", "the netherlands", "holland"),
    "BE": ("belgium", "belgique", "belgie"), "LU": ("luxembourg",), "ES": ("spain", "españa"),
    "PT": ("portugal",), "IT": ("italy", "italia"), "AT": ("austria", "österreich"),
    "CH": ("switzerland", "schweiz", "suisse"), "DK": ("denmark", "danmark"),
    "SE": ("sweden", "sverige"), "NO": ("norway", "norge"), "FI": ("finland", "suomi"),
    "IS": ("iceland",), "PL": ("poland", "polska"), "CZ": ("czechia", "czech republic"),
    "HU": ("hungary",), "RO": ("romania",), "BG": ("bulgaria",), "GR": ("greece",),
    "TR": ("turkey", "türkiye", "turkiye"), "UA": ("ukraine",), "EE": ("estonia",),
    "LV": ("latvia",), "LT": ("lithuania",), "RS": ("serbia",), "HR": ("croatia",),
    "SI": ("slovenia",), "RU": ("russia",), "AE": ("uae", "united arab emirates"),
    "QA": ("qatar",), "SA": ("saudi arabia", "ksa"), "IL": ("israel",), "JO": ("jordan",),
    "LB": ("lebanon",), "IR": ("iran",), "EG": ("egypt",), "MA": ("morocco",),
    "NG": ("nigeria",), "GH": ("ghana",), "KE": ("kenya",), "ZA": ("south africa", "rsa"),
    "JP": ("japan",), "KR": ("south korea", "korea"), "CN": ("china", "prc"),
    "HK": ("hong kong",), "TW": ("taiwan",), "SG": ("singapore",), "MY": ("malaysia",),
    "TH": ("thailand",), "ID": ("indonesia",), "PH": ("philippines",),
    "VN": ("vietnam", "viet nam"), "IN": ("india",), "PK": ("pakistan",),
    "BD": ("bangladesh",), "AU": ("australia",), "NZ": ("new zealand", "nz"),
}
# Region codes that appear as qualifiers in the gazetteer ("Austin, TX") → full names.
REGION_NAMES = {
    "al": "alabama", "az": "arizona", "ca": "california", "co": "colorado", "dc": "district of columbia",
    "fl": "florida", "ga": "georgia", "hi": "hawaii", "id": "idaho", "il": "illinois",
    "in": "indiana", "ky": "kentucky", "la": "louisiana", "ma": "massachusetts", "md": "maryland",
    "mi": "michigan", "mn": "minnesota", "mo": "missouri", "nc": "north carolina",
    "ne": "nebraska", "nm": "new mexico", "nv": "nevada", "ny": "new york", "oh": "ohio",
    "ok": "oklahoma", "or": "oregon", "pa": "pennsylvania", "tn": "tennessee", "tx": "texas",
    "ut": "utah", "va": "virginia", "wa": "washington", "wi": "wisconsin",
    "on": "ontario", "qc": "quebec", "bc": "british columbia", "ab": "alberta",
    "mb": "manitoba", "nsw": "new south wales", "vic": "victoria", "qld": "queensland",
}


def normalize(text: str) -> str:
    """Lowercase, strip accents and dots, tidy commas and spaces ("St. Louis, MO" → "st louis, mo")."""
    t = unicodedata.normalize("NFKD", text or "")
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    t = t.replace(".", "").replace("ı", "i")
    t = re.sub(r"\s*,\s*", ", ", t)
    t = re.sub(r"\s+", " ", t).strip(" ,")
    return t


@lru_cache(maxsize=1)
def gazetteer() -> tuple:
    """``(index, qualifiers)``: normalized name/alias → Place, and Place → allowed qualifiers."""
    path = Path(__file__).with_name("places.tsv")
    index: dict = {}
    quals: dict = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return index, quals
    for line in lines:
        if not line.strip() or line.startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) != 6:
            continue
        name, aliases, cc, lat, lon, radius = cols
        try:
            place = Place(name, cc.strip().upper(), float(lat), float(lon), float(radius))
        except ValueError:
            continue
        keys = [name] + [a for a in aliases.split(";") if a.strip()]
        allowed = {cc.strip().lower()} | {normalize(n) for n in COUNTRY_NAMES.get(place.country, ())}
        for key in keys:
            norm = normalize(key)
            index.setdefault(norm, place)
            if ", " in norm:
                for q in norm.split(", ")[1:]:
                    allowed.add(q)
                    if q in REGION_NAMES:
                        allowed.add(REGION_NAMES[q])
        quals[place] = frozenset(allowed)
    return index, quals


def lookup_place(place: str) -> Place | None:
    """The gazetteer entry for ``place``, or None (pure / network-free).

    Matches a name or alias exactly ("NYC", "Austin, TX", "München"), or a known
    city followed by qualifiers that fit it ("Austin, Texas", "Berlin, Germany",
    "Paris, France"). A qualifier that doesn't fit ("London, Ontario",
    "Portland, Maine") is not guessed at — it falls through to Nominatim.
    """
    norm = normalize(place)
    if not norm:
        return None
    index, quals = gazetteer()
    if norm in index:
        return index[norm]
    parts = norm.split(", ")
    for cut in range(len(parts) - 1, 0, -1):
        head = ", ".join(parts[:cut])
        hit = index.get(head)
        if hit is not None and all(q in quals.get(hit, ()) for q in parts[cut:]):
            return hit
    return None


# --- Nominatim ------------------------------------------------------------------ #
def _is_result_list(data) -> str | None:
    return None if isinstance(data, list) else "not a Nominatim result list"


def resolve_place(place: str, cache=None) -> BBox | None:
    """Resolve a free-text place to a bounding box, or None if not found.

    Order: the bundled gazetteer (offline) → Nominatim (retried, 8s timeout,
    throttled, cached 90 days under ``geo``) → None. The box is clamped to
    :data:`MAX_RADIUS_KM` around the place's centre.
    """
    place = (place or "").strip()
    if not place:
        return None
    hit = lookup_place(place)
    if hit is not None:
        _note("note", f"geocode: gazetteer ({hit.name})")
        return bbox_around(hit.lat, hit.lon, min(hit.radius_km, MAX_RADIUS_KM))
    params = urllib.parse.urlencode(
        {"q": place, "format": "jsonv2", "limit": "1", "addressdetails": "0"}
    )
    url = f"{NOMINATIM}?{params}"
    if cache is None or cache.get("geo", url) is None:
        _throttle()
    data = get_json(url, headers=_UA, cache=cache, ttl_ns="geo", timeout=GEOCODE_TIMEOUT,
                    validate=_is_result_list)
    if not isinstance(data, list) or not data:
        _note("note", f"couldn't place '{place}' on the map"
              + (" (geocoder unreachable)" if data is None else ""))
        _note("flag", "geocode_failed")
        return None
    bbox = bbox_from_result(data[0])
    if bbox is None:
        return None
    try:
        lat, lon = float(data[0]["lat"]), float(data[0]["lon"])
    except (KeyError, TypeError, ValueError):
        lat, lon = (bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2
    return clamp_bbox(bbox, lat, lon)


def _note(kind: str, text: str) -> None:
    """Tell the active run report (if any) how geocoding went."""
    getattr(runreport, kind)(text)


# Nominatim's usage policy: at most one request per second.
_last_call = [0.0]
_throttle_lock = threading.Lock()


def _throttle() -> None:
    with _throttle_lock:
        wait = 1.1 - (time.monotonic() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.monotonic()


def search_pois(key: str, value: str, place: str, cache=None, limit: int = 40,
                bbox: BBox | None = None) -> list[dict]:
    """Find businesses tagged ``key=value`` in ``place`` via Nominatim.

    Returns Overpass-shaped elements (``{"id", "tags"}``) so the caller can reuse
    the same parser. This is the fallback for when every Overpass instance is
    overloaded: it returns fewer businesses (Nominatim caps results) but it's fast
    and rarely down. With ``bbox`` the search is bounded to that box.
    """
    params = {"format": "jsonv2", "limit": str(limit), "extratags": "1", "addressdetails": "1"}
    if bbox is not None:
        params.update(q=f"[{key}={value}]", viewbox=bbox.as_viewbox(), bounded="1")
    else:
        params["q"] = f"[{key}={value}] {place}"
    url = f"{NOMINATIM}?{urllib.parse.urlencode(params)}"
    data = cache.get("dataset", url) if cache else None
    if data is None:
        _throttle()
        data = get_json(url, headers=_UA, cache=cache, ttl_ns="dataset",
                        timeout=GEOCODE_TIMEOUT + 2, validate=_is_result_list)
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
