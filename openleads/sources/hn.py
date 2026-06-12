"""
Hacker News "Who is hiring?" source — real companies hiring *right now*.

Every month, HN runs an "Ask HN: Who is hiring?" thread where companies post
``Company | Role | Location | …`` with a link and, very often, a **direct
apply email**. Those emails are ground truth — the email engine promotes them to
``safe`` for free — and the links give a real company domain to guess from.

It's all keyless via the public **Algolia HN Search API** (one batch call per
run), so it's fast and reliable — and the lead quality is excellent: current,
hiring, contactable B2B/tech companies. This is OpenLeads' answer to "give me
better leads than YC alone."
"""
from __future__ import annotations

import html as ihtml
import re
from typing import Iterator

from openleads._http import get_json
from openleads.emails.permute import domain_of
from openleads.models import Entity, Query
from openleads.sources.base import Source

ALGOLIA = "https://hn.algolia.com/api/v1"

# Applicant-tracking / aggregator hosts: great for a job link, wrong for an email
# domain — so we never treat these as the company's domain.
ATS_HOSTS = {
    "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "breezy.hr",
    "bamboohr.com", "smartrecruiters.com", "jobvite.com", "notion.site",
    "notion.so", "docs.google.com", "forms.gle", "airtable.com", "ycombinator.com",
    "linkedin.com", "twitter.com", "x.com", "youtube.com", "github.com",
    "angel.co", "wellfound.com", "indeed.com", "glassdoor.com",
    "grnh.se", "bit.ly", "tinyurl.com", "rb.gy",
}

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_URL = re.compile(r"https?://[^\s\"'<>)]+")
_ROLE_HINT = re.compile(
    r"(engineer|developer|designer|scientist|manager|lead|founder|cto|ceo|"
    r"head of|director|devops|sre|product|data|ml|ai|backend|frontend|full[\s-]?stack)",
    re.I)


def _clean(text_html: str) -> str:
    t = re.sub(r"<\s*/?p\s*>", "\n", text_html or "", flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return ihtml.unescape(t)


def _hrefs(text_html: str) -> list:
    """All href targets, HTML-unescaped (HN encodes '/' as &#x2f; in attributes)."""
    return [ihtml.unescape(h) for h in re.findall(r'href="([^"]+)"', text_html or "")]


def _company_name(first_line: str) -> str:
    name = first_line.split("|")[0]
    name = re.sub(r"\(YC[^)]*\)", "", name, flags=re.I)          # drop "(YC W24)"
    name = re.sub(r"https?://\S+", "", name)
    name = re.sub(r"\(\s*\)", "", name)                          # drop empty "( )"
    # Some posts have no '|' and run the company name straight into a sentence
    # ("Acme is hiring a senior engineer…"). Cut at the first clause/verb so we
    # store "Acme", not a whole sentence as the organization name.
    name = re.split(r"\b(?:is|are|—|–|-|:|,|\.| seeking| looking| hiring| wants"
                    r"| needs| we're| we are)\b", name, maxsplit=1, flags=re.I)[0]
    name = name.strip(" -—–:•/\\\t")
    # If it's still sentence-shaped (too many words), keep only the leading
    # proper-noun-ish run so the CRM isn't full of marketing copy.
    words = name.split()
    if len(words) > 6:
        name = " ".join(words[:6])
    return name[:60].strip()


def _pick_domain(urls: list, email: str) -> str:
    """The company's real domain: a non-ATS link, else the email's domain."""
    for u in urls:
        d = domain_of(u) or ""
        if d and not any(d == h or d.endswith("." + h) for h in ATS_HOSTS):
            return d
    if email and "@" in email:
        d = email.split("@", 1)[1].lower()
        if d and not any(d == h or d.endswith("." + h) for h in ATS_HOSTS):
            return d
    return ""


def parse_hiring_post(comment_html: str) -> Entity | None:
    """Parse one top-level 'Who is hiring' comment into an Entity (pure/testable).

    Returns None when there's no usable company domain (so the engine never wastes
    time on a post we can't turn into an email).
    """
    text = _clean(comment_html)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return None
    first = lines[0]
    company = _company_name(first)
    if not company or len(company) < 2:
        return None

    hrefs = _hrefs(comment_html)
    mailto = [h[7:].split("?", 1)[0].strip() for h in hrefs if h.lower().startswith("mailto:")]
    urls = [h for h in hrefs if h.lower().startswith("http")] + _URL.findall(text)
    emails = [e for e in (mailto + _EMAIL.findall(text))
              if "@" in e and not e.lower().endswith(("@example.com", "@domain.com"))]
    email = emails[0] if emails else ""
    domain = _pick_domain(urls, email)
    if not domain:
        return None  # no company domain → not actionable, skip

    # Role/title: prefer the segment after the first '|', else a role-ish phrase.
    title = ""
    segs = [s.strip() for s in first.split("|")]
    if len(segs) > 1 and _ROLE_HINT.search(segs[1]):
        title = segs[1][:80]
    if not title:
        m = _ROLE_HINT.search(text)
        title = "Hiring" if not m else text[max(0, m.start() - 0):m.start() + 40].strip()[:80]

    # Location: REMOTE / ONSITE / a "| City |" segment.
    loc = ""
    lm = re.search(r"\b(remote|onsite|hybrid)\b", first, re.I)
    if lm:
        loc = lm.group(1).upper()

    website = next((u for u in urls if (domain_of(u) or "") == domain), f"https://{domain}")
    public_email = next((e for e in emails if e.lower().endswith("@" + domain)), "")

    return Entity(
        full_name="",  # the *company* is the lead; a real apply-email needs no name
        title=title or "Hiring",
        organization=company,
        domain=domain,
        website=website,
        location=loc,
        links={"hn": ""},
        extra={
            "public_email": public_email,   # ground truth → instant 'safe'
            "vertical": "companies hiring",
            "summary": text.strip().replace("\n", " ")[:200],
        },
        source="hn",
    )


def _latest_thread_id(cache) -> str:
    """Find the newest 'Ask HN: Who is hiring?' story id (posted by whoishiring)."""
    data = get_json(
        f"{ALGOLIA}/search_by_date?tags=story,author_whoishiring&query=hiring&hitsPerPage=1",
        cache=cache, ttl_ns="dataset")
    hits = (data or {}).get("hits") or []
    return str(hits[0]["objectID"]) if hits else ""


class HNSource(Source):
    name = "hn"
    kind = "company"
    vertical = "companies hiring now (Hacker News)"
    description = "Companies from HN's monthly 'Who is hiring' — domains + real apply emails."

    def search(self, query: Query) -> Iterator[Entity]:
        sid = _latest_thread_id(self.cache)
        if not sid:
            return
        data = get_json(f"{ALGOLIA}/search?tags=comment,story_{sid}&hitsPerPage=100",
                        cache=self.cache, ttl_ns="dataset")
        hits = (data or {}).get("hits") or []
        term = (query.keyword or query.industry or "").lower().strip()
        loc = (query.location or "").lower().strip()
        try:
            sid_int = int(sid)
        except ValueError:
            sid_int = None

        seen: set = set()
        for h in hits:
            if sid_int is not None and h.get("parent_id") != sid_int:
                continue  # top-level posts only (skip reply chatter)
            raw = h.get("comment_text") or ""
            blob = _clean(raw).lower()
            if term and term not in blob:
                continue
            if loc and loc not in blob:
                continue
            ent = parse_hiring_post(raw)
            if not ent or ent.domain in seen:
                continue
            seen.add(ent.domain)
            yield ent
