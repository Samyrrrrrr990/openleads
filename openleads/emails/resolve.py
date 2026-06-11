"""
Orchestrate the deliverability engine and emit an explainable, tiered verdict.

``find_email(name, domain)`` and ``verify_address(email)`` are the public entry
points. They gather independent, mostly-free signals — MX + SPF/DMARC health,
learned per-domain patterns, Gravatar existence, ground-truth harvested addresses,
and (when port 25 is open) live SMTP — then hand them to
:func:`openleads.emails.score.assess`, which decides ``safe`` / ``risky`` / ``bad``.

Design rules:
* Cheap, port-25-free signals run by default (MX, DNS health, learned patterns,
  Gravatar). The expensive/optional ones (site scrape, GitHub commit harvest,
  multi-candidate Gravatar) run only when ``deep=True``.
* Every observed *real* address (SMTP-verified, ground-truth, Gravatar-confirmed)
  teaches the domain's pattern, so accuracy compounds across runs.
* A missing/errored signal never adds confidence; guesses never reach ``safe``
  without corroboration.
"""
from __future__ import annotations

import re

from openleads.emails import gravatar, groundtruth, patterns, smtp_verify
from openleads.emails import mx as mxmod
from openleads.emails.permute import (
    candidate_emails,
    is_common_pattern,
    is_disposable,
    is_free_provider,
    is_role_account,
)
from openleads.emails.score import assess, score_signals  # noqa: F401 (re-export)
from openleads.models import EmailResult

__all__ = ["find_email", "verify_address", "score_signals", "assess"]


def _emit(email: str, signals: dict) -> EmailResult:
    v = assess(signals)
    return EmailResult(email=email, confidence=v["confidence"], score=v["score"],
                       tier=v["tier"], reasons=v["reasons"], signals=signals)


def _verify_key(full_name: str, domain: str) -> str:
    from openleads.emails.permute import name_parts
    first, last = name_parts(full_name)
    return f"{first or ''}|{last or ''}|{domain}"


def _mx_lookup(domain: str, cache):
    info = cache.get("mx", domain) if cache else None
    if info is None:
        info = mxmod.lookup(domain)
        if cache:
            cache.set("mx", domain, info)
    return info


def _ordered_candidates(full_name: str, domain: str, db) -> list[str]:
    """Learned-pattern candidates first, then prevalence-ordered guesses; deduped."""
    learned = patterns.learned_candidates(db, full_name, domain) if db else []
    out: list[str] = []
    for c in learned + candidate_emails(full_name, domain):
        if c not in out:
            out.append(c)
    return out


def _github_login(links: dict | None) -> str | None:
    gh = (links or {}).get("github") or ""
    m = re.search(r"github\.com/([^/?#]+)", gh)
    return m.group(1) if m else None


def find_email(full_name: str, domain: str, cache=None, db=None,
               links: dict | None = None, deep: bool = False) -> EmailResult:
    """Find + verify the most likely email for ``full_name`` at ``domain``.

    ``db`` enables persistent pattern learning; ``links`` may carry a GitHub URL for
    deep ground-truth; ``deep`` turns on the heavier harvesters. Returns an
    :class:`EmailResult` with ``email``, ``tier``, 0-100 ``score`` and ``reasons``.
    """
    domain = (domain or "").lower().strip()
    ordered = _ordered_candidates(full_name, domain, db)
    if not ordered:
        return _emit("", {"no_candidates": True, "mx_exists": True})

    mx_info = _mx_lookup(domain, cache)
    hosts = mx_info.get("hosts") or []
    signals = {
        "mx_exists": bool(hosts),
        "mx_resolvers_ok": mx_info.get("resolvers_ok", 0),
        "mx_agreement": mx_info.get("agreement", False),
        "disposable": is_disposable(domain),
        "free_provider": is_free_provider(domain),
    }
    if not hosts or signals["disposable"]:
        return _emit(ordered[0], signals)

    health = mxmod.dns_health(domain, cache=cache)
    signals.update(health)
    signals["mx_provider"] = mxmod.classify_provider(hosts)

    best = ordered[0]

    # --- ground truth (deep): real addresses beat any guess ----------------- #
    gt_exact = None
    if deep:
        site = groundtruth.harvest_from_site(domain, cache=cache)
        gh_login = _github_login(links)
        gh = groundtruth.harvest_from_github(gh_login, cache=cache) if gh_login else []
        # GitHub emails belong to *this* person; on-domain site emails matching a
        # candidate are name-consistent → also this person.
        person_on_domain = [e for e in gh if e.endswith("@" + domain)]
        site_match = [e for e in site if e in ordered]
        for e in person_on_domain + site_match:
            gt_exact = e
            break
        if gt_exact:
            patterns.learn_from_email(db, gt_exact, full_name)

    if gt_exact:
        best = gt_exact
        signals["groundtruth_exact"] = True
        signals["common_pattern"] = is_common_pattern(best, full_name)
        signals["role_account"] = is_role_account(best)
        return _emit(best, signals)

    # --- live SMTP (skipped if port 25 blocked; cached by name+domain) ------ #
    vkey = _verify_key(full_name, domain)
    probe = cache.get("verify", vkey) if cache else None
    if probe is None:
        probe = {"verified": None, "catch_all": False, "reachable": False}
        for host in hosts[:2]:
            probe = smtp_verify.probe(host, domain, ordered)
            if probe["reachable"]:
                break
        if cache:
            cache.set("verify", vkey, probe)

    verified = probe.get("verified")
    signals["smtp_verified"] = bool(verified)
    signals["catch_all"] = probe.get("catch_all", False)
    signals["smtp_reachable"] = probe.get("reachable", False)
    if verified:
        best = verified
        patterns.learn_from_email(db, verified, full_name)

    # --- Gravatar existence (free, no port 25) ------------------------------ #
    if not verified:
        check = ordered[:3] if deep else ordered[:1]
        for cand in check:
            if gravatar.has_gravatar(cand, cache=cache):
                best = cand
                signals["gravatar"] = True
                patterns.learn_from_email(db, cand, full_name)
                break
        else:
            signals["gravatar"] = bool(gravatar.has_gravatar(best, cache=cache))

    signals["common_pattern"] = is_common_pattern(best, full_name)
    signals["role_account"] = is_role_account(best)
    signals["learned_pattern_match"] = patterns.matches_learned(db, best, full_name)
    return _emit(best, signals)


def verify_address(email: str, cache=None, db=None, deep: bool = False) -> EmailResult:
    """Verify one concrete ``email`` (no name permutation). For ``openleads verify``."""
    email = (email or "").strip().lower()
    if "@" not in email:
        return EmailResult(email=email, confidence="none", score=0, tier="bad",
                           reasons=["not a valid email address"],
                           signals={"reason": "not_an_email"})
    local, _, domain = email.partition("@")

    mx_info = _mx_lookup(domain, cache)
    hosts = mx_info.get("hosts") or []
    signals = {
        "mx_exists": bool(hosts),
        "mx_resolvers_ok": mx_info.get("resolvers_ok", 0),
        "mx_agreement": mx_info.get("agreement", False),
        "disposable": is_disposable(domain),
        "free_provider": is_free_provider(domain),
        "role_account": is_role_account(email),
    }
    if not hosts or signals["disposable"]:
        return _emit(email, signals)

    signals.update(mxmod.dns_health(domain, cache=cache))
    signals["mx_provider"] = mxmod.classify_provider(hosts)

    probe = {"verified": None, "catch_all": False, "reachable": False}
    for host in hosts[:2]:
        probe = smtp_verify.probe(host, domain, [email])
        if probe["reachable"]:
            break
    signals["smtp_verified"] = bool(probe.get("verified"))
    signals["catch_all"] = probe.get("catch_all", False)
    signals["smtp_reachable"] = probe.get("reachable", False)
    signals["gravatar"] = bool(gravatar.has_gravatar(email, cache=cache))
    return _emit(email, signals)
