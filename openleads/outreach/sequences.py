"""
Follow-up sequences — the polite, automatic nudges that win most cold replies.

Most positive replies come from follow-ups, not the first email. A *sequence* is an
ordered list of steps with a delay before each. We compute which leads are **due**
for their next step from the send log, and we **never** follow up with anyone who
replied, bounced, or unsubscribed (the DB status gates that).

Timing/decision logic is pure and testable; drafting reuses
:mod:`openleads.outreach.compose`.
"""
from __future__ import annotations

import time

from openleads import db as dbmod
from openleads.models import Draft

DAY = 86400

# Default 3-touch sequence. Step 1 is the main personalized email; 2-3 are bumps.
DEFAULT_SEQUENCE = [
    {"name": "intro", "delay_days": 0},
    {"name": "bump", "delay_days": 3,
     "body": "Hey {first},\n\nFloating this back to the top of your inbox in case it "
             "slipped by. Worth a quick chat?\n\nBest,\n{sender}"},
    {"name": "breakup", "delay_days": 5,
     "body": "Hey {first},\n\nI'll close the loop here so I'm not cluttering your inbox. "
             "If the timing's ever better, just reply and I'll pick it back up.\n\n"
             "All the best,\n{sender}"},
]

# Statuses that permanently stop a sequence.
STOP_STATUSES = {dbmod.STATUS_REPLIED, dbmod.STATUS_BOUNCED, dbmod.STATUS_UNSUB,
                 dbmod.STATUS_DNC}


def next_step(touches: list[dict], sequence=DEFAULT_SEQUENCE, now: float | None = None) -> int | None:
    """Return the 1-based step number that's due now, or None if nothing is due.

    Looks at sent touches: finds the highest step already sent and whether enough
    days have passed (per the *next* step's ``delay_days``) to send the next one.
    """
    now = time.time() if now is None else now
    sent = [t for t in touches if t.get("status") == dbmod.STATUS_SENT]
    if not sent:
        return 1 if sequence else None
    last = max(sent, key=lambda t: t.get("step", 1))
    last_step = last.get("step", 1)
    if last_step >= len(sequence):
        return None  # sequence exhausted
    delay = sequence[last_step].get("delay_days", 0) * DAY  # next step's delay
    if now - last.get("ts", 0) >= delay:
        return last_step + 1
    return None


def due(db, campaign: str = "default", sequence=DEFAULT_SEQUENCE) -> list[dict]:
    """Leads whose next sequence step is due now: ``[{email, step}, ...]``."""
    out = []
    for lead in db.list_leads(status=dbmod.STATUS_SENT):
        email = lead["email"]
        touches = [t for t in db.touches_for(email) if t.get("campaign") == campaign]
        if any(t.get("status") in STOP_STATUSES for t in touches):
            continue
        step = next_step(touches, sequence)
        if step and step > 1:
            out.append({"email": email, "step": step})
    return out


def followup_draft(lead: dict, step: int, sender: str = "", sequence=DEFAULT_SEQUENCE) -> Draft:
    """Build a short bump for ``step`` (2+) using the sequence's template."""
    spec = sequence[step - 1]
    first = lead.get("first_name") or lead.get("name", "").split(" ")[0] or "there"
    body = spec.get("body", "Hey {first},\n\nJust following up.\n\nBest,\n{sender}")
    body = body.format(first=first, sender=sender or "Me")
    subject = "re: " + (lead.get("last_subject") or f"quick note for {lead.get('organization', '')}").strip()
    return Draft(email=lead["email"], subject=subject, body=body,
                 first_name=first, organization=lead.get("organization", ""),
                 model="sequence")
