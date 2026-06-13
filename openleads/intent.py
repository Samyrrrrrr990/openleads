"""
Natural-language → :class:`Query` intent parsing.

``rule_parse`` is a pure, deterministic, network-free parser that understands
requests like:

    "find 50 fintech founders, verified only"
    "pediatricians in California"
    "ML researchers at MIT as ndjson"
    "open source rust developers in Berlin"

It powers the chat REPL and the CLI's free-text ``find`` with **zero API key**.
If ``OPENROUTER_API_KEY`` is set, :func:`parse` can additionally route ambiguous
input through a free LLM (``llm_parse``) that returns the same structured Query —
but the rule parser alone is always enough to run at $0.
"""
from __future__ import annotations

import json
import re
import urllib.request

from openleads.config import openrouter_key
from openleads.emails.permute import is_probable_domain
from openleads.models import Query

# Vertical keyword → source name. First match wins (order matters).
SOURCE_KEYWORDS = [
    ("npi", ("doctor", "doctors", "physician", "physicians", "dentist", "dentists",
             "nurse", "nurses", "pediatric", "pediatrician", "pediatricians",
             "cardiolog", "dermatolog", "healthcare", "provider", "clinician",
             "psychiatr", "surgeon", "therapist", " md ", "medical")),
    ("openalex", ("researcher", "researchers", "professor", "professors", "academic",
                  "academics", "scientist", "scientists", "phd", "scholar",
                  "author of", "papers", "publication", "postdoc")),
    ("github", ("developer", "developers", "engineer", "engineers", "devs",
                "open source", "open-source", "maintainer", "maintainers",
                "programmer", "hacker", "github")),
    ("producthunt", ("producthunt", "product hunt", "makers", "indie hacker",
                     "launch", "trending products")),
    ("yc", ("founder", "founders", "startup", "startups", "ceo", "cto",
            "y combinator", "yc ", "co-founder", "cofounder", "executive")),
]

FORMATS = ("ndjson", "json", "csv")

# Tokens stripped when distilling the leftover keyword/industry.
_NOISE = {
    "find", "get", "me", "some", "a", "an", "the", "of", "with", "and", "for",
    "please", "show", "list", "give", "verified", "only", "email", "emails",
    "lead", "leads", "people", "person", "contacts", "contact", "that", "who",
    "as", "in", "at", "from", "to", "their", "all",
}


def _extract_count(text: str) -> int | None:
    m = re.search(r"\b(\d+)\b", text)
    return int(m.group(1)) if m else None


def _extract_location(text: str) -> str | None:
    # "in California", "in New York", "from Berlin" — capture a short place phrase.
    m = re.search(r"\b(?:in|from|located in)\s+([A-Za-z][A-Za-z .'-]{1,30}?)"
                  r"(?:\s+(?:with|who|that|verified|only|as|using)\b|[,.]|$)", text, re.I)
    if not m:
        return None
    place = m.group(1).strip().rstrip(".")
    # Reject if it's actually a vertical word ("in healthcare").
    low = place.lower()
    for _, kws in SOURCE_KEYWORDS:
        if any(low == k.strip() for k in kws):
            return None
    return place or None


# A bare domain / "emails at acme.com" → the Hunter-style `domains` source.
_DOMAIN_RE = re.compile(
    r"\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})\b", re.I)


def detect_domains(text: str) -> list[str]:
    """Return real company-domain tokens in ``text`` ('email at acme.com' → ['acme.com']).

    Code/file tokens (node.js, config.yaml) and abbreviations (inc., e.g.) are
    rejected via :func:`~openleads.emails.permute.is_probable_domain`, so a request
    like 'node.js engineers' is NOT hijacked to the domains source."""
    out: list[str] = []
    for m in _DOMAIN_RE.finditer(text or ""):
        tok = m.group(1).lower().rstrip(".")
        if is_probable_domain(tok) and tok not in out:
            out.append(tok)
    return out


def _detect_source(text: str) -> str | None:
    low = f" {text.lower()} "
    for name, kws in SOURCE_KEYWORDS:
        if any(kw in low for kw in kws):
            return name
    return None


def _detect_format(text: str) -> str:
    low = text.lower()
    for fmt in FORMATS:           # ndjson before json (substring)
        if re.search(rf"\b{fmt}\b", low):
            return fmt
    return "csv"


def _distill_keyword(text: str, location: str | None) -> str | None:
    low = text.lower()
    if location:
        low = low.replace(location.lower(), " ")
    # Remove source trigger words (longest first, whole-word) and format words.
    all_kws = sorted(
        {kw.strip() for _, kws in SOURCE_KEYWORDS for kw in kws},
        key=len, reverse=True,
    )
    for kw in all_kws:
        low = re.sub(rf"\b{re.escape(kw)}\b", " ", low)
    for fmt in FORMATS:
        low = re.sub(rf"\b{fmt}\b", " ", low)
    low = re.sub(r"\b\d+\b", " ", low)                # counts
    words = [w for w in re.findall(r"[a-z][a-z+.-]*", low) if w not in _NOISE]
    kw = " ".join(words).strip()
    return kw or None


def rule_parse(text: str) -> Query:
    """Deterministically parse free text into a :class:`Query`. Never raises."""
    text = (text or "").strip()
    q = Query()
    q.text = text                      # preserved so the federation planner can route
    if not text:
        return q

    low = text.lower()
    q.verified_only = bool(re.search(r"verified(\s+(only|emails?))?", low)) \
        or "only verified" in low
    count = _extract_count(text)
    if count:
        q.count = max(1, min(count, 1000))
    q.fmt = _detect_format(text)

    # A named domain ("emails at acme.com") wins: route to the Hunter-style
    # `domains` source and carry the domain list as the keyword.
    domains = detect_domains(text)
    if domains:
        q.source = "domains"
        q.keyword = ", ".join(domains)
        return q

    # v4: the federation layer routes across the sources that fit a query, so we no
    # longer hard-pin a single vertical source here — we extract the signals
    # (location, keyword) the planner needs. A typed domain (handled above) stays
    # the one unambiguous pin; an explicit `-s`/`/source` still overrides downstream.
    q.location = _extract_location(text)
    kw = _distill_keyword(text, q.location)
    if kw:
        q.keyword = kw
    return q


# --------------------------------------------------------------------------- #
# Optional free-LLM parsing (stdlib HTTP; no extra dependency).               #
# --------------------------------------------------------------------------- #
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
LLM_MODEL = "openai/gpt-oss-120b:free"

_LLM_SYSTEM = (
    "You convert a user's lead-generation request into a compact JSON object with "
    "keys: source (one of yc, github, npi, openalex, producthunt, or null), count "
    "(int), industry (str|null), location (str|null), keyword (str|null), title "
    "(str|null), verified_only (bool), fmt (csv|json|ndjson). Respond with ONLY the "
    "JSON object, no prose."
)


def llm_parse(text: str, timeout: int = 30) -> Query | None:
    """Parse via a free OpenRouter model. Returns None if unavailable or on error."""
    key = openrouter_key()
    if not key:
        return None
    body = json.dumps({
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": _LLM_SYSTEM},
            {"role": "user", "content": text},
        ],
        "temperature": 0,
    }).encode()
    req = urllib.request.Request(
        OPENROUTER_URL, data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.load(r)
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(re.search(r"\{.*\}", content, re.DOTALL).group(0))
    except Exception:
        return None
    return _query_from_dict(parsed)


def _query_from_dict(d: dict) -> Query:
    q = Query()
    if not isinstance(d, dict):
        return q
    if d.get("source") in {"yc", "github", "npi", "openalex", "producthunt"}:
        q.source = d["source"]
    try:
        q.count = max(1, min(int(d.get("count") or 20), 1000))
    except (TypeError, ValueError):
        pass
    for f in ("industry", "location", "keyword", "title"):
        v = d.get(f)
        if isinstance(v, str) and v.strip():
            setattr(q, f, v.strip())
    q.verified_only = bool(d.get("verified_only"))
    if d.get("fmt") in FORMATS:
        q.fmt = d["fmt"]
    return q


def parse(text: str, allow_llm: bool = True) -> tuple[Query, str]:
    """Parse ``text`` into ``(Query, mode)`` where mode is ``"rule"`` or ``"llm"``.

    Rule-based always runs (deterministic baseline). If a key is set and the input
    looks ambiguous, the LLM result is preferred. Mode lets the UI show which ran.
    """
    rq = rule_parse(text)
    if allow_llm and openrouter_key():
        lq = llm_parse(text)
        if lq is not None:
            return lq, "llm"
    return rq, "rule"
