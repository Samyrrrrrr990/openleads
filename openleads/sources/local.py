"""
Local-business source — the capability paid tools charge the most for, free.

OpenStreetMap is a global, keyless, openly-licensed map of the world's businesses:
agencies, clinics, law/accounting firms, gyms, salons, restaurants, shops, studios
— the long tail that cold outreach actually lives on. We resolve a place name to a
bounding box (Nominatim), ask the **Overpass API** for businesses of a category in
that box, and keep the ones with a website (so the email waterfall can reach them).
Many even publish ``contact:email`` directly — instant ground truth.

    openleads find -s local "marketing agencies in Miami"
    openleads find -s local --keyword "dentist" --location "Austin, TX"
    (chat)  law firms in London

Keyless and local-first like everything else: the only network calls are the cached
Nominatim + Overpass fetches.
"""
from __future__ import annotations

import os
import re
import threading
import time
import urllib.parse
from typing import Iterator

from openleads import _concurrency, runreport
from openleads._http import get_json, recent_errors
from openleads.config import APP_USER_AGENT
from openleads.discover.geo import resolve_place, search_pois
from openleads.emails.permute import domain_of, is_role_account
from openleads.models import Entity, Query
from openleads.sources.base import Source

OVERPASS = "https://overpass-api.de/api/interpreter"
# The main Overpass instance is often overloaded (HTTP 504/429). Public mirrors run
# the same API, so a failed query moves on to the next one, then to Nominatim.
# Override (comma-separated) with OPENLEADS_OVERPASS_URLS.
OVERPASS_MIRRORS = (
    OVERPASS,
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
# Patchable so tests never actually wait between mirror rounds.
_sleep = time.sleep
# Overpass rejects browser-like User-Agents (HTTP 406); send the identifying app UA.
_UA = {"User-Agent": APP_USER_AGENT}

# Keyword → OSM tag selectors. First matching keyword wins; each maps to one or
# more (key, value) tag filters OR'd together in the Overpass query. Ordered so
# more-specific terms match before generic ones.
CATEGORY_TAGS: list[tuple[tuple[str, ...], list[tuple[str, str]]]] = [
    (("marketing", "advertis", "agency", "agencies", "branding", "creative agency"),
     [("office", "advertising_agency"), ("office", "marketing"), ("shop", "marketing")]),
    (("seo", "digital agency", "web design", "web agency", "design studio"),
     [("office", "it"), ("office", "advertising_agency"), ("craft", "designer")]),
    (("software", "saas", "it company", "tech company", "it services", "startup"),
     [("office", "it"), ("office", "company"), ("office", "telecommunication")]),
    (("dentist", "dental", "orthodont"),
     [("amenity", "dentist"), ("healthcare", "dentist")]),
    (("doctor", "physician", "clinic", "medical", "gp", "family medicine", "pediatric",
      "dermatolog", "cardiolog", "chiropract", "physiotherap", "physical therap",
      "optometr", "therapist", "psychiatr", "psycholog", "surgeon"),
     [("amenity", "doctors"), ("healthcare", "doctor"), ("amenity", "clinic"),
      ("healthcare", "clinic")]),
    (("veterinar", "vet "),
     [("amenity", "veterinary"), ("healthcare", "veterinary")]),
    (("lawyer", "law firm", "attorney", "solicitor", "legal"),
     [("office", "lawyer")]),
    (("accountant", "accounting", "bookkeep", "cpa", "tax"),
     [("office", "accountant"), ("office", "tax_advisor")]),
    (("insurance", "broker"),
     [("office", "insurance"), ("office", "financial")]),
    (("real estate", "realtor", "estate agent", "property"),
     [("office", "estate_agent")]),
    (("architect",),
     [("office", "architect")]),
    (("gym", "fitness", "crossfit", "yoga", "pilates"),
     [("leisure", "fitness_centre"), ("leisure", "sports_centre"),
      ("amenity", "gym")]),
    (("salon", "hairdress", "barber", "beauty", "spa", "nails"),
     [("shop", "hairdresser"), ("shop", "beauty"), ("leisure", "spa"),
      ("shop", "massage")]),
    (("restaurant", "cafe", "coffee", "bakery", "bar ", "pub", "bistro"),
     [("amenity", "restaurant"), ("amenity", "cafe"), ("shop", "bakery"),
      ("amenity", "bar"), ("amenity", "pub")]),
    (("hotel", "motel", "hostel", "bnb", "lodging"),
     [("tourism", "hotel"), ("tourism", "motel"), ("tourism", "guest_house")]),
    (("dealership", "car dealer", "auto repair", "mechanic", "garage"),
     [("shop", "car"), ("shop", "car_repair"), ("craft", "car_repair")]),
    (("plumber", "electrician", "contractor", "construction", "builder", "roofer",
      "hvac", "handyman", "landscap"),
     [("craft", "plumber"), ("craft", "electrician"), ("craft", "carpenter"),
      ("office", "construction_company"), ("craft", "hvac"), ("craft", "roofer"),
      ("craft", "gardener")]),
    (("consult", "advisory"),
     [("office", "consulting"), ("office", "company")]),
    (("recruit", "staffing", "talent"),
     [("office", "employment_agency")]),
    (("retail", "shop", "store", "boutique"),
     [("shop", "*")]),
    (("school", "tutoring", "academy", "training"),
     [("amenity", "school"), ("office", "educational_institution")]),
    (("nonprofit", "ngo", "charity", "foundation"),
     [("office", "ngo"), ("office", "association")]),
]

# When the category is unknown, fall back to generic companies + shops + crafts and
# rely on the name filter (if any) to narrow.
_FALLBACK_SELECTORS = [("office", "company"), ("office", "*"), ("shop", "*"),
                       ("craft", "*")]

_STOP = {"in", "near", "around", "the", "a", "an", "of", "for", "me", "find",
         "get", "list", "show", "companies", "company", "business", "businesses",
         "local", "leads", "with", "and", "that", "who"}


def category_selectors(term: str) -> list[tuple[str, str]]:
    """Map a free-text category to OSM tag selectors (curated; falls back generically)."""
    low = f" {(term or '').lower()} "
    for keys, selectors in CATEGORY_TAGS:
        if any(k in low for k in keys):
            return selectors
    return _FALLBACK_SELECTORS


def category_term(query: Query) -> str:
    """The free text that names the business category for ``query``.

    The intent parser strips vertical trigger words ("dentists") out of
    ``query.keyword``, so "dentists in Austin" arrives with no keyword at all. Fall
    back to the original text (minus the place) so the category still maps to the
    right OSM tags instead of the generic "any business" fallback.
    """
    for term in (query.keyword, query.industry):
        if term and category_selectors(term) is not _FALLBACK_SELECTORS:
            return term.strip()
    text = (query.text or "").strip()
    if text:
        if query.location:
            text = re.sub(re.escape(query.location), " ", text, flags=re.I)
        text = re.sub(r"\b(?:in|near|around)\s*$", " ", text.strip(), flags=re.I).strip()
        if category_selectors(text) is not _FALLBACK_SELECTORS:
            return text
    return (query.keyword or query.industry or "").strip()


def _name_filter(term: str) -> str:
    """A leftover free-text term to match against business names, or '' if none."""
    words = [w for w in re.findall(r"[a-z0-9&'-]+", (term or "").lower())
             if w not in _STOP and len(w) > 2]
    # Drop words that are themselves category triggers (already used as tag filters).
    triggers = {k.strip() for keys, _ in CATEGORY_TAGS for k in keys}
    words = [w for w in words if not any(w in t or t in w for t in triggers)]
    return " ".join(words[:3])


# One regex key filter instead of six statements per selector: any of these tags
# makes a business reachable (a site to crawl, or a published address).
CONTACT_TAGS = ("website", "contact:website", "email", "contact:email")
_CONTACT_FILTER = '[~"^(' + "|".join(CONTACT_TAGS) + ')$"~"."]'


def build_overpass_query(selectors, bbox_clause: str, name_filter: str = "",
                         limit: int = 60, timeout: int = 20) -> str:
    """Build an Overpass QL query for businesses matching selectors in a bbox.

    One ``nwr`` statement per selector (nodes, ways and relations at once), with a
    single regex key filter for "has a website or an email" — a sixth of the
    statements the old node/way × three-tags expansion sent, so the query is
    cheaper for the (often overloaded) public servers. ``timeout`` is the server-side
    limit in seconds.
    """
    name_clause = f'["name"~"{re.escape(name_filter)}",i]' if name_filter else ""
    parts = []
    for key, value in selectors:
        tag = f'["{key}"]' if value == "*" else f'["{key}"="{value}"]'
        parts.append(f"  nwr{tag}{name_clause}{_CONTACT_FILTER}{bbox_clause};")
    body = "\n".join(parts)
    return f"[out:json][timeout:{int(timeout)}];\n(\n{body}\n);\nout tags center {int(limit)};"


def _tag(tags: dict, *keys: str) -> str:
    for k in keys:
        v = (tags.get(k) or "").strip()
        if v:
            return v
    return ""


def extract_businesses(overpass_json: dict) -> list[Entity]:
    """Turn an Overpass response into business Entities (pure / network-free)."""
    out: list[Entity] = []
    seen: set[str] = set()
    for el in (overpass_json or {}).get("elements", []) or []:
        tags = el.get("tags") or {}
        name = _tag(tags, "name", "official_name", "brand")
        if not name:
            continue
        website = _tag(tags, "website", "contact:website", "url", "contact:url")
        email = _tag(tags, "email", "contact:email")
        domain = domain_of(website) or (email.split("@", 1)[1].lower()
                                        if email and "@" in email else "")
        if not domain:
            continue
        if domain in seen:
            continue
        seen.add(domain)
        city = _tag(tags, "addr:city", "addr:town", "addr:suburb")
        country = _tag(tags, "addr:country")
        state = _tag(tags, "addr:state", "addr:province")
        street = " ".join(p for p in (_tag(tags, "addr:housenumber"),
                                      _tag(tags, "addr:street")) if p)
        category = (_tag(tags, "office", "shop", "amenity", "craft", "leisure",
                         "healthcare", "tourism") or "business")
        public_email = email if (email and "@" in email
                                 and email.split("@", 1)[1].lower() == domain) else ""
        out.append(Entity(
            full_name="",  # the *business* is the lead; people come from discovery
            title=category.replace("_", " ").title(),
            organization=name,
            domain=domain,
            website=website or f"https://{domain}",
            location=", ".join(p for p in (city, country) if p),
            links={"osm": str(el.get("id", "")),
                   "phone": _tag(tags, "phone", "contact:phone")},
            extra={
                "public_email": public_email,
                "role_address": is_role_account(public_email) if public_email else False,
                "vertical": "local businesses",
                "category": category,
                "city": city,
                "country": country,
                "state": state,
                "address": street,
                "postcode": _tag(tags, "addr:postcode"),
                "opening_hours": _tag(tags, "opening_hours"),
                "socials": osm_socials(tags),
            },
            source="local",
        ))
    return out


_OSM_SOCIAL_TAGS = (
    ("linkedin", ("contact:linkedin", "linkedin")),
    ("facebook", ("contact:facebook", "facebook")),
    ("instagram", ("contact:instagram", "instagram")),
    ("twitter", ("contact:twitter", "twitter", "contact:x")),
    ("youtube", ("contact:youtube", "youtube")),
    ("tiktok", ("contact:tiktok", "tiktok")),
)


def osm_socials(tags: dict) -> dict:
    """Social profile URLs from OSM ``contact:*`` tags (bare handles become URLs)."""
    from openleads.insights.socials import classify_url
    base = {"linkedin": "https://www.linkedin.com/company/", "facebook": "https://www.facebook.com/",
            "instagram": "https://www.instagram.com/", "twitter": "https://x.com/",
            "youtube": "https://www.youtube.com/@", "tiktok": "https://www.tiktok.com/@"}
    out = {}
    for network, keys in _OSM_SOCIAL_TAGS:
        raw = _tag(tags, *keys)
        if not raw:
            continue
        url = raw if raw.startswith(("http://", "https://")) else base[network] + raw.lstrip("@/")
        net, canon = classify_url(url)
        if net == network:
            out[network] = canon
    return out


class CircuitBreaker:
    """Skip a host for ``cooldown`` seconds after ``threshold`` failures in a row.

    Public Overpass servers fail in streaks (overload, maintenance). Once one has
    failed twice, the next searches in this process go straight to the mirrors
    instead of spending their budget on it again.
    """

    def __init__(self, threshold: int = 2, cooldown: float = 120.0) -> None:
        self.threshold = threshold
        self.cooldown = cooldown
        self._lock = threading.Lock()
        self._fails: dict = {}
        self._open_until: dict = {}

    def allow(self, host: str) -> bool:
        with self._lock:
            return time.monotonic() >= self._open_until.get(host, 0.0)

    def failure(self, host: str) -> None:
        with self._lock:
            n = self._fails.get(host, 0) + 1
            if n >= self.threshold:
                self._open_until[host] = time.monotonic() + self.cooldown
                n = 0
            self._fails[host] = n

    def success(self, host: str) -> None:
        with self._lock:
            self._fails.pop(host, None)
            self._open_until.pop(host, None)

    def reset(self) -> None:
        with self._lock:
            self._fails.clear()
            self._open_until.clear()


BREAKER = CircuitBreaker()
# Pause before the single second round over the mirrors, and the time that must be
# left in the run for that round to be worth it.
RETRY_ROUND_DELAY = 2.0
RETRY_ROUND_MIN_SECONDS = 20.0
# Overpass gets a slice of the run's budget, never all of it: when every mirror
# is down or slow, the Nominatim fallback (and people discovery after it) still
# needs time. A healthy Overpass answers a clamped city bbox in a few seconds.
OVERPASS_SHARE = 0.45
OVERPASS_MIN_SECONDS = 8.0
OVERPASS_MAX_SECONDS = 30.0


def overpass_mirrors() -> tuple:
    """Overpass endpoints to try, in order (``OPENLEADS_OVERPASS_URLS`` overrides)."""
    raw = os.environ.get("OPENLEADS_OVERPASS_URLS", "").strip()
    if raw:
        urls = tuple(u.strip() for u in re.split(r"[,\s]+", raw) if u.strip())
        if urls:
            return urls
    return OVERPASS_MIRRORS


def overpass_problem(data) -> str | None:
    """Why an Overpass reply is unusable (None if it's a real result)."""
    if not isinstance(data, dict) or "elements" not in data:
        return "not an Overpass result"
    remark = str(data.get("remark") or "")
    if "error" in remark.lower():
        return f"overpass remark: {remark[:80]}"
    return None


def run_overpass(ql: str, cache=None, mirrors=None, timeout: int = 25,
                 reasons: list | None = None):
    """Run an Overpass QL query across the public mirrors; None if all fail.

    Each mirror gets one attempt (a 429/504 moves straight on to the next one
    instead of backing off on a server that is shedding load), mirrors whose
    breaker is open are skipped, and only if every mirror failed *and* more than
    20s of the run remain is there one more round after a short pause. Error
    remarks are rejected (and never cached). Pass a list as ``reasons`` to collect
    why each mirror failed.
    """
    mirrors = tuple(mirrors or overpass_mirrors())
    qs = urllib.parse.urlencode({"data": ql})
    reasons = reasons if reasons is not None else []
    for round_no in (0, 1):
        tried = False
        for base in mirrors:
            host = urllib.parse.urlsplit(base).hostname or base
            if not BREAKER.allow(host):
                continue
            tried = True
            url = f"{base}?{qs}"
            data = get_json(url, headers=_UA, cache=cache, ttl_ns="dataset",
                            timeout=timeout, retries=0, validate=overpass_problem)
            problem = overpass_problem(data)
            if problem is None:
                BREAKER.success(host)
                return data
            BREAKER.failure(host)
            last = recent_errors()
            if last and last[-1][0] == url:
                reasons.append(f"{host}: {last[-1][1]}")
            elif not any(r.startswith(f"{host}: ") for r in reasons):
                reasons.append(f"{host}: {problem}")
        if round_no or not tried or _concurrency.remaining() <= RETRY_ROUND_MIN_SECONDS:
            break
        _sleep(RETRY_ROUND_DELAY)
    return None


def rank_elements(elements: list) -> list:
    """Businesses that publish an email first, then by OSM id (stable across runs)."""
    def key(el):
        tags = el.get("tags") or {}
        has_email = bool(_tag(tags, "email", "contact:email"))
        try:
            oid = int(el.get("id") or 0)
        except (TypeError, ValueError):
            oid = 0
        return (0 if has_email else 1, oid)
    return sorted(elements or [], key=key)


class LocalSource(Source):
    name = "local"
    kind = "company"
    vertical = "local businesses (any city, any category)"
    description = ("Real businesses by category + place via OpenStreetMap/Overpass — "
                   "agencies, clinics, firms, shops; websites + emails. Keyless, global.")

    def search(self, query: Query) -> Iterator[Entity]:
        place = (query.location or "").strip()
        term = category_term(query)
        # If no explicit location, try to peel a trailing place off the term
        # ("agencies in Miami" → place=Miami, term=agencies).
        if not place and term:
            m = re.search(r"\b(?:in|near|around)\s+(.+)$", term, re.I)
            if m:
                place = m.group(1).strip()
                term = term[:m.start()].strip()
        if not place:
            return  # local search is inherently geographic
        bbox = resolve_place(place, cache=self.cache)
        if bbox is None:
            return
        selectors = category_selectors(term)
        name_filter = _name_filter(term) if selectors is _FALLBACK_SELECTORS else ""
        limit = max(query.count * 5, 50)
        # Overpass gets at most a share of what is left of the budget, and one slow
        # mirror at most half of that, so a night when the main instance returns
        # 502s or hangs still leaves time for the Nominatim fallback below.
        left = _concurrency.remaining()
        window = (OVERPASS_MAX_SECONDS if left == float("inf") else
                  min(OVERPASS_MAX_SECONDS,
                      max(min(OVERPASS_MIN_SECONDS, left * 0.6), left * OVERPASS_SHARE)))
        per_mirror = max(6.0, window / 2)
        server_timeout = int(max(5, min(25, per_mirror - 2)))
        ql = build_overpass_query(selectors, bbox.as_overpass(), name_filter, limit,
                                  timeout=server_timeout)
        reasons: list = []
        with _concurrency.window(window):
            data = run_overpass(ql, cache=self.cache, timeout=per_mirror, reasons=reasons)
        if data is None:
            # Every Overpass instance failed (they're often overloaded). Nominatim
            # returns fewer businesses, but it answers.
            why = (reasons[0].split(": ", 1)[-1] if reasons
                   else "all mirrors paused after recent failures")
            runreport.fallback(f"overpass→nominatim ({why})")
            # "Busy" (429/5xx/timeouts/error remarks) vs "can't get there at all"
            # (DNS, TLS, proxy refusals) need different advice.
            unreachable = bool(reasons) and all("network error" in r and "timed out" not in r
                                                for r in reasons)
            runreport.flag("overpass_unreachable" if unreachable else "overpass_fallback")
            elements = []
            for key, value in selectors:
                if value != "*":
                    elements += search_pois(key, value, place, cache=self.cache, bbox=bbox)
            data = {"elements": elements}
        for ent in extract_businesses({"elements": rank_elements(data.get("elements"))}):
            if not ent.extra.get("city") and place:
                ent.extra["city"] = place.split(",")[0].strip()
                if not ent.location:
                    ent.location = place
            yield ent
