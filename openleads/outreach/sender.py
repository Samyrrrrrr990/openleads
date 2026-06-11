"""
The sender — deliverability-first delivery of drafted emails.

Built to protect your domain reputation and stay out of spam:

* **Dry-run by default.** Nothing leaves your machine unless ``dry_run=False``.
* **Suppression-aware.** Never emails anyone bounced/unsubscribed/do-not-contact,
  and never the same person twice (the DB tracks every touch).
* **Warmup-capped.** Honors the daily ramp from :mod:`outreach.deliverability`.
* **Human-paced.** Randomized delays between real sends.
* **Correct headers.** Real ``Message-ID``/``Date``, a one-click ``List-Unsubscribe``
  (mailto) header, and a polite opt-out footer. Plain text, no tracking pixels.

Every attempt is logged to :class:`openleads.db.DB` so campaigns are resumable and
reportable.
"""
from __future__ import annotations

import random
import time
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from openleads import db as dbmod
from openleads import settings
from openleads.models import Draft, SendResult
from openleads.outreach import providers

OPT_OUT_FOOTER = "\n\nP.S. If this isn't relevant, just reply and I'll leave you be."


def _noop(_):
    pass


def build_message(draft: Draft, cfg: dict, add_footer: bool = True) -> EmailMessage:
    """Build a deliverability-friendly plain-text message for one recipient."""
    sender_name = settings.get("sender_name") or cfg.get("user", "")
    from_addr = cfg["user"]
    msg = EmailMessage()
    msg["From"] = f"{sender_name} <{from_addr}>" if sender_name else from_addr
    msg["To"] = draft.email
    msg["Subject"] = draft.subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=from_addr.split("@")[-1] or "localhost")
    # One-click unsubscribe via mailto (RFC 8058-friendly, no web server needed).
    msg["List-Unsubscribe"] = f"<mailto:{from_addr}?subject=unsubscribe>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    body = draft.body + (OPT_OUT_FOOTER if add_footer else "")
    msg.set_content(body)
    return msg


def send_drafts(drafts: list[Draft], dry_run: bool = True, db=None,
                campaign: str = "default", overrides: dict | None = None,
                step: int = 1, on_progress=_noop) -> list[SendResult]:
    """Send (or preview) a list of drafts. Returns one :class:`SendResult` each.

    Owns the DB lifecycle only if it opens one. Respects suppression + warmup caps;
    real sends are throttled with randomized human-like delays.
    """
    own_db = False
    if db is None:
        db = dbmod.DB()
        own_db = True

    cfg = providers.smtp_config(overrides)
    delay_min = int(settings.get("send_delay_min"))
    delay_max = max(delay_min, int(settings.get("send_delay_max")))

    # Warmup budget (real sends only).
    from openleads.outreach.deliverability import warmup_status
    remaining = warmup_status(db)["remaining"] if not dry_run else len(drafts)

    server = None
    results: list[SendResult] = []
    try:
        if not dry_run:
            server = providers.connect_smtp(cfg)  # raises on bad creds → caller handles

        sent_count = 0
        last_real_index = -1
        for i, d in enumerate(drafts):
            email = (d.email or "").lower().strip()
            reason = db.is_suppressed(email)
            if not email:
                res = SendResult(email, "skipped", detail="no recipient address")
            elif reason:
                res = SendResult(email, "skipped", detail=f"suppressed: {reason}")
            elif not d.subject or not d.body:
                res = SendResult(email, "skipped", detail="empty draft")
            elif not dry_run and sent_count >= remaining:
                res = SendResult(email, "skipped", detail="daily warmup cap reached")
            elif dry_run:
                res = SendResult(email, "preview")
            else:
                # human-paced gap between consecutive real sends
                if last_real_index >= 0:
                    time.sleep(random.uniform(delay_min, delay_max))
                try:
                    msg = build_message(d, cfg)
                    server.send_message(msg)
                    res = SendResult(email, "sent", message_id=msg["Message-ID"])
                    sent_count += 1
                    last_real_index = i
                except Exception as e:  # noqa: BLE001 — one failure must not abort the batch
                    res = SendResult(email, "error", error=str(e))

            db.record_touch(email, res.status, subject=d.subject, campaign=campaign,
                            step=step, message_id=res.message_id, error=res.error)
            if res.status == "sent":
                db.set_status(email, dbmod.STATUS_SENT)
            results.append(res)
            on_progress(res)
    finally:
        if server is not None:
            try:
                server.quit()
            except Exception:
                pass
        if own_db:
            db.close()
    return results
