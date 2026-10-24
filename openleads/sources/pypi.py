
"""PyPI source — maintainers of Python packages."""

from __future__ import annotations

from typing import Iterator
from urllib.parse import quote

from openleads._http import get_json
from openleads.models import Entity, Query
from openleads.sources.base import Source

API = "https://pypi.org/pypi"


def parse_results(data: dict) -> list[Entity]:
    """Convert a PyPI package response into an Entity record."""
    info = (data or {}).get("info", {}) or {}
    name = (info.get("author") or info.get("maintainer") or "").strip()
    package = (info.get("name") or "").strip()

    if not name:
        name = package

    if not name:
        return []

    project_url = (info.get("project_url") or "").strip()
    homepage = (info.get("home_page") or "").strip()
    urls = info.get("project_urls") or {}

    website = homepage or next(
        (url for url in urls.values() if isinstance(url, str) and url.startswith("https://")),
        "",
    )

    domain = ""
    if website:
        try:
            from urllib.parse import urlparse
            domain = (urlparse(website).hostname or "").removeprefix("www.")
        except ValueError:
            domain = ""

    return [
        Entity(
            full_name=name,
            title="Python package maintainer",
            organization=package,
            domain=domain,
            website=website or project_url,
            location="",
            links={"pypi": project_url} if project_url else {},
            extra={
                "package": package,
                "summary": info.get("summary", ""),
                "vertical": "Python package maintainers",
            },
            source="pypi",
        )
    ]


class PyPISource(Source):
    name = "pypi"
    kind = "people"
    vertical = "Python package maintainers"
    description = "Maintainers of Python packages published on PyPI."

    def search(self, query: Query) -> Iterator[Entity]:
        term = (query.keyword or query.industry or query.text or "").strip()
        if not term:
            return

        url = f"{API}/{quote(term, safe='')}/json"
        data = get_json(url, cache=self.cache, ttl_ns="dataset")

        if data:
            yield from parse_results(data)
