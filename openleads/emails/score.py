"""
Consensus scoring — turn a bag of independent signals into one honest decision.

The job of the whole engine is to answer a single question: **is it safe to send
to this address?** v2 answered with a 0–100 ``score`` and a ``confidence`` label.
v3 keeps both (``score_signals`` is unchanged for back-compat) and adds
:func:`assess`, which folds in the new free signals (Gravatar, ground truth,
learned patterns, SPF/DMARC) and emits a **tier**:

* ``safe``  — multiple independent signals agree it's real → send by default.
* ``risky`` — plausible but unconfirmed (catch-all, port-25-blocked guess) → keep,
              don't send unless the user opts in.
* ``bad``   — no MX / disposable / can't form an address → drop.

The bias is deliberate: a missing or errored signal never *adds* confidence, and a
pattern guess never reaches ``safe`` without corroboration. Honest gating is what
makes real-world deliverability beat tools that label every guess "valid".

Pure and deterministic — unit-tested directly with signal dicts.
"""
from __future__ import annotations


# --- v2 back-compat scorer (unchanged contract) -------------------------------- #
def score_signals(s: dict) -> dict:
    """Map signals to ``{"confidence", "score"}`` (0-100). Kept stable for v2 callers."""
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
        confidence = "pattern_guess"
        score = 30 + mx_bonus + pattern_bonus
    else:
        confidence = "pattern_guess"
        score = 35 + mx_bonus + pattern_bonus

    score = max(0, min(100, score - role_penalty))
    return {"confidence": confidence, "score": score}


# --- v3 consensus assessment --------------------------------------------------- #
def assess(s: dict) -> dict:
    """Fold all signals into ``{score, tier, confidence, reasons, confidence_pct}``.

    ``tier`` drives the send decision; ``confidence`` keeps v2's vocabulary;
    ``reasons`` is a short human explanation; ``confidence_pct`` is a calibrated
    0–100 deliverability likelihood (Hunter/Apollo-style) so high-probability
    guesses surface with a number instead of being buried.

    The honesty rule is intact: a blind guess never reaches ``safe``. What *does*
    reach ``safe`` without a live SMTP check is **observed evidence** — a real
    ground-truth address, or a learned pattern that we saw produce a real sibling
    address at the same domain (``observed_pattern``). An observed pattern is data,
    not a guess: if ``ada.lovelace@acme.com`` was seen real, ``alan.turing@acme.com``
    on the same shape is a sound, sendable bet — which is exactly how Hunter works.
    """
    reasons: list[str] = []

    # Hard fails first.
    if not s.get("mx_exists"):
        return _verdict(0, "bad", "none", ["no mail server (no MX record)"])
    if s.get("disposable"):
        return _verdict(0, "bad", "none", ["disposable / throwaway domain"])
    if s.get("no_candidates"):
        return _verdict(0, "bad", "none", ["couldn't form an address from the name"])

    free = s.get("free_provider")
    role = s.get("role_account")

    # Infrastructure health (corroborating, not decisive).
    health = 0
    if s.get("mx_resolvers_ok", 0) >= 2:
        health += 1
    if s.get("mx_agreement"):
        health += 1
    if s.get("spf_present"):
        health += 1
        reasons.append("SPF configured")
    if s.get("dmarc_present"):
        health += 1
        reasons.append("DMARC configured")
    healthy = health >= 2
    pro_host = s.get("mx_provider") in ("google", "microsoft", "zoho", "proton")

    # --- decisive positives → safe ------------------------------------------ #
    if s.get("groundtruth_exact"):
        reasons.insert(0, "found publicly (ground-truth address)")
        # A published apply/contact address (e.g. jobs@company.com from an HN
        # 'who is hiring' post) is a real, intended-for-contact mailbox — a role
        # local-part does NOT demote ground truth below 'safe'.
        if role:
            reasons.append("published team/role address")
        return _verdict(98, "safe", "verified", reasons, pct=98)

    if s.get("smtp_verified") and not s.get("catch_all"):
        reasons.insert(0, "SMTP-verified mailbox")
        score = 90 + (4 if s.get("mx_agreement") else 0) + (3 if s.get("common_pattern") else 0)
        return _verdict(score, "safe", "verified", reasons, role, pct=min(99, score + 5))

    gravatar = s.get("gravatar")
    learned = s.get("learned_pattern_match")
    observed = s.get("observed_pattern")  # a learned pattern that came from a *seen* address
    common = s.get("common_pattern")

    if gravatar:
        reasons.insert(0, "Gravatar profile exists for this address")
    if observed:
        reasons.insert(0, "built from a pattern observed at this domain")
    elif learned:
        reasons.insert(0, "matches this domain's learned email pattern")

    # Free/personal providers: a guessed local-part is meaningless. Only a direct
    # existence signal (Gravatar) can make it safe; otherwise it's a no-go.
    if free:
        if gravatar:
            return _verdict(82, "safe", "verified", reasons + ["personal mailbox, confirmed"],
                            role, pct=82)
        return _verdict(15, "bad", "none",
                        ["personal mailbox — can't guess the handle"], role, pct=10)

    # Corporate domain guesses, ordered by how much corroboration we have.
    # An observed pattern is real evidence → safe even with port 25 blocked.
    if observed and not s.get("catch_all"):
        score = 88 if healthy else 82
        return _verdict(score, "safe", "verified", reasons, role, pct=score)

    if learned and (gravatar or s.get("smtp_reachable")) and not s.get("catch_all"):
        return _verdict(86 if healthy else 80, "safe", "verified", reasons, role, pct=84)

    if gravatar and (common or learned) and healthy and not s.get("catch_all"):
        return _verdict(80, "safe", "verified", reasons, role, pct=80)

    if learned and not s.get("catch_all"):
        reasons.append("learned pattern, not yet independently confirmed")
        return _verdict(66, "risky", "pattern_guess", reasons, role, pct=66)

    # --- uncertain → risky -------------------------------------------------- #
    if s.get("catch_all"):
        reasons.append("catch-all domain — accepts anything, can't confirm a person")
        score = 48 + (4 if common else 0) + (4 if gravatar else 0)
        # Cap the calibrated likelihood below the campaign reach threshold (55): a
        # catch-all accepts all mail, so we can't confirm the *person* exists and it
        # must not auto-qualify for sending without the user opting in.
        return _verdict(score, "risky", "catch_all_guess", reasons, role, pct=min(score, 50))

    if s.get("smtp_reachable"):
        reasons.append("server reachable but didn't confirm this address")
        return _verdict(38 + (5 if common else 0), "risky", "pattern_guess", reasons, role,
                        pct=45 + (8 if common else 0))

    # Port 25 blocked / server unreachable → MX-only guess (the common default).
    # A common pattern on a professionally-hosted, authenticated domain is a
    # genuinely probable hit — surface it with a real percentage, still 'risky'.
    if s.get("port25_blocked"):
        reasons.append("verification port (25) blocked here — scored on pattern + infra")
    else:
        reasons.append("mail server didn't answer — pattern guess only")
    base = 34 + (6 if common else 0) + (6 if gravatar else 0) + (4 if healthy else 0)
    pct = 35
    if common and pro_host and healthy:
        pct = 62
        reasons.insert(0, "common pattern on a professionally-hosted, authenticated domain")
    elif common and healthy:
        pct = 52
    return _verdict(base, "risky", "pattern_guess", reasons, role, pct=pct)


def _verdict(score: int, tier: str, confidence: str, reasons: list, role: bool = False,
             pct: int | None = None) -> dict:
    if role:
        score = max(0, score - 25)
        reasons = reasons + ["role/shared mailbox (not a person)"]
        if tier == "safe":
            tier = "risky"
        if pct is not None:
            pct = max(0, pct - 20)
    score = max(0, min(100, score))
    return {
        "score": score,
        "tier": tier,
        "confidence": confidence,
        "reasons": reasons,
        "confidence_pct": max(0, min(100, pct if pct is not None else score)),
    }
