"""
OpenAlex source — researchers and academics.

OpenAlex is a fully free, keyless catalog of ~250M scholarly works and their
authors. We search authors by name/topic, attach their institution as the
organization, link their ORCID, and derive an email domain from the institution's
homepage when OpenAlex exposes one (cached). Domain-less authors still come back
as rich records.
"""
from __future__ import annotations

import time
import urllib.parse
from typing import Iterator

from openleads._http import get_json
from openleads.emails.permute import domain_of
from openleads.models import Entity, Query
from openleads.sources.base import Source

API = "https://api.openalex.org"
# OpenAlex "polite pool" — a contact param (no key). Speeds up + is good manners.
MAILTO = "openleads@users.noreply.github.com"


def _looks_like_person(name: str) -> bool:
    """Reject concept/topic 'authors' (e.g. 'Machine Learning') from topic searches."""
    name = (name or "").strip()
    toks = [t for t in name.split() if t]
    if not (2 <= len(toks) <= 4):
        return False
    junk = {"machine", "learning", "deep", "algorithm", "algorithms", "model",
            "models", "network", "networks", "analysis", "review", "study",
            "system", "systems", "data", "method", "methods", "approach", "based"}
    return not ({t.lower() for t in toks} & junk)


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


def parse_work_authors(data: dict) -> list[Entity]:
    """Authors of a works response, deduplicated, in citation order (pure/testable).

    OpenAlex's author search matches *names*, so a topic like "machine learning"
    finds conference titles, not people. Searching works by topic and taking their
    authors finds the people actually publishing on it.
    """
    out: list[Entity] = []
    seen: set[str] = set()
    for w in (data or {}).get("results", []) or []:
        for au in w.get("authorships", []) or []:
            a = au.get("author") or {}
            aid = a.get("id") or ""
            name = (a.get("display_name") or "").strip()
            if name.count(",") == 1:                      # "Jakubův, Jan" → "Jan Jakubův"
                last, first = (p.strip() for p in name.split(","))
                name = f"{first} {last}".strip()
            if not name or aid in seen:
                continue
            seen.add(aid)
            insts = au.get("institutions") or []
            inst = insts[0] if insts else {}
            out.append(Entity(
                full_name=name,
                title="Researcher",
                organization=(inst.get("display_name") or "").strip(),
                domain="",
                website="",
                location=(inst.get("country_code") or "").strip(),
                links={"orcid": (a.get("orcid") or "").strip(), "openalex": aid},
                extra={"institution_id": inst.get("id", ""), "vertical": "researchers",
                       "paper": (w.get("title") or "")[:140]},
                source="openalex",
            ))
    return out


class OpenAlexSource(Source):
    name = "openalex"
    kind = "people"
    vertical = "researchers & academics"
    description = "Scholarly authors via the free OpenAlex catalog; ORCID + institution."

    def _institution_homepage(self, inst_id: str) -> str:
        return self._homepages([inst_id]).get(inst_id, "")

    def _homepages(self, inst_ids) -> dict:
        """Institution id → homepage URL, via the API in batches of 50.

        Ids look like ``https://openalex.org/I123``; that URL is the website (HTTP
        403 for scripts), so we query ``api.openalex.org/institutions`` instead.
        """
        ids = [i for i in dict.fromkeys(inst_ids) if i]
        out: dict = {}
        for start in range(0, len(ids), 50):
            chunk = ids[start:start + 50]
            short = "|".join(i.rsplit("/", 1)[-1] for i in chunk)
            params = {"filter": f"openalex_id:{short}", "per_page": "50",
                      "select": "id,homepage_url", "mailto": MAILTO}
            data = get_json(f"{API}/institutions?" + urllib.parse.urlencode(params),
                            cache=self.cache, ttl_ns="dataset")
            for inst in (data or {}).get("results", []) or []:
                out[inst.get("id", "")] = inst.get("homepage_url") or ""
        return out

    def search(self, query: Query) -> Iterator[Entity]:
        term = query.keyword or query.industry or ""
        if term:
            # Topic → the authors of recent, well-cited papers on it.
            since = f"{time.gmtime().tm_year - 4}-01-01"
            params = {"search": term, "per_page": "50", "mailto": MAILTO,
                      "filter": f"from_publication_date:{since}",
                      "sort": "cited_by_count:desc", "select": "title,authorships"}
            data = get_json(f"{API}/works?" + urllib.parse.urlencode(params),
                            cache=self.cache, ttl_ns="dataset")
            candidates = parse_work_authors(data or {})
        else:
            params = {"per_page": str(min(max(query.count * 3, 25), 100)), "mailto": MAILTO}
            data = get_json(f"{API}/authors?" + urllib.parse.urlencode(params),
                            cache=self.cache, ttl_ns="dataset")
            candidates = parse_authors(data or {})
        candidates = [e for e in candidates if _looks_like_person(e.full_name)]
        homes = self._homepages(e.extra.get("institution_id") for e in candidates
                                if not e.domain)
        for ent in candidates:
            if not _looks_like_person(ent.full_name):
                continue  # drop concept/topic 'authors' from topic searches
            # Enrich domain from the institution homepage if we don't have one.
            iid = ent.extra.get("institution_id")
            if not ent.domain and iid:
                home = homes.get(iid, "")
                if home:
                    ent.website = home
                    ent.domain = domain_of(home) or ""
            if not ent.domain:
                continue  # no institution domain → not emailable, skip
            yield ent
