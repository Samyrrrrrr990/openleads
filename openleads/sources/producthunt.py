"""
ProductHunt source — trending products and the makers behind them.

Uses ProductHunt's **public RSS/Atom feed** (keyless; the official GraphQL API
needs a token, which we avoid to keep OpenLeads key-free). The feed yields
products and links; it's discovery-oriented — a company domain isn't always in
the feed, so some records come back without an email (honest). It's a clean
demonstration of pluggability and a useful startup-discovery vertical.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Iterator

from openleads._http import get_text
from openleads.emails.permute import domain_of
from openleads.models import Entity, Query
from openleads.sources.base import Source

FEED = "https://www.producthunt.com/feed"


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _first_url_in(text: str) -> str:
    m = re.search(r"https?://[^\s\"'<>]+", text or "")
    return m.group(0) if m else ""


def parse_feed(xml_text: str) -> list[Entity]:
    """Parse a ProductHunt RSS/Atom feed into Entity records (pure/testable)."""
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return []
    out: list[Entity] = []
    for node in root.iter():
        if _localname(node.tag) not in ("item", "entry"):
            continue
        title = link = summary = ""
        for child in node:
            tag = _localname(child.tag)
            if tag == "title" and child.text:
                title = child.text.strip()
            elif tag in ("link", "id"):
                href = child.attrib.get("href")
                if href and not link:
                    link = href.strip()
                elif child.text and not link:
                    link = child.text.strip()
            elif tag in ("summary", "description", "content") and child.text and not summary:
                summary = child.text.strip()
        if not title:
            continue
        # Prefer an external product URL found in the summary; else the feed link.
        ext = _first_url_in(summary)
        website = ext or link
        dom = domain_of(website) or ""
        if dom == "producthunt.com":   # PH post URL, not the product's site
            dom = ""
        out.append(Entity(
            full_name="",  # makers aren't reliably in the feed
            title="Product",
            organization=title,
            domain=dom,
            website=website,
            location="",
            links={"producthunt": link},
            extra={"summary": summary[:200], "vertical": "products/startups"},
            source="producthunt",
        ))
    return out


class ProductHuntSource(Source):
    name = "producthunt"
    kind = "company"
    vertical = "trending products & startups"
    description = "Products from ProductHunt's public RSS feed (keyless; discovery-focused)."

    def search(self, query: Query) -> Iterator[Entity]:
        url = FEED
        if query.keyword or query.industry:
            term = (query.keyword or query.industry).replace(" ", "-").lower()
            url = f"{FEED}?category={term}"
        xml_text = get_text(url, cache=self.cache, ttl_ns="dataset")
        yield from parse_feed(xml_text or "")
