"""Workspace CLI: people, companies, lists, sequences, tasks, deals, import, stats."""
import json

import pytest

from openleads import cli
from openleads.db import DB


@pytest.fixture(autouse=True)
def home(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    db = DB()
    for r in [
        dict(email="jane@acme.example", first_name="Jane", last_name="Doe", title="VP of Sales",
             organization="Acme", tier="safe", technologies=["HubSpot"], phone="+15125550100"),
        dict(email="john@acme.example", first_name="John", last_name="Roe", title="Engineer",
             organization="Acme", tier="risky"),
        dict(email="ann@beta.example", first_name="Ann", last_name="Poe", title="Head of Growth",
             organization="Beta", tier="safe"),
    ]:
        db.upsert_lead(r)
    from openleads.workspace import scoring
    scoring.rescore(db)
    db.close()
    yield tmp_path


def run(capsys, *argv):
    code = cli.main(list(argv))
    out = capsys.readouterr()
    return code, out.out, out.err


def test_people_list_search_and_filters(capsys):
    code, out, _ = run(capsys, "people")
    assert code == 0 and "jane@acme.example" in out and "3 contact(s)" in out
    _, out, _ = run(capsys, "people", "acme", "--tier", "safe")
    assert "jane@acme.example" in out and "john@" not in out and "ann@" not in out
    _, out, _ = run(capsys, "people", "--fit", "B", "--json")
    rows = json.loads(out)["rows"]
    assert {r["email"] for r in rows} <= {"jane@acme.example", "ann@beta.example"}
    code, _, err = run(capsys, "people", "--fit", "Z")
    assert code == 2 and "--fit" in err


def test_people_show_stage_tag_note(capsys):
    code, out, _ = run(capsys, "people", "stage", "jane@acme.example", "--to", "interested")
    assert code == 0 and "1 moved" in out
    run(capsys, "people", "tag", "jane@acme.example", "ann@beta.example", "--add", "vip,q4")
    run(capsys, "people", "note", "jane@acme.example", "Loved", "the", "demo")
    code, out, _ = run(capsys, "people", "show", "jane@acme.example")
    assert code == 0 and "interested" in out and "vip" in out and "Loved the demo" in out
    _, out, _ = run(capsys, "people", "--tag", "vip", "--json")
    assert json.loads(out)["total"] == 2
    code, _, err = run(capsys, "people", "show", "nobody@x.example")
    assert code == 2 and "not in your CRM" in err
    code, _, err = run(capsys, "people", "stage", "jane@acme.example", "--to", "sleepy")
    assert code == 2 and "unknown stage" in err


def test_companies_list_and_show(capsys):
    code, out, _ = run(capsys, "companies")
    assert code == 0 and "acme.example" in out and "beta.example" in out
    _, out, _ = run(capsys, "companies", "--tech", "HubSpot", "--json")
    assert [r["domain"] for r in json.loads(out)["rows"]] == ["acme.example"]
    _, out, _ = run(capsys, "companies", "beta")
    assert "beta.example" in out and "acme.example" not in out
    code, out, _ = run(capsys, "companies", "show", "acme.example")
    assert code == 0 and "HubSpot" in out and "jane@acme.example" in out
