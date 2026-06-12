"""
Domains source — Hunter-style company search: give it a domain, get real emails.

Point it at one or more company domains (or homepage URLs) and it returns the
**actual, published** addresses on those domains — harvested from the homepage,
``/contact``, ``/about``, ``/team`` and ``security.txt`` — plus the detected
local-part pattern. Every address it returns is real ground truth, so it lands as
``safe`` for free. This is OpenLeads' direct answer to "find emails at acme.com".

Usage (any of):

    openleads find --source domains --keyword "acme.com, stripe.com"
    openleads find -s domains "acme.com example.org"
    (chat)  find emails at acme.com

It's keyless and local-first like everything else; the only network calls are the
cached page fetches the engine already knows how to make.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Iterator

from openleads.emails import groundtruth
from openleads.emails.permute import domain_of, is_probable_domain, is_role_account, local_tokens
from openleads.models import Entity, Query
from openleads.sources.base import Source

_TOKEN_SPLIT = re.compile(r"[,\s]+")


def parse_domains(text: str) -> list[str]:
    """Extract real company domains from a free-text list of domains / URLs (pure)."""
    out: list[str] = []
    seen: set[str] = set()
    for tok in _TOKEN_SPLIT.split(text or ""):
        tok = tok.strip().strip(".,;")
        if not tok:
            continue
        dom = domain_of(tok) if "/" in tok or tok.startswith("http") else tok.lower()
        # Keep only real registrable domains (rejects react.js, config.yaml, …).
        if dom and is_probable_domain(dom) and dom not in seen:
            seen.add(dom)
            out.append(dom)
    return out


def _name_from_local(local: str) -> str:
    """Reconstruct a display name from a structured local-part ('ada.lovelace')."""
    return " ".join(p.capitalize() for p in local_tokens(local)[:2])


def address_to_entity(email: str, domain: str) -> Entity:
    """Turn a harvested ``@domain`` address into a ground-truth Entity."""
    local = email.split("@", 1)[0]
    role = is_role_account(email)
    name = "" if role else _name_from_local(local)
    title = "Team / contact address" if role else "Contact at this company"
    return Entity(
        full_name=name,
        title=title,
        organization=domain,
        domain=domain,
        website=f"https://{domain}",
        links={},
        extra={
            "public_email": email,             # real address → ground truth → safe
            "vertical": "company contacts",
            "role_address": role,
        },
        source="domains",
    )


class DomainsSource(Source):
    name = "domains"
    kind = "company"
    vertical = "any company domain (Hunter-style email search)"
    description = "Real published emails for any domain you name (homepage/contact/team/security.txt)."

    def search(self, query: Query) -> Iterator[Entity]:
        raw = " ".join(filter(None, (query.keyword, query.industry, query.location)))
        domains = parse_domains(raw)
        if not domains:
            return

        def harvest(domain: str):
            return domain, groundtruth.harvest_from_site(domain, cache=self.cache)

        with ThreadPoolExecutor(max_workers=min(8, len(domains))) as ex:
            for domain, emails in ex.map(harvest, domains):
                seen: set[str] = set()
                # Real people (structured locals) first, then role/contact addresses.
                for email in sorted(emails, key=lambda e: is_role_account(e)):
                    if email in seen:
                        continue
                    seen.add(email)
                    yield address_to_entity(email, domain)
