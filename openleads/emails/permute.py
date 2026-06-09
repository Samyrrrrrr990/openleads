"""
Name → domain → candidate email permutations.

Pure helpers (no network) so they unit-test cleanly. Patterns are ordered by
real-world prevalence at small companies (``first.last`` and ``first`` dominate).
"""
from __future__ import annotations

import re

# Role / generic mailboxes we never want to guess as a person's address.
ROLE_LOCALS = {
    "info", "admin", "support", "sales", "hello", "contact", "team", "office",
    "help", "billing", "careers", "jobs", "press", "media", "noreply", "no-reply",
    "webmaster", "postmaster", "abuse", "marketing", "hr", "legal",
}

# Domains that exist only to throw mail away — never worth verifying.
DISPOSABLE_DOMAINS = {
    "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
    "trashmail.com", "yopmail.com", "throwawaymail.com", "getnada.com",
}


def domain_of(website: str) -> str | None:
    """Reduce a URL/host to a bare lowercase domain. ``https://www.Acme.com/x`` → ``acme.com``."""
    if not website:
        return None
    d = re.sub(r"^https?://", "", website.strip(), flags=re.I)
    d = d.split("/")[0].split("?")[0].strip().lower()
    if d.startswith("www."):
        d = d[4:]
    return d or None


def name_parts(full_name: str) -> tuple[str | None, str | None]:
    """Split a display name into ASCII-folded (first, last) local-part tokens."""
    toks = [re.sub(r"[^a-z]", "", t.lower()) for t in (full_name or "").split()]
    toks = [t for t in toks if t]
    if not toks:
        return None, None
    first = toks[0]
    last = toks[-1] if len(toks) > 1 else ""
    return first, last


def candidate_emails(full_name: str, domain: str) -> list[str]:
    """Generate likely addresses for ``full_name`` at ``domain``, most-likely first."""
    first, last = name_parts(full_name)
    if not first:
        return []
    if last:
        locals_ = [
            f"{first}.{last}", f"{first}", f"{first}{last}",
            f"{first[0]}{last}", f"{first}_{last}", f"{first[0]}.{last}", f"{last}",
        ]
    else:
        locals_ = [first]
    seen, out = set(), []
    for lp in locals_:
        if lp and lp not in seen:
            seen.add(lp)
            out.append(f"{lp}@{domain}")
    return out


def is_role_account(email: str) -> bool:
    """True if the local-part is a generic/role mailbox (info@, sales@, ...)."""
    local = email.split("@", 1)[0].lower()
    return local in ROLE_LOCALS


def is_disposable(domain: str) -> bool:
    """True if the domain is a known disposable/throwaway mail provider."""
    return (domain or "").lower() in DISPOSABLE_DOMAINS


def is_common_pattern(email: str, full_name: str) -> bool:
    """True if ``email`` uses one of the two most prevalent patterns (first / first.last)."""
    first, last = name_parts(full_name)
    if not first:
        return False
    local = email.split("@", 1)[0].lower()
    common = {first}
    if last:
        common.add(f"{first}.{last}")
    return local in common
