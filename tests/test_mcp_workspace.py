"""MCP workspace tools against a seeded local workspace."""
import json

import pytest

from openleads import mcp
from openleads.db import DB


@pytest.fixture(autouse=True)
def workspace(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    db = DB()
    db.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "last_name": "Doe",
                    "title": "VP of Sales", "organization": "Acme", "tier": "safe",
                    "technologies": ["HubSpot"]})
    db.upsert_lead({"email": "bob@beta.example", "first_name": "Bob", "last_name": "Roe",
                    "title": "Engineer", "organization": "Beta", "tier": "risky"})
    from openleads.workspace import deals, notes, scoring, tasks
    scoring.rescore(db)
    notes.add(db, "contact", "jane@acme.example", "Prefers mornings")
    tasks.create(db, "Call Jane", kind="call", contact="jane@acme.example", due="today")
    deals.create(db, "Acme pilot", contact="jane@acme.example", amount="9k", stage="proposal")
    db.close()


def call(_tool, **args):
    r = mcp.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                    "params": {"name": _tool, "arguments": args}})["result"]
    assert r["isError"] is False, r["content"][0]["text"]
    return r["structuredContent"]


def test_workspace_tools_are_listed_with_annotations():
    tools = mcp.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})["result"]["tools"]
    by = {t["name"]: t for t in tools}
    assert {"search_contacts", "get_contact", "search_companies", "get_company", "list_tasks",
            "pipeline", "list_sequences", "workspace_stats", "find_leads"} <= set(by)
    assert by["search_contacts"]["annotations"]["readOnlyHint"] is True
    assert by["find_leads"]["annotations"]["openWorldHint"] is True
    json.dumps(tools)                                    # serializable


def test_search_and_get_contact():
    res = call("search_contacts", query="acme")
    assert res["total"] == 1 and res["contacts"][0]["email"] == "jane@acme.example"
    assert call("search_contacts", tier="risky")["contacts"][0]["email"] == "bob@beta.example"
    top = call("search_contacts", fit_min=40)["contacts"]
    assert [c["email"] for c in top] == ["jane@acme.example"]       # VP + safe = 50
    d = call("get_contact", email="jane@acme.example")
    assert d["contact"]["title"] == "VP of Sales" and d["notes"][0]["text"] == "Prefers mornings"
    assert d["open_tasks"][0]["title"] == "Call Jane" and d["deals"][0]["stage"] == "proposal"
    r = mcp.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": {"name": "get_contact", "arguments": {"email": "x@y.example"}}})
    assert r["result"]["isError"] is True


def test_companies_tasks_pipeline_sequences_stats():
    assert call("search_companies", technology="HubSpot")["companies"][0]["domain"] == "acme.example"
    co = call("get_company", domain="acme.example")
    assert co["people"][0]["email"] == "jane@acme.example" and co["deals"][0]["name"] == "Acme pilot"
    t = call("list_tasks", bucket="today")
    assert t["counts"]["today"] == 1 and t["tasks"][0]["contact_name"] == "Jane Doe"
    p = call("pipeline")
    assert p["totals"]["open_value"] == 9000
    assert [s["stage"] for s in p["stages"]][:2] == ["qualify", "meeting"]
    assert call("list_sequences") == {"sequences": []}
    st = call("workspace_stats")
    assert st["contacts"]["total"] == 2 and st["pipeline"]["open_count"] == 1


def test_write_tools_change_the_workspace():
    r = call("save_contacts", list="From Claude", tags=["ai"], contacts=[
        {"email": "Ann@Gamma.example", "name": "Ann Lee", "title": "Head of Growth",
         "organization": "Gamma", "tier": "safe"},
        {"email": "jane@acme.example", "phone": "+1 512 555 0100"},
        {"email": "nope"}])
    assert r["created"] == 1 and r["updated"] == 1 and r["skipped"][0]["email"] == "nope"
    assert r["list"] == "From Claude"
    ann = call("get_contact", email="ann@gamma.example")["contact"]
    assert ann["name"] == "Ann Lee" and "ai" in ann["tags"]
    assert ann["lists"] == ["From Claude"]
    assert call("get_contact", email="jane@acme.example")["contact"]["title"] == "VP of Sales"
    assert call("add_to_list", list="Hot", emails=["jane@acme.example", "x@y.example"]) == \
        {"list": "Hot", "added": 1, "not_in_workspace": 1}
    assert call("set_stage", emails=["jane@acme.example"], stage="interested")["updated"] == 1
    assert call("tag_contacts", emails=["jane@acme.example"], tags=["vip"])["changed"] == 1
    call("add_note", email="jane@acme.example", text="Wants a demo Thursday")
    t = call("create_task", title="Send deck", contact="jane@acme.example", kind="email",
             due="tomorrow")
    call("complete_task", id=t["id"])
    d = call("create_deal", name="Gamma pilot", contact="ann@gamma.example", amount="2.5k")
    assert d["amount"] == 2500 and d["stage"] == "qualify"
    assert call("move_deal", id=d["id"], stage="won")["stage"] == "won"
    jane = call("get_contact", email="jane@acme.example")
    assert jane["contact"]["stage"] == "interested" and "vip" in jane["contact"]["tags"]
    assert jane["notes"][0]["text"] == "Wants a demo Thursday"
    assert call("get_contact", email="ann@gamma.example")["contact"]["stage"] == "customer"


def test_enroll_in_sequence_tool():
    from openleads.workspace import sequences
    db = DB()
    sequences.create(db, "Q4", sequences.starter_steps())
    db.close()
    call("add_to_list", list="Q4 list", emails=["jane@acme.example", "bob@beta.example"])
    r = call("enroll_in_sequence", sequence="Q4", list="Q4 list")
    assert r["enrolled"] == 1 and r["skipped"][0]["email"] == "bob@beta.example"
    assert call("get_contact", email="jane@acme.example")["sequences"][0]["name"] == "Q4"
    bad = mcp.handle({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                      "params": {"name": "enroll_in_sequence", "arguments": {"sequence": "nope"}}})
    assert bad["result"]["isError"] is True
