"""Exporting people from the workspace in every format."""
import csv
import io
import json

import pytest

from openleads.db import DB
from openleads.workspace import export


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "e.db")
    d.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "last_name": "Doe",
                   "title": "VP of Sales", "organization": "Acme", "tier": "safe",
                   "technologies": ["HubSpot"], "phone": "+15125550100",
                   "signals": {"groundtruth_exact": True}})
    yield d
    d.close()


def test_leads_carry_company_details(db):
    [ld] = export.leads_for(db, ["jane@acme.example"])
    assert ld.title == "VP of Sales" and ld.seniority == "vp" and ld.technologies == ["HubSpot"]
    assert export.leads_for(db, []) == []


@pytest.mark.parametrize("fmt,header", [("csv", "Email"), ("apollo", "Email Status"),
                                        ("hubspot", "Email")])
def test_csv_formats(db, fmt, header):
    text, ext = export.render(export.leads_for(db, ["jane@acme.example"]), fmt)
    rows = list(csv.DictReader(io.StringIO(text)))
    assert ext == "csv" and header in rows[0] and "jane@acme.example" in rows[0].values()


def test_json_and_bad_format(db):
    text, ext = export.render(export.leads_for(db, ["jane@acme.example"]), "json")
    assert ext == "json" and json.loads(text)[0]["email"] == "jane@acme.example"
    with pytest.raises(ValueError):
        export.render([], "xlsx")
