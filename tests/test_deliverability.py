"""Network-free tests for the v3 deliverability engine: patterns, scoring, harvest."""
import pytest

from openleads.db import DB
from openleads.emails import groundtruth, patterns
from openleads.emails.mx import classify_provider, parse_txt
from openleads.emails.permute import (
    fill,
    is_free_provider,
)
from openleads.emails.score import assess


# --- pattern derivation / learning -----------------------------------------
@pytest.mark.parametrize("local,name,expected", [
    ("ada.lovelace", "Ada Lovelace", "{first}.{last}"),
    ("ada", "Ada Lovelace", "{first}"),
    ("alovelace", "Ada Lovelace", "{f}{last}"),
    ("adalovelace", "Ada Lovelace", "{first}{last}"),
    ("lovelace", "Ada Lovelace", "{last}"),
    ("zzz", "Ada Lovelace", None),
])
def test_derive_pattern(local, name, expected):
    assert patterns.derive_pattern(local, name) == expected


def test_fill_needs_last_name():
    assert fill("{first}.{last}", "ada", "") is None
    assert fill("{first}", "ada", "") == "ada"


def test_learn_and_apply_pattern(tmp_path):
    db = DB(path=str(tmp_path / "t.db"))
    # Learn from a real address belonging to Ada.
    learned = patterns.learn_from_email(db, "ada.lovelace@acme.io", "Ada Lovelace")
    assert learned == "{first}.{last}"
    # A different person at the same domain inherits the pattern.
    cands = patterns.learned_candidates(db, "Grace Hopper", "acme.io")
    assert cands == ["grace.hopper@acme.io"]
    assert patterns.matches_learned(db, "grace.hopper@acme.io", "Grace Hopper")
    assert not patterns.matches_learned(db, "ghopper@acme.io", "Grace Hopper")
    db.close()


def test_learn_skips_free_providers(tmp_path):
    db = DB(path=str(tmp_path / "t.db"))
    assert patterns.learn_from_email(db, "ada.lovelace@gmail.com", "Ada Lovelace") is None
    assert patterns.learned_candidates(db, "Grace Hopper", "gmail.com") == []
    db.close()


def test_is_free_provider():
    assert is_free_provider("gmail.com")
    assert is_free_provider("outlook.com")
    assert not is_free_provider("acme.io")


# --- ground-truth extraction -----------------------------------------------
def test_extract_emails_filters_and_dedupes():
    html = ('contact <a href="mailto:Ada@Acme.io">Ada</a> or sales@acme.io '
            'or noreply@acme.io or ghost@other.com')
    out = groundtruth.extract_emails(html, domain="acme.io")
    assert "ada@acme.io" in out
    assert "sales@acme.io" in out
    assert "noreply@acme.io" not in out      # role-ish noreply discarded
    assert "ghost@other.com" not in out      # off-domain filtered
    assert len(out) == len(set(out))


def test_is_noreply():
    assert groundtruth.is_noreply("12345+ada@users.noreply.github.com")
    assert groundtruth.is_noreply("noreply@acme.io")
    assert not groundtruth.is_noreply("ada@acme.io")


# --- mx helpers ------------------------------------------------------------
def test_parse_txt_unwraps_quotes():
    doh = {"Answer": [
        {"type": 16, "data": '"v=spf1 include:_spf.google.com ~all"'},
        {"type": 1, "data": "1.2.3.4"},
    ]}
    out = parse_txt(doh)
    assert out == ["v=spf1 include:_spf.google.com ~all"]


def test_classify_provider():
    assert classify_provider(["aspmx.l.google.com"]) == "google"
    assert classify_provider(["acme-io.mail.protection.outlook.com"]) == "microsoft"
    assert classify_provider(["mx.acme.io"]) == "other"
    assert classify_provider([]) == "none"


# --- the consensus scorer (assess) -----------------------------------------
def test_assess_no_mx_is_bad():
    out = assess({"mx_exists": False})
    assert out["tier"] == "bad" and out["score"] == 0


def test_assess_disposable_is_bad():
    assert assess({"mx_exists": True, "disposable": True})["tier"] == "bad"


def test_assess_groundtruth_is_safe():
    out = assess({"mx_exists": True, "groundtruth_exact": True})
    assert out["tier"] == "safe" and out["confidence"] == "verified"
    assert out["score"] >= 95


def test_assess_smtp_verified_is_safe():
    out = assess({"mx_exists": True, "smtp_verified": True, "mx_agreement": True})
    assert out["tier"] == "safe" and out["score"] >= 90


def test_assess_catch_all_is_risky():
    out = assess({"mx_exists": True, "catch_all": True, "smtp_reachable": True})
    assert out["tier"] == "risky" and out["confidence"] == "catch_all_guess"


def test_assess_port25_blocked_is_risky():
    out = assess({"mx_exists": True, "smtp_reachable": False, "common_pattern": True})
    assert out["tier"] == "risky" and out["confidence"] == "pattern_guess"


def test_assess_learned_plus_gravatar_is_safe():
    out = assess({"mx_exists": True, "mx_resolvers_ok": 2, "spf_present": True,
                  "learned_pattern_match": True, "gravatar": True})
    assert out["tier"] == "safe"


def test_assess_free_provider_guess_is_bad():
    out = assess({"mx_exists": True, "free_provider": True, "common_pattern": True})
    assert out["tier"] == "bad"


def test_assess_free_provider_with_gravatar_is_safe():
    out = assess({"mx_exists": True, "free_provider": True, "gravatar": True})
    assert out["tier"] == "safe"


def test_find_email_uses_known_email_as_groundtruth(monkeypatch):
    """A source-provided real email on the domain → instant 'safe' (no network)."""
    from openleads.emails import resolve
    monkeypatch.setattr(resolve, "_mx_lookup",
                        lambda d, c: {"hosts": ["mx.acme.io"], "resolvers_ok": 2,
                                      "agreement": True})
    monkeypatch.setattr(resolve.mxmod, "dns_health",
                        lambda d, cache=None: {"spf_present": True, "dmarc_present": True,
                                               "dmarc_policy": "reject"})
    monkeypatch.setattr(resolve.mxmod, "classify_provider", lambda h: "other")
    res = resolve.find_email("Ada Lovelace", "acme.io", known_email="ada@acme.io")
    assert res.tier == "safe"
    assert res.email == "ada@acme.io"
    assert res.signals.get("groundtruth_exact")


def test_assess_role_account_demoted():
    base = assess({"mx_exists": True, "smtp_verified": True})
    role = assess({"mx_exists": True, "smtp_verified": True, "role_account": True})
    assert role["score"] < base["score"]
    assert role["tier"] == "risky"   # a role mailbox is never 'safe' for a person
