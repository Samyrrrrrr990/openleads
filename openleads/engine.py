"""
The pipeline: Query → Source.search() → email resolution → score → Lead.

This is the heart that every front-end (CLI, chat, web) shares. It is
source-agnostic and output-agnostic; it just turns a :class:`Query` into a list
of :class:`Lead`.

v3.1 makes it **fast and honest**: email resolution runs concurrently (so a batch
of MX/SMTP probes overlaps instead of blocking one-by-one), the scan bails early
when a source yields nothing usable (no more multi-minute silent waits), and any
underlying HTTP failure is surfaced instead of vanishing.
"""
from __future__ import annotations

import itertools
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from openleads import _http
from openleads.emails.resolve import find_email
from openleads.models import EmailResult, Entity, Lead, Query
from openleads.sources import default_source, get_source

# Progress callback: (kind, payload). kinds:
#   "phase" (str msg) · "lead" (Lead) · "scan" ({scanned, found, with_domain})
ProgressFn = Callable[[str, object], None]


def _noop(kind: str, payload: object) -> None:
    pass


_DOMAINLESS = dict(confidence="none", score=0, tier="bad",
                   reasons=["no email domain — public record only"],
                   signals={"reason": "no_domain"})


def entity_to_lead(entity: Entity, email_result) -> Lead:
    """Flatten an Entity + EmailResult into an output-ready Lead."""
    name = entity.full_name.strip()
    first, *rest = name.split() if name else [""]
    last = " ".join(rest)
    return Lead(
        first_name=first,
        last_name=last,
        email=email_result.email,
        title=entity.title,
        organization=entity.organization,
        industry=entity.extra.get("industry", ""),
        employees=entity.extra.get("employees", ""),
        linkedin_url=entity.links.get("linkedin", ""),
        city=entity.extra.get("city", "") or entity.location,
        country=entity.extra.get("country", ""),
        website=entity.website,
        confidence=email_result.confidence,
        score=email_result.score,
        source=entity.source,
        vertical=entity.extra.get("vertical", ""),
        tier=email_result.tier,
        reasons=email_result.reasons,
        signals=email_result.signals,
    )


def build_leads(query: Query, cache=None, db=None, on_progress: ProgressFn = _noop) -> list[Lead]:
    """Run the pipeline for ``query`` and return up to ``query.count`` leads.

    ``db`` (an :class:`openleads.db.DB`) enables persistent per-domain pattern
    learning so accuracy compounds across runs. ``query.verified_only`` means
    "deliverable only" — it keeps only ``safe``-tier leads the engine is confident
    won't bounce.

    Email resolution runs concurrently in ordered windows; the scan stops early
    when a source clearly can't satisfy the request, and HTTP failures surface.
    """
    name = query.source or default_source()
    source = get_source(name)
    if source is None:
        raise ValueError(f"unknown source: {name!r}. Try `openleads sources`.")
    source.cache = cache if query.use_cache else None
    use_cache = cache if query.use_cache else None
    _http.clear_errors()

    on_progress("phase", f"source={source.name} ({source.vertical}) — searching…")

    def resolve(entity: Entity) -> EmailResult:
        if entity.domain:
            return find_email(entity.full_name, entity.domain, cache=use_cache,
                              db=db, links=entity.links, deep=query.deep,
                              known_email=entity.extra.get("public_email"))
        # Domain-less vertical (e.g. NPI): the public record is itself the value.
        return EmailResult(**_DOMAINLESS)

    leads: list[Lead] = []
    scanned = with_domain = 0
    futility = max(25, query.count * 4)   # give up if nothing usable after this many
    workers = max(1, min(8, query.count))
    gen = iter(source.search(query))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        while len(leads) < query.count and scanned < query.max_companies:
            batch = list(itertools.islice(gen, workers))
            if not batch:
                break
            scanned += len(batch)
            # Resolve the whole batch (threads) before touching the DB on this
            # thread → no worker/main-thread SQLite overlap. Order is preserved.
            results = list(pool.map(resolve, batch))
            for entity, result in zip(batch, results):
                if entity.domain:
                    with_domain += 1
                    if result.tier == "bad":   # no MX / disposable / unguessable
                        continue
                if query.verified_only and result.tier != "safe":
                    continue
                leads.append(entity_to_lead(entity, result))
                on_progress("lead", leads[-1])
                if len(leads) >= query.count:
                    break
            on_progress("scan", {"scanned": scanned, "found": len(leads),
                                  "with_domain": with_domain})
            if not leads and scanned >= futility:
                if with_domain == 0:
                    on_progress("phase", f"{source.name}: these records carry no email "
                                "domain — try a source with emails (hn · yc · github).")
                else:
                    on_progress("phase", f"{source.name}: no deliverable matches — try "
                                "without 'verified only' or a broader query.")
                break

    _surface_errors(source.name, leads, on_progress)
    on_progress("phase", f"done — {len(leads)} lead(s)")
    return leads


def _surface_errors(source_name: str, leads: list, on_progress: ProgressFn) -> None:
    """If we came up empty and a request failed, say why (instead of silence)."""
    if leads:
        return
    errs = _http.recent_errors()
    if not errs:
        return
    url, reason = errs[-1]
    host = url.split("/")[2] if "//" in url else url
    extra = " — set GITHUB_TOKEN for higher limits" if "github" in host else ""
    on_progress("phase", f"note: {host} returned {reason}{extra}")
