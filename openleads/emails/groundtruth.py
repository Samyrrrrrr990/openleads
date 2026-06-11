"""
Ground-truth email harvesting — get *real* addresses for free.

The reason paid tools verify well is they've seen real emails. So have we, from
fully public sources, at $0:

* **GitHub commit metadata** — a developer's public push events expose the email
  they actually commit with (``commit.author.email``). We filter GitHub's
  ``noreply`` placeholders and keep real addresses. This is gold: an exact, in-use
  address *and* a free pattern lesson for that person's domain.
* **Website scrape** — a company's homepage, ``/contact``, and ``security.txt``
  routinely list ``mailto:`` addresses on their own domain.

A harvested address that matches our person is an **exact** ground-truth hit
(→ ``safe``). Any harvested address also teaches the per-domain pattern
(:mod:`openleads.emails.patterns`), making every *future* guess at that domain better.

Network helpers are thin; the parsing (``extract_emails``, ``is_noreply``) is pure
and unit-tested.
"""
from __future__ import annotations

import re

from openleads._http import get_json, get_text
from openleads.config import USER_AGENT, github_token

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_GH_NOREPLY = "users.noreply.github.com"


def is_noreply(email: str) -> bool:
    """True for GitHub/no-reply placeholder addresses we must discard."""
    low = (email or "").lower()
    return (_GH_NOREPLY in low or low.startswith("noreply@") or low.startswith("no-reply@")
            or "example.com" in low or low.endswith(".png") or low.endswith(".jpg"))


def extract_emails(text: str, domain: str | None = None) -> list[str]:
    """Pull addresses from arbitrary text (incl. ``mailto:`` links), deduped.

    If ``domain`` is given, keep only addresses on that domain. Pure/network-free.
    """
    if not text:
        return []
    found: list[str] = []
    seen = set()
    # mailto: links first (most intentional), then bare addresses.
    for m in re.findall(r"mailto:([^\"'>?\s]+)", text, re.I):
        found.append(m)
    found.extend(EMAIL_RE.findall(text))
    out = []
    dom = (domain or "").lower()
    for e in found:
        e = e.strip().strip(".").lower()
        if not e or e in seen or is_noreply(e):
            continue
        if "@" not in e:
            continue
        if dom and e.split("@", 1)[1] != dom:
            continue
        seen.add(e)
        out.append(e)
    return out


def harvest_from_site(domain: str, cache=None, timeout: int = 15) -> list[str]:
    """Scrape a domain's public pages for ``@domain`` addresses."""
    if not domain:
        return []
    found: list[str] = []
    seen = set()
    paths = ["", "/contact", "/about", "/team",
             "/.well-known/security.txt", "/security.txt"]
    for path in paths:
        url = f"https://{domain}{path}"
        text = get_text(url, timeout=timeout, cache=cache, ttl_ns="dataset")
        if not text:
            continue
        for e in extract_emails(text, domain):
            if e not in seen:
                seen.add(e)
                found.append(e)
        if len(found) >= 5:
            break
    return found


def harvest_from_github(login: str, cache=None, timeout: int = 15) -> list[str]:
    """Find real commit-author emails from a GitHub user's public push events."""
    if not login:
        return []
    headers = {"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}
    tok = github_token()
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    events = get_json(f"https://api.github.com/users/{login}/events/public?per_page=100",
                      headers=headers, timeout=timeout, cache=cache, ttl_ns="dataset")
    if not isinstance(events, list):
        return []
    out: list[str] = []
    seen = set()
    for ev in events:
        if ev.get("type") != "PushEvent":
            continue
        for commit in (ev.get("payload") or {}).get("commits") or []:
            email = ((commit.get("author") or {}).get("email") or "").strip().lower()
            if email and email not in seen and not is_noreply(email):
                seen.add(email)
                out.append(email)
    return out


def harvest(domain: str, links: dict | None = None, cache=None,
            deep: bool = False) -> list[str]:
    """Combine all sources into a deduped list of real addresses for a person/domain.

    ``links`` may carry a ``github`` URL (used when ``deep`` is set, since the GitHub
    API calls cost rate-limit budget). Site scraping is always attempted (cheap, cached).
    """
    out: list[str] = []
    seen = set()

    def add(emails):
        for e in emails:
            if e and e not in seen:
                seen.add(e)
                out.append(e)

    if deep and links:
        gh = links.get("github") or ""
        m = re.search(r"github\.com/([^/?#]+)", gh)
        if m:
            add(harvest_from_github(m.group(1), cache=cache))
    if domain:
        add(harvest_from_site(domain, cache=cache))
    return out
