"""v3.5 lead-engine upgrades: port-25 memoization, calibrated confidence, the
ground-truth flywheel (observed patterns → safe without port 25), and quality guards.

All network-free: SMTP is forced off via OPENLEADS_SMTP25 and harvesting is
monkeypatched, so these are fast and deterministic.
"""
import pytest

from openleads.emails import netcheck, resolve
from openleads.emails.score import assess


# --- port-25 single probe + env override ----------------------------------- #
def test_port25_env_override(monkeypatch):
    netcheck.reset()
    monkeypatch.setenv("OPENLEADS_SMTP25", "0")
    assert netcheck.port25_open() is False
    monkeypatch.setenv("OPENLEADS_SMTP25", "1")
    assert netcheck.port25_open() is True


def test_port25_probes_once(monkeypatch):
    netcheck.reset()
    monkeypatch.delenv("OPENLEADS_SMTP25", raising=False)
    calls = {"n": 0}

    def fake_probe(timeout=5.0):
        calls["n"] += 1
        return False

    monkeypatch.setattr(netcheck, "_probe", fake_probe)
    assert netcheck.port25_open() is False
    assert netcheck.port25_open() is False
    assert calls["n"] == 1   # cached after the first probe
    netcheck.reset()


# --- calibrated confidence (Hunter-style %) --------------------------------- #
def test_confidence_pct_present_and_bounded():
    out = assess({"mx_exists": True, "groundtruth_exact": True})
    assert 0 <= out["confidence_pct"] <= 100
    assert out["confidence_pct"] >= 90


def test_observed_pattern_is_safe_without_port25():
    """An address built from a pattern *observed* at the domain is evidence, not a
    guess — it reaches 'safe' even with port 25 blocked and no live SMTP."""
    out = assess({"mx_exists": True, "mx_resolvers_ok": 2, "mx_agreement": True,
                  "spf_present": True, "dmarc_present": True,
                  "observed_pattern": True, "learned_pattern_match": True,
                  "port25_blocked": True})
    assert out["tier"] == "safe"
    assert out["confidence_pct"] >= 80


def test_common_pattern_pro_host_surfaces_real_pct():
    """A common pattern on a Google/MS-hosted, authenticated domain is a probable
    hit — still 'risky', but surfaced with a meaningful percentage, not buried."""
    out = assess({"mx_exists": True, "mx_resolvers_ok": 2, "mx_agreement": True,
                  "spf_present": True, "dmarc_present": True, "common_pattern": True,
                  "mx_provider": "google", "port25_blocked": True})
    assert out["tier"] == "risky"
    assert out["confidence_pct"] >= 60


def test_bare_guess_stays_low():
    out = assess({"mx_exists": True, "common_pattern": True, "port25_blocked": True})
    assert out["tier"] == "risky"
    assert out["confidence_pct"] < 60


# --- the flywheel: a sibling's harvested address promotes the next person ---- #
def test_site_harvest_flywheel_promotes_sibling(monkeypatch, tmp_path):
    from openleads.db import DB
    db = DB(path=str(tmp_path / "fly.db"))

    # No live SMTP; healthy, authenticated corporate domain.
    monkeypatch.setattr(resolve, "_mx_lookup",
                        lambda d, c: {"hosts": ["mx.acme.io"], "resolvers_ok": 2,
                                      "agreement": True})
    monkeypatch.setattr(resolve.mxmod, "dns_health",
                        lambda d, cache=None: {"spf_present": True, "dmarc_present": True,
                                               "dmarc_policy": "reject"})
    monkeypatch.setattr(resolve.mxmod, "classify_provider", lambda h: "google")
    monkeypatch.setattr(resolve.netcheck, "port25_open", lambda: False)
    monkeypatch.setattr(resolve.gravatar, "has_gravatar", lambda e, cache=None: False)
    # The company site exposes one real, structured address.
    monkeypatch.setattr(resolve.groundtruth, "harvest_from_site",
                        lambda domain, cache=None: ["ada.lovelace@acme.io"])

    res = resolve.find_email("Grace Hopper", "acme.io", db=db)
    assert res.email == "grace.hopper@acme.io"   # built from the observed shape
    assert res.signals.get("observed_pattern")
    assert res.tier == "safe"
    db.close()


def test_site_harvest_ignores_role_mailbox(monkeypatch, tmp_path):
    """A role mailbox (info@) must NOT teach a bogus '{first}' pattern."""
    from openleads.db import DB
    db = DB(path=str(tmp_path / "role.db"))
    monkeypatch.setattr(resolve, "_mx_lookup",
                        lambda d, c: {"hosts": ["mx.acme.io"], "resolvers_ok": 2,
                                      "agreement": True})
    monkeypatch.setattr(resolve.mxmod, "dns_health",
                        lambda d, cache=None: {"spf_present": True, "dmarc_present": True,
                                               "dmarc_policy": "none"})
    monkeypatch.setattr(resolve.mxmod, "classify_provider", lambda h: "google")
    monkeypatch.setattr(resolve.netcheck, "port25_open", lambda: False)
    monkeypatch.setattr(resolve.gravatar, "has_gravatar", lambda e, cache=None: False)
    monkeypatch.setattr(resolve.groundtruth, "harvest_from_site",
                        lambda domain, cache=None: ["info@acme.io"])

    res = resolve.find_email("Grace Hopper", "acme.io", db=db)
    assert not res.signals.get("observed_pattern")   # role address taught nothing
    assert res.tier == "risky"
    db.close()


# --- campaign reach: sendable_leads threshold ------------------------------- #
def test_sendable_leads_threshold():
    from openleads.automate.pipeline import sendable_leads
    from openleads.models import Lead

    leads = [
        Lead(email="a@x.com", tier="safe", confidence_pct=90),
        Lead(email="b@x.com", tier="risky", confidence_pct=62),
        Lead(email="c@x.com", tier="risky", confidence_pct=35),
        Lead(email="d@x.com", tier="bad", confidence_pct=0),
        Lead(email="", tier="safe", confidence_pct=99),   # no address
    ]
    # Default: only safe.
    assert [l.email for l in sendable_leads(leads)] == ["a@x.com"]
    # Reach: safe + risky ≥55%.
    reach = sendable_leads(leads, include_risky=True, min_pct=55)
    assert [l.email for l in reach] == ["a@x.com", "b@x.com"]


# --- structured-personal guard --------------------------------------------- #
@pytest.mark.parametrize("email,ok", [
    ("ada.lovelace@acme.io", True),
    ("a_lovelace@acme.io", True),
    ("ada-lovelace@acme.io", True),
    ("info@acme.io", False),
    ("sales@acme.io", False),
    ("ada@acme.io", False),       # single token — ambiguous, skipped
    ("team42@acme.io", False),    # digits — not a clean name shape
])
def test_is_structured_personal(email, ok):
    assert resolve._is_structured_personal(email) is ok
