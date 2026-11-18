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
    POST /api/sites/log              {id, lines: [{text, kind}]}  what happened to it
    GET  /api/sites/email?id=        a first email offering the site to its lead
    POST /api/sites/send             {id, subject, body}  publish if needed, then send
    POST /api/sites/ai               {system, user}  one answer from the model you chose
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


@_route(POST, "/api/sites/log")
def sites_log(db, p):
    return {"log": sites.add_log(db, _id(p), p.get("lines") or [])}


@_route(GET, "/api/sites/email")
def sites_email(db, p):
    return sites.email_for(db, _id(p))


@_route(POST, "/api/sites/send")
def sites_send(db, p):
    """Email the lead their site. This really sends (through the approval queue)."""
    return sites.send(db, _id(p), str(p.get("subject") or ""), str(p.get("body") or ""))


AI_MAX_CHARS = 250_000


@_route(POST, "/api/sites/ai")
def sites_ai(db, p):
    """Studio's prompts, answered by the model you picked (your Claude subscription,
    a key, or a local model). The reply is a list of Zory commands; the browser
    validates every one against the site before anything changes."""
    from openleads import ai
    system, user = str(p.get("system") or ""), str(p.get("user") or "")
    if not system or not user:
        raise ValueError("system and user are required")
    if len(system) + len(user) > AI_MAX_CHARS:
        raise ValueError("that site is too big to send to the model in one go")
    m = ai.chosen()
    if m is None:
        return {"ok": False, "code": "no_model",
                "detail": ai.problem() or "Pick a model first: Settings, Model."}
    try:
        text = ai.chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                       m, max_tokens=8000, temperature=0.3, untrusted=True, timeout=300)
    except ai.AIError as e:
        return {"ok": False, "code": "failed", "detail": ai.public_error(str(e))}
    return {"ok": True, "text": text, "model": m.label}
