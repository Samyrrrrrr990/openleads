"""
NPI source — U.S. healthcare providers from the public NPI Registry API.

The National Provider Identifier registry (CMS) is fully free and keyless. It
returns rich public records — name, credential, specialty (taxonomy), practice
address — but **almost never an email or website**. So doctors come back as
honest, domain-less records: the public data itself is the value, and email
confidence is labeled ``none`` unless a practice domain is discoverable.

This is the showcase that OpenLeads is "Apollo for everyone" — including verticals
the paid tools barely touch.
"""
from __future__ import annotations

import urllib.parse
from typing import Iterator

from openleads._http import get_json
from openleads.models import Entity, Query
from openleads.sources.base import Source

API = "https://npiregistry.cms.hhs.gov/api/"

# Minimal full-name → USPS abbreviation map (NPI filters by 2-letter state).
STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX",
    "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}


def parse_results(data: dict) -> list[Entity]:
    """Turn an NPI API response into Entity records (pure/testable)."""
    out: list[Entity] = []
    for r in (data or {}).get("results", []) or []:
        basic = r.get("basic", {}) or {}
        first = (basic.get("first_name") or "").strip().title()
        last = (basic.get("last_name") or "").strip().title()
        org = (basic.get("organization_name") or "").strip()
        full = f"{first} {last}".strip() or org
        if not full:
            continue
        taxonomies = r.get("taxonomies", []) or []
        primary_tax = next((t for t in taxonomies if t.get("primary")), taxonomies[0] if taxonomies else {})
        addrs = r.get("addresses", []) or []
        loc = next((a for a in addrs if a.get("address_purpose") == "LOCATION"),
                   addrs[0] if addrs else {})
        out.append(Entity(
            full_name=full,
            title=(primary_tax.get("desc") or basic.get("credential") or "Healthcare Provider").strip(),
            organization=org,
            domain="",  # NPI has no email/website — honest empty
            website="",
            location=", ".join(p for p in (loc.get("city", ""), loc.get("state", "")) if p),
            links={"npi": str(r.get("number", ""))},
            extra={
                "credential": basic.get("credential", ""),
                "taxonomy": primary_tax.get("desc", ""),
                "city": loc.get("city", ""),
                "country": loc.get("country_name", "United States"),
                "vertical": "healthcare providers",
            },
            source="npi",
        ))
    return out


class NPISource(Source):
    name = "npi"
    kind = "people"
    vertical = "U.S. doctors & healthcare providers"
    description = "Licensed U.S. providers from the public NPI Registry (rich data, rarely emails)."

    def search(self, query: Query) -> Iterator[Entity]:
        params = {"version": "2.1", "limit": str(min(query.count, 200)),
                  "country_code": "US"}
        term = query.keyword or query.industry
        if term:
            params["taxonomy_description"] = term
        if query.location:
            loc = query.location.strip()
            if len(loc) == 2:
                params["state"] = loc.upper()
            elif loc.lower() in STATES:
                params["state"] = STATES[loc.lower()]
            else:
                params["city"] = loc
        url = API + "?" + urllib.parse.urlencode(params)
        data = get_json(url, cache=self.cache, ttl_ns="dataset")
        yield from parse_results(data or {})
