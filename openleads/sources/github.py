"""
GitHub source — real, contactable developers (quality over quantity).

The keyless GitHub Search API returns a lot of *non-people*: topic accounts,
"awesome-x" list owners, bots, orgs. v3.1 filters hard for **actual humans we can
email**: a person-looking name plus a usable domain — a public profile email
(ground truth → ``safe`` for free) or a real personal/company site (not a social
or blog-platform host). Users without a usable domain are skipped, so the engine
never burns time on un-emailable accounts.

Keyless works (60 req/hr); set ``GITHUB_TOKEN`` for 5,000/hr and bigger pulls.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Iterator

from openleads._http import get_json
from openleads.config import github_token
from openleads.emails.permute import domain_of
from openleads.models import Entity, Query
from openleads.sources.base import Source

API = "https://api.github.com"

# Hosts that are never a person's "company domain" — social + blog platforms.
SOCIAL_HOSTS = {
    "youtube.com", "twitter.com", "x.com", "linkedin.com", "facebook.com",
    "instagram.com", "t.me", "telegram.me", "discord.gg", "discord.com",
    "patreon.com", "medium.com", "substack.com", "wordpress.com", "blogspot.com",
    "dev.to", "hashnode.com", "hashnode.dev", "github.io", "github.com",
    "gitlab.com", "bit.ly", "linktr.ee", "notion.site", "about.me", "gravatar.com",
}

# Words that betray a non-person (topic/list/org) account.
_NON_PERSON = {
    "machine", "learning", "deep", "awesome", "list", "lists", "data", "ml", "ai",
    "official", "team", "labs", "lab", "inc", "ltd", "org", "community", "group",
    "project", "framework", "library", "tutorial", "tutorials", "course", "courses",
    "university", "institute", "school", "academy", "foundation", "network",
    "systems", "solutions", "technologies", "software", "apps", "studio", "games",
    "media", "news", "blog", "resources", "tools", "api", "sdk", "bot", "the",
}


def _is_person_name(name: str) -> bool:
    """Heuristic: looks like a real human name, not a topic/org/list account."""
    name = (name or "").strip()
    if not (2 <= len(name) <= 40):
        return False
    toks = [t for t in re.split(r"[\s.]+", name) if t]
    if len(toks) < 2 or len(toks) > 4:
        return False
    low_toks = {t.lower() for t in toks}
    if low_toks & _NON_PERSON:
        return False
    letters = sum(c.isalpha() for c in name)
    if letters < len(name) * 0.6:        # mostly letters (not "ML-2024 list")
        return False
    if name.isupper():                   # ACRONYM ORGS
        return False
    return True


def _usable_domain(email: str, blog: str) -> str:
    """A domain we can email at: the public email's, else a non-social blog host."""
    if email and "@" in email:
        return email.split("@", 1)[1].lower()
    d = domain_of(blog) or ""
    if d and not any(d == h or d.endswith("." + h) for h in SOCIAL_HOSTS):
        return d
    return ""


def parse_user(profile: dict) -> Entity | None:
    """Turn a GitHub user profile into an Entity, or None if not an emailable person."""
    if not isinstance(profile, dict) or profile.get("type") == "Organization":
        return None
    name = (profile.get("name") or "").strip()
    if not _is_person_name(name):
        return None
    email = (profile.get("email") or "").strip()
    blog = (profile.get("blog") or "").strip()
    domain = _usable_domain(email, blog)
    if not domain:
        return None  # no way to reach them → skip (quality over quantity)
    return Entity(
        full_name=name,
        title=(profile.get("bio") or "Developer").strip()[:80] or "Developer",
        organization=(profile.get("company") or "").lstrip("@").strip(),
        domain=domain,
        website=blog,
        location=(profile.get("location") or "").strip(),
        links={"github": profile.get("html_url", ""), "blog": blog},
        extra={
            "public_email": email if email.endswith("@" + domain) else "",
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
    description = "Contactable developers via the keyless GitHub API (public email/site)."

    def search(self, query: Query) -> Iterator[Entity]:
        term = query.keyword or query.industry or "language:python"
        q = term
        if query.location:
            q += f" location:{query.location}"
        if "followers:" not in q:
            q += " followers:>3"          # bias toward established, real accounts
        q += " type:user"
        # Pull a generous candidate set — most get filtered to real, emailable people.
        n = min(max(query.count * 6, 30), 100)
        search = get_json(f"{API}/search/users?q={_quote(q)}&per_page={n}",
                          headers=_headers(), cache=self.cache, ttl_ns="dataset")
        logins = [it.get("login") for it in (search or {}).get("items", []) if it.get("login")]
        if not logins:
            return

        def fetch(login):
            return get_json(f"{API}/users/{login}", headers=_headers(),
                            cache=self.cache, ttl_ns="dataset")

        # Fetch profiles concurrently (much faster than the old sequential + sleep).
        with ThreadPoolExecutor(max_workers=6) as ex:
            for profile in ex.map(fetch, logins):
                ent = parse_user(profile or {})
                if ent:
                    yield ent


def _headers() -> dict:
    h = {"Accept": "application/vnd.github+json"}
    tok = github_token()
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


def _quote(s: str) -> str:
    import urllib.parse
    return urllib.parse.quote(s)
