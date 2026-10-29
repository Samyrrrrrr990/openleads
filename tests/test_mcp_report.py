"""MCP find_leads: 45s default budget, new filters, stable keys, report on short results."""
import pytest

from openleads import engine, mcp
from openleads.models import EmailResult, Entity
from openleads.sources import get_registry


class _Src:
    name, kind, vertical, description = "mcpfake", "people", "t", "t"
    cache = None

    def search(self, q):
        yield Entity(full_name="Ada Lovelace", organization="Acme", domain="mcpfake.example")


@pytest.fixture()
def fake_source(monkeypatch):
    get_registry(reload=True)["mcpfake"] = _Src()
    monkeypatch.setattr(engine, "find_email", lambda name, domain, **kw: EmailResult(
        email="ada@mcpfake.example", tier="safe", score=95, signals={"groundtruth_exact": True}))


def test_schema_defaults_to_a_45s_budget_and_new_filters():
    tool = next(t for t in mcp.TOOLS if t["name"] == "find_leads")
    props = tool["inputSchema"]["properties"]
    assert props["budget_seconds"]["default"] == 45
    assert {"location", "source", "seniority", "department"} <= set(props)


def test_options_reach_the_query(monkeypatch):
    seen = {}

    def fake(q, cache=None, db=None):
        seen["q"] = q
        return []
    monkeypatch.setattr("openleads.engine.build_leads", fake)
    mcp.call_tool("find_leads", {"query": "agencies", "location": "Miami",
                                 "seniority": "vp,director", "department": "sales"})
    q = seen["q"]
    assert q.budget == 45 and q.location == "Miami"
    assert q.seniority == ["vp", "director"] and q.department == ["sales"]
    with pytest.raises(ValueError, match="did you mean 'local'"):
        mcp.call_tool("find_leads", {"query": "dentists", "source": "locl"})


def test_short_result_carries_a_report_and_stable_keys(fake_source):
    out = mcp.call_tool("find_leads", {"query": "anything", "source": "mcpfake",
                                       "count": 5, "budget_seconds": 10})
    assert out["count"] == 1
    lead = out["leads"][0]
    assert set(mcp.CORE_LEAD_KEYS) <= set(lead)        # present even when empty
    assert lead["city"] == "" and lead["contact_type"] == "person"
    assert out["report"]["sources"]["mcpfake"]["status"] == "ok"
    assert "1/5 leads" in out["report"]["summary"] and out["hint"]


def test_full_result_has_no_report(fake_source):
    out = mcp.call_tool("find_leads", {"query": "anything", "source": "mcpfake", "count": 1})
    assert out["count"] == 1 and "report" not in out and "hint" not in out


def test_web_find_stream_forwards_source_and_report_events(fake_source):
    from openleads.web import api
    events = []
    api.find({"query": "anything", "source": "mcpfake", "count": 3, "no_company": True},
             events.append)
    types = [e["type"] for e in events]
    assert "source" in types and "report" in types and types[-1] == "done"
    rep = next(e for e in events if e["type"] == "report")["report"]
    assert rep["sources"]["mcpfake"]["status"] == "ok" and rep["leads"] == 1
