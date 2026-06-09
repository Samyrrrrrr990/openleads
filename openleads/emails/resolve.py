"""
Orchestrate the email engine and compute an explainable confidence score.

``find_email(name, domain)`` is the single public entry point. ``score_signals``
is a pure function (no network) so the scoring math is unit-tested directly.
"""
from __future__ import annotations

from openleads.emails import mx as mxmod
from openleads.emails import smtp_verify
from openleads.emails.permute import (
    candidate_emails,
    is_common_pattern,
    is_disposable,
    is_role_account,
    name_parts,
)
from openleads.models import EmailResult


def score_signals(s: dict) -> dict:
    """Map a dict of boolean/int signals to ``{"confidence", "score"}`` (0-100).

    Pure and deterministic. Signals understood:
    ``mx_exists, mx_resolvers_ok, mx_agreement, smtp_verified, catch_all,
    smtp_reachable, common_pattern, role_account, disposable``.
    """
    if not s.get("mx_exists") or s.get("disposable"):
        return {"confidence": "none", "score": 0}

    mx_bonus = 0
    if s.get("mx_resolvers_ok", 0) >= 2:
        mx_bonus += 8
    if s.get("mx_agreement"):
        mx_bonus += 7
    pattern_bonus = 5 if s.get("common_pattern") else 0
    role_penalty = 20 if s.get("role_account") else 0

    if s.get("smtp_verified"):
        confidence = "verified"
        score = 85 + mx_bonus + (3 if s.get("common_pattern") else 0)
    elif s.get("catch_all"):
        confidence = "catch_all_guess"
        score = 45 + mx_bonus + pattern_bonus
    elif s.get("smtp_reachable"):
        # Server answered but rejected every candidate → weak guess.
        confidence = "pattern_guess"
        score = 30 + mx_bonus + pattern_bonus
    else:
        # Port 25 blocked / server unreachable → MX-only guess.
        confidence = "pattern_guess"
        score = 35 + mx_bonus + pattern_bonus

    score = max(0, min(100, score - role_penalty))
    return {"confidence": confidence, "score": score}


def verify_address(email: str, cache=None) -> EmailResult:
    """Verify one concrete ``email`` (no name permutation). For ``openleads verify``."""
    if "@" not in email:
        return EmailResult(email=email, confidence="none", score=0,
                           signals={"reason": "not_an_email"})
    domain = email.split("@", 1)[1].lower()

    mx_info = cache.get("mx", domain) if cache else None
    if mx_info is None:
        mx_info = mxmod.lookup(domain)
        if cache:
            cache.set("mx", domain, mx_info)
    hosts = mx_info.get("hosts") or []

    signals = {
        "mx_exists": bool(hosts),
        "mx_resolvers_ok": mx_info.get("resolvers_ok", 0),
        "mx_agreement": mx_info.get("agreement", False),
        "disposable": is_disposable(domain),
        "role_account": is_role_account(email),
    }
    if not hosts or signals["disposable"]:
        return EmailResult(email=email, confidence="none", score=0, signals=signals)

    probe = {"verified": None, "catch_all": False, "reachable": False}
    for host in hosts[:2]:
        probe = smtp_verify.probe(host, domain, [email])
        if probe["reachable"]:
            break
    signals.update({
        "smtp_verified": bool(probe.get("verified")),
        "catch_all": probe.get("catch_all", False),
        "smtp_reachable": probe.get("reachable", False),
    })
    scored = score_signals(signals)
    return EmailResult(email=email, confidence=scored["confidence"],
                       score=scored["score"], signals=signals)


def _verify_key(full_name: str, domain: str) -> str:
    first, last = name_parts(full_name)
    return f"{first or ''}|{last or ''}|{domain}"


def find_email(full_name: str, domain: str, cache=None) -> EmailResult:
    """Find + verify the most likely email for ``full_name`` at ``domain``.

    Uses ``cache`` (optional) to skip repeat MX/SMTP probes. Returns an
    :class:`EmailResult` with email, confidence label, 0-100 score, and signals.
    """
    cands = candidate_emails(full_name, domain)
    if not cands:
        return EmailResult(confidence="none", score=0, signals={"reason": "no_candidates"})

    # --- MX (cached by domain) ---------------------------------------------
    mx_info = cache.get("mx", domain) if cache else None
    if mx_info is None:
        mx_info = mxmod.lookup(domain)
        if cache:
            cache.set("mx", domain, mx_info)
    hosts = mx_info.get("hosts") or []

    signals = {
        "mx_exists": bool(hosts),
        "mx_resolvers_ok": mx_info.get("resolvers_ok", 0),
        "mx_agreement": mx_info.get("agreement", False),
        "disposable": is_disposable(domain),
    }

    if not hosts:
        return EmailResult(confidence="none", score=0, signals=signals)
    if signals["disposable"]:
        return EmailResult(email=cands[0], confidence="none", score=0, signals=signals)

    # --- SMTP verification (cached by name+domain) -------------------------
    vkey = _verify_key(full_name, domain)
    probe = cache.get("verify", vkey) if cache else None
    if probe is None:
        probe = {"verified": None, "catch_all": False, "reachable": False}
        for host in hosts[:2]:
            probe = smtp_verify.probe(host, domain, cands)
            if probe["reachable"]:
                break
        if cache:
            cache.set("verify", vkey, probe)

    verified = probe.get("verified")
    best = verified or cands[0]
    signals.update({
        "smtp_verified": bool(verified),
        "catch_all": probe.get("catch_all", False),
        "smtp_reachable": probe.get("reachable", False),
        "common_pattern": is_common_pattern(best, full_name),
        "role_account": is_role_account(best),
    })

    scored = score_signals(signals)
    return EmailResult(email=best, confidence=scored["confidence"],
                       score=scored["score"], signals=signals)
