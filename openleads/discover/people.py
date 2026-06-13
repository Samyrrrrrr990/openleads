"""
People discovery — find the humans behind a company domain, for free.

Company sites routinely publish their team on ``/team``, ``/about``, ``/leadership``
and friends. We fetch those pages (concurrently, short timeout, cached) and pull out
``(name, title)`` pairs three ways, most reliable first:

1. **JSON-LD** ``Person`` objects (``@type: Person`` with ``name`` / ``jobTitle``) —
   structured and unambiguous.
2. **Adjacent text** — a person-looking name line followed closely by a title line
   ("Jane Smith" then "Chief Executive Officer").
3. **Inline "Name — Title"** — a single line joining the two with a dash/comma.

The parsing (``extract_people``) is pure so it unit-tests offline; only
``find_people`` touches the network. Discovered people are fed back into the email
waterfall (name + domain → verified address), which is how a bare company domain
turns into real, contactable decision-makers.
"""
from __future__ import annotations

import html as ihtml
import json
import re
from concurrent.futures import ThreadPoolExecutor

from openleads._http import get_text

# Pages most likely to list the team. Ordered by yield; fetched concurrently.
TEAM_PATHS = ("/team", "/about", "/about-us", "/leadership", "/our-team",
              "/people", "/company/team", "/company", "/our-people", "/staff",
              "/management", "/founders")

# Title must contain one of these to be accepted as a real role (keeps "Jane Smith
# / New York" from being read as a person+title pair).
ROLE_WORDS = (
    "founder", "co-founder", "cofounder", "ceo", "cto", "coo", "cfo", "cmo", "cpo",
    "president", "owner", "principal", "partner", "director", "manager", "head",
    "chief", "vp", "vice president", "lead", "engineer", "developer", "designer",
    "marketing", "sales", "operations", "product", "growth", "people", "talent",
    "recruit", "account", "success", "strategy", "counsel", "attorney", "lawyer",
    "physician", "doctor", "dentist", "nurse", "consultant", "analyst", "architect",
    "scientist", "officer", "executive", "specialist", "coordinator", "advisor",
)

_NON_PERSON = {
    "team", "about", "our", "the", "company", "contact", "careers", "home", "menu",
    "services", "products", "solutions", "blog", "news", "press", "privacy", "terms",
    "cookie", "login", "sign", "search", "follow", "subscribe", "copyright", "rights",
    "reserved", "all", "view", "read", "more", "learn", "get", "started", "demo",
    "inc", "llc", "ltd", "group", "agency", "studio", "labs", "ventures", "capital",
}

_NAME_RE = re.compile(r"[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,3}")
# "Jane Smith — CEO" / "Jane Smith, Head of Growth" / "Jane Smith - Founder"
_INLINE_RE = re.compile(
    r"([A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,3})\s*[—–\-,|:]\s*([A-Za-z][A-Za-z /&]+)")


def looks_like_person_name(text: str) -> bool:
    """Heuristic: a 2–4 word capitalized human name, not a nav label or org."""
    text = (text or "").strip()
    if not _NAME_RE.fullmatch(text):
        return False
    toks = text.split()
    if not (2 <= len(toks) <= 4):
        return False
    low = {t.lower().strip(".'’-") for t in toks}
    if low & _NON_PERSON:
        return False
    if text.isupper():
        return False
    return True


def _is_title(text: str) -> bool:
    low = (text or "").lower()
    return any(w in low for w in ROLE_WORDS) and len(text) <= 80


def _clean_title(text: str) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip(" ,—–-|:\t"))
    return t[:80]


def _from_jsonld(html_text: str) -> list[dict]:
    """Pull Person objects out of any JSON-LD blocks."""
    out: list[dict] = []
    for m in re.finditer(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html_text or "", re.I | re.S):
        raw = m.group(1).strip()
        try:
            data = json.loads(raw)
        except Exception:
            continue
        _walk_jsonld(data, out)
    return out


def _walk_jsonld(node, out: list[dict], depth: int = 0) -> None:
    if depth > 6:
        return
    if isinstance(node, list):
        for n in node:
            _walk_jsonld(n, out, depth + 1)
        return
    if not isinstance(node, dict):
        return
    typ = node.get("@type")
    types = typ if isinstance(typ, list) else [typ]
    if "Person" in types:
        name = (node.get("name") or "").strip()
        title = (node.get("jobTitle") or node.get("description") or "").strip()
        if name and looks_like_person_name(name):
            out.append({"name": name, "title": _clean_title(title) or "Team member"})
    for v in node.values():
        if isinstance(v, (list, dict)):
            _walk_jsonld(v, out, depth + 1)


def _visible_lines(html_text: str) -> list[str]:
    """Strip scripts/styles/tags → a list of non-empty visible text lines."""
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html_text or "", flags=re.I | re.S)
    # Turn block-ish tags into line breaks so names/titles separate cleanly.
    t = re.sub(r"<\s*(br|/p|/div|/li|/h[1-6]|/span|/td|/a)\s*>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "\n", t)
    t = ihtml.unescape(t)
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in t.split("\n")]
    return [ln for ln in lines if ln]


def extract_people(html_text: str, limit: int = 40) -> list[dict]:
    """Extract ``[{name, title}]`` from a team/about page (pure / network-free)."""
    people: list[dict] = []
    seen: set[str] = set()

    def add(name: str, title: str) -> None:
        name = re.sub(r"\s+", " ", name).strip()
        key = name.lower()
        if not name or key in seen or not looks_like_person_name(name):
            return
        seen.add(key)
        people.append({"name": name, "title": _clean_title(title) or "Team member"})

    for p in _from_jsonld(html_text):
        add(p["name"], p["title"])

    lines = _visible_lines(html_text)
    # Inline "Name — Title" on a single line.
    for ln in lines:
        for m in _INLINE_RE.finditer(ln):
            if _is_title(m.group(2)):
                add(m.group(1), m.group(2))
    # Adjacent lines: a name line followed within 2 lines by a title line.
    for i, ln in enumerate(lines):
        if looks_like_person_name(ln):
            for j in range(i + 1, min(i + 3, len(lines))):
                if _is_title(lines[j]):
                    add(ln, lines[j])
                    break
    return people[:limit]


def find_people(domain: str, cache=None, timeout: int = 8, limit: int = 25) -> list[dict]:
    """Discover real people (name + title) for a company ``domain`` from its site."""
    if not domain:
        return []

    def fetch(path: str) -> str | None:
        return get_text(f"https://{domain}{path}", timeout=timeout,
                        cache=cache, ttl_ns="dataset")

    found: list[dict] = []
    seen: set[str] = set()
    with ThreadPoolExecutor(max_workers=min(6, len(TEAM_PATHS))) as ex:
        for text in ex.map(fetch, TEAM_PATHS):
            if not text:
                continue
            for person in extract_people(text):
                key = person["name"].lower()
                if key not in seen:
                    seen.add(key)
                    found.append(person)
            if len(found) >= limit:
                break
    return found[:limit]
