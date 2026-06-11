"""
The pipeline: Query → Source.search() → email resolution → score → Lead.

This is the heart that every front-end (CLI, chat) shares. It is source-agnostic
and output-agnostic; it just turns a :class:`Query` into a list of :class:`Lead`.
"""
from __future__ import annotations

from typing import Callable

from openleads.emails.resolve import find_email
from openleads.models import Entity, Lead, Query
from openleads.sources import default_source, get_source

# Progress callback: (kind, payload). kinds: "phase" (str msg), "lead" (Lead).
ProgressFn = Callable[[str, object], None]


def _noop(kind: str, payload: object) -> None:
    pass


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
    learning so accuracy compounds across runs. ``query.verified_only`` now means
    "deliverable only" — it keeps only ``safe``-tier leads the engine is confident
    won't bounce.
    """
    name = query.source or default_source()
    source = get_source(name)
    if source is None:
        raise ValueError(f"unknown source: {name!r}. Try `openleads sources`.")
    source.cache = cache if query.use_cache else None
    use_cache = cache if query.use_cache else None

    on_progress("phase", f"source={source.name} ({source.vertical}) — searching…")

    leads: list[Lead] = []
    for entity in source.search(query):
        if len(leads) >= query.count:
            break

        if entity.domain:
            result = find_email(entity.full_name, entity.domain, cache=use_cache,
                                db=db, links=entity.links, deep=query.deep,
                                known_email=entity.extra.get("public_email"))
            # Skip non-deliverable domains (no MX / disposable / unguessable personal).
            if result.tier == "bad":
                continue
        else:
            # Domain-less vertical (e.g. NPI): the public record is itself valuable.
            from openleads.models import EmailResult
            result = EmailResult(confidence="none", score=0, tier="bad",
                                 reasons=["no email domain — public record only"],
                                 signals={"reason": "no_domain"})

        # verified_only → deliverable (safe) only.
        if query.verified_only and result.tier != "safe":
            continue

        lead = entity_to_lead(entity, result)
        leads.append(lead)
        on_progress("lead", lead)

    on_progress("phase", f"done — {len(leads)} lead(s)")
    return leads
