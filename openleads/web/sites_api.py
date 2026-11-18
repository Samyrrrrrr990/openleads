"""
Studio's JSON API: the drag-and-drop editor stores its projects here.

    GET  /api/sites                  [{id, slug, name, lead_email, preview, url, …}]
    GET  /api/sites/get?id=          one site with its project graph
    GET  /api/sites/lead?email=      what a template is pre-filled with for a lead
    POST /api/sites/save             {project, starterId?, lead?, html?}
    POST /api/sites/rename           {id, name}
    POST /api/sites/link             {id, lead}
    POST /api/sites/delete           {id}
    POST /api/sites/publish          {id}   static folder (+ Netlify deploy with a token)
"""
from __future__ import annotations

from openleads import sites
from openleads.db import DB

GET: dict = {}
POST: dict = {}
STREAM: dict = {}


def _route(table: dict, path: str):
    def deco(fn):
        def handler(payload=None):
            db = DB()
            try:
                return fn(db, payload or {})
            finally:
                db.close()
        handler.__name__ = fn.__name__
        table[path] = handler
        return fn
    return deco


def _id(p: dict) -> str:
    sid = str(p.get("id") or "").strip()
    if not sid:
        raise ValueError("id is required")
    return sid


@_route(GET, "/api/sites")
def sites_list(db, p):
    from openleads import settings
    return {"sites": sites.list_sites(db, str(p.get("lead") or "")),
            "base_url": settings.get("site_base_url") or "",
            "netlify": bool(settings.get("netlify_token"))}


@_route(GET, "/api/sites/get")
def sites_get(db, p):
    site = sites.get(db, _id(p))
    if not site:
        raise ValueError("no such site")
    return site


@_route(GET, "/api/sites/lead")
def sites_lead(db, p):
    brief = sites.lead_brief(db, str(p.get("email") or ""))
    if not brief:
        raise ValueError("no such lead")
    return brief


@_route(POST, "/api/sites/save")
def sites_save(db, p):
    return sites.save(db, p.get("project"), p.get("starterId"), str(p.get("lead") or ""),
                      p.get("html"))


@_route(POST, "/api/sites/rename")
def sites_rename(db, p):
    return sites.rename(db, _id(p), str(p.get("name") or ""))


@_route(POST, "/api/sites/link")
def sites_link(db, p):
    return sites.link_lead(db, _id(p), str(p.get("lead") or ""))


@_route(POST, "/api/sites/delete")
def sites_delete(db, p):
    return {"ok": sites.delete(db, _id(p))}


@_route(POST, "/api/sites/publish")
def sites_publish(db, p):
    return sites.publish(db, _id(p))
