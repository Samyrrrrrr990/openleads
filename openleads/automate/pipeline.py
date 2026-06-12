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


def sendable_leads(leads, include_risky: bool = False, min_pct: int = 0):
    """Filter to leads we're willing to email.

    ``safe`` leads are always eligible. ``risky`` leads are eligible only when
    ``include_risky`` is on AND their calibrated confidence is at least ``min_pct``
    — that lets a campaign reach high-probability guesses (e.g. a common pattern on
    an authenticated corporate domain) without dragging in pure shots in the dark.
    """
    out = []
    for ld in leads:
        if not ld.email:
            continue
        if ld.tier == "safe":
            out.append(ld)
        elif ld.tier == "risky" and include_risky and (ld.confidence_pct or 0) >= min_pct:
            out.append(ld)
    return out


def run(query: Query, send: bool = False, dry_run: bool = True,
        overrides: dict | None = None, cache=None, db=None,
        include_risky: bool | None = None, min_confidence: int = 0,
        on_progress=_noop) -> dict:
    """Execute the full pipeline for ``query``. ``send=False`` stops after drafting.

    ``include_risky`` overrides the stored setting when given; ``min_confidence``
    gates which risky leads are sendable by their calibrated 0–100 likelihood.
    """
    own_cache = own_db = False
    if cache is None:
        cache = Cache()
        own_cache = True
    if db is None:
        db = dbmod.DB()
        own_db = True

    # The engine already drops 'bad' tiers; include_risky decides whether 'risky'
    # leads are eligible to be drafted/sent (off by default — safer).
    if include_risky is None:
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
        targets = sendable_leads(leads, include_risky=include_risky, min_pct=min_confidence)
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
          deep: bool = False, overrides: dict | None = None, verified_only: bool = True,
          include_risky: bool | None = None, min_confidence: int = 0,
          on_progress=_noop) -> dict:
    """Convenience: parse free text into a Query and run the pipeline.

    ``verified_only`` (default True) keeps the engine to deliverable ``safe`` leads.
    A campaign that wants reach can pass ``verified_only=False`` with
    ``include_risky=True`` + a ``min_confidence`` floor to also draft high-
    probability guesses.
    """
    q, _ = intent.parse(text)
    q.count = count
    q.deep = deep
    q.verified_only = verified_only
    return run(q, send=send, dry_run=dry_run, overrides=overrides,
               include_risky=include_risky, min_confidence=min_confidence,
               on_progress=on_progress)
