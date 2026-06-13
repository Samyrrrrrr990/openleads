"""
Companies source — notable & mid-market companies by industry + country, via Wikidata.

Wikidata is a free, keyless, openly-licensed knowledge graph. Crucially, a great many
company entities carry an **official website** (property ``P856``) — a real domain the
email waterfall can resolve — plus industry (``P452``) and country (``P17``). We resolve
the user's free-text industry (and optional country) to Wikidata entities, then run one
SPARQL query for companies in that industry with a website.

    openleads find -s companies "fintech companies in germany"
    openleads find -s companies --industry "video game" --location "Japan"

Keyless and cached; the only network calls are the entity search + one SPARQL query.
"""
from __future__ import annotations

import urllib.parse
from typing import Iterator

from openleads._http import get_json
from openleads.emails.permute import domain_of
from openleads.models import Entity, Query
from openleads.sources.base import Source

WD_SEARCH = "https://www.wikidata.org/w/api.php"
WD_SPARQL = "https://query.wikidata.org/sparql"
# Wikidata asks for a descriptive UA with contact/project info.
_UA = {"User-Agent": "openleads/4.0 (https://github.com/Samyrrrrrr990/openleads)",
       "Accept": "application/sparql-results+json"}


def resolve_entity(term: str, cache=None) -> str | None:
    """Resolve a free-text term to a Wikidata QID (best match), or None."""
    term = (term or "").strip()
    if not term:
        return None
    params = urllib.parse.urlencode({
        "action": "wbsearchentities", "search": term, "language": "en",
        "format": "json", "type": "item", "limit": "1",
    })
    data = get_json(f"{WD_SEARCH}?{params}", headers=_UA, cache=cache, ttl_ns="dataset")
    hits = (data or {}).get("search") or []
    return hits[0]["id"] if hits else None


def build_sparql(industry_qid: str, country_qid: str | None, limit: int) -> str:
    """SPARQL for companies in an industry (and optional country) with a website."""
    country_clause = f"  ?company wdt:P17 wd:{country_qid} .\n" if country_qid else ""
    return (
        "SELECT DISTINCT ?company ?companyLabel ?website ?countryLabel WHERE {\n"
        f"  ?company wdt:P452 wd:{industry_qid} .\n"
        "  ?company wdt:P856 ?website .\n"
        f"{country_clause}"
        "  OPTIONAL { ?company wdt:P17 ?country. }\n"
        '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n'
        "}\n"
        f"LIMIT {int(limit)}"
    )


def parse_bindings(sparql_json: dict) -> list[Entity]:
    """Turn a SPARQL results document into company Entities (pure / network-free)."""
    out: list[Entity] = []
    seen: set[str] = set()
    rows = (sparql_json or {}).get("results", {}).get("bindings", []) or []
    for row in rows:
        name = (row.get("companyLabel", {}) or {}).get("value", "").strip()
        website = (row.get("website", {}) or {}).get("value", "").strip()
        country = (row.get("countryLabel", {}) or {}).get("value", "").strip()
        domain = domain_of(website) or ""
        if not name or not domain or domain in seen:
            continue
        # Skip Wikidata's placeholder labels (unlabelled items come back as Q-ids).
        if name.startswith("Q") and name[1:].isdigit():
            continue
        seen.add(domain)
        out.append(Entity(
            full_name="",  # the company is the lead; people come from discovery
            title="Company",
            organization=name,
            domain=domain,
            website=website,
            location=country,
            links={"wikidata": (row.get("company", {}) or {}).get("value", "")},
            extra={"vertical": "companies", "country": country},
            source="companies",
        ))
    return out


class CompaniesSource(Source):
    name = "companies"
    kind = "company"
    vertical = "companies by industry & country (Wikidata)"
    description = ("Companies in any industry/country with real websites, via the free "
                   "Wikidata graph. Keyless; great for B2B company discovery.")

    def _industry_qid(self, term: str) -> str | None:
        """Resolve an industry term to a QID, biased toward the *industry* entity
        (P452 values are industries like 'video game industry', not 'video game')."""
        low = term.lower()
        if "industry" not in low:
            qid = resolve_entity(f"{term} industry", cache=self.cache)
            if qid:
                return qid
        return resolve_entity(term, cache=self.cache)

    def search(self, query: Query) -> Iterator[Entity]:
        term = (query.industry or query.keyword or "").strip()
        if not term:
            return
        industry_qid = self._industry_qid(term)
        if not industry_qid:
            return
        country_qid = resolve_entity(query.location, cache=self.cache) if query.location else None
        limit = max(query.count * 4, 50)
        sparql = build_sparql(industry_qid, country_qid, limit)
        url = f"{WD_SPARQL}?{urllib.parse.urlencode({'query': sparql, 'format': 'json'})}"
        data = get_json(url, headers=_UA, cache=self.cache, ttl_ns="dataset", timeout=40)
        yield from parse_bindings(data or {})
