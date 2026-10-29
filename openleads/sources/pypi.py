```python
"""PyPI source — maintainers of Python packages."""

from __future__ import annotations

from typing import Iterator
from urllib.parse import quote, urlparse

from openleads._http import get_json
from openleads.emails.permute import domain_of
from openleads.models import Entity, Query
from openleads.sources.base import Source

API = "https://pypi.org/pypi"

SOCIAL_HOSTS = {
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "readthedocs.io",
    "pypi.org",
}


def usable_domain(url: str) -> str:
    """Return a usable website domain, excluding shared hosting platforms."""
    if not url:
        return ""

    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""

    if host.startswith("www."):
        host = host[4:]

    if not host or host in SOCIAL_HOSTS:
        return ""

    return host


def parse_results(data: dict) -> list[Entity]:
    """Convert a PyPI package response into an Entity record."""
    info = (data or {}).get("info", {}) or {}

    name = (
        info.get("author")
        or info.get("maintainer")
        or ""
    ).strip()

    if not name:
        return []

    package = (info.get("name") or "").strip()
    project_url = (info.get("project_url") or "").strip()
    homepage = (info.get("home_page") or "").strip()
    urls = info.get("project_urls") or {}

    website = homepage or next(
        (
            url for url in urls.values()
            if isinstance(url, str) and url.startswith("https://")
        ),
        "",
    )

    email = (
        info.get("author_email")
        or info.get("maintainer_email")
        or ""
    ).strip()

    domain = ""
    if email and "@" in email:
        domain = email.rsplit("@", 1)[1].lower().strip()
        if domain.startswith("www."):
            domain = domain[4:]
    else:
        domain = usable_domain(website)

    if domain in SOCIAL_HOSTS:
        domain = ""

    if email and "@" in email:
        email_domain = email.rsplit("@", 1)[1].lower().strip()
        if email_domain and email_domain not in SOCIAL_HOSTS:
            domain = email_domain
        else:
            email = ""

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
                **({"public_email": email} if email else {}),
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
        if not term or query.count <= 0:
            return

        # PyPI's JSON API looks up one exact package name, not a topic.
        # Search PyPI's package index first, then fetch package metadata.
        search_url = (
            "https://pypi.org/search/?q="
            + quote(term, safe="")
        )

        # PyPI's HTML search is not a stable public API. Until a supported
        # package-search endpoint is available, only query an exact package.
        url = f"{API}/{quote(term, safe='')}/json"
        data = get_json(url, cache=self.cache, ttl_ns="dataset")

        if data:
            results = parse_results(data)
            yield from results[:query.count]
