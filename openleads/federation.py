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

import re
import time
from dataclasses import replace as _dc_replace
from typing import Iterator

from openleads import _concurrency, runreport
from openleads._concurrency import BudgetExhausted, ordered_map
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
_ML = ("hugging face", "huggingface", "ml engineer", "machine learning engineer",
       "ml developer", "model author", "dataset author", "llm developer", "ai engineer")
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
# Companies expanded into people at once. Each expansion fetches a handful of team
# pages, so doing them one at a time made local searches take minutes.
EXPAND_WORKERS = 6
# Below this share of the time budget, expansion keeps published addresses and
# skips team-page people discovery.
DEGRADE_AT = 0.4

_HONORIFIC_RE = re.compile(r"^(?:dr|mr|mrs|ms|mx|prof)\.?\s+", re.I)
# Post-nominals and generational suffixes ("K.C.", "MD", "Jr.", "PhD", "DDS").
_SUFFIX_RE = re.compile(
    r"(?:,?\s+(?:k\.?c\.?|q\.?c\.?|m\.?d\.?|d\.?d\.?s\.?|d\.?m\.?d\.?|ph\.?d\.?|"
    r"esq\.?|cpa|mba|jr\.?|sr\.?|ii|iii|iv))+\s*$", re.I)


def clean_person_name(name: str) -> str:
    """Drop honorifics and post-nominals ("Dr. Jane Doe, DDS" → "Jane Doe").

    Email patterns are built from the name, so "David Josse K.C." must not turn
    into ``david.kc@``.
    """
    name = re.sub(r"\s+", " ", (name or "")).strip()
    name = _HONORIFIC_RE.sub("", name).strip()
    return _SUFFIX_RE.sub("", name).strip(" ,")


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
    if loc and (_has(text, _LOCAL) or not _has(text, _DEV + _RESEARCH + _STARTUP + _ML)):
        add("local")
    # Health + a place → local clinics first (they publish websites, so they're
    # reachable). NPI records carry no email, so they only lead when there's no place.
    if _has(text, _HEALTH):
        add("local" if loc else "npi")
    if _has(text, _DEV):
        add("github")
    if _has(text, _RESEARCH):
        add("openalex")
    if _has(text, _ML):
        add("huggingface")
    if _has(text, _STARTUP):
        add("yc", "hn")
    if _has(text, _COMPANY) or (query.industry and not loc):
        add("companies", "edgar")
    # A location with no developer/researcher target is a local-business search.
    if loc and not (set(picks) & {"github", "openalex", "huggingface"}):
        add("local")
    # Sensible default when nothing matched: startups + hiring + companies.
    if not picks:
        add("yc", "hn", "companies")
    return picks[:MAX_SOURCES]


def _first_hit(text: str, words) -> str:
    low = f" {text.lower()} "
    return next((w.strip() for w in words if w in low), "")


def plan_reasons(query: Query, names: list | None = None) -> dict:
    """Why each planned source was picked, in plain words (for ``--explain`` and reports)."""
    names = plan(query) if names is None else list(names)
    if query.source and query.source not in ("auto",):
        return {n: "pinned with --source" for n in names}
    text = (query.text
            or " ".join(filter(None, [query.keyword, query.industry, query.title]))).strip()
    loc = (query.location or "").strip()
    groups = (_LOCAL, _HEALTH, _DEV, _RESEARCH, _ML, _STARTUP, _COMPANY)
    matched_any = any(_has(text, g) for g in groups) or bool(query.industry)
    out = {}
    for n in names:
        if n == "local":
            what = _first_hit(text, _HEALTH + _LOCAL)
            out[n] = (f"a place ({loc}) + a local category ('{what}')" if what
                      else f"a place ({loc}) with no developer/researcher target")
        elif n == "npi":
            out[n] = f"health terms ('{_first_hit(text, _HEALTH)}') and no place"
        elif n == "github":
            out[n] = f"developer terms ('{_first_hit(text, _DEV)}')"
        elif n == "openalex":
            out[n] = f"researcher terms ('{_first_hit(text, _RESEARCH)}')"
        elif n == "huggingface":
            out[n] = f"ML builder terms ('{_first_hit(text, _ML)}')"
        elif n in ("yc", "hn") and _has(text, _STARTUP):
            out[n] = f"startup terms ('{_first_hit(text, _STARTUP)}')"
        elif n in ("companies", "edgar") and (_has(text, _COMPANY) or query.industry):
            hit = _first_hit(text, _COMPANY)
            out[n] = f"company/industry terms ('{hit or query.industry}')"
        elif not matched_any:
            out[n] = "default mix (no specific signal in the query)"
        else:
            out[n] = "matched the query's keywords"
    return out


def _person_entity(company: Entity, name: str, title: str) -> Entity:
    """Clone a company Entity into a person Entity (keeps org/domain/site/location)."""
    name = clean_person_name(name)
    if not title or clean_person_name(title).lower() == name.lower():
        title = ""
    return _dc_replace(
        company,
        full_name=name,
        # Never the company's label: an OSM category ("Dentist") or a source tag
        # ("Hiring") on a person reads as their job title.
        title=title or "Team member",
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
    """Yield from each iterable in turn so results stay diverse as they arrive.

    A stream that raises is dropped (the others keep going): one broken source
    must never end the whole search.
    """
    streams = [iter(s) for s in streams]
    while streams:
        nxt = []
        for s in streams:
            try:
                item = next(s)
            except StopIteration:
                continue
            except BudgetExhausted:
                return
            except Exception:  # noqa: BLE001 — isolate a failing source
                continue
            yield item
            nxt.append(s)
        streams = nxt


def _instrument(name: str, stream) -> Iterator[Entity]:
    """Run one source's stream under its own name in the run report.

    While the source's code runs (each ``next()``), it is the *active source*, so
    its HTTP errors, fallbacks and notes are attributed to it. Entities and time
    are counted; an exception or the time budget ends this stream only — the other
    sources keep going. An entity without a ``source`` gets this one's name.
    """
    rep = runreport.current()
    sr = rep.source(name) if rep is not None else None
    it = iter(stream)
    try:
        while True:
            if sr is not None:
                sr.started = True
            t0 = time.monotonic()
            token = runreport.SOURCE.set(name)
            ent, failure = None, None
            try:
                ent = next(it)
            except StopIteration:
                failure = "done"
            except BudgetExhausted:
                failure = "deadline"
            except Exception as e:  # noqa: BLE001 — isolate a failing source
                failure = f"{type(e).__name__}: {e}"
            finally:
                runreport.SOURCE.reset(token)
                if sr is not None:
                    sr.seconds += time.monotonic() - t0
            if failure is not None:
                if sr is not None:
                    if failure == "deadline":
                        sr.hit_deadline = True
                    else:
                        if failure != "done":
                            rep.add_error(sr, failure)
                        rep.source_done(sr)
                return
            if sr is not None:
                sr.entities += 1
            if isinstance(ent, Entity) and not ent.source:
                ent.source = name
            yield ent
    finally:
        close = getattr(it, "close", None)
        if close is not None:
            try:
                close()
            except Exception:  # noqa: BLE001 — cleanup only
                pass


def key_for(cand: Entity) -> tuple:
    """Dedupe key: one row per person, or per published address for company contacts.

    Keyed on the name alone, a company's second contact address (``sales@`` after
    ``info@``) collapsed into the first.
    """
    who = (cand.full_name or "").lower().strip()
    if not who:
        who = str(cand.extra.get("public_email") or "").lower().strip()
    return (cand.domain, who)


def _tagged(name: str, stream) -> Iterator[tuple]:
    for ent in stream:
        yield name, ent


def search(query: Query, cache=None, db=None, discover_people: bool | None = None,
           on_progress=None) -> Iterator[Entity]:
    """Fan ``query`` out, expand companies into people, dedupe, and yield Entities."""
    on_progress = on_progress or (lambda *_: None)
    discover = query.discover if discover_people is None else discover_people
    names = plan(query)
    rep = runreport.current()
    if rep is not None and not rep.plan:
        rep.set_plan(names, plan_reasons(query, names))
    streams = []
    for name in names:
        src = get_source(name)
        if src is None:
            if rep is not None:
                rep.source(name).note = "no such source installed"
            continue
        src.cache = cache
        try:
            stream = src.search(query)
        except Exception as e:  # noqa: BLE001 — a plugin's search() may raise eagerly
            if rep is not None:
                sr = rep.source(name)
                sr.started = True
                rep.add_error(sr, f"{type(e).__name__}: {e}")
                rep.source_done(sr)
            continue
        streams.append(_tagged(name, _instrument(name, stream)))
    if not streams:
        return

    degraded: set = set()

    def expand(item) -> tuple:
        name, ent = item
        disc = discover
        # Late in the budget, team-page crawls (up to a dozen pages per company)
        # cost more than they return: keep the published addresses, skip people.
        if disc and _concurrency.fraction_left() < DEGRADE_AT:
            disc = False
            if name not in degraded:
                degraded.add(name)
                with runreport.active_source(name):
                    runreport.note("people discovery skipped (budget)")
        try:
            return name, expand_company(ent, cache=cache, discover=disc)
        except Exception:               # one bad site never sinks the whole search
            return name, [ent]

    seen: set[tuple] = set()
    groups = ordered_map(expand, _roundrobin(streams), EXPAND_WORKERS)
    try:
        for name, group in groups:
            for cand in group:
                if key_for(cand) in seen:
                    continue
                seen.add(key_for(cand))
                if rep is not None:
                    rep.source(name).expanded += 1
                yield cand
    except BudgetExhausted:
        return
    finally:
        groups.close()
        for s in streams:
            close = getattr(s, "close", None)
            if close is not None:
                try:
                    close()
                except Exception:  # noqa: BLE001 — cleanup only
                    pass


# Back-compat name (tests and plugins import it from here).
_ordered_parallel = ordered_map
