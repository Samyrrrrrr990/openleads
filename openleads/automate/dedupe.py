"""
Dedupe + do-not-contact — never email the same person twice, and honor opt-outs.

Cold outreach reputation dies from repeat-contacting people who bounced, replied,
unsubscribed, or were already emailed. These helpers make that impossible by
checking every candidate against the suppression list and prior sends.
"""
from __future__ import annotations

import csv

from openleads import db as dbmod

# Statuses that mean "already engaged — don't re-add to a fresh send".
_ENGAGED = {dbmod.STATUS_SENT, dbmod.STATUS_REPLIED, dbmod.STATUS_BOUNCED,
            dbmod.STATUS_UNSUB, dbmod.STATUS_DNC, dbmod.STATUS_QUEUED}


def is_contactable(db, email: str) -> bool:
    """True if ``email`` may be emailed: not suppressed and not already engaged."""
    email = (email or "").lower().strip()
    if not email or db.is_suppressed(email):
        return False
    lead = db.get_lead(email)
    return not (lead and lead.get("status") in _ENGAGED)


def partition(db, leads) -> tuple[list, list]:
    """Split leads into ``(contactable, skipped)`` by suppression + prior engagement."""
    fresh, skipped = [], []
    seen = set()
    for ld in leads:
        email = getattr(ld, "email", None) or (ld.get("email") if isinstance(ld, dict) else "")
        email = (email or "").lower().strip()
        if not email or email in seen:
            skipped.append(ld)
            continue
        seen.add(email)
        (fresh if is_contactable(db, email) else skipped).append(ld)
    return fresh, skipped


def add_do_not_contact(db, emails) -> int:
    """Suppress one or many addresses as do-not-contact. Returns count added."""
    if isinstance(emails, str):
        emails = [emails]
    n = 0
    for e in emails:
        e = (e or "").lower().strip()
        if e:
            db.suppress(e, dbmod.STATUS_DNC)
            n += 1
    return n


def import_suppression(db, path: str) -> int:
    """Import a CSV/txt of addresses into the suppression list. Returns count."""
    n = 0
    with open(path, newline="", encoding="utf-8") as f:
        for line in f:
            for token in line.replace(",", " ").split():
                if "@" in token:
                    db.suppress(token.lower().strip(), "imported")
                    n += 1
    return n


def export_suppression(db, path: str) -> int:
    rows = db.list_suppressed()
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["email", "reason"])
        for r in rows:
            w.writerow([r["email"], r["reason"]])
    return len(rows)
