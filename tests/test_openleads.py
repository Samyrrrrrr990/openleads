"""
Unit tests for the OpenLeads engine's pure (network-free) helpers.

These never touch the network: they exercise the parsing, permutation, and
formatting logic so CI stays fast and deterministic.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import lead_engine as le  # noqa: E402


# --- domain_of -------------------------------------------------------------
@pytest.mark.parametrize("website,expected", [
    ("https://www.acme.com", "acme.com"),
    ("http://Acme.com/path?x=1", "acme.com"),
    ("https://sub.example.io", "sub.example.io"),
    ("example.org", "example.org"),
    ("https://WWW.UPPER.COM/", "upper.com"),
])
def test_domain_of(website, expected):
    assert le.domain_of(website) == expected


# --- name_parts ------------------------------------------------------------
@pytest.mark.parametrize("name,first,last", [
    ("Ada Lovelace", "ada", "lovelace"),
    ("Grace Brewster Hopper", "grace", "hopper"),
    ("Cher", "cher", ""),
    ("Jean-Luc Picard", "jeanluc", "picard"),
])
def test_name_parts(name, first, last):
    assert le.name_parts(name) == (first, last)


def test_name_parts_empty():
    assert le.name_parts("") == (None, None)


# --- candidate_emails ------------------------------------------------------
def test_candidate_emails_orders_and_dedupes():
    cands = le.candidate_emails("Ada Lovelace", "x.com")
    assert cands[0] == "ada.lovelace@x.com"
    assert "ada@x.com" in cands
    assert "alovelace@x.com" in cands
    assert len(cands) == len(set(cands))  # no duplicates
    assert all(c.endswith("@x.com") for c in cands)


def test_candidate_emails_single_name():
    cands = le.candidate_emails("Madonna", "label.com")
    assert cands == ["madonna@label.com"]


def test_candidate_emails_empty_name():
    assert le.candidate_emails("", "x.com") == []


# --- split_location --------------------------------------------------------
@pytest.mark.parametrize("loc,city,country", [
    ("San Francisco, CA, USA", "San Francisco", "USA"),
    ("London, UK", "London", "UK"),
    ("Berlin", "Berlin", ""),
    ("", "", ""),
])
def test_split_location(loc, city, country):
    assert le.split_location(loc) == (city, country)


# --- pick_exec -------------------------------------------------------------
def test_pick_exec_prefers_senior_title():
    founders = [
        {"full_name": "A B", "title": "Engineer"},
        {"full_name": "C D", "title": "Founder/CEO"},
    ]
    assert le.pick_exec(founders)["full_name"] == "C D"


def test_pick_exec_falls_back_to_first():
    founders = [{"full_name": "A B", "title": "Designer"}]
    assert le.pick_exec(founders)["full_name"] == "A B"


def test_pick_exec_empty():
    assert le.pick_exec([]) is None
