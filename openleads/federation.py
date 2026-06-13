"""
The federation layer — OpenLeads' answer to "one box that just works."

Apollo feels magic because you type an ICP and get people; you never pick a data
source. We get the same feel, free and local, by **fanning a query out across the
public sources that fit its shape** instead of resolving one source:

* a place + a business category  → ``local`` (OpenStreetMap)
* founder / startup language      → ``yc`` + ``hn``
* an industry / company term      → ``companies`` (Wikidata) + ``edgar``
* developer / researcher / doctor → ``github`` / ``openalex`` / ``npi``
* a named domain                  → ``domains``

Company results are then **expanded into real people** via team-page discovery
(:mod:`openleads.discover.people`) so a bare company domain becomes contactable
decision-makers — exactly the step the email waterfall needs. Streams are
interleaved round-robin (diverse results early) and de-duplicated by
``(domain, person)``. The engine consumes the merged :class:`Entity` stream
unchanged; everything downstream (email waterfall, scoring, output) is reused.
"""
from __future__ import annotations

from dataclasses import replace as _dc_replace
from typing import Iterator

from openleads.discover.people import find_people
from openleads.emails import groundtruth
from openleads.emails.permute import is_role_account
from openleads.models import Entity, Query
from openleads.sources import get_source

# --- keyword groups that steer the fan-out ---------------------------------- #
_DEV = ("developer", "developers", "engineer", "engineers", "devs", "programmer",
        "open source", "open-source", "maintainer", "hacker", "github")
_RESEARCH = ("researcher", "researchers", "professor", "academic", "scientist",
             "scientists", "phd", "scholar", "postdoc", "publication")
_HEALTH = ("doctor", "doctors", "physician", "dentist", "dentists", "clinic",
           "nurse", "pediatric", "dermatolog", "cardiolog", "therapist", "surgeon")
_STARTUP = ("founder", "founders", "startup", "startups", "co-founder", "cofounder",
            "ceo", "cto", "yc", "y combinator", "saas", "indie hacker", "maker")
_COMPANY = ("company", "companies", "firm", "firms", "brand", "brands", "enterprise",
            "manufacturer", "vendor", "business", "businesses")
# Categories that are inherently *local* (a place makes them an OSM search).
_LOCAL = ("agency", "agencies", "marketing", "advertis", "dentist", "clinic",
          "law firm", "lawyer", "attorney", "accountant", "accounting", "gym",
          "fitness", "salon", "barber", "spa", "restaurant", "cafe", "bakery",
          "hotel", "realtor", "real estate", "plumber", "electrician", "contractor",
          "consult", "studio", "shop", "store", "boutique", "broker", "insurance",
          "architect", "veterinar", "recruit", "staffing", "school", "tutoring",
          "nonprofit", "roofer", "hvac", "landscap", "mechanic", "dealership")

# How many people to pull from one company's team page (most senior first-ish).
MAX_PEOPLE_PER_COMPANY = 3
# Cap the fan-out so we stay fast and polite.
MAX_SOURCES = 4


def _has(text: str, words) -> bool:
    low = f" {text.lower()} "
    return any(w in low for w in words)


def plan(query: Query) -> list[str]:
    """Return the ordered list of source names to fan ``query`` out across.

    An explicit ``query.source`` pin (anything but ``None``/``"auto"``) short-circuits
    to that single source, preserving back-compat with ``find -s <source>``.
    """
    if query.source and query.source not in ("auto",):
        return [query.source]

    # Route on the original free text when present (it still carries the role words
    # the keyword-distiller strips); fall back to the structured fields otherwise.
    text = (query.text
            or " ".join(filter(None, [query.keyword, query.industry, query.title]))).strip()
    loc = (query.location or "").strip()
    picks: list[str] = []

    def add(*names):
        for n in names:
            if n not in picks:
                picks.append(n)

    # A place + a business-ish category → local businesses (the headline path).
    if loc and (_has(text, _LOCAL) or not _has(text, _DEV + _RESEARCH + _STARTUP)):
        add("local")
    if _has(text, _HEALTH):
        add("npi", "local")
    if _has(text, _DEV):
        add("github")
    if _has(text, _RESEARCH):
        add("openalex")
    if _has(text, _STARTUP):
        add("yc", "hn")
    if _has(text, _COMPANY) or (query.industry and not loc):
        add("companies", "edgar")
    # A location with no developer/researcher target is a local-business search.
    if loc and not (set(picks) & {"github", "openalex"}):
        add("local")
    # Sensible default when nothing matched: startups + hiring + companies.
    if not picks:
        add("yc", "hn", "companies")
    return picks[:MAX_SOURCES]


def _person_entity(company: Entity, name: str, title: str) -> Entity:
    """Clone a company Entity into a person Entity (keeps org/domain/site/location)."""
    return _dc_replace(
        company,
        full_name=name,
        title=title or company.title or "Team member",
        links=dict(company.links),
        extra={**company.extra, "via": "team-page", "public_email": ""},
    )


def _company_contact(company: Entity, email: str) -> Entity:
    """A company-level contact Entity built from a harvested role/contact address."""
    return _dc_replace(
        company,
        full_name="",
        title="Team / contact address" if is_role_account(email) else company.title,
        extra={**company.extra, "public_email": email,
               "role_address": is_role_account(email)},
    )


def expand_company(ent: Entity, cache=None, discover: bool = True,
                   max_people: int = MAX_PEOPLE_PER_COMPANY) -> list[Entity]:
    """Turn a company Entity into the best set of contactable Entities.

    Order of value: a person already on the record → discovered team people →
    a published ground-truth address → the company itself (honest fallback).
    """
    if ent.full_name:                       # already a person
        return [ent]
    if not ent.domain:                      # nothing to resolve against
        return [ent]

    out: list[Entity] = []
    # A source that already handed us a real on-domain address is ground truth.
    if ent.extra.get("public_email"):
        out.append(ent)

    if discover:
        people = find_people(ent.domain, cache=cache, limit=max_people * 2)
        for p in people[:max_people]:
            out.append(_person_entity(ent, p["name"], p["title"]))

    if not out:
        # No people, no source-provided address: harvest published addresses so the
        # company is still reachable (real role/contact mailboxes → 'safe' for free).
        emails = groundtruth.harvest_from_site(ent.domain, cache=cache)
        for email in sorted(emails, key=is_role_account)[:2]:
            out.append(_company_contact(ent, email))
    if not out:
        out.append(ent)                     # honest empty — engine will tier it
    return out


def _roundrobin(streams) -> Iterator:
    """Yield from each iterable in turn so results stay diverse as they arrive."""
    streams = [iter(s) for s in streams]
    while streams:
        nxt = []
        for s in streams:
            try:
                yield next(s)
                nxt.append(s)
            except StopIteration:
                continue
        streams = nxt


def search(query: Query, cache=None, db=None, discover_people: bool | None = None,
           on_progress=None) -> Iterator[Entity]:
    """Fan ``query`` out, expand companies into people, dedupe, and yield Entities."""
    on_progress = on_progress or (lambda *_: None)
    discover = query.discover if discover_people is None else discover_people
    names = plan(query)
    streams = []
    for name in names:
        src = get_source(name)
        if src is None:
            continue
        src.cache = cache
        streams.append(src.search(query))
    if not streams:
        return

    seen: set[tuple] = set()
    for ent in _roundrobin(streams):
        for cand in expand_company(ent, cache=cache, discover=discover):
            key = (cand.domain, (cand.full_name or "").lower().strip())
            if key in seen:
                continue
            seen.add(key)
            yield cand
