"""
Output writers: CSV (v1-compatible), JSON (array), NDJSON (one lead per line), plus
CRM-shaped CSVs: ``apollo`` (Apollo's export column names, so import mappings built
for Apollo files work unchanged) and ``hubspot`` (HubSpot's contact import headers).

A single module (not an ``output/`` package) on purpose — ``output/`` is
gitignored for scraped data, and writers are small enough to live together.
"""
from __future__ import annotations

import csv
import json
import sys
from typing import Iterable

from openleads.models import CSV_FIELDS, Lead


def _open_out(path: str | None):
    """Return (file_obj, should_close). ``None`` or ``-`` means stdout."""
    if path in (None, "-"):
        return sys.stdout, False
    return open(path, "w", newline="", encoding="utf-8"), True


def write_csv(leads: list[Lead], path: str | None = "leads.csv") -> None:
    f, close = _open_out(path)
    try:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for lead in leads:
            w.writerow(lead.to_csv_row())
    finally:
        if close:
            f.close()


def write_json(leads: list[Lead], path: str | None = None) -> None:
    f, close = _open_out(path)
    try:
        json.dump([lead.to_dict() for lead in leads], f, indent=2, ensure_ascii=False)
        f.write("\n")
    finally:
        if close:
            f.close()


def write_ndjson(leads: Iterable[Lead], path: str | None = None) -> None:
    f, close = _open_out(path)
    try:
        for lead in leads:
            f.write(json.dumps(lead.to_dict(), ensure_ascii=False) + "\n")
    finally:
        if close:
            f.close()


# --- CRM-shaped CSVs --------------------------------------------------------- #
APOLLO_FIELDS = [
    "First Name", "Last Name", "Title", "Company", "Company Name for Emails", "Email",
    "Email Status", "Seniority", "Departments", "First Phone", "Corporate Phone",
    "# Employees", "Industry", "Keywords", "Person Linkedin Url", "Website",
    "Company Linkedin Url", "Facebook Url", "Twitter Url", "City", "Country",
    "SEO Description", "Technologies", "Source",
]
HUBSPOT_FIELDS = [
    "First Name", "Last Name", "Email", "Job Title", "Company Name", "Phone Number",
    "Website URL", "City", "Country/Region", "Industry", "LinkedIn URL",
    "Number of Employees", "Lead Source",
]
# How we know the address → Apollo's "Email Status" vocabulary, kept honest.
_EMAIL_STATUS = {"found": "Verified", "pattern": "Extrapolated", "guessed": "Unverified",
                 "none": "Unavailable"}


def apollo_row(lead: Lead) -> dict:
    from openleads.insights.titles import label_department, label_seniority
    socials = lead.socials or {}
    return {
        "First Name": lead.first_name, "Last Name": lead.last_name, "Title": lead.title,
        "Company": lead.organization, "Company Name for Emails": lead.organization,
        "Email": lead.email, "Email Status": _EMAIL_STATUS.get(lead.evidence, ""),
        "Seniority": label_seniority(lead.seniority),
        "Departments": label_department(lead.department),
        "First Phone": lead.phone if lead.first_name else "",
        "Corporate Phone": lead.phone,
        "# Employees": lead.employees or lead.company_size, "Industry": lead.industry,
        "Keywords": "", "Person Linkedin Url": lead.linkedin_url if lead.first_name else "",
        "Website": lead.website, "Company Linkedin Url": socials.get("linkedin", ""),
        "Facebook Url": socials.get("facebook", ""), "Twitter Url": socials.get("twitter", ""),
        "City": lead.city, "Country": lead.country, "SEO Description": lead.description,
        "Technologies": ", ".join(lead.technologies or []), "Source": f"OpenLeads ({lead.source})",
    }


def hubspot_row(lead: Lead) -> dict:
    return {
        "First Name": lead.first_name, "Last Name": lead.last_name, "Email": lead.email,
        "Job Title": lead.title, "Company Name": lead.organization, "Phone Number": lead.phone,
        "Website URL": lead.website, "City": lead.city, "Country/Region": lead.country,
        "Industry": lead.industry, "LinkedIn URL": lead.linkedin_url,
        "Number of Employees": lead.employees or lead.company_size,
        "Lead Source": f"OpenLeads ({lead.source})" if lead.source else "OpenLeads",
    }


def _write_shaped(leads, path, fields, row_fn) -> None:
    f, close = _open_out(path)
    try:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for lead in leads:
            w.writerow(row_fn(lead))
    finally:
        if close:
            f.close()


def write_apollo(leads: list[Lead], path: str | None = "leads-apollo.csv") -> None:
    _write_shaped(leads, path, APOLLO_FIELDS, apollo_row)


def write_hubspot(leads: list[Lead], path: str | None = "leads-hubspot.csv") -> None:
    _write_shaped(leads, path, HUBSPOT_FIELDS, hubspot_row)


WRITERS = {"csv": write_csv, "json": write_json, "ndjson": write_ndjson,
           "apollo": write_apollo, "hubspot": write_hubspot}
DEFAULT_PATHS = {"csv": "leads.csv", "apollo": "leads-apollo.csv",
                 "hubspot": "leads-hubspot.csv"}


def write(leads: list[Lead], fmt: str = "csv", path: str | None = None) -> None:
    """Dispatch to the writer for ``fmt`` (csv|json|ndjson|apollo|hubspot)."""
    writer = WRITERS.get(fmt)
    if writer is None:
        raise ValueError(f"unknown format: {fmt!r} (choose {'|'.join(WRITERS)})")
    # CSV-shaped formats default to a file; json/ndjson default to stdout.
    if path is None:
        path = DEFAULT_PATHS.get(fmt)
    writer(leads, path)
