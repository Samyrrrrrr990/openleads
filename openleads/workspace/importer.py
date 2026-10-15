"""
CSV import — bring contacts in from Apollo, HubSpot, a LinkedIn export, a
spreadsheet, or anything with an email column.

:func:`detect_mapping` matches headers to contact fields by name ("Email Address",
"Work Email", "E-mail" → email; "Company Name for Emails", "Account" → company; …),
so the usual exports import with no setup. :func:`preview` shows the mapping and a
sample before anything is written. :func:`import_rows` upserts contacts, merging
into existing ones without blanking fields the file leaves empty, then applies
tags, a list and a stage.

Rows without an email are reported, not dropped silently: they need enrichment
(``openleads enrich``) to find an address first.
"""
from __future__ import annotations

import csv
import io
import re

from openleads.workspace import activity
from openleads.workspace import lists as listmod
from openleads.workspace import tags as tagmod

# field → header spellings (normalized: lowercase, alphanumerics only), best first.
FIELD_ALIASES = {
    "email": ("email", "emailaddress", "workemail", "businessemail", "email1", "emails",
              "primaryemail", "contactemail", "mail"),
    "first_name": ("firstname", "first", "givenname", "fname"),
    "last_name": ("lastname", "last", "surname", "familyname", "lname"),
    "name": ("name", "fullname", "contactname", "personname", "contact"),
    "title": ("title", "jobtitle", "position", "role", "headline", "designation"),
    "organization": ("company", "companyname", "companynameforemails", "organization",
                     "organisation", "organizationname", "account", "accountname", "employer",
                     "business", "businessname"),
    "website": ("website", "websiteurl", "companywebsite", "url", "companyurl", "domain",
                "companydomain", "web"),
    "phone": ("phone", "phonenumber", "mobile", "mobilephone", "workdirectphone", "firstphone",
              "directphone", "corporatephone", "telephone", "tel", "cell"),
    "linkedin_url": ("linkedin", "linkedinurl", "personlinkedinurl", "linkedinprofile",
                     "profileurl", "linkedinprofileurl"),
    "city": ("city", "town", "personcity"),
    "state": ("state", "region", "province", "stateregion", "county"),
    "country": ("country", "countryregion", "nation"),
    "industry": ("industry", "sector", "vertical"),
    "employees": ("employees", "numberofemployees", "companysize", "headcount", "size",
                  "employeecount", "staff"),
    "tags": ("tags", "tag", "labels", "label"),
    "stage": ("stage", "contactstage", "lifecyclestage", "leadstatus", "status"),
    "notes": ("notes", "note", "comments", "comment", "description"),
}
FIELDS = tuple(FIELD_ALIASES)
_EMAIL_RE = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[a-z]{2,}$", re.I)
_STAGE_WORDS = {
    "new": "new", "cold": "new", "lead": "new", "subscriber": "new", "open": "new",
    "approaching": "approaching", "contacted": "approaching", "attempted": "approaching",
    "in progress": "approaching", "replied": "replied", "interested": "interested",
    "qualified": "interested", "sql": "interested", "mql": "interested",
    "opportunity": "meeting", "meeting": "meeting", "customer": "customer",
    "not interested": "not_interested", "unqualified": "not_interested",
    "unresponsive": "unresponsive", "do not contact": "do_not_contact",
    "bad data": "bad_data", "bad timing": "not_interested",
}
MAX_ROWS = 50000


def norm_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(h or "").lower())


def detect_mapping(headers) -> dict:
    """``{header: field}`` for the headers we recognize (each field used once)."""
    normed = [(h, norm_header(h)) for h in headers or []]
    mapping: dict = {}
    used: set = set()
    # Exact alias matches first, in alias priority order; then "contains" matches.
    for field, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            hit = next((h for h, n in normed if n == alias and h not in mapping), None)
            if hit is not None and field not in used:
                mapping[hit] = field
                used.add(field)
                break
    for h, n in normed:
        if h in mapping or not n:
            continue
        for field, aliases in FIELD_ALIASES.items():
            if field in used:
                continue
            if any(len(a) >= 5 and a in n for a in aliases):
                mapping[h] = field
                used.add(field)
                break
    return mapping


def parse_csv(text: str) -> tuple:
    """``(headers, rows)`` from CSV text; sniffs comma / semicolon / tab."""
    text = (text or "").lstrip("﻿")
    if not text.strip():
        return [], []
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    rows = []
    for i, row in enumerate(reader):
        if i >= MAX_ROWS:
            break
        rows.append({k: (v or "").strip() for k, v in row.items() if k is not None})
    return list(reader.fieldnames or []), rows


def map_row(row: dict, mapping: dict) -> dict:
    """One CSV row → a contact dict (fields only, blanks dropped)."""
    out: dict = {}
    for header, field in mapping.items():
        val = str(row.get(header) or "").strip()
        if val and field not in out:
            out[field] = val
    if "email" in out:
        out["email"] = out["email"].strip("<> ").split(",")[0].split(";")[0].strip().lower()
    if "name" in out and not (out.get("first_name") or out.get("last_name")):
        parts = out["name"].split()
        out["first_name"], out["last_name"] = parts[0], " ".join(parts[1:])
    out.pop("name", None)
    site = out.get("website", "")
    if site and not site.startswith(("http://", "https://")):
        host = site.split("/")[0]
        if host.lower().startswith("www."):
            host = host[4:]
        out["website"] = f"https://{host}" if "." in host else ""
    if out.get("phone"):
        from openleads.insights.phones import normalize
        out["phone"] = normalize(out["phone"]) or out["phone"]
    if "stage" in out:
        out["stage"] = stage_from_text(out["stage"])
    return out


def stage_from_text(text: str) -> str:
    low = str(text or "").strip().lower().replace("_", " ").replace("-", " ")
    return _STAGE_WORDS.get(low, "")


def preview(text: str, mapping: dict | None = None, limit: int = 5) -> dict:
    headers, rows = parse_csv(text)
    mapping = mapping or detect_mapping(headers)
    mapped = [map_row(r, mapping) for r in rows]
    with_email = sum(1 for m in mapped if _EMAIL_RE.match(m.get("email", "")))
    return {"headers": headers, "mapping": mapping, "fields": list(FIELDS),
            "total": len(rows), "with_email": with_email,
            "without_email": len(rows) - with_email, "sample": mapped[:limit],
            "unmapped": [h for h in headers if h not in mapping]}


def import_rows(db, rows, mapping: dict | None = None, list_name: str = "", tags=None,
                stage: str = "", source: str = "import", update_existing: bool = True) -> dict:
    """Upsert rows into the CRM. Returns counts plus the affected emails."""
    from openleads.workspace import notes as notemod
    from openleads.workspace import people
    if isinstance(rows, str):
        headers, rows = parse_csv(rows)
        mapping = mapping or detect_mapping(headers)
    elif mapping is None:
        mapping = detect_mapping(list(rows[0].keys()) if rows else [])
    created, updated, emails = 0, 0, []
    skipped: list = []
    no_email = 0
    for i, row in enumerate(rows or []):
        c = map_row(row, mapping)
        email = c.get("email", "")
        if not email:
            no_email += 1
            continue
        if not _EMAIL_RE.match(email):
            skipped.append({"row": i + 1, "email": email, "reason": "not a valid email"})
            continue
        existing = db.get_lead(email)
        if existing and not update_existing:
            skipped.append({"row": i + 1, "email": email, "reason": "already in CRM"})
            continue
        row_tags = c.pop("tags", "")
        row_note = c.pop("notes", "")
        row_stage = c.pop("stage", "") or stage
        if existing:
            base = _existing_dict(db, existing)
            base.update({k: v for k, v in c.items() if v})
            db.upsert_lead(base)
            updated += 1
        else:
            c.update(source=source, tier="")
            db.upsert_lead(c)
            created += 1
            activity.log(db, "contact", email, "imported", source, {"row": i + 1})
        if row_stage:
            people.update(db, email, {"stage": row_stage})
        all_tags = [t for t in re.split(r"[,;|]", row_tags or "") if t.strip()] + list(
            tags or [])
        if all_tags:
            tagmod.add(db, [email], all_tags)
        if row_note:
            notemod.add(db, "contact", email, row_note)
        emails.append(email)
    lst = None
    if list_name and emails:
        lst = listmod.ensure(db, list_name, "people")
        listmod.add(db, lst["id"], emails)
    if emails:
        from openleads.workspace import scoring
        scoring.rescore(db, emails)
    return {"created": created, "updated": updated, "no_email": no_email, "skipped": skipped,
            "emails": emails, "list": lst}


def _existing_dict(db, row: dict) -> dict:
    """The stored lead as a dict suitable for re-upserting (keeps tier, signals…)."""
    import json
    try:
        data = json.loads(row.get("data") or "{}")
    except ValueError:
        data = {}
    base = {k: row.get(k) for k in ("email", "first_name", "last_name", "title", "organization",
                                     "tier", "score", "source", "city", "state", "country",
                                     "phone", "linkedin_url", "website", "industry", "employees")}
    return {**data, **{k: v for k, v in base.items() if v not in (None, "")}}
