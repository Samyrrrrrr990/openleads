"""
Export people from the workspace — the same rows the dashboard and the CLI
export — as the standard CSV, JSON, or ready-to-import Apollo / HubSpot CSV.
"""
from __future__ import annotations

import csv
import io
import json

from openleads.models import CSV_FIELDS, Lead

FORMATS = ("csv", "apollo", "hubspot", "json")


def leads_for(db, emails: list) -> list:
    """Workspace rows → :class:`Lead` objects (with company tech and socials)."""
    out = []
    for i in range(0, len(emails), 500):
        chunk = emails[i:i + 500]
        marks = ",".join("?" for _ in chunk)
        accounts = {a["domain"]: a for a in db.query(
            f"SELECT * FROM accounts WHERE domain IN (SELECT domain FROM leads "
            f"WHERE email IN ({marks}))", chunk)}
        for r in db.query(f"SELECT * FROM leads WHERE email IN ({marks}) ORDER BY name", chunk):
            try:
                data = json.loads(r.get("data") or "{}")
            except ValueError:
                data = {}
            acc = accounts.get(r["domain"]) or {}
            socials = {k: acc.get(f"{k}_url") for k in ("linkedin", "twitter", "facebook",
                                                        "instagram") if acc.get(f"{k}_url")}
            out.append(Lead(
                first_name=r["first_name"] or "", last_name=r["last_name"] or "",
                email=r["email"], title=r["title"] or "", organization=r["organization"] or "",
                industry=r["industry"] or acc.get("industry") or "",
                employees=r["employees"] or acc.get("employees") or "",
                linkedin_url=r["linkedin_url"] or "", city=r["city"] or "",
                country=r["country"] or "", website=r["website"] or acc.get("website") or "",
                confidence=data.get("confidence", "none"), score=r["score"] or 0,
                source=r["source"] or "", tier=r["tier"] or "",
                signals=data.get("signals") or {}, reasons=data.get("reasons") or [],
                confidence_pct=r["confidence_pct"] or 0, seniority=r["seniority"] or "",
                department=r["department"] or "", phone=r["phone"] or acc.get("phone") or "",
                company_size=r["company_size"] or acc.get("company_size") or "",
                technologies=[t for t in (acc.get("technologies") or "").split("|") if t],
                socials=socials, description=acc.get("description") or ""))
    return out


def render(leads: list, fmt: str = "csv") -> tuple:
    """``(text, extension)`` for ``leads`` in one of :data:`FORMATS`."""
    from openleads import writers
    if fmt == "json":
        return json.dumps([ld.to_dict() for ld in leads], indent=2, ensure_ascii=False), "json"
    if fmt not in FORMATS:
        raise ValueError(f"format must be one of {', '.join(FORMATS)}")
    buf = io.StringIO()
    if fmt == "csv":
        w = csv.DictWriter(buf, fieldnames=CSV_FIELDS)
        w.writeheader()
        for ld in leads:
            w.writerow(ld.to_csv_row())
    else:
        fields, row = {"apollo": (writers.APOLLO_FIELDS, writers.apollo_row),
                       "hubspot": (writers.HUBSPOT_FIELDS, writers.hubspot_row)}[fmt]
        w = csv.DictWriter(buf, fieldnames=fields)
        w.writeheader()
        for ld in leads:
            w.writerow(row(ld))
    return buf.getvalue(), "csv"
