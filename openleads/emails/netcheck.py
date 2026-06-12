"""
Outbound port-25 reachability — probed **once** per process, then remembered.

Live SMTP verification (``smtp_verify.probe``) needs an outbound connection to a
mail server on port 25. Most home/office ISPs and nearly every cloud provider
block it. v3.1 paid that cost *per candidate*: every single lead opened (and
waited out the timeout on) two dead connections, which is exactly why a
``verified_only`` YC run took ~26 s to yield one lead.

This module probes port 25 a single time against well-known, always-up mail
exchangers, caches the verdict for the life of the process, and lets the resolver
skip SMTP entirely when it's blocked. The engine then leans on the free,
port-25-independent signals (ground truth, learned patterns, Gravatar, DNS health)
that work everywhere — which is what makes it fast *and* honest.

``OPENLEADS_SMTP25`` can force the verdict for tests/CI: ``0`` = blocked, ``1`` =
open (skips the live probe entirely).
"""
from __future__ import annotations

import os
import socket
import threading

# Stable, high-availability MX hosts to test a real port-25 handshake against.
_PROBE_HOSTS = ("alt1.aspmx.l.google.com", "aspmx.l.google.com", "gmail-smtp-in.l.google.com")

_lock = threading.Lock()
_verdict: bool | None = None


def _env_override() -> bool | None:
    raw = os.environ.get("OPENLEADS_SMTP25", "").strip().lower()
    if raw in ("1", "true", "yes", "on", "open"):
        return True
    if raw in ("0", "false", "no", "off", "blocked"):
        return False
    return None


def _probe(timeout: float = 5.0) -> bool:
    for host in _PROBE_HOSTS:
        try:
            with socket.create_connection((host, 25), timeout=timeout):
                return True
        except OSError:
            continue
    return False


def port25_open(timeout: float = 5.0, force: bool = False) -> bool:
    """Return whether outbound port 25 works, probing at most once per process.

    ``force=True`` re-probes (used by ``doctor``). An ``OPENLEADS_SMTP25`` env var
    short-circuits the network probe so tests stay offline and deterministic.
    """
    global _verdict
    override = _env_override()
    if override is not None:
        return override
    with _lock:
        if _verdict is None or force:
            _verdict = _probe(timeout)
        return _verdict


def reset() -> None:
    """Forget the cached verdict (tests)."""
    global _verdict
    with _lock:
        _verdict = None
