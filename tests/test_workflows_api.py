"""Workflow editor API, the `openleads workflow` CLI and the MCP workflow tools."""
import http.client
import json
import threading
from http.server import ThreadingHTTPServer

import pytest

from openleads import cli, mcp
from openleads.models import Lead
from openleads.web.server import Handler


@pytest.fixture(scope="module")
def server():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


@pytest.fixture(autouse=True)
def home(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    from openleads import engine

    def fake_build(q, cache=None, db=None, on_progress=None):
        leads = [Lead(first_name="Ada", last_name="L", email="ada@acme.example",
                      organization="Acme", tier="safe", confidence_pct=95, seniority="founder"),
                 Lead(first_name="Bo", last_name="K", email="bo@beta.example",
                      organization="Beta", tier="risky", confidence_pct=60)]
        for ld in leads:
            (on_progress or (lambda *_: None))("lead", ld)
        return leads
    monkeypatch.setattr(engine, "build_leads", fake_build)
    yield tmp_path


def req(port, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    h = {"Host": f"127.0.0.1:{port}"}
    if body is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    conn.request(method, path, body=data, headers=h)
    r = conn.getresponse()
    status, raw = r.status, r.read()
    conn.close()
    return status, raw


def get(port, path):
    status, raw = req(port, "GET", path)
    assert status == 200, raw
    return json.loads(raw)


def post(port, path, body):
    status, raw = req(port, "POST", path, body)
    assert status == 200, raw
    return json.loads(raw)


def stream(port, path, body):
    status, raw = req(port, "POST", path, body)
    assert status == 200
    return [json.loads(x) for x in raw.decode().splitlines() if x.strip()]


GRAPH = {
    "name": "api-wf",
    "nodes": [{"id": "t", "type": "trigger.manual", "params": {}, "position": {"x": 0, "y": 0}},
              {"id": "f", "type": "find", "params": {"query": "agencies in Miami"},
               "position": {"x": 200, "y": 0}},
              {"id": "i", "type": "filter", "params": {"conditions": [
                  {"field": "tier", "op": "is", "value": "safe"}]},
               "position": {"x": 400, "y": 0}},
              {"id": "tg", "type": "tag", "params": {"tags": "hot"},
               "position": {"x": 600, "y": 0}}],
    "edges": [{"from": "t", "from_port": "out", "to": "f"},
              {"from": "f", "from_port": "out", "to": "i"},
              {"from": "i", "from_port": "true", "to": "tg"}],
}


# --------------------------------------------------------------------------- #
# API                                                                          #
# --------------------------------------------------------------------------- #
def test_catalog_templates_and_empty_list(server):
    cat = get(server, "/api/workflows/catalog")
    assert {n["type"] for n in cat["nodes"]} >= {"find", "filter", "send", "wait"}
    assert cat["groups"][0] == "Triggers" and cat["fields"] and cat["ops"]
    assert "stage" in cat["options"]
    assert len(get(server, "/api/workflows/templates")["templates"]) >= 6
    assert get(server, "/api/workflows")["workflows"] == []


def test_save_get_flags_delete(server):
    res = post(server, "/api/workflows/save", {"workflow": GRAPH, "create": True})
    assert res["ok"] and res["workflow"]["kind"] == "workflow"
    status, raw = req(server, "POST", "/api/workflows/save", {"workflow": GRAPH, "create": True})
    assert status == 400 and b"already exists" in raw
    got = get(server, "/api/workflows/get?name=api-wf")
    assert got["workflow"]["nodes"][1]["params"]["count"] == 25 and got["problems"] == []
    res = post(server, "/api/workflows/flags", {"name": "api-wf", "active": True})
    assert res["workflow"]["active"] is True
    rows = get(server, "/api/workflows")["workflows"]
    assert rows[0]["name"] == "api-wf" and rows[0]["active"] is True and rows[0]["when"] == "manual"
    assert post(server, "/api/workflows/delete", {"name": "api-wf"})["ok"] is True
    assert get(server, "/api/workflows")["workflows"] == []


def test_invalid_graph_returns_problems(server):
    bad = {**GRAPH, "edges": GRAPH["edges"] + [{"from": "tg", "from_port": "out", "to": "f"}]}
    res = post(server, "/api/workflows/save", {"workflow": bad})
    assert res["ok"] is False and any("loops back" in p["message"] for p in res["problems"])
    v = post(server, "/api/workflows/validate", {"workflow": bad})
    assert v["problems"]


def test_run_streams_node_events_and_is_logged(server):
    post(server, "/api/workflows/save", {"workflow": GRAPH})
    events = stream(server, "/api/workflows/run", {"name": "api-wf"})
    types = [e["type"] for e in events]
    assert types[0] == "run" and types[-1] == "done"
    done = events[-1]
    assert done["mode"] == "test" and done["status"] == "ok" and done["summary"]["found"] == 2
    filt = [e for e in events if e["type"] == "node" and e["id"] == "i" and e["status"] == "ok"]
    assert filt[0]["out"] == {"true": 1, "false": 1}
    runs = get(server, "/api/workflows/runs?name=api-wf")["runs"]
    assert runs[0]["mode"] == "test" and runs[0]["summary"]["found"] == 2
    one = get(server, f"/api/workflows/run?id={runs[0]['id']}")["run"]
    tag = next(n for n in one["nodes"] if n["id"] == "tg")
    assert tag["notes"][0].startswith("test run: would tag 1")
    assert all("trace" not in n for n in one["nodes"])


def test_unsaved_graphs_only_test_run(server):
    g = {**GRAPH, "name": "draft-wf"}
    events = stream(server, "/api/workflows/run", {"workflow": g, "mode": "run", "live": True})
    assert events[-1]["type"] == "error"                 # real runs need a saved workflow
    events = stream(server, "/api/workflows/run", {"workflow": g})
    assert events[-1]["mode"] == "test" and events[-1]["live"] is False


def test_real_run_applies_workspace_changes(server):
    post(server, "/api/workflows/save", {"workflow": GRAPH})
    done = stream(server, "/api/workflows/run", {"name": "api-wf", "mode": "run"})[-1]
    assert done["mode"] == "run" and done["live"] is False
    from openleads.db import DB
    from openleads.workspace import tags
    db = DB()
    try:
        assert tags.for_contact(db, "ada@acme.example") == ["hot"]
    finally:
        db.close()


def test_new_from_template_export_import(server):
    res = post(server, "/api/workflows/new", {"template": "inbound-reply", "name": "replies"})
    assert res["ok"] and res["workflow"]["active"] is False
    doc = get(server, "/api/workflows/export?name=replies")["doc"]
    res = post(server, "/api/workflows/import", {"doc": doc, "name": "replies-2"})
    assert res["ok"] and res["workflow"]["name"] == "replies-2"
    status, raw = req(server, "POST", "/api/workflows/new", {"template": "nope", "name": "x"})
    assert status == 400 and b"no template" in raw


def test_recipes_show_up_and_old_endpoints_still_work(server):
    assert post(server, "/api/recipes/save", {"name": "old", "query": "roofers"})["ok"]
    rows = get(server, "/api/workflows")["workflows"]
    assert rows[0]["name"] == "old" and rows[0]["kind"] == "recipe"
    assert get(server, "/api/recipes")["recipes"][0]["name"] == "old"


def test_security_rules_apply(server):
    status, _ = req(server, "POST", "/api/workflows/save", json.dumps({"workflow": GRAPH}).encode(),
                    {"Content-Type": "text/plain"})
    assert status == 415
    status, _ = req(server, "POST", "/api/workflows/run", {"name": "x"},
                    {"Origin": "https://evil.example"})
    assert status == 403
    status, _ = req(server, "GET", "/api/workflows", headers={"Host": "evil.example"})
    assert status == 403
    status, _ = req(server, "GET", "/api/workflows/get?name=", None)
    assert status == 400


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #
def cli_run(capsys, *argv):
    code = cli.main(list(argv))
    out = capsys.readouterr()
    return code, out.out, out.err


def test_cli_templates_new_list_show(capsys):
    code, out, _ = cli_run(capsys, "workflow", "templates")
    assert code == 0 and "local-business-outreach" in out and "enrich-csv-hubspot" in out
    code, out, _ = cli_run(capsys, "workflow", "new", "fo", "--from", "founder-outreach")
    assert code == 0 and "created 'fo'" in out
    code, _, err = cli_run(capsys, "workflow", "new", "fo", "--from", "founder-outreach")
    assert code == 2 and "already exists" in err
    code, out, _ = cli_run(capsys, "workflow", "list")
    assert code == 0 and "fo" in out and "paused" in out
    code, out, _ = cli_run(capsys, "workflow", "show", "fo")
    assert code == 0 and "Find leads" in out and "true: Skip contacted" in out
    code, out, _ = cli_run(capsys, "workflow", "show", "fo", "--json")
    assert json.loads(out)["name"] == "fo"


def test_cli_run_is_a_test_run_by_default(capsys):
    cli_run(capsys, "workflow", "new", "fo", "--from", "founder-outreach")
    code, out, _ = cli_run(capsys, "workflow", "run", "fo")
    assert code == 0 and "test run" in out and "found 2" in out and "sent 0" in out
    code, out, _ = cli_run(capsys, "workflow", "run", "fo", "--json")
    res = json.loads(out)
    assert res["mode"] == "test" and res["summary"]["previewed"] == 0
    code, out, _ = cli_run(capsys, "runs")
    assert "wf-test" in out and "fo" in out


def test_cli_export_import_activate_rm(capsys, tmp_path):
    cli_run(capsys, "workflow", "new", "dg", "--from", "weekly-digest-sheets")
    code, out, _ = cli_run(capsys, "workflow", "export", "dg")
    path = tmp_path / "wf.json"
    path.write_text(out)
    code, _, err = cli_run(capsys, "workflow", "import", str(path))
    assert code == 2 and "--replace" in err
    code, out, _ = cli_run(capsys, "workflow", "import", str(path), "--name", "dg2")
    assert code == 0 and "imported 'dg2'" in out
    code, out, _ = cli_run(capsys, "workflow", "activate", "dg2")
    assert code == 0 and "active" in out
    code, out, _ = cli_run(capsys, "wf", "list")
    assert "dg2" in out and "active" in out
    code, out, _ = cli_run(capsys, "workflow", "rm", "dg2")
    assert code == 0
    code, _, err = cli_run(capsys, "workflow", "show", "dg2")
    assert code == 2 and "no workflow" in err


def test_cli_recipe_commands_map_to_graphs(capsys):
    code, _, _ = cli_run(capsys, "recipe", "add", "miami", "agencies in Miami", "--every", "9am")
    assert code == 0
    code, out, _ = cli_run(capsys, "workflow", "list")
    assert "miami" in out and "(recipe)" in out
    code, out, _ = cli_run(capsys, "workflow", "show", "miami")
    assert "Split by tier" in out and "safe: Write email" in out


def test_help_lists_workflow_command(capsys):
    assert "workflow" in cli.build_parser().epilog


# --------------------------------------------------------------------------- #
# MCP                                                                          #
# --------------------------------------------------------------------------- #
def mcp_call(tool, **args):
    r = mcp.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                    "params": {"name": tool, "arguments": args}})["result"]
    assert r["isError"] is False, r["content"][0]["text"]
    return r["structuredContent"]


def test_mcp_lists_and_test_runs_workflows(capsys):
    cli_run(capsys, "workflow", "new", "fo", "--from", "founder-outreach")
    tools = {t["name"]: t for t in mcp.handle({"jsonrpc": "2.0", "id": 1,
                                               "method": "tools/list"})["result"]["tools"]}
    assert tools["list_workflows"]["annotations"]["readOnlyHint"] is True
    assert "TEST RUN" in tools["run_workflow"]["description"]
    rows = mcp_call("list_workflows")["workflows"]
    assert rows[0]["name"] == "fo" and rows[0]["active"] is False
    res = mcp_call("run_workflow", name="fo")
    assert res["mode"] == "test" and res["live"] is False and res["summary"]["sent"] == 0
    assert any(s["type"] == "Find leads" and s["out"] == {"out": 2} for s in res["steps"])
    from openleads.db import DB
    db = DB()
    try:
        assert db.scalar("SELECT COUNT(*) FROM tasks", default=0) == 0
    finally:
        db.close()
    r = mcp.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": {"name": "run_workflow", "arguments": {"name": "nope"}}})
    assert r["result"]["isError"] is True
