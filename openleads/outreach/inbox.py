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
import time
from email.utils import getaddresses, parseaddr, parsedate_to_datetime

from openleads import db as dbmod
from openleads.outreach import providers, replies

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


SCAN_MODEL_BUDGET = 10      # replies one scan may sort with your model; the rest use rules


def scan(db=None, days: int = 21, overrides: dict | None = None) -> dict:
    """Scan recent inbox mail; mark replied/bounced leads and keep reply text.
    At most :data:`SCAN_MODEL_BUDGET` new replies are sorted by your model per scan."""
    with replies.model_budget(SCAN_MODEL_BUDGET):
        return _scan(db, days, overrides)


def _scan(db=None, days: int = 21, overrides: dict | None = None) -> dict:
    """Scan recent inbox mail; mark replied/bounced leads and keep reply text.

    Safe to call repeatedly: a reply already kept (same Message-ID) isn't added
    again. Afterwards the Sent folder is checked for your own answers, so Today
    stops listing replies you've dealt with. Requires IMAP settings; returns an
    error dict if not configured rather than raising.
    """
    own_db = False
    if db is None:
        db = dbmod.DB()
        own_db = True
    summary = {"replied": 0, "bounced": 0, "scanned": 0, "recorded": 0, "answered": 0,
               "error": ""}
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
                kept = replies.record(db, from_addr, subject, _body_text(msg),
                                      _message_id(msg), _received(msg), from_hdr)
                if kept:
                    summary["recorded"] += 1
        summary["answered"] = _scan_sent(server, db, date_since)
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


def _scan_sent(server, db, date_since: str) -> int:
    """Mark replies answered when your own email to that person is in Sent. Never raises."""
    try:
        waiting = {r["email"]: r["received"] for r in replies.waiting(db)}
        if not waiting:
            return 0
        box = providers.find_sent_mailbox(server)
        if not box:
            return 0
        server.select(f'"{box}"', readonly=True)
        typ, data = server.search(None, f'(SINCE {date_since})')
        if typ != "OK" or not data or not data[0]:
            return 0
        answered = 0
        for num in data[0].split()[-500:]:
            typ, msg_data = server.fetch(num, "(RFC822)")
            if typ != "OK" or not msg_data or not msg_data[0]:
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            when = _received(msg)
            for _, addr in getaddresses(msg.get_all("To", []) + msg.get_all("Cc", [])):
                addr = addr.lower()
                if addr in waiting and when > waiting[addr]:
                    replies.mark_answered(db, addr, when)
                    waiting.pop(addr)
                    answered += 1
        return answered
    except Exception:  # noqa: BLE001 — a Sent folder we can't read just means "not checked"
        return 0


def _body_text(msg) -> str:
    """The plain text of a message; HTML-only mail is reduced to its text."""
    plain, rich = [], []
    for p in (msg.walk() if msg.is_multipart() else [msg]):
        kind = p.get_content_type()
        if kind not in ("text/plain", "text/html"):
            continue
        try:
            text = p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8",
                                                     "ignore")
        except Exception:
            continue
        (plain if kind == "text/plain" else rich).append(text)
    if any(t.strip() for t in plain):
        return "\n".join(plain).strip()
    return "\n".join(replies.html_text(t) for t in rich).strip()


def _message_id(msg) -> str:
    mid = (msg.get("Message-ID") or "").strip()
    if mid:
        return mid
    import hashlib
    key = f"{msg.get('From', '')}|{msg.get('Subject', '')}|{msg.get('Date', '')}"
    return "<" + hashlib.sha1(key.encode("utf-8", "ignore")).hexdigest() + "@openleads>"


def _received(msg) -> float:
    try:
        return parsedate_to_datetime(msg.get("Date")).timestamp()
    except Exception:
        return time.time()


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
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%d-%b-%Y")
