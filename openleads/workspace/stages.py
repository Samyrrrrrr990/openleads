"""
Stage vocabularies for contacts, accounts and deals.

Contact stages follow the Apollo model a sales team already knows. They move
forward on their own when something happens (an email is sent → *approaching*, a
reply → *replied*, a bounce → *bad data*, an unsubscribe → *do not contact*), and a
person can always set one by hand. Automatic moves never drag a contact backwards:
a follow-up sent to someone you marked *interested* leaves them *interested*.
"""
from __future__ import annotations

# (key, label, tone) — tone is a UI hint: neutral | info | good | warn | bad
CONTACT_STAGES = (
    ("new", "New", "neutral"),
    ("approaching", "Approaching", "info"),
    ("replied", "Replied", "good"),
    ("interested", "Interested", "good"),
    ("meeting", "Meeting booked", "good"),
    ("customer", "Customer", "good"),
    ("not_interested", "Not interested", "warn"),
    ("unresponsive", "Unresponsive", "warn"),
    ("do_not_contact", "Do not contact", "bad"),
    ("bad_data", "Bad data", "bad"),
)
CONTACT_STAGE_KEYS = tuple(s[0] for s in CONTACT_STAGES)

ACCOUNT_STAGES = (
    ("prospect", "Prospect", "neutral"),
    ("engaged", "Engaged", "info"),
    ("opportunity", "Opportunity", "good"),
    ("customer", "Customer", "good"),
    ("churned", "Churned", "warn"),
    ("disqualified", "Disqualified", "bad"),
)
ACCOUNT_STAGE_KEYS = tuple(s[0] for s in ACCOUNT_STAGES)

# (key, label, win probability %)
DEAL_STAGES = (
    ("qualify", "Qualify", 10),
    ("meeting", "Meeting", 25),
    ("proposal", "Proposal", 50),
    ("negotiation", "Negotiation", 75),
    ("won", "Won", 100),
    ("lost", "Lost", 0),
)
DEAL_STAGE_KEYS = tuple(s[0] for s in DEAL_STAGES)
DEAL_PROBABILITY = {k: p for k, _, p in DEAL_STAGES}
OPEN_DEAL_STAGES = ("qualify", "meeting", "proposal", "negotiation")

# Send-status (db.STATUS_*) → the stage it implies for a brand-new row.
STATUS_TO_STAGE = {
    "new": "new", "queued": "new", "sent": "approaching", "replied": "replied",
    "bounced": "bad_data", "unsubscribed": "do_not_contact",
    "do_not_contact": "do_not_contact",
}

# Stages an automatic "email sent" may advance from.
_PRE_CONTACT = {"", "new", None}
_PRE_REPLY = {"", "new", None, "approaching", "unresponsive"}


def auto_stage(current: str | None, status: str) -> str | None:
    """The stage a status change moves a contact to, or None to leave it alone."""
    if status == "sent":
        return "approaching" if current in _PRE_CONTACT else None
    if status == "replied":
        return "replied" if current in _PRE_REPLY else None
    if status == "bounced":
        return "bad_data"
    if status in ("unsubscribed", "do_not_contact"):
        return "do_not_contact"
    return None


def label(key: str, table=CONTACT_STAGES) -> str:
    for row in table:
        if row[0] == key:
            return row[1]
    return key.replace("_", " ").capitalize() if key else ""


def as_options(table=CONTACT_STAGES) -> list:
    """``[{key, label, tone|probability}]`` for the UI."""
    out = []
    for row in table:
        item = {"key": row[0], "label": row[1]}
        item["probability" if isinstance(row[2], int) else "tone"] = row[2]
        out.append(item)
    return out
