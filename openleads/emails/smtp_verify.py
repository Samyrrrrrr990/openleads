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


def _rand_local() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=18))


def _rcpt(server, addr: str, polite_delay: float):
    """RCPT once, retrying a single time on a greylist (4xx) reply.

    Returns the SMTP code (or None on transport error). Many real servers greylist
    the first attempt from an unknown sender (a 450/451); a brief retry tells a true
    rejection apart from a temporary deferral, which is a common source of v2 misses.
    """
    try:
        code, _ = server.rcpt(addr)
    except Exception:
        return None
    if code in (450, 451, 452):  # greylisted / temporary — retry once
        time.sleep(max(polite_delay, 2.0))
        try:
            code, _ = server.rcpt(addr)
        except Exception:
            return None
    time.sleep(polite_delay)
    return code


def probe(mx_host: str, domain: str, candidates: list[str], timeout: int = 15,
          polite_delay: float = 0.4) -> dict:
    """Probe ``candidates`` against one MX host (never sends — stops before DATA).

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

    # Catch-all detection with TWO random mailboxes that cannot legitimately exist.
    # Requiring both to be accepted avoids falsely flagging a server that merely
    # greylit (or transiently accepted) a single probe.
    accepted_random = 0
    for _ in range(2):
        code = _rcpt(server, f"{_rand_local()}@{domain}", polite_delay)
        if code in (250, 251):
            accepted_random += 1
    catch_all = accepted_random >= 2

    verified = None
    if not catch_all:
        for cand in candidates:
            code = _rcpt(server, cand, polite_delay)
            if code is None:
                break
            if code in (250, 251):
                verified = cand
                break

    try:
        server.quit()
    except Exception:
        pass
    return {"verified": verified, "catch_all": catch_all, "reachable": True}
