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


def call(name, **args):
    r = mcp.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                    "params": {"name": name, "arguments": args}})["result"]
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
