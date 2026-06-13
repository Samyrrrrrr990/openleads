"""
List enrichment — bring your own people/companies, get verified emails.

This is the Clay-style "I already have a list" workflow, free and local. Feed it a
CSV (or rows) carrying any mix of name, company, domain, and email, and it runs the
same waterfall the finder uses:

* a row with an **email** → verify it (MX/SMTP/Gravatar/ground-truth) and tier it.
* a row with **name + domain** → find + verify the most likely address.
* a row with **domain only** → harvest the company's published addresses + discover
  people, then verify.

Header matching is forgiving ("First Name", "company", "Domain", "Email" …). Every
enriched row becomes a :class:`~openleads.models.Lead`, is saved to the local CRM,
and can be written out, drafted, sequenced, or exported like any other lead.
"""
from __future__ import annotations

import csv
from concurrent.futures import ThreadPoolExecutor

from openleads.emails.permute import domain_of, is_probable_domain
from openleads.emails.resolve import find_email, verify_address
from openleads.engine import entity_to_lead
from openleads.models import Entity, Lead

# Forgiving header → field mapping (lowercased, stripped).
HEADER_ALIASES = {
    "first name": "first_name", "firstname": "first_name", "first": "first_name",
    "last name": "last_name", "lastname": "last_name", "last": "last_name",
    "name": "name", "full name": "name", "fullname": "name",
    "email": "email", "email address": "email", "e-mail": "email",
    "company": "company", "organization": "company", "organization name": "company",
    "org": "company", "company name": "company", "account": "company",
    "domain": "domain", "website": "domain", "url": "domain", "site": "domain",
    "title": "title", "job title": "title", "role": "title", "position": "title",
    "linkedin": "linkedin_url", "linkedin url": "linkedin_url",
    "city": "city", "country": "country", "location": "location",
    # identity entries so normalize_row is idempotent (safe to re-normalize)
    "first_name": "first_name", "last_name": "last_name", "linkedin_url": "linkedin_url",
}


def normalize_row(raw: dict) -> dict:
    """Map an arbitrary CSV/dict row to OpenLeads field names (pure)."""
    out: dict = {}
    for key, value in (raw or {}).items():
        field = HEADER_ALIASES.get((key or "").strip().lower())
        if field and isinstance(value, str):
            out[field] = value.strip()
        elif field:
            out[field] = value
    # Split a single "name" into first/last if those weren't given separately.
    if out.get("name") and not (out.get("first_name") or out.get("last_name")):
        parts = out["name"].split()
        out["first_name"] = parts[0]
        out["last_name"] = " ".join(parts[1:])
    return out


def read_rows(path: str) -> list[dict]:
    """Read + normalize a CSV file into enrichment rows."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [normalize_row(r) for r in csv.DictReader(f)]


def _domain_for(row: dict) -> str:
    """Best domain for a row: explicit domain/website, else the email's, else a
    company token that is itself a domain."""
    d = row.get("domain") or ""
    dom = domain_of(d) if ("/" in d or d.startswith("http")) else d.lower().strip()
    if dom and is_probable_domain(dom):
        return dom
    email = (row.get("email") or "").lower().strip()
    if "@" in email:
        return email.split("@", 1)[1]
    comp = (row.get("company") or "").lower().strip()
    if is_probable_domain(comp):
        return comp
    return ""


def row_to_entity(row: dict) -> Entity:
    """Turn a normalized row into an Entity (domain may be empty → honest record)."""
    full = (f"{row.get('first_name','')} {row.get('last_name','')}").strip() \
        or row.get("name", "")
    domain = _domain_for(row)
    return Entity(
        full_name=full,
        title=row.get("title", ""),
        organization=row.get("company", "") or (domain or ""),
        domain=domain,
        website=f"https://{domain}" if domain else "",
        location=row.get("location", "") or row.get("city", ""),
        links={"linkedin": row.get("linkedin_url", "")},
        extra={"city": row.get("city", ""), "country": row.get("country", ""),
               "vertical": "enriched", "public_email": (row.get("email") or "").strip()},
        source="enrich",
    )


def _resolve(entity: Entity, cache, db, deep: bool):
    """Resolve one entity's email via the waterfall (verify a known one, or find)."""
    known = entity.extra.get("public_email") or ""
    if known and "@" in known:
        # The list already has an address — verify it as ground truth.
        return verify_address(known, cache=cache, db=db, deep=deep)
    if entity.domain and entity.full_name:
        return find_email(entity.full_name, entity.domain, cache=cache, db=db,
                          links=entity.links, deep=deep)
    if entity.domain:
        return find_email(entity.full_name, entity.domain, cache=cache, db=db,
                          links=entity.links, deep=deep,
                          known_email=known or None)
    from openleads.models import EmailResult
    return EmailResult(email="", confidence="none", score=0, tier="bad",
                       reasons=["no email or domain to enrich"],
                       signals={"reason": "no_domain"})


def enrich_rows(rows, cache=None, db=None, deep: bool = False,
                on_progress=None) -> list[Lead]:
    """Enrich + verify a list of rows. Returns Leads (also upserted to the CRM)."""
    on_progress = on_progress or (lambda *_: None)
    entities = [row_to_entity(normalize_row(r)) for r in rows]
    leads: list[Lead] = []
    workers = max(1, min(8, len(entities) or 1))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda e: _resolve(e, cache, db, deep), entities))
    for entity, result in zip(entities, results):
        lead = entity_to_lead(entity, result)
        leads.append(lead)
        if db is not None and lead.email:
            db.upsert_lead(lead.to_dict())
        on_progress("lead", lead)
    return leads


def enrich_file(path: str, cache=None, db=None, deep: bool = False,
                on_progress=None) -> list[Lead]:
    """Read a CSV and enrich every row."""
    return enrich_rows(read_rows(path), cache=cache, db=db, deep=deep,
                       on_progress=on_progress)
