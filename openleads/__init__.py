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
    from openleads import Query, Lead, Entity, EmailResult
    from openleads.engine import build_leads
    from openleads.sources import get_registry
"""

__version__ = "5.0.0"

from openleads.models import EmailResult, Entity, Lead, Query, SourceInfo

__all__ = ["Entity", "EmailResult", "Lead", "Query", "SourceInfo", "__version__"]
