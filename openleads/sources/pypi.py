"""PyPI source — maintainers of Python packages."""

from __future__ import annotations

from typing import Iterator
from urllib.parse import quote

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
    "github.io",
    "gitlab.io",
}

# Curated package lists for common topics.
# Add packages to these lists as the source grows.
TOPIC_PACKAGES = {
    "django": [
        "django",
        "djangorestframework",
        "django-filter",
        "django-cors-headers",
        "django-allauth",
    ],
    "flask": [
        "flask",
        "flask-restful",
        "flask-login",
        "flask-sqlalchemy",
    ],
    "fastapi": [
        "fastapi",
        "uvicorn",
        "starlette",
        "pydantic",
    ],
    "machine learning": [
        "scikit-learn",
        "xgboost",
        "lightgbm",
        "catboost",
    ],
    "data science": [
        "pandas",
        "numpy",
        "scipy",
        "matplotlib",
        "seaborn",
    ],
    "security": [
        "cryptography",
        "bandit",
        "paramiko",
        "pyopenssl",
    ],
}


def usable_domain(email: str, website: str) -> str:
    """Return a usable domain, preferring the public email domain."""
    if email and "@" in email:
        candidate = email.rsplit("@", 1)[1].strip().lower()
        domain = domain_of(candidate) or ""
        if domain and not any(
            domain == host or domain.endswith("." + host)
            for host in SOCIAL_HOSTS
        ):
            return domain

    domain = domain_of(website) or ""
    if domain and not any(
        domain == host or domain.endswith("." + host)
        for host in SOCIAL_HOSTS
    ):
        return domain

    return ""


def parse_results(data: dict) -> list[Entity]:
    """Convert PyPI package metadata into a maintainer entity."""
    if not isinstance(data, dict):
        return []

    info = data.get("info") or {}
    if not isinstance(info, dict):
        return []

    name = (
        info.get("author")
        or info.get("maintainer")
        or ""
    )
    if not isinstance(name, str) or not name.strip():
        return []

    package = info.get("name") or ""
    if not isinstance(package, str):
        package = ""

    project_url = info.get("project_url") or ""
    homepage = info.get("home_page") or ""
    urls = info.get("project_urls") or {}

    if not isinstance(urls, dict):
        urls = {}

    website = homepage if isinstance(homepage, str) else ""

    if not website:
        for value in urls.values():
            if isinstance(value, str) and value.startswith("https://"):
                website = value
                break

    author_email = info.get("author_email") or ""
    maintainer_email = info.get("maintainer_email") or ""

    email = ""
    for candidate in (author_email, maintainer_email):
        if isinstance(candidate, str) and candidate.count("@") == 1:
            local, host = candidate.rsplit("@", 1)
            if local.strip() and host.strip():
                email = candidate.strip()
                break

    domain = usable_domain(email, website)

    # Do not expose an email whose domain is a shared hosting platform.
    if email and not domain:
        email = ""

    links = {}
    if isinstance(project_url, str) and project_url:
        links["pypi"] = project_url

    return [
        Entity(
            full_name=name.strip(),
            title="Python package maintainer",
            organization=package,
            domain=domain,
            website=website or project_url,
            location="",
            links=links,
            extra={
                "package": package,
                "summary": info.get("summary") or "",
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
    description = "Maintainers of Python packages discovered by topic."

    def search(self, query: Query) -> Iterator[Entity]:
        term = (
            getattr(query, "keyword", None)
            or getattr(query, "industry", None)
            or getattr(query, "text", None)
            or ""
        ).strip().lower()

        if not term or query.count <= 0:
            return

        # Use curated topic packages when available.
        # For other terms, treat the term as an exact package name.
        packages = TOPIC_PACKAGES.get(term, [term])

        seen = set()
        yielded = 0

        for package in packages:
            if yielded >= query.count:
                break

            if package in seen:
                continue
            seen.add(package)

            url = "{}/{}/json".format(API, quote(package, safe=""))

            try:
                data = get_json(
                    url,
                    cache=self.cache,
                    ttl_ns="dataset",
                )
            except Exception:
                # One unavailable package should not stop the search.
                continue

            for entity in parse_results(data):
                yield entity
                yielded += 1

                if yielded >= query.count:
                    break
