"""
A tiny local CRM over the SQLite DB — see everyone you've found and every email
you've sent, without a spreadsheet or a SaaS.

Thin, formatting-oriented helpers on top of :class:`openleads.db.DB`; the storage
lives there. Exports reuse the same CSV schema as the finder for round-tripping.
"""
from __future__ import annotations

import csv
import json

from openleads import db as dbmod


def overview(db) -> dict:
    """High-level numbers for a dashboard/`crm` summary."""
    counts = db.lead_counts()
    return {
        "total_leads": sum(counts.values()),
        "by_status": counts,
        "sent_total": db.sent_total(),
        "sent_today": db.sent_today(),
        "suppressed": len(db.list_suppressed()),
    }


def history(db, email: str) -> dict:
    """Full record for one lead: profile + every touch."""
    return {"lead": db.get_lead(email), "touches": db.touches_for(email)}


def rows(db, status: str | None = None, limit: int = 1000) -> list[dict]:
    """CRM rows with the lead's stored profile merged in (for tables/exports)."""
    out = []
    for lead in db.list_leads(status=status, limit=limit):
        try:
            data = json.loads(lead.get("data") or "{}")
        except (ValueError, TypeError):
            data = {}
        out.append({
            "email": lead["email"], "name": lead["name"],
            "organization": lead["organization"], "title": lead["title"],
            "tier": lead["tier"], "score": lead["score"], "status": lead["status"],
            "source": lead["source"], "city": data.get("city", ""),
            "country": data.get("country", ""), "linkedin_url": data.get("linkedin_url", ""),
        })
    return out


def export_csv(db, path: str, status: str | None = None) -> int:
    """Write CRM rows to ``path``. Returns the number of rows written."""
    data = rows(db, status=status, limit=100000)
    fields = ["email", "name", "organization", "title", "tier", "score",
              "status", "source", "city", "country", "linkedin_url"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in data:
            w.writerow(r)
    return len(data)


def analytics(db) -> dict:
    """Funnel + breakdowns for the dashboard Analytics tab."""
    leads = db.list_leads(limit=100000)
    by_source: dict = {}
    by_tier: dict = {}
    for ld in leads:
        by_source[ld.get("source") or "?"] = by_source.get(ld.get("source") or "?", 0) + 1
        by_tier[ld.get("tier") or "?"] = by_tier.get(ld.get("tier") or "?", 0) + 1
    counts = db.lead_counts()
    sent = db.sent_total()
    replied = counts.get(dbmod.STATUS_REPLIED, 0)
    bounced = counts.get(dbmod.STATUS_BOUNCED, 0)
    return {
        "total_leads": len(leads),
        "deliverable": by_tier.get("safe", 0),
        "sent": sent,
        "sent_today": db.sent_today(),
        "replied": replied,
        "bounced": bounced,
        "reply_rate": round(100 * replied / sent, 1) if sent else 0.0,
        "bounce_rate": round(100 * bounced / sent, 1) if sent else 0.0,
        "by_source": by_source,
        "by_tier": by_tier,
        "by_status": counts,
    }


STATUSES = (dbmod.STATUS_NEW, dbmod.STATUS_QUEUED, dbmod.STATUS_SENT,
            dbmod.STATUS_REPLIED, dbmod.STATUS_BOUNCED, dbmod.STATUS_UNSUB,
            dbmod.STATUS_DNC)
