"""
SEC EDGAR source — U.S. public companies, from the government's free filings data.

The SEC publishes a keyless ``company_tickers.json`` mapping every public company to
its name, ticker, and CIK. We filter it by the user's keyword/industry and produce
company leads. EDGAR has no website field, so we derive a **candidate** domain from
the company's name and let the email waterfall confirm it (MX + on-site ground truth):
companies whose guessed domain doesn't resolve are dropped, so what survives is real.

    openleads find -s edgar "semiconductor"
    openleads find -s edgar --keyword "biotech"

This adds a recognizable "public companies" vertical; for warmer, more contactable
leads prefer ``local``/``companies``/``yc``. Keyless and cached.
"""
from __future__ import annotations

import re
from typing import Iterator

from openleads._http import get_json
from openleads.emails.permute import is_probable_domain
from openleads.models import Entity, Query
from openleads.sources.base import Source

TICKERS = "https://www.sec.gov/files/company_tickers.json"
# SEC's fair-access policy asks for a declared, identifying User-Agent.
_UA = {"User-Agent": "openleads research admin@openleads.dev"}

# Corporate suffixes stripped before guessing a domain.
_SUFFIX_RE = re.compile(
    r"\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|lp|plc|holdings?|"
    r"group|the|sa|ag|nv|class|common|stock|trust|fund)\b", re.I)


def guess_domain(company: str) -> str:
    """Best-effort domain from a company name ('Acme Robotics Inc' → 'acmerobotics.com')."""
    name = _SUFFIX_RE.sub(" ", company or "")
    name = re.sub(r"[^a-z0-9 ]", " ", name.lower())
    tokens = [t for t in name.split() if t]
    if not tokens:
        return ""
    # Join the leading distinctive tokens; cap to keep the guess realistic.
    stem = "".join(tokens[:3]) if len("".join(tokens[:3])) <= 24 else "".join(tokens[:2])
    domain = f"{stem}.com"
    return domain if is_probable_domain(domain) else ""


def parse_tickers(data, term: str, limit: int) -> list[Entity]:
    """Filter the tickers map by ``term`` and build company Entities (pure)."""
    if isinstance(data, dict):
        rows = list(data.values())
    elif isinstance(data, list):
        rows = data
    else:
        return []
    term = (term or "").lower().strip()
    out: list[Entity] = []
    seen: set[str] = set()
    for row in rows:
        title = (row.get("title") or "").strip()
        if not title:
            continue
        if term and term not in title.lower():
            continue
        domain = guess_domain(title)
        if not domain or domain in seen:
            continue
        seen.add(domain)
        out.append(Entity(
            full_name="",
            title="Company",
            organization=title,
            domain=domain,
            website=f"https://{domain}",
            location="United States",
            links={"ticker": str(row.get("ticker", "")),
                   "sec_cik": str(row.get("cik_str", ""))},
            extra={"vertical": "public companies", "domain_guessed": True,
                   "country": "United States"},
            source="edgar",
        ))
        if len(out) >= limit:
            break
    return out


class EdgarSource(Source):
    name = "edgar"
    kind = "company"
    vertical = "U.S. public companies (SEC EDGAR)"
    description = ("Public companies by keyword from SEC EDGAR; domain confirmed by the "
                   "email waterfall. Keyless.")

    def search(self, query: Query) -> Iterator[Entity]:
        data = get_json(TICKERS, headers=_UA, cache=self.cache, ttl_ns="dataset")
        if not data:
            return
        term = query.keyword or query.industry or ""
        yield from parse_tickers(data, term, max(query.count * 3, 30))
