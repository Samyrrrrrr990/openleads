"""
GitHub source — developers and the orgs/companies behind public repos.

Uses the keyless GitHub REST API (60 req/hr unauthenticated; set ``GITHUB_TOKEN``
for 5,000/hr). A developer's public profile often exposes a real name, a company,
and a personal/site URL — enough for the email engine to do its job. When a user
has a public email, we use its domain directly.
"""
from __future__ import annotations

import time
from typing import Iterator

from openleads._http import get_json
from openleads.config import github_token
from openleads.emails.permute import domain_of
from openleads.models import Entity, Query
from openleads.sources.base import Source

API = "https://api.github.com"


def _headers() -> dict:
    h = {"Accept": "application/vnd.github+json"}
    tok = github_token()
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


def parse_user(profile: dict) -> Entity | None:
    """Turn a GitHub user profile JSON into an Entity (pure/testable)."""
    if not isinstance(profile, dict) or not profile.get("login"):
        return None
    name = (profile.get("name") or "").strip()
    if not name:
        return None  # no real name → can't build a person email
    email = (profile.get("email") or "").strip()
    blog = (profile.get("blog") or "").strip()
    domain = ""
    if email and "@" in email:
        domain = email.split("@", 1)[1].lower()
    elif blog:
        domain = domain_of(blog) or ""
    return Entity(
        full_name=name,
        title=(profile.get("bio") or "Developer").strip()[:80],
        organization=(profile.get("company") or "").lstrip("@").strip(),
        domain=domain,
        website=blog,
        location=(profile.get("location") or "").strip(),
        links={"github": profile.get("html_url", ""), "blog": blog},
        extra={
            "public_email": email,
            "followers": profile.get("followers", 0),
            "public_repos": profile.get("public_repos", 0),
            "vertical": "developers",
        },
        source="github",
    )


class GitHubSource(Source):
    name = "github"
    kind = "people"
    vertical = "developers & open-source orgs"
    description = "Developers and company maintainers via the keyless GitHub API."

    def search(self, query: Query) -> Iterator[Entity]:
        term = query.keyword or query.industry or "language:python"
        q = term
        if query.location:
            q += f" location:{query.location}"
        q += " type:user"
        search = get_json(f"{API}/search/users?q={_quote(q)}&per_page={min(query.count * 2, 100)}",
                          headers=_headers(), cache=self.cache, ttl_ns="dataset")
        items = (search or {}).get("items") or []
        for it in items:
            login = it.get("login")
            if not login:
                continue
            profile = get_json(f"{API}/users/{login}", headers=_headers(),
                               cache=self.cache, ttl_ns="dataset")
            ent = parse_user(profile or {})
            if ent:
                yield ent
            time.sleep(0.2)  # be gentle with the keyless rate limit


def _quote(s: str) -> str:
    import urllib.parse
    return urllib.parse.quote(s)
