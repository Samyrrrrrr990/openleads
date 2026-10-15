"""
The workspace JSON API — People, Companies, Lists, Tasks, Deals, Templates,
Sequences, saved searches, scoring, import and the home dashboard.

Every handler opens the local database, calls one ``openleads.workspace`` function
and returns plain JSON. Validation problems raise ``ValueError``, which the server
turns into a 400 with the message, so the UI can show it as-is.

Routes are collected in :data:`GET`, :data:`POST` and :data:`STREAM`, and merged
into the server's tables.
"""
from __future__ import annotations

from typing import Callable

from openleads.db import DB

GET: dict = {}
POST: dict = {}
STREAM: dict = {}


def route(table: dict, path: str) -> Callable:
    """Register ``fn(db, payload)`` at ``path``; the wrapper owns the DB lifecycle."""
    def deco(fn):
        if table is STREAM:
            def handler(payload, emit):
                db = DB()
                try:
                    return fn(db, payload or {}, emit)
                finally:
                    db.close()
        else:
            def handler(payload=None):
                db = DB()
                try:
                    return fn(db, payload or {})
                finally:
                    db.close()
        handler.__name__ = fn.__name__
        handler.__doc__ = fn.__doc__
        table[path] = handler
        return fn
    return deco


def _int(v, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _emails_from(db, p: dict) -> list:
    """A selection: explicit ``emails``, or every contact matching ``filters`` (``all``)."""
    from openleads.workspace import people
    if p.get("all"):
        return people.matching_emails(db, p.get("filters") or {})
    emails = p.get("emails") or []
    if isinstance(emails, str):
        emails = [e for e in emails.replace(",", " ").split() if e]
    return [str(e).lower().strip() for e in emails if str(e).strip()]


# --------------------------------------------------------------------------- #
# Meta + home                                                                 #
# --------------------------------------------------------------------------- #
@route(GET, "/api/meta")
def meta(db, p):
    """Vocabularies the UI renders: stages, seniorities, departments, sizes, …"""
    from openleads.automate.exporters import SINKS
    from openleads.insights import companysize, techstack, titles
    from openleads.workspace import lists, sequences, stages, tasks, templates
    return {
        "contact_stages": stages.as_options(stages.CONTACT_STAGES),
        "account_stages": stages.as_options(stages.ACCOUNT_STAGES),
        "deal_stages": stages.as_options(stages.DEAL_STAGES),
        "seniorities": [{"key": k, "label": v} for k, v in titles.SENIORITIES],
        "departments": [{"key": k, "label": v} for k, v in titles.DEPARTMENTS],
        "company_sizes": list(companysize.BUCKET_KEYS),
        "step_types": [{"key": k, "label": v} for k, v in sequences.STEP_TYPES],
        "task_kinds": [{"key": k, "label": v} for k, v in tasks.KINDS],
        "template_variables": [{"key": k, "label": d, "example": e}
                               for k, d, e in templates.VARIABLES],
        "technologies": list(techstack.NAMES),
        "list_colors": list(lists.COLORS),
        "export_sinks": list(SINKS),
        "export_formats": ["csv", "apollo", "hubspot", "json"],
    }


@route(GET, "/api/home")
def home(db, p):
    from openleads.workspace import stats
    return stats.home(db, days=_int(p.get("days"), 30) or 30)


@route(GET, "/api/health")
def health(db, p):
    from openleads.workspace import stats
    return stats.health(db)


# --------------------------------------------------------------------------- #
# People                                                                      #
# --------------------------------------------------------------------------- #
@route(POST, "/api/people/search")
def people_search(db, p):
    from openleads.workspace import people
    res = people.search(db, p.get("filters") or {}, sort=p.get("sort") or "updated",
                        direction=p.get("direction") or "desc", page=_int(p.get("page"), 1),
                        per_page=_int(p.get("per_page"), 50))
    if p.get("facets"):
        res["facets"] = people.facets(db, p.get("filters") or {})
    return res


@route(POST, "/api/people/facets")
def people_facets(db, p):
    from openleads.workspace import people
    return people.facets(db, p.get("filters") or {})


@route(GET, "/api/people/get")
def people_get(db, p):
    from openleads.workspace import people
    d = people.detail(db, p.get("email") or "")
    if d is None:
        raise ValueError("no such contact")
    return d


@route(POST, "/api/people/create")
def people_create(db, p):
    from openleads.workspace import people, scoring
    row = people.create(db, p.get("contact") or p)
    scoring.rescore(db, [row["email"]])
    return {"ok": True, "contact": people.get(db, row["email"])}


@route(POST, "/api/people/update")
def people_update(db, p):
    from openleads.workspace import people, scoring
    row = people.update(db, p.get("email") or "", p.get("fields") or {})
    if row is None:
        raise ValueError("no such contact")
    scoring.rescore(db, [row["email"]])
    return {"ok": True, "contact": people.get(db, row["email"])}


@route(POST, "/api/people/tags")
def people_tags(db, p):
    from openleads.workspace import tags
    return {"ok": True, "tags": tags.set_tags(db, p.get("email") or "", p.get("tags") or [])}


@route(POST, "/api/people/bulk")
def people_bulk(db, p):
    from openleads.workspace import people
    emails = _emails_from(db, p)
    return {"ok": True, **people.bulk(db, emails, p.get("action") or "", p.get("value"))}


# --------------------------------------------------------------------------- #
# Companies                                                                   #
# --------------------------------------------------------------------------- #
@route(POST, "/api/companies/search")
def companies_search(db, p):
    from openleads.workspace import companies
    res = companies.search(db, p.get("filters") or {}, sort=p.get("sort") or "people",
                           direction=p.get("direction") or "desc", page=_int(p.get("page"), 1),
                           per_page=_int(p.get("per_page"), 50))
    if p.get("facets"):
        res["facets"] = companies.facets(db, p.get("filters") or {})
    return res


@route(GET, "/api/companies/get")
def companies_get(db, p):
    from openleads.workspace import companies
    d = companies.detail(db, p.get("domain") or "")
    if d is None:
        raise ValueError("no such company")
    return d


@route(POST, "/api/companies/create")
def companies_create(db, p):
    from openleads.workspace import companies
    fields = {k: v for k, v in (p.get("fields") or {}).items()}
    return {"ok": True, "company": companies.create(db, p.get("domain") or "",
                                                    p.get("name") or "", **fields)}


@route(POST, "/api/companies/update")
def companies_update(db, p):
    from openleads.workspace import companies
    row = companies.update(db, p.get("domain") or "", p.get("fields") or {})
    if row is None:
        raise ValueError("no such company")
    return {"ok": True, "company": row}


@route(POST, "/api/companies/bulk")
def companies_bulk(db, p):
    from openleads.workspace import companies
    domains = p.get("domains") or []
    if p.get("all"):
        domains = [r["domain"] for r in companies.search(
            db, p.get("filters") or {}, per_page=500)["rows"]]
    return {"ok": True, **companies.bulk(db, domains, p.get("action") or "", p.get("value"))}


@route(POST, "/api/companies/profile")
def companies_profile(db, p):
    """Fetch a company's homepage profile (one cached GET) and fold it in."""
    from openleads.cache.store import Cache
    from openleads.insights.company import fetch_profile
    from openleads.workspace import companies, scoring
    domain = (p.get("domain") or "").lower().strip()
    if not domain:
        raise ValueError("domain is required")
    cache = Cache()
    try:
        prof = fetch_profile(domain, cache=cache, refresh=bool(p.get("refresh")))
    finally:
        cache.close()
    if prof.get("error"):
        return {"ok": False, "error": f"{domain}: {prof['error']}", "profile": prof}
    acc = companies.apply_profile(db, domain, prof)
    scoring.rescore(db, [r["email"] for r in db.query("SELECT email FROM leads WHERE domain=?",
                                                       (domain,))])
    return {"ok": True, "company": acc, "profile": prof}


@route(STREAM, "/api/companies/enrich")
def companies_enrich(db, p, emit):
    """Profile many companies, streaming one event per domain."""
    from openleads.cache.store import Cache
    from openleads.insights.company import fetch_profile
    from openleads.workspace import companies, scoring
    domains = p.get("domains") or companies.needs_profile(db, limit=_int(p.get("limit"), 25) or 25)
    emit({"type": "phase", "message": f"profiling {len(domains)} companies…"})
    cache = Cache()
    ok = 0
    try:
        for d in domains:
            prof = fetch_profile(d, cache=cache, refresh=bool(p.get("refresh")))
            if prof.get("error"):
                emit({"type": "company", "domain": d, "ok": False, "error": prof["error"]})
                continue
            acc = companies.apply_profile(db, d, prof)
            ok += 1
            emit({"type": "company", "domain": d, "ok": True,
                  "technologies": acc["technologies"], "name": acc["name"]})
    finally:
        cache.close()
    scoring.rescore(db)
    emit({"type": "done", "count": len(domains), "profiled": ok})
