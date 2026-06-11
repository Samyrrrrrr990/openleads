"""
Plain-text rendering helpers (stdlib only).

Used by the non-interactive CLI and as the chat REPL's fallback when the
``[chat]`` extra (rich/prompt_toolkit) isn't installed. Keeping this dependency
free means OpenLeads looks decent with nothing but Python.
"""
from __future__ import annotations

from collections import Counter

from openleads.models import Lead

TAGS = {
    "verified": "OK ",
    "catch_all_guess": "~CA",
    "pattern_guess": "~PG",
    "none": "  -",
}


def lead_line(lead: Lead, idx: int, total: int) -> str:
    tag = TAGS.get(lead.confidence, "  ?")
    email = lead.email or "(no email — public record)"
    who = f"{lead.first_name} {lead.last_name}".strip() or lead.organization
    title = f" ({lead.title})" if lead.title else ""
    org = f" @ {lead.organization}" if lead.organization else ""
    score = f"  score {lead.score}" if lead.email else ""
    return f"  [{idx:>2}/{total}] {tag} {email:<34} {who}{title}{org}{score}"


def summary_line(leads: list[Lead]) -> str:
    tiers = Counter(ld.tier for ld in leads)
    safe = tiers.get("safe", 0)
    risky = tiers.get("risky", 0)
    return (f"[summary] {len(leads)} leads · {safe} safe (deliverable) · "
            f"{risky} risky (unconfirmed)")


def banner() -> str:
    from openleads import __version__
    return (
        "================================================================\n"
        f"  OpenLeads v{__version__} — find anyone, verify deliverably, send\n"
        "  founders · developers · doctors · researchers · anyone · free\n"
        "================================================================"
    )
