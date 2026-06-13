"""
Recipes — save an ICP + message + schedule once; let it run itself.

A *recipe* is the unit of seamless automation: a named, reusable definition of "who
to reach, what to say, how often, and where to put the results." It captures a whole
workflow so a single ``openleads recipe run growth`` (or the daily scheduler) does
find → write → send → export end-to-end, deduped and warmup-capped.

Recipes persist in the same ``campaigns`` table the scheduler reads, so a recipe with
a schedule fires unattended via the on-device drip. The spec is a plain dict:

    {name, query, count, context, verified_only, send, sequence,
     send_hour, send_minute, enabled, export: {sink, target}}

``normalize_spec`` is pure/testable; ``run`` executes via the shared pipeline.
"""
from __future__ import annotations

from datetime import date

from openleads import db as dbmod
from openleads import intent
from openleads.automate import exporters
from openleads.cache.store import Cache
from openleads.outreach import sequences

RECIPE_KIND = "recipe"


def normalize_spec(spec: dict) -> dict:
    """Fill defaults + clamp a recipe spec (pure)."""
    s = dict(spec or {})
    s.setdefault("_kind", RECIPE_KIND)
    s["query"] = (s.get("query") or "").strip()
    s["count"] = max(1, min(int(s.get("count") or 25), 1000))
    s["context"] = (s.get("context") or "").strip()
    s["verified_only"] = bool(s.get("verified_only", True))
    s["send"] = bool(s.get("send", False))
    s["sequence"] = bool(s.get("sequence", False))
    s["enabled"] = bool(s.get("enabled", True))
    try:
        s["send_hour"] = max(0, min(int(s.get("send_hour", 9)), 23))
    except (TypeError, ValueError):
        s["send_hour"] = 9
    try:
        s["send_minute"] = max(0, min(int(s.get("send_minute", 0)), 59))
    except (TypeError, ValueError):
        s["send_minute"] = 0
    exp = s.get("export")
    if exp and exp.get("sink"):
        s["export"] = {"sink": exp["sink"], "target": exp.get("target") or ""}
    else:
        s["export"] = None
    return s


def save(name: str, spec: dict, db=None) -> dict:
    own = db is None
    db = db or dbmod.DB()
    try:
        s = normalize_spec(spec)
        s["name"] = name
        db.save_campaign(name, s)
        return s
    finally:
        if own:
            db.close()


def get(name: str, db=None) -> dict | None:
    own = db is None
    db = db or dbmod.DB()
    try:
        row = db.get_campaign(name)
        if not row:
            return None
        return {**normalize_spec(row["data"]), "name": name}
    finally:
        if own:
            db.close()


def list_recipes(db=None) -> list[dict]:
    own = db is None
    db = db or dbmod.DB()
    try:
        out = []
        for row in db.list_campaigns():
            spec = row.get("data") or {}
            spec = normalize_spec(spec)
            spec["name"] = row["name"]
            out.append(spec)
        return out
    finally:
        if own:
            db.close()


def delete(name: str, db=None) -> bool:
    own = db is None
    db = db or dbmod.DB()
    try:
        return db.delete_campaign(name)
    finally:
        if own:
            db.close()


def to_query(spec: dict):
    """Build a :class:`Query` from a recipe spec."""
    q, _ = intent.parse(spec.get("query", "")) if spec.get("query") else (intent.rule_parse(""), "rule")
    q.count = int(spec.get("count", 25))
    q.verified_only = bool(spec.get("verified_only", True))
    return q


def run(spec: dict, db=None, cache=None, dry_run: bool = True, on_progress=None) -> dict:
    """Execute a recipe: find → write → (send) → export. Returns a summary dict."""
    from openleads.automate import pipeline
    on_progress = on_progress or (lambda *_: None)
    spec = normalize_spec(spec)
    own_cache = own_db = False
    if cache is None:
        cache, own_cache = Cache(), True
    if db is None:
        db, own_db = dbmod.DB(), True
    try:
        q = to_query(spec)
        overrides = {"sender_context": spec["context"]} if spec["context"] else None
        out = pipeline.run(
            q, send=spec["send"], dry_run=dry_run, overrides=overrides,
            cache=cache, db=db, include_risky=not spec["verified_only"],
            min_confidence=55 if not spec["verified_only"] else 0,
            on_progress=on_progress)
        leads = out.get("leads", [])
        summary = {"name": spec.get("name", ""), "found": len(leads),
                   "drafted": len(out.get("drafts", [])),
                   "sent": sum(1 for r in out.get("results", []) if r.status == "sent")}
        # Enroll sent leads into the follow-up sequence (handled by the daily tick).
        summary["sequence"] = spec["sequence"]
        # Export, if configured.
        if spec["export"]:
            res = exporters.export(leads, sink=spec["export"]["sink"],
                                   target=spec["export"]["target"] or None)
            summary["export"] = res
            on_progress("phase", f"exported {res.get('count', 0)} → {spec['export']['sink']}")
        return summary
    finally:
        if own_cache:
            cache.close()
        if own_db:
            db.close()


def due(db, now=None) -> list[dict]:
    """Recipes whose scheduled hour has arrived today and that haven't run today."""
    import time
    now = now or time.localtime()
    today = date.today().isoformat()
    out = []
    for spec in list_recipes(db):
        if not spec.get("enabled", True):
            continue
        if spec.get("last_run") == today:
            continue
        if now.tm_hour >= int(spec.get("send_hour", 9)):
            out.append(spec)
    return out


# Re-export so callers have one import for "is this lead done with its sequence".
STOP_STATUSES = sequences.STOP_STATUSES
