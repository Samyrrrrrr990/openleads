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

from openleads.emails import gravatar, groundtruth, netcheck, patterns, smtp_verify
from openleads.emails import mx as mxmod
from openleads.emails.permute import (
    ROLE_LOCALS,
    candidate_emails,
    is_common_pattern,
    is_disposable,
    is_free_provider,
    is_role_account,
    local_tokens,
)
from openleads.emails.score import assess, score_signals  # noqa: F401 (re-export)
from openleads.models import EmailResult

__all__ = ["find_email", "verify_address", "score_signals", "assess"]


def _emit(email: str, signals: dict) -> EmailResult:
    v = assess(signals)
    return EmailResult(email=email, confidence=v["confidence"], score=v["score"],
                       tier=v["tier"], reasons=v["reasons"], signals=signals,
                       confidence_pct=v.get("confidence_pct", v["score"]))


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
               links: dict | None = None, deep: bool = False,
               known_email: str | None = None) -> EmailResult:
    """Find + verify the most likely email for ``full_name`` at ``domain``.

    ``db`` enables persistent pattern learning; ``links`` may carry a GitHub URL for
    deep ground-truth; ``deep`` turns on the heavier harvesters. ``known_email`` is a
    real address a source already exposed (e.g. a GitHub public email) — when it's on
    ``domain`` it's treated as ground truth, making the lead ``safe`` for free.
    Returns an :class:`EmailResult` with ``email``, ``tier``, ``score`` and ``reasons``.
    """
    domain = (domain or "").lower().strip()
    known = (known_email or "").lower().strip()
    ordered = _ordered_candidates(full_name, domain, db)

    # --- ground truth, name-free fast path ---------------------------------- #
    # A source handed us a real on-domain address (an HN apply email, a GitHub
    # public email). It needs no name permutation — only a deliverable domain —
    # so it works even for company-only leads with no person name.
    if known and "@" in known and known.endswith("@" + domain):
        gmx = _mx_lookup(domain, cache)
        ghosts = gmx.get("hosts") or []
        if ghosts and not is_disposable(domain):
            gsig = {
                "mx_exists": True,
                "mx_resolvers_ok": gmx.get("resolvers_ok", 0),
                "mx_agreement": gmx.get("agreement", False),
                "disposable": False,
                "free_provider": is_free_provider(domain),
                "groundtruth_exact": True,
                "role_account": is_role_account(known),
                "common_pattern": is_common_pattern(known, full_name) if full_name else False,
                "mx_provider": mxmod.classify_provider(ghosts),
            }
            gsig.update(mxmod.dns_health(domain, cache=cache))
            patterns.learn_from_email(db, known, full_name)
            return _emit(known, gsig)

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

    # --- source-provided real email = instant ground truth ------------------ #
    gt_exact = None
    known = (known_email or "").lower().strip()
    if known and "@" in known and known.endswith("@" + domain):
        gt_exact = known
        patterns.learn_from_email(db, gt_exact, full_name)

    # --- ground-truth harvest (default-on): real addresses beat any guess --- #
    # Site scraping is cheap, cached, and the single biggest accuracy lever (the
    # free analogue of Hunter's domain search), so it runs for every corporate
    # domain — not just under --deep. The heavier GitHub commit-email harvest
    # stays gated behind ``deep`` because it spends API rate-limit budget.
    if not gt_exact:
        site = groundtruth.harvest_from_site(domain, cache=cache)
        gh = []
        if deep:
            gh_login = _github_login(links)
            gh = groundtruth.harvest_from_github(gh_login, cache=cache) if gh_login else []
        # GitHub emails belong to *this* person; on-domain site emails matching a
        # candidate are name-consistent → also this person.
        person_on_domain = [e for e in gh if e.endswith("@" + domain)]
        site_match = [e for e in site if e in ordered]
        for e in person_on_domain + site_match:
            gt_exact = e
            break
        # Even a non-matching on-domain address teaches the domain's pattern, so
        # every *other* person at this domain is built from an observed shape. We
        # only learn from *structured* personal locals (first.last / f.last / …) —
        # a separator-free local could be a role mailbox (info@) and would teach a
        # bogus "{first}" shape, so those are skipped.
        for e in site:
            if e.endswith("@" + domain) and _is_structured_personal(e):
                patterns.learn_from_email(db, e, _name_for_address(e))
        if gt_exact:
            patterns.learn_from_email(db, gt_exact, full_name)

    if gt_exact:
        best = gt_exact
        signals["groundtruth_exact"] = True
        signals["common_pattern"] = is_common_pattern(best, full_name)
        signals["role_account"] = is_role_account(best)
        return _emit(best, signals)

    # Re-derive candidates now that a sibling's address may have taught a pattern,
    # so ``best`` reflects the freshly-observed shape for this person.
    ordered = _ordered_candidates(full_name, domain, db) or ordered
    best = ordered[0]

    # --- live SMTP (only when port 25 is actually open here) ----------------- #
    port25 = netcheck.port25_open()
    if not port25:
        signals["port25_blocked"] = True
    else:
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
    if not signals.get("smtp_verified"):
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
    learned = patterns.matches_learned(db, best, full_name)
    signals["learned_pattern_match"] = learned
    # A DB-learned pattern only ever comes from a *real observed* address (ground
    # truth, site scrape, SMTP-verified, Gravatar-confirmed), so a candidate built
    # from it is evidence-backed, not a blind guess — the scorer can trust it.
    signals["observed_pattern"] = learned
    return _emit(best, signals)


def _is_structured_personal(email: str) -> bool:
    """True if a local-part looks like a real first/last name (separator, alpha parts).

    ``ada.lovelace`` / ``a_lovelace`` → yes; ``info`` / ``sales`` / ``team42`` → no.
    Also rejects locals whose tokens are role/generic words (``press.team``,
    ``sales.eu``) so a shared alias never teaches a bogus per-person pattern.
    """
    if is_role_account(email):
        return False
    local = email.split("@", 1)[0]
    parts = [p for p in re.split(r"[._-]+", local) if p]
    if len(parts) < 2 or not all(p.isalpha() for p in parts):
        return False
    return not any(p.lower() in ROLE_LOCALS for p in parts)


def _name_for_address(email: str) -> str:
    """Reconstruct "first last" from a structured local-part, for pattern learning.

    ``first.last@`` / ``first_last@`` → "first last" so ``derive_pattern`` can
    recognise the shape. Only called for locals that passed ``_is_structured_personal``.
    """
    return " ".join(local_tokens(email.split("@", 1)[0])[:2])


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

    if netcheck.port25_open():
        probe = {"verified": None, "catch_all": False, "reachable": False}
        for host in hosts[:2]:
            probe = smtp_verify.probe(host, domain, [email])
            if probe["reachable"]:
                break
        signals["smtp_verified"] = bool(probe.get("verified"))
        signals["catch_all"] = probe.get("catch_all", False)
        signals["smtp_reachable"] = probe.get("reachable", False)
    else:
        signals["port25_blocked"] = True
    signals["gravatar"] = bool(gravatar.has_gravatar(email, cache=cache))
    return _emit(email, signals)
