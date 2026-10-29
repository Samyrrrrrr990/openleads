"""
The Python API — OpenLeads in three functions.

    import openleads

    leads = openleads.find("dentists in Austin", count=10)
    for lead in leads:
        print(lead.email, lead.tier, lead.organization)
    print(leads.report.summary())          # what each source did, and why it stopped
    leads.write("dentists.csv")            # or .json / .jsonl

    openleads.find_email("Ada Lovelace", "acme.com")   # -> EmailResult
    openleads.verify("ada@acme.com")                    # -> EmailResult

``find`` takes the same plain-English query as the CLI plus keyword options, and
returns a :class:`SearchResult` — a ``list`` of :class:`~openleads.models.Lead`
that also carries the parsed query and the per-source run report. Everything is
stdlib-only and local; results and learned email patterns use the same cache and
database as the CLI (under ``~/.openleads``, or ``OPENLEADS_HOME``).
"""
from __future__ import annotations

import json
import os
from typing import Callable

from openleads.models import EmailResult, Lead, Query
from openleads.runreport import SearchReport

__all__ = ["find", "find_email", "verify", "SearchResult"]

# Leads returned when neither ``count`` nor the query names a number.
DEFAULT_COUNT = 10


class SearchResult(list):
    """The leads a search found (a ``list`` of :class:`Lead`), plus how it went.

    * ``.query``  — the :class:`Query` that ran (parsed words + your options);
    * ``.report`` — the :class:`~openleads.runreport.SearchReport`: per-source
      status, what was dropped, why it stopped, and hints when it came up short.
    """

    def __init__(self, leads=(), query: Query | None = None,
                 report: SearchReport | None = None) -> None:
        super().__init__(leads)
        self.query = query
        self.report = report

    def to_dicts(self) -> list:
        """Every lead as a JSON-ready dict (same shape as ``find --format json``)."""
        return [lead.to_dict() for lead in self]

    def to_json(self, indent: int | None = 2) -> str:
        return json.dumps(self.to_dicts(), indent=indent, ensure_ascii=False)

    def write(self, path: str, fmt: str | None = None) -> str:
        """Write the leads to ``path``; the format follows the extension unless given.

        ``.csv`` → the CSV schema of ``openleads find`` · ``.json`` → a JSON array ·
        ``.jsonl``/``.ndjson`` → one JSON object per line. Returns ``path``.
        """
        from openleads import writers
        if fmt is None:
            ext = os.path.splitext(str(path))[1].lower().lstrip(".")
            fmt = {"jsonl": "ndjson", "ndjson": "ndjson", "json": "json"}.get(ext, "csv")
        fmt = {"jsonl": "ndjson"}.get(fmt, fmt)
        writers.write(list(self), fmt=fmt, path=str(path))
        return str(path)

    def __repr__(self) -> str:
        summary = self.report.summary() if self.report is not None else f"{len(self)} leads"
        return f"<SearchResult {summary}>"


def find(query: str = "", *, count: int | None = None, location: str | None = None,
         source: str | None = None, verified_only: bool = False, budget: int = 60,
         deep: bool = False, people: bool = True, company_profile: bool = True,
         use_cache: bool = True, seniority=None, department=None,
         on_lead: Callable[[Lead], None] | None = None) -> SearchResult:
    """Find leads for a plain-English ``query`` ("marketing agencies in Miami").

    Options you pass win over what the words say; options you leave at their
    defaults don't undo the words ("50 fintech founders, verified only" still means
    50 and verified-only).

    :param count: how many leads to return (1–1000); default: the number in the
        query, else 10.
    :param location: a place, if it isn't in the words ("Austin, TX").
    :param source: pin one source (``openleads sources``); default: pick automatically.
    :param verified_only: keep only ``safe``-tier (deliverable) addresses.
    :param budget: seconds before the search returns what it has (0 = no limit).
    :param deep: slower, more thorough ground-truth harvesting.
    :param people: expand companies into named people from their team pages.
    :param company_profile: read each company's homepage (tech, socials, phone).
    :param use_cache: reuse cached lookups (and save new ones) under ``~/.openleads``.
    :param seniority: keep only these seniorities, e.g. ``["vp", "director"]``.
    :param department: keep only these departments, e.g. ``"sales,marketing"``.
    :param on_lead: called with each :class:`Lead` as soon as it's found.
    :raises ValueError: an unknown source or role filter (with a suggestion).
    """
    from openleads import intent
    from openleads.cache.store import Cache
    from openleads.db import DB
    from openleads.engine import build_leads

    if count is None and not intent._extract_count(query or ""):
        count = DEFAULT_COUNT
    q = intent.build_query(query, count=count, location=location, source=source,
                           verified_only=True if verified_only else None, budget=budget,
                           deep=True if deep else None, discover=people,
                           company_profile=company_profile, use_cache=use_cache,
                           seniority=seniority, department=department)

    def on_progress(kind, payload):
        if kind == "lead" and on_lead is not None:
            on_lead(payload)

    report = SearchReport()
    cache = Cache() if use_cache else None
    db = DB()
    try:
        leads = build_leads(q, cache=cache, db=db, on_progress=on_progress, report=report)
    finally:
        if cache is not None:
            cache.close()
        db.close()
    return SearchResult(leads, query=q, report=report)


def find_email(name: str, domain: str, *, deep: bool = False,
               use_cache: bool = True) -> EmailResult:
    """The most likely work address for ``name`` at ``domain``, with its evidence.

    Returns an :class:`EmailResult` (``email``, ``tier`` safe/risky/bad,
    ``confidence_pct``, ``reasons``).
    """
    from openleads.cache.store import Cache, MemoryCache
    from openleads.db import DB
    from openleads.emails.resolve import find_email as _find_email
    domain = (domain or "").lower().replace("https://", "").replace("http://", "").strip("/")
    cache = Cache() if use_cache else MemoryCache()
    db = DB()
    try:
        return _find_email(name, domain, cache=cache, db=db, deep=deep)
    finally:
        cache.close()
        db.close()


def verify(email: str, *, use_cache: bool = True) -> EmailResult:
    """Check one address: ``tier`` safe / risky / bad, and the reasons why."""
    from openleads.cache.store import Cache, MemoryCache
    from openleads.emails.resolve import verify_address
    cache = Cache() if use_cache else MemoryCache()
    try:
        return verify_address(email, cache=cache)
    finally:
        cache.close()
