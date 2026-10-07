"""MCP server: protocol handling without the network."""
import io
import json

from openleads import mcp


def _call(method, params=None, mid=1):
    return mcp.handle({"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}})


def test_initialize_negotiates_version():
    r = _call("initialize", {"protocolVersion": "2024-11-05"})["result"]
    assert r["protocolVersion"] == "2024-11-05"
    assert r["serverInfo"]["name"] == "openleads"
    assert "tools" in r["capabilities"]
    r = _call("initialize", {"protocolVersion": "1999-01-01"})["result"]
    assert r["protocolVersion"] == mcp.PROTOCOL_VERSIONS[0]


def test_tools_list_has_schemas():
    tools = _call("tools/list")["result"]["tools"]
    names = {t["name"] for t in tools}
    assert {"find_leads", "find_email", "verify_email", "list_sources"} <= names
    for t in tools:
        assert t["inputSchema"]["type"] == "object"


def test_notifications_get_no_response():
    assert mcp.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None


def test_unknown_method_is_an_error():
    assert _call("nope")["error"]["code"] == -32601


def test_tool_errors_are_reported_to_the_model(monkeypatch):
    def boom(name, args):
        raise ValueError("query is required")
    monkeypatch.setattr(mcp, "call_tool", boom)
    r = _call("tools/call", {"name": "find_leads", "arguments": {}})["result"]
    assert r["isError"] is True and "query is required" in r["content"][0]["text"]


def test_tool_success_returns_text_and_structured(monkeypatch):
    monkeypatch.setattr(mcp, "call_tool", lambda name, args: {"count": 0, "leads": []})
    r = _call("tools/call", {"name": "find_leads", "arguments": {"query": "x"}})["result"]
    assert r["isError"] is False
    assert json.loads(r["content"][0]["text"]) == {"count": 0, "leads": []}
    assert r["structuredContent"]["count"] == 0


def test_serve_loop_keeps_stdout_clean(monkeypatch):
    def noisy(name, args):
        print("library chatter")          # must not reach the protocol stream
        return {"ok": True}
    monkeypatch.setattr(mcp, "call_tool", noisy)
    stdin = io.StringIO("\n".join([
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}),
        "not json",
        json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": {"name": "list_sources", "arguments": {}}}),
    ]) + "\n")
    out = io.StringIO()
    mcp.serve(stdin=stdin, stdout=out)
    lines = [json.loads(ln) for ln in out.getvalue().splitlines()]
    assert [ln.get("id") for ln in lines] == [1, None, 2]
    assert lines[1]["error"]["code"] == -32700
    assert "library chatter" not in out.getvalue()
