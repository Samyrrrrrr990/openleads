"""
Watchers — standing alerts for "tell me when new leads match my ICP."

A watcher is a saved search plus a sink. On each run (manually or via the daily
drip) it executes the search, compares the result domains against what it saw last
time, and delivers **only the new** matches — to a file, a webhook, or any export
sink. It's how "notify me when a new agency opens in Miami" or "ping me when fresh
companies match my niche" works, hands-free.

Watchers live in the KV store (separate from send-recipes). ``diff_new`` is pure.
"""
from __future__ import annotations

from openleads import db as dbmod
from openleads.automate import exporters
from openleads.cache.store import Cache

KV_KEY = "watchers"


def list_watchers(db) -> dict:
    return db.kv_get(KV_KEY, {}) or {}


def save_watcher(db, name: str, query: str, sink: str = "csv",
                 target: str = "", count: int = 25) -> dict:
    watchers = list_watchers(db)
    spec = watchers.get(name, {})
    spec.update({"name": name, "query": query, "sink": sink, "target": target,
                 "count": max(1, min(int(count), 500)),
                 "seen": spec.get("seen", [])})
    watchers[name] = spec
    db.kv_set(KV_KEY, watchers)
    return spec


def delete_watcher(db, name: str) -> bool:
    watchers = list_watchers(db)
    if name in watchers:
        del watchers[name]
        db.kv_set(KV_KEY, watchers)
        return True
    return False


def diff_new(leads, seen: set) -> tuple[list, list]:
    """Split leads into (new, all_domains) given the previously-seen domain set (pure)."""
    new = []
    domains = []
    for ld in leads:
        d = ld.domain if hasattr(ld, "domain") else (ld.get("domain") or "")
        if not d:
            continue
        domains.append(d)
        if d not in seen:
            new.append(ld)
    return new, domains


def run_watcher(spec: dict, db=None, cache=None, dry_run: bool = True,
                on_progress=None) -> dict:
    """Run one watcher: search, find new domains, deliver them, update memory."""
    from openleads.engine import build_leads
    from openleads.models import Query
    on_progress = on_progress or (lambda *_: None)
    own_cache = own_db = False
    if cache is None:
        cache, own_cache = Cache(), True
    if db is None:
        db, own_db = dbmod.DB(), True
    try:
        from openleads import intent
        q, _ = intent.parse(spec.get("query", ""))
        q = q if isinstance(q, Query) else Query()
        q.count = int(spec.get("count", 25))
        leads = build_leads(q, cache=cache, db=db, on_progress=on_progress)
        seen = set(spec.get("seen", []))
        new, domains = diff_new(leads, seen)
        result = {"name": spec.get("name", ""), "new": len(new), "total": len(leads)}
        if new and not dry_run and spec.get("sink"):
            res = exporters.export(new, sink=spec["sink"], target=spec.get("target") or None)
            result["export"] = res
        if not dry_run:
            spec["seen"] = sorted(seen | set(domains))
            watchers = list_watchers(db)
            watchers[spec["name"]] = spec
            db.kv_set(KV_KEY, watchers)
        return result
    finally:
        if own_cache:
            cache.close()
        if own_db:
            db.close()


def tick(db, cache=None, dry_run: bool = True, on_progress=None) -> dict:
    """Run all watchers once. Returns ``{watchers_run, new_total}``."""
    on_progress = on_progress or (lambda *_: None)
    summary = {"watchers_run": 0, "new_total": 0}
    for name, spec in list(list_watchers(db).items()):
        on_progress("watch", name)
        res = run_watcher(spec, db=db, cache=cache, dry_run=dry_run,
                          on_progress=on_progress)
        summary["watchers_run"] += 1
        summary["new_total"] += res.get("new", 0)
    return summary
