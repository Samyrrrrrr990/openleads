"""openleads company <domain>."""
import json

from openleads import cli

PROFILE = {"domain": "acme.example", "name": "Acme", "description": "Widgets.",
           "industry": "Software", "phones": ["+15125550100"], "phone": "+15125550100",
           "socials": {"linkedin": "https://www.linkedin.com/company/acme"},
           "technologies": ["HubSpot"], "tech": [{"name": "HubSpot",
                                                  "category": "Marketing automation"}],
           "founded": "2015", "employees": "30", "size": "11-50",
           "address": {"city": "Austin"}, "keywords": []}


def _stub(monkeypatch, profile=PROFILE):
    monkeypatch.setattr("openleads.insights.company.fetch_profile",
                        lambda domain, cache=None, refresh=False: profile)
    monkeypatch.setattr("openleads.discover.people.find_people",
                        lambda domain, cache=None, limit=10: [
                            {"name": "Jane Doe", "title": "VP of Sales"}])


def test_company_pretty(monkeypatch, capsys):
    _stub(monkeypatch)
    assert cli.main(["company", "https://acme.example/", "--no-cache"]) == 0
    out = capsys.readouterr().out
    assert "Acme" in out and "HubSpot" in out and "+1 512-555-0100" in out
    assert "Jane Doe" in out and "VP · Sales" in out


def test_company_json(monkeypatch, capsys):
    _stub(monkeypatch)
    assert cli.main(["company", "acme.example", "--json", "--no-cache"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["profile"]["name"] == "Acme" and data["people"][0]["name"] == "Jane Doe"


def test_company_unreachable(monkeypatch, capsys):
    _stub(monkeypatch, {"domain": "down.example", "error": "homepage unreachable"})
    assert cli.main(["company", "down.example", "--no-cache", "--no-people"]) == 1
