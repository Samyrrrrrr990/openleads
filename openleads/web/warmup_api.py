"""
Warm-up's JSON API (same rules as every endpoint: loopback Host, JSON writes,
cross-site refused).

    GET  /api/warmup                  status: plan, day, allowance, schedule, health, seeds
    POST /api/warmup/plan             {plan?, window?, weekends?, volume?}
    POST /api/warmup/pause            {paused}
    POST /api/warmup/override         {}  send cold email today despite a pause verdict
    POST /api/warmup/restart          {}  start the ramp again from day 1
    POST /api/warmup/seeds/add        {email, name?, password?, provider?, imap_host?, smtp_host?}
    POST /api/warmup/seeds/remove     {email}
    POST /api/warmup/seeds/test       {email}  log in to an automatic seed
    POST /api/warmup/dns              {}  check SPF/DKIM/DMARC and remember the grade
    POST /api/warmup/run              {}  send what's due now (same as the heartbeat)
"""
from __future__ import annotations

from openleads import settings
from openleads.db import DB
from openleads.outreach import warmup

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


@_route(GET, "/api/warmup")
def warmup_status(db, p):
    return warmup.status(db)


@_route(POST, "/api/warmup/plan")
def warmup_plan(db, p):
    if p.get("plan"):
        warmup.set_plan(str(p["plan"]))
    if p.get("window") is not None:
        text = str(p["window"]).strip()
        if warmup.parse_window(text) == (540, 1020) and text.replace(" ", "") not in ("09:00-17:00", "9-17"):
            raise ValueError("send window looks like 09:00-17:00")
        settings.set("warmup_window", text)
    if p.get("weekends"):
        if p["weekends"] not in warmup.WEEKEND_FACTOR:
            raise ValueError("weekends is quiet, off or normal")
        settings.set("warmup_weekends", p["weekends"])
    if p.get("volume") is not None:
        settings.set("warmup_volume", max(0, min(200, int(p["volume"]))))
    if p.get("cap") is not None:
        settings.set("daily_cap", max(1, min(2000, int(p["cap"]))))
    return warmup.status(db)


@_route(POST, "/api/warmup/pause")
def warmup_pause(db, p):
    warmup.pause(db, bool(p.get("paused", True)))
    return warmup.status(db)


@_route(POST, "/api/warmup/override")
def warmup_override(db, p):
    warmup.override_today(db)
    return warmup.status(db)


@_route(POST, "/api/warmup/restart")
def warmup_restart(db, p):
    warmup.restart(db)
    return warmup.status(db)


@_route(POST, "/api/warmup/seeds/add")
def seeds_add(db, p):
    warmup.add_seed(str(p.get("email") or ""), str(p.get("name") or ""),
                    str(p.get("password") or ""), str(p.get("provider") or ""),
                    str(p.get("imap_host") or ""), str(p.get("smtp_host") or ""),
                    int(p.get("smtp_port") or 0))
    return warmup.status(db)


@_route(POST, "/api/warmup/seeds/remove")
def seeds_remove(db, p):
    warmup.remove_seed(str(p.get("email") or ""))
    return warmup.status(db)


@_route(POST, "/api/warmup/seeds/test")
def seeds_test(db, p):
    from openleads.outreach import providers
    email = str(p.get("email") or "").lower().strip()
    seed = next((s for s in warmup.load_seeds() if s["email"] == email), None)
    if not seed:
        raise ValueError("no such seed")
    if not seed.get("password"):
        return {"ok": True, "message": "This seed is manual: someone reads and answers it."}
    try:
        server = providers.connect_imap(warmup._seed_imap(seed), timeout=20)
        server.logout()
    except Exception as e:  # noqa: BLE001 — the message is the point
        return {"ok": False, "message": f"Couldn't log in to {email}: {e}"}
    return {"ok": True, "message": f"Logged in to {email}. Placement, rescue and replies are on."}


@_route(POST, "/api/warmup/dns")
def warmup_dns(db, p):
    import time
    from openleads.outreach import deliverability
    res = deliverability.preflight()
    db.kv_set("warmup.auth_grade", {"grade": res.get("grade", ""), "ts": time.time()})
    return {"preflight": res, "status": warmup.status(db)}


@_route(POST, "/api/warmup/run")
def warmup_run(db, p):
    res = warmup.tick(db)
    return {"result": res, "status": warmup.status(db)}
