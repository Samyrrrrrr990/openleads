"""
The outreach engine — turn verified leads into sent, deliverable cold emails.

This is the only part of OpenLeads that touches your mailbox, and it is built
deliverability-first: it drafts personalized plain-text email (``compose``),
audits *your* sending domain and plans a warmup (``deliverability``), connects to
your mailbox via provider presets (``providers``), and sends with throttling, a
suppression list, one-click unsubscribe, and a full audit log (``sender``).
Follow-ups and reply/bounce handling live in ``sequences`` and ``inbox``.

Everything is opt-in and dry-run by default. The core lead engine never sends.
"""
