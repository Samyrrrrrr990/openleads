"""
The pipeline — find → verify → write → send, in one call.

This is the "four buttons and done" backend, shared by ``openleads run`` and the
web dashboard. Each stage reports progress so a UI can stream it:

1. **find/verify** — run the engine; only ``safe``-tier leads are sendable by
   default (``include_risky`` opts in). Every lead is saved to the local CRM.
2. **write** — draft a personalized, spam-linted email per sendable lead.
3. **send** — dry-run preview by default; real send is throttled + warmup-capped.

Returns a single structured dict so callers (CLI, web) render the same result.
"""
from __future__ import annotations

from openleads import db as dbmod
from openleads import intent, settings
from openleads.cache.store import Cache
from openleads.engine import build_leads
from openleads.models import Query
from openleads.outreach import compose, deliverability, sender


def _noop(kind, payload):
    pass


def sendable_leads(leads, include_risky: bool = False):
    """Filter to leads we're willing to email: safe by default, +risky if opted in."""
    tiers = {"safe", "risky"} if include_risky else {"safe"}
    return [ld for ld in leads if ld.email and ld.tier in tiers]


def run(query: Query, send: bool = False, dry_run: bool = True,
        overrides: dict | None = None, cache=None, db=None,
        on_progress=_noop) -> dict:
    """Execute the full pipeline for ``query``. ``send=False`` stops after drafting."""
    own_cache = own_db = False
    if cache is None:
        cache = Cache()
        own_cache = True
    if db is None:
        db = dbmod.DB()
        own_db = True

    # The engine already drops 'bad' tiers; include_risky decides whether 'risky'
    # leads are eligible to be drafted/sent (off by default — safer).
    include_risky = bool(settings.get("include_risky"))

    result = {"leads": [], "drafts": [], "results": [], "campaign": query.keyword or "default"}
    try:
        # 1) find + verify
        on_progress("phase", "finding & verifying leads…")
        leads = build_leads(query, cache=cache, db=db, on_progress=on_progress)
        for ld in leads:
            db.upsert_lead(ld.to_dict())
        result["leads"] = leads

        # 2) write
        targets = sendable_leads(leads, include_risky=include_risky)
        on_progress("phase", f"writing {len(targets)} personalized emails…")
        drafts = []
        for ld in targets:
            d = compose.draft(ld.to_dict(), overrides)
            drafts.append(d)
            on_progress("draft", d)
        result["drafts"] = drafts

        # sender-side readiness is always useful to report
        result["preflight"] = deliverability.preflight(cache=cache)
        result["warmup"] = deliverability.warmup_status(db)

        # 3) send (dry-run unless explicitly told to send live)
        if send:
            on_progress("phase", "sending" if not dry_run else "previewing sends…")
            results = sender.send_drafts(drafts, dry_run=dry_run, db=db,
                                         campaign=result["campaign"],
                                         overrides=overrides, on_progress=
                                         lambda r: on_progress("send", r))
            result["results"] = results
    finally:
        if own_cache:
            cache.close()
        if own_db:
            db.close()
    return result


def quick(text: str, count: int = 25, send: bool = False, dry_run: bool = True,
          deep: bool = False, overrides: dict | None = None, on_progress=_noop) -> dict:
    """Convenience: parse free text into a Query and run the pipeline."""
    q, _ = intent.parse(text)
    q.count = count
    q.deep = deep
    q.verified_only = True  # the pipeline targets deliverable leads
    return run(q, send=send, dry_run=dry_run, overrides=overrides, on_progress=on_progress)
