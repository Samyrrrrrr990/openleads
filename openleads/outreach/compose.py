"""
Compose personalized, deliverable cold emails.

Two ways to draft:

* **Free LLM** (OpenRouter free model) when a key is configured — world-class
  copy, personalized from the lead's real facts. Uses stdlib ``urllib`` so the
  core stays dependency-free.
* **Template** fallback when no key — a clean, deterministic, human draft so the
  tool always works at $0 with nothing configured.

Either way the output is run through :func:`spam_lint` (a deliverability check for
spam-trigger words, shouting, link-stuffing, and length) and guaranteed free of
``[placeholder]`` leftovers. Plain text is the default because it lands in inboxes;
HTML and tracking pixels do not.

The pure text helpers are also re-exported from ``openleads.campaign`` for v2
back-compat.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from openleads import settings
from openleads.models import Draft

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# --- pure text helpers (unit-tested, no I/O) ------------------------------- #
PLACEHOLDER_RE = re.compile(r"[\[\{][^\]\}]{0,50}[\]\}]")  # [anything] or {anything}


def clean_dashes(text: str) -> str:
    """Normalize exotic Unicode punctuation/spaces to plain ASCII (outreach style)."""
    repl = {
        "—": ",", "–": ",",
        "‑": "-", "‐": "-", "−": "-",
        "’": "'", "‘": "'",
        "“": '"', "”": '"',
        "…": "...",
    }
    for k, v in repl.items():
        text = text.replace(k, v)
    text = re.sub(r"[  -   　]", " ", text)
    text = re.sub(r"[​‌‍﻿]", "", text)
    return text


def has_placeholder(text: str) -> bool:
    return bool(PLACEHOLDER_RE.search(text))


def strip_placeholders(text: str) -> str:
    return re.sub(r"\s*" + PLACEHOLDER_RE.pattern, "", text).strip()


def format_body(body: str, first_name: str) -> str:
    """Guarantee a greeting line and blank lines between paragraphs."""
    body = (body or "").strip()
    body = re.sub(r"\n[ \t]+", "\n", body)
    body = re.sub(r"\n{3,}", "\n\n", body)
    lines = body.split("\n")
    first_line = lines[0].strip().lower() if lines else ""
    if any(first_line.startswith(w) for w in ("hi", "hey", "hello", "dear")):
        if len(lines) > 1 and lines[1].strip() != "":
            lines.insert(1, "")
            body = "\n".join(lines)
    else:
        name = (first_name or "").strip() or "there"
        body = f"Hey {name},\n\n{body}"
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def parse_response(response: str, company: str) -> tuple[str, str]:
    if "SUBJECT:" in response and "EMAIL:" in response:
        parts = response.split("EMAIL:", 1)
        subject = parts[0].replace("SUBJECT:", "").strip().split("\n")[0].strip()
        body = parts[1].strip()
    else:
        subject = f"Quick note for {company}".strip()
        body = response.strip()
    return subject, body


# --- spam linter (deliverability) ------------------------------------------ #
# Words/phrases that classically trip spam filters in cold email.
SPAM_TERMS = (
    "free", "100% free", "risk-free", "guarantee", "guaranteed", "act now",
    "limited time", "click here", "buy now", "order now", "cash", "winner",
    "congratulations", "you have been selected", "prize", "$$$", "earn money",
    "make money", "extra income", "double your", "investment", "credit card",
    "no cost", "cheap", "discount", "promo", "offer expires", "urgent",
    "amazing", "incredible", "miracle", "viagra", "weight loss", "crypto",
    "best price", "lowest price", "increase sales", "unsubscribe now",
)


def spam_lint(subject: str, body: str) -> dict:
    """Score outreach for spamminess (0 = clean, 100 = very spammy) with warnings."""
    text = f"{subject}\n{body}"
    low = text.lower()
    warnings: list[str] = []
    score = 0

    hits = sorted({t for t in SPAM_TERMS if t in low})
    if hits:
        score += min(40, 8 * len(hits))
        warnings.append(f"spam-trigger words: {', '.join(hits[:6])}")

    letters = [c for c in subject if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.5 and len(letters) > 4:
        score += 15
        warnings.append("subject is mostly UPPERCASE (shouting)")

    if text.count("!") >= 3:
        score += 12
        warnings.append("too many exclamation marks")

    links = len(re.findall(r"https?://", text))
    if links > 2:
        score += min(20, 6 * (links - 2))
        warnings.append(f"{links} links (keep cold email to 0-1)")

    if "$" in text or re.search(r"\b\d+%\b", text):
        score += 8
        warnings.append("money amounts / percentages read as salesy")

    words = len(re.findall(r"\w+", body))
    if words > 200:
        score += 12
        warnings.append(f"body is long ({words} words) — aim for <150")
    elif words < 20:
        score += 8
        warnings.append("body is very short — may look like a template")

    if has_placeholder(text):
        score += 30
        warnings.append("unfilled [placeholder] / {braces} present")

    score = max(0, min(100, score))
    return {"score": score, "warnings": warnings, "ok": score < 35}


# --- configuration --------------------------------------------------------- #
def sender_cfg(overrides: dict | None = None) -> dict:
    """Resolve sender/LLM config from settings, with optional per-call overrides."""
    cfg = {
        "api_key": settings.get("openrouter_api_key", ""),
        "model": settings.get("openrouter_model"),
        "sender": settings.get("sender_name") or "Me",
        "org": settings.get("sender_org") or "our team",
        "context": settings.get("sender_context")
        or "We're reaching out about a potential collaboration.",
    }
    if overrides:
        cfg.update({k: v for k, v in overrides.items() if v not in (None, "")})
    return cfg


# --- LLM drafting (stdlib HTTP) -------------------------------------------- #
def build_prompt(lead: dict, cfg: dict) -> str:
    first = lead.get("first_name") or "there"
    company = lead.get("organization") or lead.get("company", "")
    loc = f"{lead.get('city', '')}, {lead.get('country', '')}".strip(", ")
    li = lead.get("linkedin_url") or "not available"
    return f"""Act like a world-class cold emailer with 20+ years of experience, writing on behalf of {cfg['org']}.

LEAD (use these REAL values; never write a placeholder):
- First name: {first}
- Full name: {lead.get('first_name', '')} {lead.get('last_name', '')}
- Title: {lead.get('title', '')}
- Company: {company}
- Industry: {lead.get('industry', '')}
- Location: {loc}
- LinkedIn: {li}

ABOUT {cfg['org']}:
{cfg['context']}

OUTPUT ONLY this exact format:

SUBJECT: <one short, lowercase, specific subject line — no clickbait>

EMAIL:
Hey {first},

<paragraph one: a specific, genuine reason you're reaching out to THIS person>

<paragraph two: a soft, low-friction ask>

Best,
{cfg['sender']}

RULES:
- Write the ACTUAL name "{first}" and company "{company}". NEVER output [brackets] or {{braces}}.
- Blank line between greeting, each paragraph, and the signature.
- Under 120 words, punchy, human, specific. No em dashes (use commas). No spammy words."""


def call_llm(prompt: str, cfg: dict, max_tokens: int = 700, timeout: int = 60) -> str:
    """Call a free OpenRouter model via stdlib urllib. Raises on failure."""
    if not cfg.get("api_key"):
        raise RuntimeError("no OpenRouter key configured")
    body = json.dumps({
        "model": cfg["model"], "max_tokens": max_tokens, "temperature": 0.85,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request(
        OPENROUTER_URL, data=body,
        headers={"Authorization": f"Bearer {cfg['api_key']}",
                 "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.load(r)
    raw = data["choices"][0]["message"]["content"].strip()
    return re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()


def template_draft(lead: dict, cfg: dict) -> tuple[str, str]:
    """Deterministic, decent fallback draft when no LLM key is configured."""
    first = lead.get("first_name") or "there"
    company = lead.get("organization") or lead.get("company") or "your team"
    role = (lead.get("title") or "").strip()
    role_bit = f"your work as {role}" if role else f"what you're building at {company}"
    subject = f"quick question about {company}".lower()
    body = (
        f"Hey {first},\n\n"
        f"I came across {role_bit} and wanted to reach out. "
        f"{cfg['context']}\n\n"
        f"Would you be open to a quick chat? Happy to work around your schedule.\n\n"
        f"Best,\n{cfg['sender']}"
    )
    return subject, body


def draft(lead: dict, overrides: dict | None = None) -> Draft:
    """Produce a personalized :class:`Draft` for one lead (LLM if available, else template)."""
    cfg = sender_cfg(overrides)
    company = lead.get("organization") or lead.get("company", "")
    subject = body = ""
    model = "template"

    if cfg.get("api_key"):
        for _ in range(3):
            try:
                resp = call_llm(build_prompt(lead, cfg), cfg)
            except (urllib.error.URLError, urllib.error.HTTPError, OSError,
                    KeyError, ValueError, RuntimeError):
                break
            subject, body = parse_response(resp, company)
            subject = clean_dashes(subject)
            body = format_body(clean_dashes(body), lead.get("first_name", ""))
            model = cfg["model"]
            if not has_placeholder(subject) and not has_placeholder(body):
                break
        else:
            subject = strip_placeholders(subject)
            body = format_body(strip_placeholders(body), lead.get("first_name", ""))

    if not subject or not body:
        subject, body = template_draft(lead, cfg)
        model = "template"

    return Draft(
        email=lead.get("email", ""), subject=subject, body=body,
        first_name=lead.get("first_name", ""), organization=company,
        lint=spam_lint(subject, body), model=model,
    )
