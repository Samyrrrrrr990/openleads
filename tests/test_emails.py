"""Network-free tests for the email engine: permutations, MX parsing, scoring."""
import pytest

from openleads.emails import mx
from openleads.emails.permute import (
    candidate_emails,
    domain_of,
    is_common_pattern,
    is_disposable,
    is_role_account,
    name_parts,
)
from openleads.emails.resolve import score_signals


# --- domain_of -------------------------------------------------------------
@pytest.mark.parametrize("website,expected", [
    ("https://www.acme.com", "acme.com"),
    ("http://Acme.com/path?x=1", "acme.com"),
    ("https://sub.example.io", "sub.example.io"),
    ("example.org", "example.org"),
    ("https://WWW.UPPER.COM/", "upper.com"),
    ("", None),
])
def test_domain_of(website, expected):
    assert domain_of(website) == expected


# --- name_parts ------------------------------------------------------------
@pytest.mark.parametrize("name,first,last", [
    ("Ada Lovelace", "ada", "lovelace"),
    ("Grace Brewster Hopper", "grace", "hopper"),
    ("Cher", "cher", ""),
    ("Jean-Luc Picard", "jeanluc", "picard"),
    ("", None, None),
])
def test_name_parts(name, first, last):
    assert name_parts(name) == (first, last)


# --- candidate_emails ------------------------------------------------------
def test_candidate_emails_orders_and_dedupes():
    cands = candidate_emails("Ada Lovelace", "x.com")
    assert cands[0] == "ada.lovelace@x.com"   # most prevalent pattern first
    assert "ada@x.com" in cands
    assert "alovelace@x.com" in cands
    assert len(cands) == len(set(cands))
    assert all(c.endswith("@x.com") for c in cands)


def test_candidate_emails_single_name():
    assert candidate_emails("Madonna", "label.com") == ["madonna@label.com"]


def test_candidate_emails_empty():
    assert candidate_emails("", "x.com") == []


# --- role / disposable / pattern -------------------------------------------
def test_is_role_account():
    assert is_role_account("info@acme.com")
    assert is_role_account("sales@acme.com")
    assert not is_role_account("ada@acme.com")


def test_is_disposable():
    assert is_disposable("mailinator.com")
    assert not is_disposable("acme.com")


def test_is_common_pattern():
    assert is_common_pattern("ada@acme.com", "Ada Lovelace")
    assert is_common_pattern("ada.lovelace@acme.com", "Ada Lovelace")
    assert not is_common_pattern("alovelace@acme.com", "Ada Lovelace")


# --- mx.parse_mx -----------------------------------------------------------
def test_parse_mx_sorts_and_strips():
    doh = {"Answer": [
        {"type": 15, "data": "20 alt2.mx.example.com."},
        {"type": 15, "data": "10 alt1.mx.example.com."},
        {"type": 1, "data": "1.2.3.4"},   # A record, ignored
    ]}
    assert mx.parse_mx(doh) == ["alt1.mx.example.com", "alt2.mx.example.com"]


def test_parse_mx_empty():
    assert mx.parse_mx({}) == []
    assert mx.parse_mx({"Answer": []}) == []


# --- score_signals ---------------------------------------------------------
def test_score_no_mx_is_none():
    assert score_signals({"mx_exists": False}) == {"confidence": "none", "score": 0}


def test_score_disposable_is_none():
    assert score_signals({"mx_exists": True, "disposable": True})["confidence"] == "none"


def test_score_verified_is_high():
    out = score_signals({
        "mx_exists": True, "mx_resolvers_ok": 2, "mx_agreement": True,
        "smtp_verified": True, "common_pattern": True,
    })
    assert out["confidence"] == "verified"
    assert out["score"] >= 95


def test_score_catch_all_is_moderate():
    out = score_signals({"mx_exists": True, "catch_all": True, "smtp_reachable": True})
    assert out["confidence"] == "catch_all_guess"
    assert 40 <= out["score"] <= 75


def test_score_unreachable_is_pattern_guess():
    out = score_signals({"mx_exists": True, "smtp_reachable": False})
    assert out["confidence"] == "pattern_guess"
    assert out["score"] < 70


def test_score_role_account_penalized():
    base = score_signals({"mx_exists": True, "smtp_verified": True})
    role = score_signals({"mx_exists": True, "smtp_verified": True, "role_account": True})
    assert role["score"] < base["score"]
