"""
Name → domain → candidate email permutations, plus the shared local-part grammar.

Pure helpers (no network) so they unit-test cleanly. ``PATTERN_TEMPLATES`` is the
single source of truth for the local-part shapes we understand; both candidate
generation (here) and pattern learning (:mod:`openleads.emails.patterns`) use it,
so a learned pattern always round-trips to a candidate we can build.
"""
from __future__ import annotations

import re

# Local-part templates, ordered by real-world prevalence at small/mid companies.
# Tokens: {first} {last} {f}=first initial {l}=last initial
PATTERN_TEMPLATES = (
    "{first}.{last}",
    "{first}",
    "{first}{last}",
    "{f}{last}",
    "{first}_{last}",
    "{f}.{last}",
    "{last}",
    "{last}.{first}",
    "{first}.{f}",
    "{last}{f}",
)

# Role / generic mailboxes we never want to guess as a person's address.
ROLE_LOCALS = {
    "info", "admin", "support", "sales", "hello", "contact", "team", "office",
    "help", "billing", "careers", "jobs", "press", "media", "noreply", "no-reply",
    "webmaster", "postmaster", "abuse", "marketing", "hr", "legal", "accounts",
    "enquiries", "inquiries", "general", "mail", "newsletter", "notifications",
}

# Free / personal mailbox providers: a local-part shape there tells us nothing
# about anyone else, so we never pattern-guess or pattern-learn on these.
FREE_PROVIDERS = {
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
    "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "msn.com",
    "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
    "pm.me", "gmx.com", "gmx.de", "mail.com", "zoho.com", "yandex.com",
    "fastmail.com", "hey.com", "tutanota.com", "tuta.io",
}

# Domains that exist only to throw mail away — never worth verifying.
DISPOSABLE_DOMAINS = {
    "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
    "trashmail.com", "yopmail.com", "throwawaymail.com", "getnada.com",
    "temp-mail.org", "sharklasers.com", "guerrillamail.info", "grr.la",
    "maildrop.cc", "dispostable.com", "fakeinbox.com", "mailnesia.com",
    "mohmal.com", "emailondeck.com", "spamgourmet.com", "33mail.com",
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


# File/code suffixes that look like a TLD but never are — so "node.js",
# "config.yaml", "app.py" aren't mistaken for company domains.
_NON_TLD_SUFFIXES = {
    "js", "ts", "jsx", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "php", "java",
    "md", "txt", "json", "yaml", "yml", "toml", "ini", "cfg", "env", "lock",
    "sh", "bash", "zsh", "css", "scss", "html", "htm", "xml", "sql", "csv", "log",
    "png", "jpg", "jpeg", "gif", "svg", "pdf", "zip", "exe", "dll",
}


def is_probable_domain(token: str) -> bool:
    """True if ``token`` looks like a real registrable domain (acme.com), not a
    code/file token (react.js) or a sentence fragment."""
    token = (token or "").strip().strip(".,;:").lower()
    if not token or "@" in token or " " in token or "/" in token or "." not in token:
        return False
    tld = token.rsplit(".", 1)[1]
    return tld.isalpha() and 2 <= len(tld) <= 24 and tld not in _NON_TLD_SUFFIXES


def local_tokens(local_part: str) -> list[str]:
    """Split a structured local-part into its alphabetic name tokens.

    ``"ada.lovelace"`` → ``["ada", "lovelace"]``; the single source of truth for
    turning a harvested address back into name tokens (used by both name display
    and pattern learning so they never diverge)."""
    return [p for p in re.split(r"[._-]+", local_part or "") if p.isalpha()]


def name_parts(full_name: str) -> tuple[str | None, str | None]:
    """Split a display name into ASCII-folded (first, last) local-part tokens."""
    toks = [re.sub(r"[^a-z]", "", t.lower()) for t in (full_name or "").split()]
    toks = [t for t in toks if t]
    if not toks:
        return None, None
    first = toks[0]
    last = toks[-1] if len(toks) > 1 else ""
    return first, last


def fill(template: str, first: str, last: str) -> str | None:
    """Render a local-part template for a name. None if it needs a part we lack."""
    if not first:
        return None
    f = first[0] if first else ""
    last_initial = last[0] if last else ""
    if ("{last}" in template or "{l}" in template) and not last:
        return None
    try:
        return template.format(first=first, last=last, f=f, l=last_initial)
    except (KeyError, IndexError):
        return None


def candidate_emails(full_name: str, domain: str) -> list[str]:
    """Generate likely addresses for ``full_name`` at ``domain``, most-likely first."""
    first, last = name_parts(full_name)
    if not first:
        return []
    if not last:
        return [f"{first}@{domain}"]
    seen, out = set(), []
    for tmpl in PATTERN_TEMPLATES:
        lp = fill(tmpl, first, last)
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


def is_free_provider(domain: str) -> bool:
    """True if the domain is a free/personal mailbox provider (gmail.com, …)."""
    return (domain or "").lower() in FREE_PROVIDERS


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
