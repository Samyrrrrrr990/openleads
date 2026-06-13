"""
Export sinks — push leads anywhere your workflow lives.

Every sink takes a list of :class:`~openleads.models.Lead` (or lead dicts) and
delivers them somewhere. The defaults are keyless and local; the SaaS sinks light
up only when their token is configured (nothing is required):

* ``csv`` / ``json`` / ``ndjson`` — write a local file (reuses the writers).
* ``sheets``                      — write a Google-Sheets-ready CSV + import hint.
* ``webhook``                     — POST the leads as NDJSON to a URL (Zapier/Make/n8n).
* ``notion``                      — create a page per lead in a Notion database.
* ``airtable``                    — create a record per lead in an Airtable table.

Network sinks accept an injected ``poster`` so they unit-test without the network.
"""
from __future__ import annotations

import json

from openleads import settings, writers
from openleads._http import get_text
from openleads.config import home

SINKS = ("csv", "json", "ndjson", "sheets", "webhook", "notion", "airtable")


def _as_dicts(leads) -> list[dict]:
    return [ld if isinstance(ld, dict) else ld.to_dict() for ld in leads]


def _as_leads(leads):
    """Coerce a mixed list to Lead objects (writers need Lead.to_csv_row)."""
    from openleads.models import Lead
    out = []
    for ld in leads:
        if isinstance(ld, Lead):
            out.append(ld)
        else:
            out.append(Lead(**{k: v for k, v in ld.items()
                               if k in Lead.__dataclass_fields__}))
    return out


def leads_to_ndjson(leads) -> str:
    """Serialize leads to newline-delimited JSON (pure)."""
    return "\n".join(json.dumps(d, ensure_ascii=False) for d in _as_dicts(leads))


def _default_export_path(ext: str) -> str:
    d = home() / "exports"
    d.mkdir(parents=True, exist_ok=True)
    import time
    return str(d / f"leads-{time.strftime('%Y%m%d-%H%M%S')}.{ext}")


# --- file sinks -------------------------------------------------------------- #
def _export_file(leads, fmt: str, target: str | None) -> dict:
    path = target or _default_export_path(fmt)
    writers.write(_as_leads(leads), fmt=fmt, path=path)
    return {"ok": True, "sink": fmt, "target": path, "count": len(leads)}


def _export_sheets(leads, target: str | None) -> dict:
    path = target or _default_export_path("csv")
    writers.write(_as_leads(leads), fmt="csv", path=path)
    return {"ok": True, "sink": "sheets", "target": path, "count": len(leads),
            "hint": f"In Google Sheets: File → Import → Upload → {path}"}


# --- webhook ----------------------------------------------------------------- #
def _post(url: str, body: bytes, headers: dict, poster=None) -> tuple[bool, str]:
    if poster is not None:
        return poster(url, body, headers)
    res = get_text(url, headers=headers, data=body, timeout=20)
    return (res is not None), (res or "")


def _export_webhook(leads, target: str | None, poster=None) -> dict:
    url = target or settings.get("webhook_url")
    if not url:
        return {"ok": False, "sink": "webhook", "error": "no webhook_url configured"}
    body = leads_to_ndjson(leads).encode("utf-8")
    ok, _ = _post(url, body, {"Content-Type": "application/x-ndjson"}, poster)
    return {"ok": ok, "sink": "webhook", "target": url, "count": len(leads),
            "error": "" if ok else "webhook POST failed"}


# --- Notion ------------------------------------------------------------------ #
def notion_properties(lead: dict) -> dict:
    """Map a lead to Notion page properties (pure; Name is the title column)."""
    name = (f"{lead.get('first_name','')} {lead.get('last_name','')}").strip() \
        or lead.get("organization") or lead.get("email", "")
    return {
        "Name": {"title": [{"text": {"content": name[:200]}}]},
        "Email": {"email": lead.get("email") or None},
        "Company": {"rich_text": [{"text": {"content": (lead.get("organization") or "")[:200]}}]},
        "Title": {"rich_text": [{"text": {"content": (lead.get("title") or "")[:200]}}]},
        "Tier": {"select": {"name": lead.get("tier") or "unknown"}},
    }


def _export_notion(leads, poster=None) -> dict:
    token = settings.get("notion_token")
    db = settings.get("notion_database_id")
    if not token or not db:
        return {"ok": False, "sink": "notion",
                "error": "set notion_token + notion_database_id first"}
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json",
               "Notion-Version": "2022-06-28"}
    ok_n = 0
    for ld in _as_dicts(leads):
        body = json.dumps({"parent": {"database_id": db},
                           "properties": notion_properties(ld)}).encode("utf-8")
        ok, _ = _post("https://api.notion.com/v1/pages", body, headers, poster)
        ok_n += int(ok)
    return {"ok": ok_n > 0, "sink": "notion", "count": ok_n, "target": db}


# --- Airtable ---------------------------------------------------------------- #
def airtable_fields(lead: dict) -> dict:
    """Map a lead to Airtable fields (pure)."""
    name = (f"{lead.get('first_name','')} {lead.get('last_name','')}").strip()
    return {"Name": name or lead.get("organization", ""),
            "Email": lead.get("email", ""), "Company": lead.get("organization", ""),
            "Title": lead.get("title", ""), "Tier": lead.get("tier", ""),
            "Source": lead.get("source", "")}


def _export_airtable(leads, poster=None) -> dict:
    token = settings.get("airtable_token")
    base = settings.get("airtable_base")
    table = settings.get("airtable_table") or "Leads"
    if not token or not base:
        return {"ok": False, "sink": "airtable",
                "error": "set airtable_token + airtable_base first"}
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    url = f"https://api.airtable.com/v0/{base}/{table}"
    dicts = _as_dicts(leads)
    ok_n = 0
    # Airtable accepts up to 10 records per request.
    for i in range(0, len(dicts), 10):
        chunk = dicts[i:i + 10]
        body = json.dumps({"records": [{"fields": airtable_fields(d)} for d in chunk],
                           "typecast": True}).encode("utf-8")
        ok, _ = _post(url, body, headers, poster)
        ok_n += len(chunk) if ok else 0
    return {"ok": ok_n > 0, "sink": "airtable", "count": ok_n, "target": f"{base}/{table}"}


def export(leads, sink: str = "csv", target: str | None = None, poster=None) -> dict:
    """Dispatch ``leads`` to ``sink``. Returns a result dict (never raises for a
    misconfigured optional sink)."""
    sink = (sink or "csv").lower()
    if sink in ("csv", "json", "ndjson"):
        return _export_file(leads, sink, target)
    if sink == "sheets":
        return _export_sheets(leads, target)
    if sink == "webhook":
        return _export_webhook(leads, target, poster)
    if sink == "notion":
        return _export_notion(leads, poster)
    if sink == "airtable":
        return _export_airtable(leads, poster)
    return {"ok": False, "sink": sink, "error": f"unknown sink: {sink!r}"}
