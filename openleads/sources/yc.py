"""
YC source — startup founders from the open ``yc-oss`` dataset.

Company discovery uses the keyless ``yc-oss`` API (~6,000 YC startups). People
discovery scrapes each company's public YC page and extracts founders from the
embedded Inertia JSON. Ported from OpenLeads v1.
"""
from __future__ import annotations

import html as ihtml
import json
import random
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Iterator

from openleads._http import get_json, get_text
from openleads.emails.permute import domain_of
from openleads.models import Entity, Query
from openleads.sources.base import Source

YC_ALL = "https://yc-oss.github.io/api/companies/all.json"
YC_PAGE = "https://www.ycombinator.com/companies/{slug}"

EXEC_KEYWORDS = ("founder", "ceo", "cto", "coo", "president", "owner",
                 "chief", "head", "vp", "partner")


def _deep_find(obj, key, depth=0):
    """Walk nested JSON for the first value under ``key`` (founders array)."""
    if depth > 7:
        return None
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            r = _deep_find(v, key, depth + 1)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _deep_find(v, key, depth + 1)
            if r is not None:
                return r
    return None


def parse_founders(page_html: str) -> list[dict]:
    """Extract founder dicts (full_name, title, linkedin_url) from a YC page.

    Pure/network-free for testing: feed it saved page HTML.
    """
    m = re.search(r'data-page="(.*?)"\s*>', page_html or "", re.DOTALL)
    if not m:
        return []
    try:
        data = json.loads(ihtml.unescape(m.group(1)))
    except Exception:
        return []
    founders = _deep_find(data, "founders")
    if not isinstance(founders, list):
        return []
    people = []
    for f in founders:
        if not isinstance(f, dict):
            continue
        name = (f.get("full_name") or "").strip()
        if not name:
            continue
        people.append({
            "full_name": name,
            "title": (f.get("title") or "Founder").strip(),
            "linkedin_url": (f.get("linkedin_url") or "").strip(),
        })
    return people


def pick_exec(founders: list[dict]) -> dict | None:
    """Choose the most senior founder by title keywords; fall back to the first."""
    for f in founders:
        if any(k in f["title"].lower() for k in EXEC_KEYWORDS):
            return f
    return founders[0] if founders else None


def split_location(all_locations: str) -> tuple[str, str]:
    """'San Francisco, CA, USA' -> ('San Francisco', 'USA')."""
    if not all_locations:
        return "", ""
    first = all_locations.split(";")[0].strip()
    parts = [p.strip() for p in first.split(",") if p.strip()]
    if not parts:
        return "", ""
    return parts[0], (parts[-1] if len(parts) > 1 else "")


def filter_companies(companies, query: Query):
    """Active startups with a website, sane size, optional industry/keyword match."""
    industry = query.industry or query.keyword
    out = []
    for c in companies:
        if c.get("status") not in ("Active", "Public", "Acquired", None):
            continue
        if not c.get("website"):
            continue
        size = c.get("team_size") or 0
        try:
            size = int(size)
        except (TypeError, ValueError):
            size = 0
        if size and not (2 <= size <= 200):
            continue
        if industry:
            blob = " ".join(str(c.get(k, "")) for k in
                            ("industry", "subindustry", "tags", "one_liner")).lower()
            if industry.lower() not in blob:
                continue
        out.append(c)
    random.shuffle(out)
    return out


class YCSource(Source):
    name = "yc"
    kind = "company"
    vertical = "startup founders (Y Combinator)"
    description = "Founders/execs of ~6,000 YC startups via the open yc-oss dataset."

    def search(self, query: Query) -> Iterator[Entity]:
        companies = get_json(YC_ALL, cache=self.cache, ttl_ns="dataset") or []
        companies = filter_companies(companies, query)

        # Only companies we can actually turn into a lead (slug + real domain).
        usable = []
        for c in companies[:query.max_companies]:
            slug = c.get("slug")
            domain = domain_of(c.get("website", ""))
            if slug and domain:
                usable.append((c, slug, domain))

        def fetch_page(item):
            c, slug, domain = item
            page = get_text(YC_PAGE.format(slug=slug), timeout=12,
                            cache=self.cache, ttl_ns="dataset")
            return c, domain, page

        # Fetch founder pages concurrently, but in bounded chunks so an early stop
        # (engine has enough leads) doesn't fetch the entire 400-company tail. The
        # old sequential 30 s-timeout fetch per company was why YC felt so slow.
        chunk = 12
        for start in range(0, len(usable), chunk):
            window = usable[start:start + chunk]
            with ThreadPoolExecutor(max_workers=8) as ex:
                pages = list(ex.map(fetch_page, window))
            for c, domain, page in pages:
                exec_ = pick_exec(parse_founders(page or ""))
                if not exec_:
                    continue
                city, country = split_location(c.get("all_locations", ""))
                yield Entity(
                    full_name=exec_["full_name"],
                    title=exec_["title"],
                    organization=c.get("name", ""),
                    domain=domain,
                    website=c.get("website", ""),
                    location=f"{city}, {country}".strip(", "),
                    links={"linkedin": exec_.get("linkedin_url", "")},
                    extra={
                        "industry": c.get("industry", ""),
                        "employees": str(c.get("team_size", "")),
                        "city": city, "country": country,
                    },
                    source=self.name,
                )
