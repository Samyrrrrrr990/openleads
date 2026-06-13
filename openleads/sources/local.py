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

import re
import urllib.parse
from typing import Iterator

from openleads._http import get_json
from openleads.discover.geo import resolve_place
from openleads.emails.permute import domain_of, is_role_account
from openleads.models import Entity, Query
from openleads.sources.base import Source

OVERPASS = "https://overpass-api.de/api/interpreter"

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
    (("doctor", "physician", "clinic", "medical", "gp", "family medicine"),
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


def _name_filter(term: str) -> str:
    """A leftover free-text term to match against business names, or '' if none."""
    words = [w for w in re.findall(r"[a-z0-9&'-]+", (term or "").lower())
             if w not in _STOP and len(w) > 2]
    # Drop words that are themselves category triggers (already used as tag filters).
    triggers = {k.strip() for keys, _ in CATEGORY_TAGS for k in keys}
    words = [w for w in words if not any(w in t or t in w for t in triggers)]
    return " ".join(words[:3])


def build_overpass_query(selectors, bbox_clause: str, name_filter: str = "",
                         limit: int = 60) -> str:
    """Build an Overpass QL query for businesses matching selectors in a bbox."""
    parts = []
    name_clause = ""
    if name_filter:
        # Case-insensitive substring on the name tag.
        name_clause = f'["name"~"{re.escape(name_filter)}",i]'
    for key, value in selectors:
        if value == "*":
            tag = f'["{key}"]'
        else:
            tag = f'["{key}"="{value}"]'
        for typ in ("node", "way"):
            parts.append(f'  {typ}{tag}{name_clause}["website"]{bbox_clause};')
            parts.append(f'  {typ}{tag}{name_clause}["contact:website"]{bbox_clause};')
            parts.append(f'  {typ}{tag}{name_clause}["contact:email"]{bbox_clause};')
    body = "\n".join(parts)
    return f"[out:json][timeout:25];\n(\n{body}\n);\nout tags center {limit};"


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
            },
            source="local",
        ))
    return out


class LocalSource(Source):
    name = "local"
    kind = "company"
    vertical = "local businesses (any city, any category)"
    description = ("Real businesses by category + place via OpenStreetMap/Overpass — "
                   "agencies, clinics, firms, shops; websites + emails. Keyless, global.")

    def search(self, query: Query) -> Iterator[Entity]:
        place = (query.location or "").strip()
        term = (query.keyword or query.industry or "").strip()
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
        limit = max(query.count * 3, 30)
        ql = build_overpass_query(selectors, bbox.as_overpass(), name_filter, limit)
        url = f"{OVERPASS}?{urllib.parse.urlencode({'data': ql})}"
        data = get_json(url, cache=self.cache, ttl_ns="dataset", timeout=40)
        for ent in extract_businesses(data or {}):
            if not ent.extra.get("city") and place:
                ent.extra["city"] = place.split(",")[0].strip()
                if not ent.location:
                    ent.location = place
            yield ent
