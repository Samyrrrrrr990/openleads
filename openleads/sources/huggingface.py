"""Keyless discovery of contributors to public Hugging Face models and datasets."""
from __future__ import annotations

import re
import urllib.parse
from typing import Iterator

from openleads import _concurrency
from openleads._http import get_json
from openleads.config import api_headers
from openleads.models import Entity, Query
from openleads.sources.base import Source
from openleads.sources.github import _usable_domain

API = "https://huggingface.co/api"
_HANDLE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}")


def _text(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _url(value) -> str:
    """Keep only explicit HTTP(S) links without embedded credentials."""
    value = _text(value)
    try:
        parsed = urllib.parse.urlsplit(value)
        if (parsed.scheme in {"https", "http"} and parsed.hostname
                and not parsed.username and not parsed.password):
            return value
    except ValueError:
        pass
    return ""


def parse_models(data) -> list[str]:
    """Read Hub list responses; tolerate a legacy results envelope and malformed items."""
    items = data.get("results", []) if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    authors: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        author = _text(item.get("author"))
        if not author:
            repo_id = _text(item.get("id")) or _text(item.get("modelId"))
            author = repo_id.split("/", 1)[0] if "/" in repo_id else ""
        if _HANDLE.fullmatch(author):
            authors.setdefault(author.casefold(), author)
    return list(authors.values())


def parse_profile(username: str, profile: dict | None) -> Entity | None:
    """Normalize /users/{username}/overview without inventing a name or an email."""
    if not _HANDLE.fullmatch(username) or not isinstance(profile, dict):
        return None
    if _text(profile.get("type")).lower() in {"org", "organization"} or profile.get("isOrganization"):
        return None
    if profile.get("serviceAccount"):
        return None
    returned_user = _text(profile.get("user"))
    if returned_user and returned_user.casefold() != username.casefold():
        return None
    name = _text(profile.get("fullname")) or _text(profile.get("name"))
    if not name:
        return None
    orgs = profile.get("orgs")
    organizations = [
        _text(org.get("fullname")) or _text(org.get("name"))
        for org in (orgs if isinstance(orgs, list) else []) if isinstance(org, dict)
    ]
    org = ", ".join(dict.fromkeys(x for x in organizations if x))
    org = org or _text(profile.get("company")) or _text(profile.get("organization"))
    home = next((u for k in ("website", "homepage", "blog", "websiteUrl") if (u := _url(profile.get(k)))), "")
    links = {"huggingface": f"https://huggingface.co/{username}"}
    public_links = profile.get("links")
    github = _url(public_links.get("github")) if isinstance(public_links, dict) else ""
    github = github or _url(profile.get("github"))
    # Hub overview details may contain a public GitHub profile link.
    if not github:
        for candidate in re.findall(r"https?://[^\s<>\[\]()]+", _text(profile.get("details"))):
            candidate = _url(candidate.rstrip(".,;"))
            parsed = urllib.parse.urlsplit(candidate)
            handle = parsed.path.strip("/")
            if parsed.hostname in {"github.com", "www.github.com"} and _HANDLE.fullmatch(handle):
                github = candidate
                break
    if github and urllib.parse.urlsplit(github).hostname in {"github.com", "www.github.com"}:
        links["github"] = github
    return Entity(
        # A personal site on its own domain is somewhere an email can be found;
        # shared hosts (github.io, huggingface.co, ...) are not.
        full_name=name, title="ML contributor", organization=org, domain=_usable_domain("", home),
        website=home or links["huggingface"], location=_text(profile.get("location")),
        links=links, extra={"vertical": "ML developers", "huggingface": username}, source="huggingface",
    )


class HuggingFaceSource(Source):
    name = "huggingface"
    kind = "people"
    vertical = "ML model & dataset authors"
    description = "Contributors to public Hugging Face models and datasets; no API key."

    def search(self, query: Query) -> Iterator[Entity]:
        term = _text(query.keyword) or _text(query.industry) or _text(query.title)
        if not term or query.count <= 0:
            return
        limit = min(max(query.count * 3, 20), 60)
        params = urllib.parse.urlencode({"search": term, "limit": str(limit)})
        authors: dict[str, str] = {}
        for kind in ("models", "datasets"):
            data = get_json(f"{API}/{kind}?{params}", headers=api_headers(),
                            cache=self.cache, ttl_ns="dataset")
            for author in parse_models(data):
                authors.setdefault(author.casefold(), author)

        def fetch(username: str) -> Entity | None:
            profile = get_json(
                f"{API}/users/{urllib.parse.quote(username, safe='')}/overview",
                headers=api_headers(), cache=self.cache, ttl_ns="dataset",
            )
            return parse_profile(username, profile)

        # Bound both requests and workers; never follow an API-supplied request URL.
        # ordered_map pulls lazily and never waits on in-flight fetches once the
        # engine has enough leads or runs out of time.
        yielded = 0
        for entity in _concurrency.ordered_map(fetch, list(authors.values())[:limit], 4):
            if entity is not None:
                yield entity
                yielded += 1
                if yielded >= query.count:
                    return
