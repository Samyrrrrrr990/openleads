"""
The web dashboard's JSON API — a thin bridge from HTTP to the very same engine
the CLI and chat use. No business logic lives here; each handler parses a payload,
calls into ``engine`` / ``automate`` / ``outreach`` / ``settings``, and returns a
plain JSON-serializable structure.

Long-running handlers (``find``, ``send``, ``run``) accept an ``emit`` callback and
stream newline-delimited JSON *events* so the browser can render progress live:

    {"type": "phase",  "message": "…"}
    {"type": "lead",   "lead": {…}}
    {"type": "draft",  "draft": {…}}
    {"type": "send",   "result": {…}}
    {"type": "done",   …summary…}
    {"type": "error",  "message": "…"}

Everything stays local: the engine never phones home, and secrets are never sent
to the browser beyond masked previews.
"""
from __future__ import annotations

from typing import Callable

from openleads import __version__, intent, settings
from openleads.cache.store import Cache
from openleads.db import DB
from openleads.models import Draft, Query
from openleads.sources import list_sources

Emit = Callable[[dict], None]


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #
def _query_from_payload(payload: dict) -> Query:
    """Build a Query the way the CLI does: parse free text, then apply overrides."""
    text = (payload.get("query") or "").strip()
    q = intent.rule_parse(text) if text else Query()
    for attr in ("source", "industry", "location", "title", "keyword"):
        val = payload.get(attr)
        if val:
            setattr(q, attr, val)
    if payload.get("count") is not None:
        try:
            q.count = max(1, min(int(payload["count"]), 200))
        except (TypeError, ValueError):
            pass
    if payload.get("verified_only"):
        q.verified_only = True
    if payload.get("deep"):
        q.deep = True
    q.use_cache = not payload.get("no_cache", False)
    return q


def _draft_from_dict(d: dict) -> Draft:
    """Rebuild a Draft from a (possibly user-edited) payload dict."""
    return Draft(
        email=(d.get("email") or "").strip(),
        subject=d.get("subject", ""),
        body=d.get("body", ""),
        first_name=d.get("first_name", ""),
        organization=d.get("organization", ""),
        lint=d.get("lint", {}) or {},
        model=d.get("model", "edited"),
    )


def _identity_flags() -> dict:
    """Quick booleans the UI uses to nudge setup (no secrets leave the box)."""
    return {
        "mailbox_configured": bool(settings.get("smtp_user")),
        "llm_configured": bool(settings.get("openrouter_api_key")),
        "github_configured": bool(settings.get("github_token")),
        "include_risky": bool(settings.get("include_risky")),
        "sender_name": settings.get("sender_name") or "",
        "sender_org": settings.get("sender_org") or "",
    }


# --------------------------------------------------------------------------- #
# Read endpoints                                                              #
# --------------------------------------------------------------------------- #
def state() -> dict:
    """Bootstrap payload for the SPA: version, sources, settings, CRM snapshot."""
    from openleads.automate import crm
    db = DB()
    try:
        overview = crm.overview(db)
    finally:
        db.close()
    return {
        "version": __version__,
        "sources": _sources_list(),
        "settings": settings.all_settings(),
        "groups": settings.groups(),
        "identity": _identity_flags(),
        "crm": overview,
    }


def _sources_list() -> list[dict]:
    return [
        {"name": s.name, "kind": s.kind, "vertical": s.vertical,
         "description": s.description}
        for s in list_sources()
    ]


def sources() -> dict:
    return {"sources": _sources_list()}


def crm(payload: dict | None = None) -> dict:
    from openleads.automate import crm as crmmod
    payload = payload or {}
    status = payload.get("status") or None
    limit = int(payload.get("limit") or 500)
    db = DB()
    try:
        return {"overview": crmmod.overview(db),
                "rows": crmmod.rows(db, status=status, limit=limit)}
    finally:
        db.close()


def get_settings() -> dict:
    return {"settings": settings.all_settings(), "groups": settings.groups(),
            "identity": _identity_flags()}


def update_settings(payload: dict) -> dict:
    """Persist a {key: value} map. Unknown keys are reported, never thrown."""
    updates = payload.get("values") or payload or {}
    errors = {}
    applied = []
    for key, value in updates.items():
        if key in ("values",):
            continue
        try:
            if value in (None, "") and not isinstance(value, bool):
                settings.unset(key)
            else:
                settings.set(key, value)
            applied.append(key)
        except (KeyError, ValueError) as e:
            errors[key] = str(e)
    return {"applied": applied, "errors": errors,
            "settings": settings.all_settings(), "identity": _identity_flags()}


def doctor() -> dict:
    from openleads import doctor as doc
    return doc.report()


def providers_presets() -> dict:
    """SMTP provider presets so the UI can auto-fill host/port on selection."""
    try:
        from openleads.outreach import providers
        presets = getattr(providers, "PRESETS", {})
        out = {}
        for name, cfg in presets.items():
            out[name] = {"host": cfg.get("smtp_host", ""),
                         "port": cfg.get("smtp_port", 465),
                         "help": cfg.get("help", "")}
        return {"presets": out}
    except Exception:  # noqa: BLE001
        return {"presets": {}}


# --------------------------------------------------------------------------- #
# Streaming / action endpoints                                               #
# --------------------------------------------------------------------------- #
def find(payload: dict, emit: Emit) -> None:
    """Find + verify leads, streaming each lead as it lands. Persists to CRM."""
    from openleads.engine import build_leads
    q = _query_from_payload(payload)
    cache = Cache() if q.use_cache else None
    db = DB()
    leads_out: list[dict] = []

    def on_progress(kind, p):
        if kind == "phase":
            emit({"type": "phase", "message": str(p)})
        elif kind == "lead":
            d = p.to_dict()
            leads_out.append(d)
            db.upsert_lead(d)
            emit({"type": "lead", "lead": d, "n": len(leads_out)})

    try:
        emit({"type": "phase", "message": f"searching {q.source or 'auto'}…"})
        build_leads(q, cache=cache, db=db, on_progress=on_progress)
        safe = sum(1 for d in leads_out if d.get("tier") == "safe")
        risky = sum(1 for d in leads_out if d.get("tier") == "risky")
        emit({"type": "done", "count": len(leads_out), "safe": safe,
              "risky": risky, "leads": leads_out})
    except ValueError as e:
        emit({"type": "error", "message": str(e)})
    finally:
        if cache:
            cache.close()
        db.close()


def verify(payload: dict) -> dict:
    """Verify a list of concrete addresses (no name permutation)."""
    from openleads.emails.resolve import verify_address
    emails = payload.get("emails") or []
    if isinstance(emails, str):
        emails = [e.strip() for e in emails.replace(",", " ").split() if e.strip()]
    cache = Cache()
    out = []
    try:
        for email in emails[:50]:
            res = verify_address(email, cache=cache)
            out.append({"email": email, "tier": res.tier, "score": res.score,
                        "confidence": res.confidence, "reasons": res.reasons,
                        "signals": res.signals})
    finally:
        cache.close()
    return {"results": out}


def write(payload: dict) -> dict:
    """Draft personalized emails for the supplied leads (LLM if configured)."""
    from openleads.outreach import compose
    leads = payload.get("leads") or []
    overrides = payload.get("overrides") or None
    drafts = []
    for ld in leads:
        if not ld.get("email"):
            continue
        d = compose.draft(ld, overrides)
        drafts.append(d.to_dict())
    return {"drafts": drafts, "llm": bool(settings.get("openrouter_api_key"))}


def send(payload: dict, emit: Emit) -> None:
    """Send (or preview) edited drafts, streaming one result per recipient."""
    from openleads.outreach import deliverability, sender
    raw = payload.get("drafts") or []
    drafts = [_draft_from_dict(d) for d in raw if d.get("email")]
    live = bool(payload.get("live"))
    campaign = payload.get("campaign") or "web"
    db = DB()
    try:
        if not drafts:
            emit({"type": "error", "message": "no drafts to send"})
            return
        emit({"type": "phase",
              "message": "sending…" if live else "previewing sends (dry-run)…"})
        results = []

        def on_result(r):
            results.append(r.to_dict())
            emit({"type": "send", "result": r.to_dict()})

        try:
            sender.send_drafts(drafts, dry_run=not live, db=db, campaign=campaign,
                               on_progress=on_result)
        except Exception as e:  # noqa: BLE001 — surface SMTP/auth errors cleanly
            emit({"type": "error", "message": f"send failed: {e}"})
            return

        sent = sum(1 for r in results if r["status"] == "sent")
        preview = sum(1 for r in results if r["status"] == "preview")
        skipped = sum(1 for r in results if r["status"] == "skipped")
        emit({"type": "done", "live": live, "sent": sent, "preview": preview,
              "skipped": skipped, "results": results,
              "warmup": deliverability.warmup_status(db)})
    finally:
        db.close()


def enrich(payload: dict, emit: Emit) -> None:
    """Enrich an uploaded list (rows of name/company/domain/email) → verified emails."""
    from openleads import enrich as enrichmod
    rows = payload.get("rows") or []
    if isinstance(rows, str):
        # Accept pasted CSV text too.
        import csv
        import io
        rows = list(csv.DictReader(io.StringIO(rows)))
    cache = Cache()
    db = DB()
    out: list[dict] = []

    def on_progress(kind, ld):
        if kind == "lead":
            d = ld.to_dict()
            out.append(d)
            emit({"type": "lead", "lead": d, "n": len(out)})
    try:
        emit({"type": "phase", "message": f"enriching {len(rows)} rows…"})
        enrichmod.enrich_rows(rows, cache=cache, db=db, deep=bool(payload.get("deep")),
                              on_progress=on_progress)
        safe = sum(1 for d in out if d.get("tier") == "safe")
        emit({"type": "done", "count": len(out), "safe": safe, "leads": out})
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "message": str(e)})
    finally:
        cache.close()
        db.close()


def recipes_list() -> dict:
    from openleads.automate import recipes
    db = DB()
    try:
        return {"recipes": recipes.list_recipes(db)}
    finally:
        db.close()


def recipes_save(payload: dict) -> dict:
    from openleads.automate import recipes
    name = (payload.get("name") or "").strip()
    if not name:
        return {"ok": False, "error": "recipe needs a name"}
    db = DB()
    try:
        spec = recipes.save(name, payload, db=db)
        return {"ok": True, "recipe": spec}
    finally:
        db.close()


def recipes_delete(payload: dict) -> dict:
    from openleads.automate import recipes
    db = DB()
    try:
        return {"ok": recipes.delete((payload.get("name") or "").strip(), db=db)}
    finally:
        db.close()


def recipes_run(payload: dict, emit: Emit) -> None:
    from openleads.automate import recipes
    db = DB()
    cache = Cache()
    try:
        spec = recipes.get((payload.get("name") or "").strip(), db=db)
        if not spec:
            emit({"type": "error", "message": "no such recipe"})
            return

        def on_progress(kind, p):
            if kind == "phase":
                emit({"type": "phase", "message": str(p)})
            elif kind == "lead":
                emit({"type": "lead", "lead": p.to_dict()})
        res = recipes.run(spec, db=db, cache=cache,
                          dry_run=not bool(payload.get("live")), on_progress=on_progress)
        emit({"type": "done", **res})
    finally:
        cache.close()
        db.close()


def watchers(payload: dict | None = None) -> dict:
    from openleads.automate import watch
    db = DB()
    try:
        return {"watchers": watch.list_watchers(db)}
    finally:
        db.close()


def watch_save(payload: dict) -> dict:
    from openleads.automate import watch
    name = (payload.get("name") or "").strip()
    if not name:
        return {"ok": False, "error": "watcher needs a name"}
    db = DB()
    try:
        spec = watch.save_watcher(db, name, payload.get("query", ""),
                                  sink=payload.get("sink", "csv"),
                                  target=payload.get("target", ""),
                                  count=int(payload.get("count") or 25))
        return {"ok": True, "watcher": spec}
    finally:
        db.close()


def watch_delete(payload: dict) -> dict:
    from openleads.automate import watch
    db = DB()
    try:
        return {"ok": watch.delete_watcher(db, (payload.get("name") or "").strip())}
    finally:
        db.close()


def export_leads(payload: dict) -> dict:
    """Export the supplied leads (or the CRM) to a sink."""
    from openleads.automate import crm as crmmod
    from openleads.automate import exporters
    leads = payload.get("leads")
    if not leads:
        db = DB()
        try:
            leads = crmmod.rows(db, status=payload.get("status") or None, limit=100000)
        finally:
            db.close()
    return exporters.export(leads, sink=payload.get("sink", "csv"),
                            target=payload.get("target") or None)


def analytics() -> dict:
    from openleads.automate import crm as crmmod
    db = DB()
    try:
        return crmmod.analytics(db)
    finally:
        db.close()


def run_pipeline(payload: dict, emit: Emit) -> None:
    """The full 4-click pipeline in one shot: find → write → send (dry-run/live)."""
    from openleads.automate import pipeline
    q = _query_from_payload(payload)
    q.verified_only = True
    live = bool(payload.get("live"))
    cache = Cache()
    db = DB()

    def on_progress(kind, p):
        if kind == "phase":
            emit({"type": "phase", "message": str(p)})
        elif kind == "lead":
            emit({"type": "lead", "lead": p.to_dict()})
        elif kind == "draft":
            emit({"type": "draft", "draft": p.to_dict()})
        elif kind == "send":
            emit({"type": "send", "result": p.to_dict()})

    try:
        out = pipeline.run(q, send=True, dry_run=not live, cache=cache, db=db,
                           on_progress=on_progress)
        emit({
            "type": "done",
            "live": live,
            "leads": [ld.to_dict() for ld in out.get("leads", [])],
            "drafts": [d.to_dict() for d in out.get("drafts", [])],
            "results": [r.to_dict() for r in out.get("results", [])],
            "preflight": out.get("preflight"),
            "warmup": out.get("warmup"),
        })
    except ValueError as e:
        emit({"type": "error", "message": str(e)})
    finally:
        cache.close()
        db.close()
