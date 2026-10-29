"""
What happened during a search, per source — so "4 leads" comes with a reason.

The engine creates one :class:`SearchReport` per run and makes it the *current*
report (a ``ContextVar``, so worker threads started through
:func:`openleads._concurrency.submit` see it too). The federation layer wraps each
source's stream and marks it as the *active source* while it runs, so anything
that goes wrong inside it — an HTTP error, a fallback to a slower path, a note —
is attributed to that source:

    local      ok        38 businesses → 61 contacts → 9 leads   21.4s
    yc         timeout   12 founders → 3 leads   (stopped at the budget)
    hn         failed    hn.algolia.com: HTTP 503

Helpers here (:func:`note`, :func:`fallback`, :func:`error`, :func:`flag`) are
no-ops outside a run, so library code can call them unconditionally. Pure stdlib.
"""
from __future__ import annotations

import contextvars
import threading
import urllib.parse
from contextlib import contextmanager
from dataclasses import dataclass, field

# The report of the run in progress (None outside a search).
CURRENT: contextvars.ContextVar = contextvars.ContextVar("openleads_report", default=None)
# The name of the source whose code is running right now (None = engine/expansion).
SOURCE: contextvars.ContextVar = contextvars.ContextVar("openleads_source", default=None)
# Where build_leads() drops its report when the caller asked to capture it.
_SINK: contextvars.ContextVar = contextvars.ContextVar("openleads_report_sink", default=None)

STATUSES = ("ok", "degraded", "empty", "failed", "timeout", "skipped")
MAX_ERRORS = 5
# DNS-over-HTTPS resolvers: failures here matter for every lead, so they're kept.
_DNS_HOSTS = ("dns.google", "cloudflare-dns.com")

# Plain-language meaning of each stop reason.
STOP_REASONS = {
    "count_reached": "got the leads asked for",
    "exhausted": "sources ran out of results",
    "budget": "time budget reached",
    "futility": "nothing usable after a long scan",
    "max_companies": "hit the --max-companies scan limit",
}


def _host(url: str) -> str:
    try:
        return urllib.parse.urlsplit(url).hostname or url
    except ValueError:
        return url


def _add_unique(items: list, text: str, limit: int = MAX_ERRORS) -> None:
    if text and text not in items and len(items) < limit:
        items.append(text)


@dataclass
class SourceReport:
    """How one source did in one run."""

    name: str
    status: str = "pending"  # ok | degraded | empty | failed | timeout | skipped
    entities: int = 0        # records the source itself returned
    expanded: int = 0        # contacts those became (team pages, published addresses)
    leads: int = 0           # leads that made it into the result
    seconds: float = 0.0     # time spent inside the source's own code
    fallbacks: list = field(default_factory=list)   # "overpass→nominatim (HTTP 429)", "stale cache"
    errors: list = field(default_factory=list)      # "overpass-api.de: HTTP 429" (deduped, ≤5)
    note: str = ""
    reason: str = ""         # why the planner picked it
    started: bool = field(default=False, repr=False)
    finished: bool = field(default=False, repr=False)
    hit_deadline: bool = field(default=False, repr=False)

    def settle(self, stop_reason: str = "") -> str:
        """Decide :attr:`status` from what happened (idempotent once decided)."""
        if self.status != "pending":
            return self.status
        if not self.started:
            self.status = "skipped"
        elif self.hit_deadline or (not self.finished and stop_reason == "budget"):
            self.status = "timeout"
        elif self.entities:
            self.status = "degraded" if (self.errors or self.fallbacks) else "ok"
        else:
            self.status = "failed" if self.errors else "empty"
        return self.status

    def line(self) -> str:
        """One human line: ``local  ok  38 found → 61 contacts → 9 leads  21.4s``."""
        bits = []
        if self.entities:
            bits.append(f"{self.entities} found")
            if self.expanded and self.expanded != self.entities:
                bits.append(f"{self.expanded} contacts")
            bits.append(f"{self.leads} lead{'s' if self.leads != 1 else ''}")
        detail = " → ".join(bits)
        extra = []
        if self.status == "skipped":
            extra.append("not needed" if not self.note else "")
        if self.status == "timeout":
            extra.append("stopped at the time budget")
        extra += self.fallbacks[:2]
        extra += self.errors[:2]
        if self.note:
            extra.append(self.note)
        tail = "; ".join(e for e in extra if e)
        secs = f"{self.seconds:.1f}s" if self.started else ""
        out = f"{self.name:<11} {self.status:<9} {detail}"
        if secs:
            out += f"  {secs}"
        if tail:
            out += f"  ({tail})"
        return out.rstrip()

    def to_dict(self) -> dict:
        return {"name": self.name, "status": self.status, "entities": self.entities,
                "expanded": self.expanded, "leads": self.leads,
                "seconds": round(self.seconds, 2), "fallbacks": list(self.fallbacks),
                "errors": list(self.errors), "note": self.note, "reason": self.reason}


@dataclass
class SearchReport:
    """One search, end to end: plan, per-source health, what was dropped and why it stopped."""

    query: dict = field(default_factory=dict)
    plan: list = field(default_factory=list)
    plan_reasons: dict = field(default_factory=dict)
    sources: dict = field(default_factory=dict)     # name -> SourceReport
    scanned: int = 0
    dropped: dict = field(default_factory=lambda: {"undeliverable": 0, "not_safe": 0,
                                                   "filtered": 0})
    leads: int = 0
    requested: int = 0
    seconds: float = 0.0
    budget: int = 0
    stop_reason: str = ""
    errors: list = field(default_factory=list)      # run-level (e.g. DNS) problems
    notes: list = field(default_factory=list)
    site_errors: int = 0                            # company pages that didn't load
    flags: set = field(default_factory=set, repr=False)

    def __post_init__(self) -> None:
        self._lock = threading.RLock()
        self._listener = None

    # --- recording ------------------------------------------------------------ #
    def source(self, name: str) -> SourceReport:
        """The :class:`SourceReport` for ``name`` (created on first use)."""
        with self._lock:
            sr = self.sources.get(name)
            if sr is None:
                sr = self.sources[name] = SourceReport(name=name,
                                                       reason=self.plan_reasons.get(name, ""))
            return sr

    def set_plan(self, names: list, reasons: dict | None = None) -> None:
        with self._lock:
            self.plan = list(names)
            self.plan_reasons = dict(reasons or {})
            for n in names:
                self.source(n).reason = self.plan_reasons.get(n, "")

    def add_error(self, sr: SourceReport, text: str) -> None:
        with self._lock:
            _add_unique(sr.errors, text)

    def source_done(self, sr: SourceReport) -> None:
        """A source finished on its own: settle its status and tell the listener."""
        sr.finished = True
        sr.settle()
        if self._listener is not None:
            try:
                self._listener(sr)
            except Exception:  # noqa: BLE001 — a UI callback must not break the run
                pass

    def finish(self, stop_reason: str) -> None:
        """Settle every source once the run has stopped."""
        self.stop_reason = stop_reason
        for sr in list(self.sources.values()):
            was = sr.status
            sr.settle(stop_reason)
            if was == "pending" and self._listener is not None:
                try:
                    self._listener(sr)
                except Exception:  # noqa: BLE001
                    pass

    # --- reading ---------------------------------------------------------------- #
    def summary(self) -> str:
        """One line: ``4/10 leads in 31.2s · time budget reached · local ok · yc timeout``."""
        parts = [f"{self.leads}/{self.requested} leads in {self.seconds:.1f}s"]
        if self.stop_reason and self.stop_reason != "count_reached":
            parts.append(STOP_REASONS.get(self.stop_reason, self.stop_reason))
        for sr in self.sources.values():
            parts.append(f"{sr.name} {sr.status}")
        return " · ".join(parts)

    def status_lines(self) -> list:
        """One line per source (plus run-level problems), for terminals and logs."""
        lines = [sr.line() for sr in self.sources.values()]
        if self.errors:
            lines.append("dns         " + "; ".join(self.errors[:2]))
        dropped = ", ".join(f"{n} {k.replace('_', ' ')}" for k, n in self.dropped.items() if n)
        if dropped:
            lines.append(f"dropped     {dropped}")
        return lines

    def problem(self) -> str:
        """The single most useful explanation when a search came up short ('' if none)."""
        for status in ("failed", "timeout", "degraded", "empty"):
            for sr in self.sources.values():
                if sr.status == status:
                    why = (sr.errors or sr.fallbacks or [sr.note or status])[0]
                    return f"{sr.name}: {status}" + (f" — {why}" if why != status else "")
        if self.errors:
            return self.errors[0]
        return STOP_REASONS.get(self.stop_reason, "")

    def hints(self) -> list:
        """Concrete next steps for a short or empty result."""
        out: list = []
        if self.leads >= self.requested and self.requested:
            return out
        if "geocode_failed" in self.flags:
            out.append("couldn't find that place — pass it explicitly, e.g. "
                       "--location 'Austin, TX'")
        if "overpass_fallback" in self.flags:
            out.append("OpenStreetMap is busy right now — re-run in a minute or raise --budget")
        if self.stop_reason == "budget":
            out.append(f"the {self.budget}s time budget ran out — raise it with --budget")
        if any("github" in e for sr in self.sources.values() for e in sr.errors):
            out.append("GitHub is rate-limiting — set GITHUB_TOKEN for higher limits")
        if self.dropped.get("not_safe") and self.query.get("verified_only"):
            out.append(f"{self.dropped['not_safe']} lead(s) weren't confirmed deliverable — "
                       "drop --verified-only to include risky ones")
        if self.dropped.get("filtered"):
            out.append("the --seniority/--department filters removed "
                       f"{self.dropped['filtered']} lead(s) — loosen them")
        if self.errors:
            out.append("DNS lookups failed — check your connection; affected leads are "
                       "marked risky")
        if self.stop_reason in ("exhausted", "futility") and not out:
            out.append("the sources ran out of matches — try a broader query or another place")
        return out

    def to_dict(self) -> dict:
        return {
            "query": dict(self.query), "plan": list(self.plan),
            "plan_reasons": dict(self.plan_reasons),
            "sources": {n: sr.to_dict() for n, sr in self.sources.items()},
            "scanned": self.scanned, "dropped": dict(self.dropped), "leads": self.leads,
            "requested": self.requested, "seconds": round(self.seconds, 2),
            "budget": self.budget, "stop_reason": self.stop_reason,
            "errors": list(self.errors), "notes": list(self.notes),
            "site_errors": self.site_errors, "summary": self.summary(),
            "hints": self.hints(),
        }


# --- module helpers (no-ops outside a run) --------------------------------------- #
def current() -> SearchReport | None:
    return CURRENT.get()


def _target():
    rep = CURRENT.get()
    if rep is None:
        return None, None
    name = SOURCE.get()
    return rep, (rep.source(name) if name else None)


def note(text: str) -> None:
    """An informational remark (e.g. "geocode: gazetteer")."""
    rep, sr = _target()
    if rep is None or not text:
        return
    with rep._lock:
        if sr is not None:
            sr.note = text if not sr.note else (sr.note if text in sr.note
                                                 else f"{sr.note}; {text}")
        else:
            _add_unique(rep.notes, text, limit=20)


def fallback(text: str) -> None:
    """A slower/secondary path was used (degrades the active source's status)."""
    rep, sr = _target()
    if rep is None or not text:
        return
    with rep._lock:
        if sr is not None:
            _add_unique(sr.fallbacks, text)
        else:
            _add_unique(rep.notes, text, limit=20)


def error(text: str) -> None:
    """Something failed (attributed to the active source, else to the run)."""
    rep, sr = _target()
    if rep is None or not text:
        return
    with rep._lock:
        _add_unique(sr.errors if sr is not None else rep.errors, text)


def flag(name: str) -> None:
    """Set a named condition that :meth:`SearchReport.hints` knows how to explain."""
    rep = CURRENT.get()
    if rep is not None:
        with rep._lock:
            rep.flags.add(name)


def deadline_hit() -> None:
    """A fetch was skipped because the time budget ran out."""
    rep, sr = _target()
    if sr is not None:
        sr.hit_deadline = True


def http_error(url: str, reason: str) -> None:
    """Route one failed request into the current report.

    "Not found" is an answer, not a failure (team pages 404 all the time), so it's
    ignored. Inside a source the failure is that source's; outside one, DNS
    failures are kept as run-level errors and company-site failures are counted.
    """
    rep, sr = _target()
    if rep is None:
        return
    if reason.startswith(("HTTP 404", "HTTP 410")):
        return
    host = _host(url)
    with rep._lock:
        if sr is not None:
            _add_unique(sr.errors, f"{host}: {reason}")
        elif host in _DNS_HOSTS:
            _add_unique(rep.errors, f"{host}: {reason}")
        else:
            rep.site_errors += 1


@contextmanager
def activate(report: SearchReport, listener=None):
    """Make ``report`` the current one for this context (and its worker threads)."""
    report._listener = listener
    token = CURRENT.set(report)
    try:
        yield report
    finally:
        CURRENT.reset(token)
        sink = _SINK.get()
        if sink is not None:
            sink.append(report)


@contextmanager
def active_source(name: str | None):
    token = SOURCE.set(name)
    try:
        yield
    finally:
        SOURCE.reset(token)


class _Captured:
    def __init__(self, sink: list) -> None:
        self._sink = sink

    @property
    def report(self) -> SearchReport | None:
        return self._sink[-1] if self._sink else None


@contextmanager
def capture():
    """Collect the report of the next ``build_leads`` run(s) without passing it in.

    ``with runreport.capture() as cap: build_leads(q)`` then ``cap.report``.
    """
    sink: list = []
    token = _SINK.set(sink)
    try:
        yield _Captured(sink)
    finally:
        _SINK.reset(token)


def query_dict(query) -> dict:
    """The parts of a :class:`~openleads.models.Query` worth showing in a report."""
    keys = ("text", "source", "count", "location", "keyword", "industry", "title",
            "verified_only", "deep", "budget", "seniority", "department")
    return {k: getattr(query, k, None) for k in keys
            if getattr(query, k, None) not in (None, "", [])}
