"""
SMTP verification: open one conversation, probe mailboxes with ``RCPT TO``, and
read the server's reply — *without ever sending a message* (we stop before DATA).

A ``250``/``251`` on a candidate means the mailbox is accepted. We first probe a
random, impossible mailbox to detect *catch-all* domains (which accept anything),
so guesses on those are labeled honestly instead of falsely "verified".

Needs outbound port 25. Some home ISPs block it; callers fall back to MX-only
pattern guesses when the server is unreachable.
"""
from __future__ import annotations

import random
import smtplib
import string
import time

from openleads.config import VERIFY_FROM, VERIFY_HELO


def probe(mx_host: str, domain: str, candidates: list[str], timeout: int = 15,
          polite_delay: float = 0.4) -> dict:
    """Probe ``candidates`` against one MX host.

    Returns ``{"verified": email|None, "catch_all": bool, "reachable": bool}``.
    """
    server = None
    try:
        server = smtplib.SMTP(timeout=timeout)
        server.connect(mx_host, 25)
        server.helo(VERIFY_HELO)
        server.mail(VERIFY_FROM)
    except Exception:
        if server is not None:
            try:
                server.close()
            except Exception:
                pass
        return {"verified": None, "catch_all": False, "reachable": False}

    # Catch-all detection: a random mailbox that cannot legitimately exist.
    rand = "".join(random.choices(string.ascii_lowercase, k=16)) + "@" + domain
    catch_all = False
    try:
        code, _ = server.rcpt(rand)
        if code in (250, 251):
            catch_all = True
    except Exception:
        pass

    verified = None
    if not catch_all:
        for cand in candidates:
            try:
                code, _ = server.rcpt(cand)
            except Exception:
                break
            if code in (250, 251):
                verified = cand
                break
            time.sleep(polite_delay)  # be gentle with the mail server

    try:
        server.quit()
    except Exception:
        pass
    return {"verified": verified, "catch_all": catch_all, "reachable": True}
