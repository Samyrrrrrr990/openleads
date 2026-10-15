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
        {"email": "jane@acme.example", "first_name": "Jane", "last_name": "Doe",
         "title": "VP of Sales", "organization": "Acme", "tier": "safe",
         "technologies": ["HubSpot"], "phone": "+15125550100"},
        {"email": "john@acme.example", "first_name": "John", "last_name": "Roe",
         "title": "Engineer", "organization": "Acme", "tier": "risky"},
        {"email": "ann@beta.example", "first_name": "Ann", "last_name": "Poe",
         "title": "Head of Growth", "organization": "Beta", "tier": "safe"},
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


def test_lists_create_add_show_delete(capsys):
    code, out, _ = run(capsys, "lists", "create", "Q4 targets")
    assert code == 0 and "created 'Q4 targets'" in out
    _, out, _ = run(capsys, "lists", "add", "q4 targets", "jane@acme.example")
    assert "added 1" in out
    _, out, _ = run(capsys, "lists", "add", "Q4 targets", "--where", "beta")
    assert "added 1" in out
    _, out, _ = run(capsys, "lists", "show", "Q4 targets", "--json")
    assert {r["email"] for r in json.loads(out)["rows"]} == {"jane@acme.example",
                                                             "ann@beta.example"}
    _, out, _ = run(capsys, "lists")
    assert "Q4 targets" in out and "2" in out
    run(capsys, "lists", "remove", "Q4 targets", "ann@beta.example")
    _, out, _ = run(capsys, "people", "--list", "Q4 targets", "--json")
    assert json.loads(out)["total"] == 1
    code, out, _ = run(capsys, "lists", "delete", "Q4 targets")
    assert code == 0 and "deleted" in out
    code, _, err = run(capsys, "lists", "show", "Q4 targets")
    assert code == 2 and "no people list" in err


def test_sequences_create_enroll_show_run(capsys, monkeypatch):
    sent = []

    def fake_send(drafts, dry_run=True, db=None, campaign="", step=1, **kw):
        from openleads.models import SendResult
        sent.extend((d.email, dry_run) for d in drafts)
        return [SendResult(d.email, "preview" if dry_run else "sent") for d in drafts]
    monkeypatch.setattr("openleads.outreach.sender.send_drafts", fake_send)
    code, out, _ = run(capsys, "seq", "create", "Q4 outbound", "--pitch", "We fix widgets")
    assert code == 0 and "5 steps" in out
    run(capsys, "lists", "create", "Hot")
    run(capsys, "lists", "add", "Hot", "jane@acme.example", "john@acme.example")
    _, out, _ = run(capsys, "seq", "enroll", "Q4 outbound", "--list", "Hot")
    assert "enrolled 1" in out and "john@acme.example: email is risky" in out
    _, out, _ = run(capsys, "seq", "show", "Q4 outbound")
    assert "1 active" in out and "day 0" in out and "call" in out
    code, _, err = run(capsys, "seq", "run", "Q4 outbound", "--live")
    assert code == 2 and "activate" in err
    _, out, _ = run(capsys, "seq", "run", "Q4 outbound", "--now")
    assert "would send 1" in out and "jane@acme.example" in out and sent == [("jane@acme.example", True)]
    run(capsys, "seq", "activate", "1")
    _, out, _ = run(capsys, "seq", "--json")
    assert json.loads(out)[0]["status"] == "active"
    _, out, _ = run(capsys, "sequences")
    assert "Q4 outbound" in out
    code, _, err = run(capsys, "seq", "show", "nope")
    assert code == 2 and "no sequence" in err


def test_tasks_add_list_done_snooze(capsys):
    code, out, _ = run(capsys, "tasks", "add", "Call", "Jane", "--contact", "jane@acme.example",
                       "--kind", "call", "--due", "today", "--priority", "high")
    assert code == 0 and "#1 Call Jane" in out
    run(capsys, "tasks", "add", "Prep deck")
    _, out, _ = run(capsys, "tasks")
    assert "Call Jane" in out and "Jane Doe" in out and "Prep deck" in out and "1 today" in out
    _, out, _ = run(capsys, "tasks", "snooze", "2", "--due", "+3d")
    assert "snoozed until" in out
    _, out, _ = run(capsys, "tasks", "done", "1")
    assert "#1 done" in out
    _, out, _ = run(capsys, "tasks", "--bucket", "done", "--json")
    assert [t["id"] for t in json.loads(out)["tasks"]] == [1]
    code, _, err = run(capsys, "tasks", "done", "99")
    assert code == 2 and "no task #99" in err
    code, _, err = run(capsys, "tasks", "add", "x", "--due", "someday")
    assert code == 2 and "due date" in err


def test_deals_board_add_move_won(capsys):
    code, out, _ = run(capsys, "deals", "add", "Acme", "—", "pilot", "--amount", "12k",
                       "--contact", "jane@acme.example")
    assert code == 0 and "$12,000 in qualify" in out
    _, out, _ = run(capsys, "deals", "move", "1", "proposal")
    assert "→ proposal" in out
    _, out, _ = run(capsys, "deals")
    assert "Proposal" in out and "Acme — pilot" in out and "weighted $6,000" in out
    run(capsys, "deals", "won", "1")
    _, out, _ = run(capsys, "people", "show", "jane@acme.example")
    assert "customer" in out
    _, out, _ = run(capsys, "deals", "--json")
    assert json.loads(out)["totals"]["won_value"] == 12000
    code, _, err = run(capsys, "deals", "move", "1")
    assert code == 2 and "which stage" in err


CSV = ("First Name,Last Name,Company Name for Emails,Email,Title,Website,Favorite Color\n"
       "Tara,Nguyen,Quill,tara@quill.example,Head of Ops,quill.example,teal\n"
       "Jane,Doe,Acme,jane@acme.example,Chief Revenue Officer,acme.example,red\n"
       "Lee,Park,Parkside,,Founder,parkside.example,green\n"
       "Bad,Row,Nope,not-an-email,,,\n")


def test_import_preview_map_and_run(capsys, tmp_path):
    f = tmp_path / "apollo.csv"
    f.write_text(CSV)
    code, out, _ = run(capsys, "import", str(f), "--preview")
    assert code == 0 and "4 rows · 2 with an email · 2 can be found" in out
    assert "Favorite Color" in out and "(not imported)" in out
    missing = tmp_path / "missing.csv"
    code, out, _ = run(capsys, "import", str(f), "--list", "Event", "--tags", "event",
                       "--map", "Title=", "--missing-out", str(missing))
    assert code == 0 and "1 new · 1 updated · 1 skipped" in out and "list 'Event'" in out
    assert missing.read_text().splitlines() == ["name,company,domain",
                                                "Lee Park,Parkside,parkside.example",
                                                "Bad Row,Nope,"]      # bad address: find one
    _, out, _ = run(capsys, "people", "show", "jane@acme.example", "--json")
    contact = json.loads(out)["contact"]
    assert contact["title"] == "VP of Sales"            # Title unmapped → kept
    assert "event" in contact["tags"]
    code, _, err = run(capsys, "import", str(f), "--map", "Nope=email")
    assert code == 2 and "no column 'Nope'" in err
    code, _, err = run(capsys, "import", str(f), "--map", "Title=shoe")
    assert code == 2 and "unknown field" in err


def test_dedupe_lists_and_merges(capsys):
    db = DB()
    db.upsert_lead({"email": "jdoe@acme.example", "first_name": "Jane", "last_name": "Doe",
                    "organization": "Acme", "tier": "risky", "phone": "+15125550199"})
    db.close()
    _, out, _ = run(capsys, "dedupe")
    assert "jane@acme.example" in out and "jdoe@acme.example" in out and "1 group" in out
    _, out, _ = run(capsys, "dedupe", "--merge")
    assert "merged 1 record" in out
    _, out, _ = run(capsys, "dedupe")
    assert "No duplicates" in out


def test_stats(capsys):
    code, out, _ = run(capsys, "stats")
    assert code == 0 and "contacts" in out and "3 (2 verified safe" in out and "pipeline" in out
    _, out, _ = run(capsys, "stats", "--json")
    assert json.loads(out)["home"]["contacts"]["total"] == 3


def test_demo_seeds_a_separate_workspace(capsys, tmp_path, home, monkeypatch):
    d = tmp_path / "demo-ws"
    code, out, _ = run(capsys, "demo", "--dir", str(d), "--no-serve")
    assert code == 0 and "seeded" in out and "invented" in out
    import os
    assert os.environ["OPENLEADS_HOME"] == str(d)
    db = DB()
    emails = [r["email"] for r in db.query("SELECT email FROM leads")]
    assert len(emails) > 30 and all(e.endswith(".example") for e in emails)
    assert db.scalar("SELECT COUNT(*) FROM sequences") == 2
    db.close()
    monkeypatch.setenv("OPENLEADS_HOME", str(home))     # each CLI run is a fresh process
    code, out, _ = run(capsys, "demo", "--dir", str(d), "--no-serve")
    assert "reusing" in out
    monkeypatch.setenv("OPENLEADS_HOME", str(home))
    code, out, _ = run(capsys, "demo", "--dir", str(d), "--no-serve", "--reset")
    assert code == 0 and "seeded" in out
    monkeypatch.setenv("OPENLEADS_HOME", str(home))
    code, _, err = run(capsys, "demo", "--dir", str(home), "--no-serve")
    assert code == 2 and "refusing" in err


def test_seq_clone(capsys):
    run(capsys, "seq", "create", "Base")
    code, out, _ = run(capsys, "seq", "clone", "Base", "Base v2")
    assert code == 0 and "'Base v2'" in out
    _, out, _ = run(capsys, "seq", "--json")
    assert {s["name"] for s in json.loads(out)} == {"Base", "Base v2"}
