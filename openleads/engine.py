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
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from openleads import _http, federation
from openleads.emails.permute import is_free_provider
from openleads.emails.resolve import find_email
from openleads.insights import companysize, phones, titles
from openleads.insights.company import fetch_profile
from openleads.models import EmailResult, Entity, Lead, Query
from openleads.sources import get_source

# Progress callback: (kind, payload). kinds:
#   "phase" (str msg) · "lead" (Lead) · "scan" ({scanned, found, with_domain})
ProgressFn = Callable[[str, object], None]


def _noop(kind: str, payload: object) -> None:
    pass


_DOMAINLESS = dict(confidence="none", score=0, tier="bad",
                   reasons=["no email domain — public record only"],
                   signals={"reason": "no_domain"})


# OpenStreetMap business categories → the industry label a CRM would show.
_OSM_INDUSTRY = {
    "advertising_agency": "Marketing & advertising", "marketing": "Marketing & advertising",
    "it": "Information technology", "company": "Business services",
    "dentist": "Dental", "doctors": "Medical practice", "doctor": "Medical practice",
    "clinic": "Medical practice", "veterinary": "Veterinary", "lawyer": "Legal services",
    "accountant": "Accounting", "tax_advisor": "Accounting", "insurance": "Insurance",
    "financial": "Financial services", "estate_agent": "Real estate",
    "architect": "Architecture", "fitness_centre": "Fitness", "sports_centre": "Fitness",
    "gym": "Fitness", "hairdresser": "Beauty & wellness", "beauty": "Beauty & wellness",
    "spa": "Beauty & wellness", "massage": "Beauty & wellness", "restaurant": "Food & beverage",
    "cafe": "Food & beverage", "bakery": "Food & beverage", "bar": "Food & beverage",
    "pub": "Food & beverage", "hotel": "Hospitality", "motel": "Hospitality",
    "guest_house": "Hospitality", "car": "Automotive", "car_repair": "Automotive",
    "plumber": "Construction & trades", "electrician": "Construction & trades",
    "carpenter": "Construction & trades", "construction_company": "Construction & trades",
    "hvac": "Construction & trades", "roofer": "Construction & trades",
    "gardener": "Construction & trades", "consulting": "Consulting",
    "employment_agency": "Staffing & recruiting", "school": "Education",
    "educational_institution": "Education", "ngo": "Nonprofit", "association": "Nonprofit",
    "designer": "Design", "telecommunication": "Telecommunications",
}


def industry_for(entity: Entity) -> str:
    """The source's industry, else a label for the OSM business category."""
    if entity.extra.get("industry"):
        return str(entity.extra["industry"])
    cat = str(entity.extra.get("category") or "").strip().lower()
    if not cat or cat in ("business", "yes"):
        return ""
    return _OSM_INDUSTRY.get(cat, cat.replace("_", " ").capitalize())


def entity_to_lead(entity: Entity, email_result) -> Lead:
    """Flatten an Entity + EmailResult into an output-ready Lead."""
    name = entity.full_name.strip()
    first, *rest = name.split() if name else [""]
    last = " ".join(rest)
    seniority, department = titles.classify(entity.title) if name else ("", "")
    found_phones = phones.split_tag(entity.links.get("phone") or entity.extra.get("phone") or "")
    return Lead(
        first_name=first,
        last_name=last,
        email=email_result.email,
        title=entity.title,
        organization=entity.organization,
        industry=industry_for(entity),
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
        confidence_pct=email_result.confidence_pct,
        seniority=seniority,
        department=department,
        phone=found_phones[0] if found_phones else "",
        company_size=companysize.bucket(entity.extra.get("employees", "")),
        socials=dict(entity.extra.get("socials") or {}),
    )


# Leave at least this much of the time budget for finding people, not profiling.
PROFILE_RESERVE_SECONDS = 15
PROFILE_TIMEOUT = 5


def apply_profile(lead: Lead, profile: dict | None) -> Lead:
    """Fold a company profile (see ``insights.company``) into ``lead``; never overwrite."""
    if not profile or profile.get("error"):
        return lead
    lead.technologies = list(profile.get("technologies") or lead.technologies or [])
    lead.socials = {**(profile.get("socials") or {}), **(lead.socials or {})}
    lead.description = lead.description or profile.get("description", "")
    lead.phone = lead.phone or profile.get("phone", "")
    lead.industry = lead.industry or profile.get("industry", "")
    lead.company_size = lead.company_size or profile.get("size", "")
    lead.employees = lead.employees or profile.get("employees", "")
    addr = profile.get("address") or {}
    lead.city = lead.city or addr.get("city", "")
    lead.country = lead.country or addr.get("country", "")
    if not lead.organization and profile.get("name"):
        lead.organization = profile["name"]
    if not lead.linkedin_url and not lead.first_name and lead.socials.get("linkedin"):
        lead.linkedin_url = lead.socials["linkedin"]   # company contact → company page
    return lead


def matches_filters(lead: Lead, query: Query) -> bool:
    """Seniority/department filters (empty filter = keep everything)."""
    if query.seniority and lead.seniority not in query.seniority:
        return False
    if query.department and lead.department not in query.department:
        return False
    return True


def build_leads(query: Query, cache=None, db=None, on_progress: ProgressFn = _noop) -> list[Lead]:
    """Run the pipeline for ``query`` and return up to ``query.count`` leads.

    ``db`` (an :class:`openleads.db.DB`) enables persistent per-domain pattern
    learning so accuracy compounds across runs. ``query.verified_only`` means
    "deliverable only" — it keeps only ``safe``-tier leads the engine is confident
    won't bounce.

    Email resolution runs concurrently in ordered windows; the scan stops early
    when a source clearly can't satisfy the request, and HTTP failures surface.
    """
    use_cache = cache if query.use_cache else None
    _http.clear_errors()
    gen, label = _entity_stream(query, use_cache, db, on_progress)

    budget = getattr(query, "budget", 0) or 0
    deadline = time.monotonic() + budget if budget > 0 else None
    profiles: dict = {}
    plock = threading.Lock()

    def profile_for(domain: str):
        if not getattr(query, "company_profile", True) or not domain or is_free_provider(domain):
            return None
        with plock:
            if domain in profiles:
                return profiles[domain]
        if deadline and deadline - time.monotonic() < PROFILE_RESERVE_SECONDS:
            return None
        prof = fetch_profile(domain, cache=use_cache, timeout=PROFILE_TIMEOUT)
        with plock:
            profiles[domain] = prof
        return prof

    def resolve(entity: Entity):
        if entity.domain:
            res = find_email(entity.full_name, entity.domain, cache=use_cache,
                             db=db, links=entity.links, deep=query.deep,
                             known_email=entity.extra.get("public_email"))
            prof = profile_for(entity.domain) if res.tier != "bad" else None
            return res, prof
        # Domain-less vertical (e.g. NPI): the public record is itself the value.
        return EmailResult(**_DOMAINLESS), None

    leads: list[Lead] = []
    scanned = with_domain = 0
    futility = max(25, query.count * 4)   # give up if nothing usable after this many
    workers = max(1, min(8, query.count))
    gen = iter(gen)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        while len(leads) < query.count and scanned < query.max_companies:
            if deadline and time.monotonic() >= deadline:
                on_progress("phase", f"time budget ({budget}s) reached — returning "
                            f"{len(leads)} lead(s); raise it with --budget")
                break
            batch = list(itertools.islice(gen, workers))
            if not batch:
                break
            scanned += len(batch)
            # Resolve the whole batch (threads) before touching the DB on this
            # thread → no worker/main-thread SQLite overlap. Order is preserved.
            results = list(pool.map(resolve, batch))
            for entity, (result, profile) in zip(batch, results):
                if entity.domain:
                    with_domain += 1
                    if result.tier == "bad":   # no MX / disposable / unguessable
                        continue
                if query.verified_only and result.tier != "safe":
                    continue
                lead = apply_profile(entity_to_lead(entity, result), profile)
                if not matches_filters(lead, query):
                    continue
                leads.append(lead)
                on_progress("lead", leads[-1])
                if len(leads) >= query.count:
                    break
            on_progress("scan", {"scanned": scanned, "found": len(leads),
                                  "with_domain": with_domain})
            if not leads and scanned >= futility:
                if with_domain == 0:
                    on_progress("phase", f"{label}: these records carry no email "
                                "domain — try a source with emails (local · hn · yc).")
                else:
                    on_progress("phase", f"{label}: no deliverable matches — try "
                                "without 'verified only' or a broader query.")
                break

    _surface_errors(label, leads, on_progress)
    on_progress("phase", f"done: {len(leads)} lead(s)")
    return leads


def _entity_stream(query: Query, cache, db, on_progress: ProgressFn):
    """Resolve a ``(entity_iterator, label)`` for ``query``.

    A pinned ``query.source`` runs that one source (back-compat). Otherwise the
    federation layer fans the query out across the sources that fit its shape and
    expands companies into real people — the "one box that just works" path.
    """
    if query.source and query.source != "auto":
        source = get_source(query.source)
        if source is None:
            raise ValueError(f"unknown source: {query.source!r}. Try `openleads sources`.")
        source.cache = cache
        on_progress("phase", f"source={source.name} ({source.vertical}) — searching…")
        return source.search(query), source.name

    names = federation.plan(query)
    on_progress("phase", "federated search · " + " · ".join(names) + " …")
    gen = federation.search(query, cache=cache, db=db, on_progress=on_progress)
    return gen, "federated"


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
