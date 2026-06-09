"""
OpenAlex source — researchers and academics.

OpenAlex is a fully free, keyless catalog of ~250M scholarly works and their
authors. We search authors by name/topic, attach their institution as the
organization, link their ORCID, and derive an email domain from the institution's
homepage when OpenAlex exposes one (cached). Domain-less authors still come back
as rich records.
"""
from __future__ import annotations

import urllib.parse
from typing import Iterator

from openleads._http import get_json
from openleads.emails.permute import domain_of
from openleads.models import Entity, Query
from openleads.sources.base import Source

API = "https://api.openalex.org"
# OpenAlex "polite pool" — a contact param (no key). Speeds up + is good manners.
MAILTO = "openleads@users.noreply.github.com"


def _institution_of(author: dict) -> dict:
    insts = author.get("last_known_institutions") or []
    if insts:
        return insts[0] or {}
    # older shape
    single = author.get("last_known_institution")
    return single or {}


def parse_authors(data: dict) -> list[Entity]:
    """Turn an OpenAlex authors response into Entity records (pure/testable).

    Domain enrichment (institution homepage) happens in :meth:`search`; here we
    only normalize what's already present.
    """
    out: list[Entity] = []
    for a in (data or {}).get("results", []) or []:
        name = (a.get("display_name") or "").strip()
        if not name:
            continue
        inst = _institution_of(a)
        orcid = (a.get("orcid") or "").strip()
        out.append(Entity(
            full_name=name,
            title="Researcher",
            organization=(inst.get("display_name") or "").strip(),
            domain=domain_of(inst.get("homepage_url", "")) or "",
            website=inst.get("homepage_url", "") or "",
            location=(inst.get("country_code") or "").strip(),
            links={"orcid": orcid, "openalex": a.get("id", "")},
            extra={
                "works_count": a.get("works_count", 0),
                "cited_by_count": a.get("cited_by_count", 0),
                "institution_id": inst.get("id", ""),
                "vertical": "researchers",
            },
            source="openalex",
        ))
    return out


class OpenAlexSource(Source):
    name = "openalex"
    kind = "people"
    vertical = "researchers & academics"
    description = "Scholarly authors via the free OpenAlex catalog; ORCID + institution."

    def _institution_homepage(self, inst_id: str) -> str:
        if not inst_id:
            return ""
        data = get_json(f"{inst_id}?mailto={MAILTO}", cache=self.cache, ttl_ns="dataset")
        return (data or {}).get("homepage_url", "") or ""

    def search(self, query: Query) -> Iterator[Entity]:
        term = query.keyword or query.industry or ""
        params = {"per_page": str(min(query.count, 50)), "mailto": MAILTO}
        if term:
            params["search"] = term
        url = f"{API}/authors?" + urllib.parse.urlencode(params)
        data = get_json(url, cache=self.cache, ttl_ns="dataset")
        for ent in parse_authors(data or {}):
            # Enrich domain from the institution homepage if we don't have one.
            if not ent.domain and ent.extra.get("institution_id"):
                home = self._institution_homepage(ent.extra["institution_id"])
                if home:
                    ent.website = home
                    ent.domain = domain_of(home) or ""
            yield ent
