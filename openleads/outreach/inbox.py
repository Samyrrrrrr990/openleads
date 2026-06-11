"""
Inbox read-back (optional) — detect replies and bounces so sequences self-stop.

If the user configures IMAP, we can close the loop automatically: a reply from a
lead marks them ``replied`` (and stops their follow-ups); a bounce notification
marks them ``bounced`` and suppresses the address. This is what keeps a campaign
clean without manual babysitting.

Pure parsing (``parse_bounced_recipient``, ``is_bounce``) is unit-tested; the IMAP
plumbing is thin and fully optional — everything else works without it.
"""
from __future__ import annotations

import email
import re
from email.utils import parseaddr

from openleads import db as dbmod
from openleads.outreach import providers

BOUNCE_SENDERS = ("mailer-daemon", "postmaster", "mail delivery", "maildelivery")
_ADDR_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def is_bounce(from_header: str, subject: str) -> bool:
    """Heuristic: is this message a delivery-failure notification?"""
    blob = f"{from_header} {subject}".lower()
    if any(s in blob for s in BOUNCE_SENDERS):
        return True
    return any(p in subject.lower() for p in
               ("undeliverable", "delivery status notification", "failure notice",
                "returned mail", "delivery has failed", "address not found"))


def parse_bounced_recipient(raw_message: str, known: set[str] | None = None) -> str | None:
    """Pull the failed recipient address from a bounce body (best-effort)."""
    candidates = _ADDR_RE.findall(raw_message or "")
    for addr in candidates:
        low = addr.lower()
        if any(s in low for s in BOUNCE_SENDERS):
            continue
        if known is not None and low not in known:
            continue
        return low
    return None


def scan(db=None, days: int = 21, overrides: dict | None = None) -> dict:
    """Scan recent inbox mail; mark replied/bounced leads. Returns a summary.

    Safe to call repeatedly. Requires IMAP settings; returns an error dict if not
    configured rather than raising.
    """
    own_db = False
    if db is None:
        db = dbmod.DB()
        own_db = True
    summary = {"replied": 0, "bounced": 0, "scanned": 0, "error": ""}
    server = None
    try:
        known = {lead["email"] for lead in db.list_leads(limit=100000)}
        if not known:
            return summary
        server = providers.connect_imap(providers.imap_config(overrides))
        server.select("INBOX")
        date_since = _imap_since(days)
        typ, data = server.search(None, f'(SINCE {date_since})')
        if typ != "OK":
            return summary
        ids = data[0].split()
        summary["scanned"] = len(ids)
        for num in ids[-500:]:  # cap work
            typ, msg_data = server.fetch(num, "(RFC822)")
            if typ != "OK" or not msg_data or not msg_data[0]:
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            from_hdr = msg.get("From", "")
            subject = msg.get("Subject", "")
            from_addr = parseaddr(from_hdr)[1].lower()
            if is_bounce(from_hdr, subject):
                raw = _flatten(msg)
                victim = parse_bounced_recipient(raw, known)
                if victim:
                    db.set_status(victim, dbmod.STATUS_BOUNCED)
                    summary["bounced"] += 1
            elif from_addr in known:
                lead = db.get_lead(from_addr)
                if lead and lead.get("status") == dbmod.STATUS_SENT:
                    db.set_status(from_addr, dbmod.STATUS_REPLIED)
                    summary["replied"] += 1
    except Exception as e:  # noqa: BLE001 — optional feature, never crash the app
        summary["error"] = str(e)
    finally:
        if server is not None:
            try:
                server.logout()
            except Exception:
                pass
        if own_db:
            db.close()
    return summary


def _flatten(msg) -> str:
    parts = []
    if msg.is_multipart():
        for p in msg.walk():
            if p.get_content_type() == "text/plain":
                try:
                    parts.append(p.get_payload(decode=True).decode("utf-8", "ignore"))
                except Exception:
                    pass
    else:
        try:
            parts.append(msg.get_payload(decode=True).decode("utf-8", "ignore"))
        except Exception:
            pass
    return "\n".join(parts)


def _imap_since(days: int) -> str:
    from datetime import datetime, timedelta
    return (datetime.utcnow() - timedelta(days=days)).strftime("%d-%b-%Y")
