"""
Hugging Face source - people behind public ML models and datasets.
"""
from __future__ import annotations

import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import Iterator

from openleads._http import get_json
from openleads.models import Entity, Query
from openleads.sources.base import Source

API = "https://huggingface.co/api"


def _profile_value(profile: dict, *keys: str) -> str:
    for key in keys:
        value = profile.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _github_link(profile: dict) -> str:
    links = profile.get("links")
    if isinstance(links, dict):
        value = links.get("github")
        if isinstance(value, str):
            return value
    value = profile.get("github")
    if isinstance(value, str):
        return value
    return ""


def _homepage(profile: dict) -> str:
    return _profile_value(profile, "website", "homepage", "blog", "websiteUrl")


def parse_models(data: dict) -> list[str]:
    """Return unique model/dataset author handles from a Hub search response."""
    out: list[str] = []
    seen: set[str] = set()
    for item in (data or {}).get("results", []) or []:
        author = (item.get("author") or "").strip()
        if not author:
            repo_id = (item.get("id") or "").strip()
            author = repo_id.split("/", 1)[0] if "/" in repo_id else ""
        if author and author not in seen:
            seen.add(author)
            out.append(author)
    return out


def parse_profile(username: str, profile: dict | None) -> Entity | None:
    """Normalize a public Hub user profile; organization profiles are skipped."""
    if not username or not isinstance(profile, dict):
        return None
    if profile.get("type") in {"org", "organization", "Organization"} or profile.get("isOrganization"):
        return None
    name = _profile_value(profile, "fullname", "name") or username
    org = _profile_value(profile, "company", "organization")
    home = _homepage(profile)
    github = _github_link(profile)
    links = {"huggingface": f"https://huggingface.co/{username}"}
    if github:
        links["github"] = github
    return Entity(
        full_name=name,
        title="ML developer",
        organization=org,
        domain="",
        website=home or links["huggingface"],
        location=_profile_value(profile, "location"),
        links=links,
        extra={"vertical": "ML developers", "huggingface": username},
        source="huggingface",
    )


class HuggingFaceSource(Source):
    name = "huggingface"
    kind = "people"
    vertical = "ML model & dataset authors"
    description = "Public Hugging Face model and dataset authors for ML-flavoured searches."

    def search(self, query: Query) -> Iterator[Entity]:
        term = (query.keyword or query.industry or query.title or "").strip()
        if not term:
            return
        limit = min(max(query.count * 3, 20), 60)
        params = urllib.parse.urlencode({"search": term, "limit": str(limit)})
        authors: list[str] = []
        seen: set[str] = set()
        for kind in ("models", "datasets"):
            data = get_json(
                f"{API}/{kind}?{params}",
                cache=self.cache,
                ttl_ns="dataset",
            )
            for author in parse_models(data or {}):
                if author not in seen:
                    seen.add(author)
                    authors.append(author)

        def fetch(username: str) -> Entity | None:
            profile = get_json(
                f"{API}/users/{urllib.parse.quote(username, safe='')}",
                cache=self.cache,
                ttl_ns="dataset",
            )
            return parse_profile(username, profile)

        with ThreadPoolExecutor(max_workers=6) as ex:
            for ent in ex.map(fetch, authors):
                if ent:
                    yield ent
