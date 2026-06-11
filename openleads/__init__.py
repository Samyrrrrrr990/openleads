"""
OpenLeads — the free, open-source Apollo alternative.

A universal `entity -> verified email` engine fed by a registry of pluggable,
free, keyless public data sources. Find founders, developers, doctors,
researchers — anyone — and verify their email over SMTP, using only public data.

Core library is 100% Python standard library (zero runtime dependencies).
The pretty chat TUI lives behind the optional ``[chat]`` extra; sending behind
``[campaign]``.

Public API:
    from openleads import Query, Lead, Entity, EmailResult
    from openleads.engine import build_leads
    from openleads.sources import get_registry
"""

__version__ = "3.1.0"

from openleads.models import EmailResult, Entity, Lead, Query, SourceInfo

__all__ = ["Entity", "EmailResult", "Lead", "Query", "SourceInfo", "__version__"]
