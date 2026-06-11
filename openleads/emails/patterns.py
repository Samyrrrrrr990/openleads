"""
Per-domain email *pattern learning* — the deliverability flywheel.

Apollo and Hunter win because they've *observed* real addresses. So do we, for
free: every time a ground-truth email turns up for a domain (a GitHub commit, a
``mailto:``, an SMTP-verified hit), we infer the company's local-part *shape* and
remember it (in :class:`openleads.db.DB`). The next person we resolve at that domain
inherits the learned pattern, so a single observation upgrades every future guess
there from a shot in the dark to a near-certainty.

All functions here are pure (no network, no I/O) so the inference is unit-tested
directly; persistence is delegated to the caller's ``db``.
"""
from __future__ import annotations

from openleads.emails.permute import (
    PATTERN_TEMPLATES,
    fill,
    is_free_provider,
    name_parts,
)


def derive_pattern(local_part: str, full_name: str) -> str | None:
    """Infer which template produced ``local_part`` for ``full_name``.

    e.g. ``derive_pattern("ada.lovelace", "Ada Lovelace")`` -> ``"{first}.{last}"``.
    Returns the most specific matching template, or None if nothing matches.
    """
    first, last = name_parts(full_name)
    if not first:
        return None
    local = (local_part or "").lower().strip()
    # Prefer the most *informative* template (longest rendered form) to avoid
    # e.g. "{first}" matching "adalovelace" when "{first}{last}" is the real one.
    matches = []
    for tmpl in PATTERN_TEMPLATES:
        rendered = fill(tmpl, first, last)
        if rendered and rendered == local:
            matches.append(tmpl)
    if not matches:
        return None
    matches.sort(key=lambda t: len(fill(t, first, last) or ""), reverse=True)
    return matches[0]


def learn_from_email(db, email: str, full_name: str) -> str | None:
    """Derive a pattern from a real ``email`` for ``full_name`` and persist it.

    Returns the learned pattern (or None). Skips free/personal providers, where a
    local-part shape says nothing about anyone else.
    """
    if not email or "@" not in email or db is None:
        return None
    local, _, domain = email.lower().partition("@")
    if is_free_provider(domain):
        return None
    pattern = derive_pattern(local, full_name)
    if pattern:
        db.learn_pattern(domain, pattern)
    return pattern


def learned_candidates(db, full_name: str, domain: str) -> list[str]:
    """Emails for ``full_name`` built from patterns already learned for ``domain``.

    Strongest-supported pattern first. Empty if nothing learned (or no db).
    """
    if db is None or not domain:
        return []
    first, last = name_parts(full_name)
    if not first:
        return []
    out: list[str] = []
    for row in db.patterns_for(domain):
        rendered = fill(row["pattern"], first, last)
        if rendered:
            addr = f"{rendered}@{domain.lower()}"
            if addr not in out:
                out.append(addr)
    return out


def matches_learned(db, email: str, full_name: str) -> bool:
    """True if ``email`` is exactly what a learned pattern for its domain predicts."""
    if db is None or not email or "@" not in email:
        return False
    domain = email.split("@", 1)[1].lower()
    return email.lower() in learned_candidates(db, full_name, domain)
