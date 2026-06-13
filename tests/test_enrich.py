"""Tests for list enrichment (BYO list → verified emails)."""
import openleads.enrich as enrich
from openleads.models import EmailResult


def test_normalize_row_aliases_and_idempotent():
    row = enrich.normalize_row({"First Name": "Ada", "Last Name": "Lovelace",
                                "Company": "Analytical Engines", "Domain": "ae.com"})
    assert row["first_name"] == "Ada" and row["last_name"] == "Lovelace"
    assert row["company"] == "Analytical Engines" and row["domain"] == "ae.com"
    # Re-normalizing an already-normalized row must not lose fields.
    assert enrich.normalize_row(row) == row


def test_normalize_splits_full_name():
    row = enrich.normalize_row({"name": "Grace Hopper", "email": "grace@navy.mil"})
    assert row["first_name"] == "Grace" and row["last_name"] == "Hopper"


def test_domain_for_precedence():
    assert enrich._domain_for({"domain": "https://acme.com/x"}) == "acme.com"
    assert enrich._domain_for({"email": "a@beta.io"}) == "beta.io"
    assert enrich._domain_for({"company": "gamma.dev"}) == "gamma.dev"
    assert enrich._domain_for({"company": "Just A Name"}) == ""


def test_row_to_entity():
    ent = enrich.row_to_entity({"first_name": "Ada", "last_name": "Lovelace",
                                "domain": "ae.com", "title": "Founder"})
    assert ent.full_name == "Ada Lovelace"
    assert ent.domain == "ae.com" and ent.title == "Founder"
    assert ent.source == "enrich"


def test_enrich_rows_verifies_known_email(monkeypatch):
    seen = {}

    def fake_verify(email, **kw):
        seen["verified"] = email
        return EmailResult(email=email, confidence="verified", score=95, tier="safe",
                           confidence_pct=95)
    monkeypatch.setattr(enrich, "verify_address", fake_verify)
    leads = enrich.enrich_rows([{"name": "Ada Lovelace", "email": "ada@ae.com"}])
    assert seen["verified"] == "ada@ae.com"
    assert leads[0].email == "ada@ae.com" and leads[0].tier == "safe"


def test_enrich_rows_finds_from_name_and_domain(monkeypatch):
    def fake_find(name, domain, **kw):
        return EmailResult(email=f"found@{domain}", confidence="pattern_guess",
                           score=60, tier="risky", confidence_pct=60)
    monkeypatch.setattr(enrich, "find_email", fake_find)
    leads = enrich.enrich_rows([{"first_name": "Ada", "last_name": "Lovelace",
                                 "domain": "ae.com"}])
    assert leads[0].email == "found@ae.com" and leads[0].tier == "risky"


def test_enrich_rows_no_domain_is_honest(monkeypatch):
    leads = enrich.enrich_rows([{"name": "Nobody Known"}])
    assert leads[0].email == "" and leads[0].tier == "bad"
