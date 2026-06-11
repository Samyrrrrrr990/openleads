"""
Core data models shared across the pipeline.

Every source yields normalized :class:`Entity` records. The email engine turns a
name+domain into an :class:`EmailResult`. The engine flattens both into a
:class:`Lead` for output. User intent is captured in a :class:`Query`.

All annotations use ``from __future__ import annotations`` so modern syntax
(``str | None``) is safe down to Python 3.8.
"""
from __future__ import annotations

from dataclasses import dataclass, field, fields


@dataclass
class Entity:
    """A normalized person/contact record produced by a source.

    Sources differ wildly (startups, doctors, researchers); this is the common
    shape the engine understands. ``domain`` is the email domain when known or
    derivable; ``links`` holds profile URLs (linkedin, github, orcid, npi, ...);
    ``extra`` holds vertical-specific metadata for transparency in output.
    """

    full_name: str
    title: str = ""
    organization: str = ""
    domain: str = ""
    website: str = ""
    location: str = ""
    links: dict = field(default_factory=dict)
    extra: dict = field(default_factory=dict)
    source: str = ""


@dataclass
class EmailResult:
    """Outcome of trying to find+verify an email for a name on a domain.

    ``confidence`` keeps v1's human labels for back-compat; ``score`` (0-100) is
    additive and ``signals`` records which checks fired so the score is explainable.
    v3 adds ``tier`` (safe|risky|bad — the send-decision) and ``reasons`` (a human
    list of why), driven by the multi-signal consensus in ``openleads.emails.score``.
    """

    email: str = ""
    confidence: str = "none"  # verified | catch_all_guess | pattern_guess | none
    score: int = 0
    signals: dict = field(default_factory=dict)
    tier: str = "bad"         # safe | risky | bad
    reasons: list = field(default_factory=list)


# v1 CSV schema, preserved exactly so automation.py / campaign keeps working.
# New columns are appended (never reordered) for back-compatibility.
CSV_FIELDS = [
    "First Name", "Last Name", "Email", "Title", "Organization Name",
    "Industry", "# Employees", "LinkedIn Url", "City", "Country",
    "Website", "Email Confidence",
    # v2 additions:
    "Email Score", "Source", "Vertical",
    # v3 addition: the send-decision tier (safe | risky | bad).
    "Email Tier",
]


@dataclass
class Lead:
    """A finished lead: an :class:`Entity` joined with its :class:`EmailResult`."""

    first_name: str = ""
    last_name: str = ""
    email: str = ""
    title: str = ""
    organization: str = ""
    industry: str = ""
    employees: str = ""
    linkedin_url: str = ""
    city: str = ""
    country: str = ""
    website: str = ""
    confidence: str = "none"
    score: int = 0
    source: str = ""
    vertical: str = ""
    signals: dict = field(default_factory=dict)
    tier: str = "bad"                       # safe | risky | bad (the send-decision)
    reasons: list = field(default_factory=list)

    @property
    def domain(self) -> str:
        return self.email.split("@", 1)[1].lower() if "@" in self.email else ""

    def to_csv_row(self) -> dict:
        """Map to the exact CSV header schema (``CSV_FIELDS``)."""
        return {
            "First Name": self.first_name,
            "Last Name": self.last_name,
            "Email": self.email,
            "Title": self.title,
            "Organization Name": self.organization,
            "Industry": self.industry,
            "# Employees": self.employees,
            "LinkedIn Url": self.linkedin_url,
            "City": self.city,
            "Country": self.country,
            "Website": self.website,
            "Email Confidence": self.confidence,
            "Email Score": self.score,
            "Source": self.source,
            "Vertical": self.vertical,
            "Email Tier": self.tier,
        }

    def to_dict(self) -> dict:
        """Full JSON-friendly representation (includes signals)."""
        return {
            "first_name": self.first_name,
            "last_name": self.last_name,
            "email": self.email,
            "title": self.title,
            "organization": self.organization,
            "industry": self.industry,
            "employees": self.employees,
            "linkedin_url": self.linkedin_url,
            "city": self.city,
            "country": self.country,
            "website": self.website,
            "confidence": self.confidence,
            "score": self.score,
            "source": self.source,
            "vertical": self.vertical,
            "tier": self.tier,
            "reasons": self.reasons,
            "signals": self.signals,
        }


@dataclass
class Query:
    """Parsed user intent that drives the engine."""

    action: str = "find"            # find | verify | export
    source: str | None = None       # source name; None = engine default
    count: int = 20
    industry: str | None = None
    location: str | None = None
    title: str | None = None
    keyword: str | None = None
    verified_only: bool = False
    fmt: str = "csv"                # csv | json | ndjson
    out: str | None = None
    max_companies: int = 400
    use_cache: bool = True

    def replace(self, **changes) -> "Query":
        """Return a copy with the given fields changed (for chat refinement)."""
        valid = {f.name for f in fields(self)}
        bad = set(changes) - valid
        if bad:
            raise ValueError(f"unknown Query field(s): {sorted(bad)}")
        data = {f.name: getattr(self, f.name) for f in fields(self)}
        data.update(changes)
        return Query(**data)


@dataclass
class SourceInfo:
    """Lightweight descriptor used by ``openleads sources`` and the registry."""

    name: str
    kind: str          # "company" | "people"
    description: str
    vertical: str = "" # human label: "startup founders", "US doctors", ...


@dataclass
class Draft:
    """A personalized outreach email produced by ``openleads.outreach.compose``."""

    email: str = ""                 # recipient
    subject: str = ""
    body: str = ""                  # plain text (deliverability-first default)
    first_name: str = ""
    organization: str = ""
    lint: dict = field(default_factory=dict)   # spam-lint report (score + warnings)
    model: str = ""                 # which generator produced it ("template" or model id)

    def to_dict(self) -> dict:
        return {
            "email": self.email, "subject": self.subject, "body": self.body,
            "first_name": self.first_name, "organization": self.organization,
            "lint": self.lint, "model": self.model,
        }


@dataclass
class SendResult:
    """Outcome of attempting to send one email."""

    email: str = ""
    status: str = "preview"         # sent | preview | skipped | error
    message_id: str = ""
    error: str = ""
    detail: str = ""                # e.g. "suppressed: bounced", "daily cap reached"

    def to_dict(self) -> dict:
        return {
            "email": self.email, "status": self.status, "message_id": self.message_id,
            "error": self.error, "detail": self.detail,
        }
