"""CRM-shaped CSV writers and the new find flags."""
import csv

from openleads import cli, writers
from openleads.models import Lead

LEAD = Lead(first_name="Jane", last_name="Doe", email="jane@acme.example", title="VP Sales",
            organization="Acme", website="https://acme.example", city="Austin",
            country="US", phone="+15125550100", seniority="vp", department="sales",
            company_size="11-50", technologies=["HubSpot"], source="yc",
            socials={"linkedin": "https://www.linkedin.com/company/acme"},
            signals={"groundtruth_exact": True})


def _read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_apollo_csv(tmp_path):
    out = tmp_path / "a.csv"
    writers.write([LEAD], fmt="apollo", path=str(out))
    row = _read(out)[0]
    assert list(row) == writers.APOLLO_FIELDS
    assert row["Email Status"] == "Verified"
    assert row["Seniority"] == "VP" and row["Departments"] == "Sales"
    assert row["Company Linkedin Url"].endswith("/company/acme")
    assert row["Technologies"] == "HubSpot" and row["# Employees"] == "11-50"


def test_apollo_status_is_honest_for_guesses(tmp_path):
    guess = Lead(first_name="Ann", email="ann@b.example", signals={})
    assert writers.apollo_row(guess)["Email Status"] == "Unverified"


def test_hubspot_csv(tmp_path):
    out = tmp_path / "h.csv"
    writers.write([LEAD], fmt="hubspot", path=str(out))
    row = _read(out)[0]
    assert list(row) == writers.HUBSPOT_FIELDS
    assert row["Job Title"] == "VP Sales" and row["Phone Number"] == "+15125550100"
    assert row["Lead Source"] == "OpenLeads (yc)"


def test_find_flags_build_query():
    args = cli.build_parser().parse_args(
        ["find", "agencies", "--seniority", "vp, director", "--department", "sales",
         "--no-company", "--format", "apollo"])
    q = cli._query_from_args(args)
    assert q.seniority == ["vp", "director"] and q.department == ["sales"]
    assert q.company_profile is False and q.fmt == "apollo"
