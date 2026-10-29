"""
OpenLeads — the free, open-source Apollo alternative.

A universal `entity -> verified email` engine fed by a registry of pluggable,
free, keyless public data sources. Find founders, developers, doctors,
researchers — anyone — and verify their email over SMTP, using only public data.
Then work them in a local workspace (:mod:`openleads.workspace`): people and
companies, lists, ICP scoring, multi-step sequences, tasks and a deal pipeline.

Core library is 100% Python standard library (zero runtime dependencies).
The pretty chat TUI lives behind the optional ``[chat]`` extra; sending behind
``[campaign]``.

Public API:
    import openleads
    leads = openleads.find("dentists in Austin", count=10)   # -> SearchResult (a list of Lead)
    openleads.find_email("Ada Lovelace", "acme.com")          # -> EmailResult
    openleads.verify("ada@acme.com")                          # -> EmailResult

    from openleads import Query, Lead, Entity, EmailResult
    from openleads.engine import build_leads
    from openleads.sources import get_registry

``find`` / ``find_email`` / ``verify`` live in :mod:`openleads.api` and are imported
on first call, so ``import openleads`` stays light.
"""

__version__ = "5.0.0"

from openleads.models import EmailResult, Entity, Lead, Query, SourceInfo

__all__ = ["Entity", "EmailResult", "Lead", "Query", "SourceInfo", "__version__",
           "find", "find_email", "verify"]


def find(query: str = "", **options):
    """Find leads for a plain-English query. See :func:`openleads.api.find`."""
    from openleads.api import find as _find
    return _find(query, **options)


def find_email(name: str, domain: str, **options):
    """Most likely work email for a person at a domain. See :func:`openleads.api.find_email`."""
    from openleads.api import find_email as _find_email
    return _find_email(name, domain, **options)


def verify(email: str, **options):
    """Check one address (safe / risky / bad). See :func:`openleads.api.verify`."""
    from openleads.api import verify as _verify
    return _verify(email, **options)
