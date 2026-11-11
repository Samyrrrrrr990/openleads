"""The writer through its surfaces: `openleads write`, the web API and the MCP tool."""
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from openleads import cli, mcp, settings
from openleads.db import DB
from openleads.web.server import Handler

LEADS = [
    {"email": "maya@northwind.example", "first_name": "Maya", "last_name": "Okafor",
     "title": "Owner & Lead Dentist", "organization": "Northwind Dental", "industry": "Dental",
     "employees": "24", "city": "Austin", "tier": "safe", "source": "local",
     "technologies": ["Zocdoc", "WordPress"],
     "description": "Gentle family dentistry with Saturday hours and same-day crowns."},
    {"email": "info@northwind.example", "name": "", "organization": "Northwind Dental",
     "tier": "safe", "contact_type": "company", "industry": "Dental"},
]


@pytest.fixture(autouse=True)
def home(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    settings.set("sender_name", "Sam")
    settings.set("sender_context", "We help clinics fill empty appointment slots from their waitlist.")
    db = DB()
    for r in LEADS:
        db.upsert_lead(r)
    db.close()
    yield tmp_path


# --- CLI ------------------------------------------------------------------------ #
def test_cli_write_for_saved_contacts_with_explain_and_variants(capsys, tmp_path):
    out_path = tmp_path / "drafts.json"
    code = cli.main(["write", "--to", "maya@northwind.example", "--to", "info@northwind.example",
                     "--variants", "2", "--tone", "casual", "--explain", "--no-llm",
                     "-o", str(out_path)])
    out = capsys.readouterr().out
    assert code == 0
    assert "quality" in out and "/100" in out
    assert "brief: Maya Okafor (person)" in out and "Tech stack: Zocdoc, WordPress" in out
    assert "why opener:" in out and "variant B" in out
    assert "Hey Maya," in out and "Hey Northwind Dental team," in out
    data = json.loads(out_path.read_text())
    assert {"quality", "brief", "explain", "variants", "angle"} <= set(data[0])
    assert data[1]["angle"] == "inbox"


def test_cli_write_angle_step_and_unknown_contact(capsys):
    code = cli.main(["write", "--to", "maya@northwind.example", "--angle", "curiosity",
                     "--step", "2"])
    out = capsys.readouterr().out
    assert code == 0 and "Subject: re: " in out
    code = cli.main(["write", "--to", "nobody@x.example"])
    cap = capsys.readouterr()
    assert code == 1 and "isn't a saved contact" in cap.err


def test_cli_write_from_csv_reads_v5_columns(capsys, tmp_path):
    from openleads import writers
    from openleads.models import Lead
    path = tmp_path / "leads.csv"
    writers.write([Lead(first_name="Ann", email="ann@shop.example", organization="ShopCo",
                        technologies=["Shopify", "Klaviyo"], title="Founder",
                        description="Hand-made ceramic mugs shipped from Portland worldwide.")],
                  fmt="csv", path=str(path))
    code = cli.main(["write", "--from", str(path), "--explain", "--no-llm"])
    out = capsys.readouterr().out
    assert code == 0 and "Shopify" in out and "Hi Ann," in out


def test_cli_write_llm_flag_without_config_warns(capsys):
    code = cli.main(["write", "--to", "maya@northwind.example", "--llm"])
    cap = capsys.readouterr()
    assert code == 0 and "no model is connected" in cap.err and "setup ai" in cap.err


# --- web API ----------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def base():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def post(base, path, body):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def get(base, path):
    with urllib.request.urlopen(base + path, timeout=10) as r:
        return r.status, json.loads(r.read())


def test_api_write_returns_quality_brief_and_variants(base):
    # Only the email is sent: the server fills the rest from the saved contact.
    st, r = post(base, "/api/write", {"leads": [{"email": "maya@northwind.example"}],
                                      "variants": 2, "angle": "compliment", "tone": "warm"})
    assert st == 200 and r["llm"] is False
    d = r["drafts"][0]
    assert d["quality"]["score"] > 0 and d["quality"]["reasons"] is not None
    assert any(f["key"] == "company.tech" for f in d["brief"]["facts"])
    assert len(d["variants"]) == 2 and d["angle"] == "compliment"
    assert d["explain"] and d["body"].startswith("Hi Maya,")


def test_api_rewrite_and_brief(base):
    _, r = post(base, "/api/write", {"leads": [{"email": "maya@northwind.example"}]})
    d = r["drafts"][0]
    st, out = post(base, "/api/write/rewrite", {"draft": d, "mode": "shorter"})
    assert st == 200 and out["draft"]["quality"]["words"] < d["quality"]["words"]
    st, bad = post(base, "/api/write/rewrite", {"draft": d, "mode": "louder"})
    assert st == 400 and "unknown rewrite" in bad["error"]
    st, b = post(base, "/api/write/brief", {"email": "info@northwind.example"})
    assert st == 200 and b["brief"]["kind"] == "company"
    # an edit in Compose is re-scored against the same brief
    st, sc = post(base, "/api/write/score", {"email": "maya@northwind.example", "subject": "hi",
                                             "body": "Hi Maya,\n\nClick here for a FREE demo!!!"})
    assert st == 200 and sc["quality"]["score"] < d["quality"]["score"]
    assert any(r["code"] == "spam" for r in sc["quality"]["reasons"])


def test_api_templates_generate_improve_and_preview_quality(base):
    st, g = post(base, "/api/templates/generate", {"angle": "pain", "step": 1})
    assert st == 200 and "{{first_name|there}}" in g["body"] and g["quality"]["score"] > 0
    st, fu = post(base, "/api/templates/generate", {"step": 3, "final": True})
    assert st == 200 and fu["subject"].startswith("re: ")
    st, imp = post(base, "/api/templates/improve", {"subject": "FREE!!!", "body": "Hi {{first_name}},"})
    assert st == 200 and "{{first_name|there}}" in imp["body"] and imp["changes"]
    st, pv = post(base, "/api/templates/preview", {"subject": "hi", "body": g["body"],
                                                    "email": "maya@northwind.example"})
    assert st == 200 and pv["draft"]["quality"]["score"] > 0
    st, meta = get(base, "/api/writing/meta")
    assert "curiosity" in meta["angles"] and "more casual" in meta["rewrites"]


def test_api_sequence_preview_has_quality(base):
    st, r = post(base, "/api/sequences/save", {"name": "AI seq", "steps": [
        {"type": "auto_email", "ai": True},
        {"type": "auto_email", "ai": True, "delay_days": 3, "thread": True}]})
    assert st == 200
    sid = r["sequence"]["id"]
    st, pv = post(base, "/api/sequences/preview", {"id": sid, "step": 1,
                                                    "email": "maya@northwind.example"})
    assert st == 200 and pv["quality"]["score"] > 0 and pv["draft"]["subject"].startswith("re: ")


# --- MCP ------------------------------------------------------------------------ #
def _call(name, **args):
    r = mcp.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                    "params": {"name": name, "arguments": args}})["result"]
    return r


def test_mcp_draft_email_returns_score_and_brief():
    tools = mcp.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})["result"]["tools"]
    tool = next(t for t in tools if t["name"] == "draft_email")
    assert tool["annotations"]["readOnlyHint"] is True
    r = _call("draft_email", email="maya@northwind.example", variants=2, use_llm=False)
    assert r["isError"] is False
    out = r["structuredContent"]
    assert out["subject"] and out["body"].startswith("Hi Maya,")
    assert 0 <= out["quality"]["score"] <= 100 and isinstance(out["quality"]["reasons"], list)
    assert any(f["key"] == "company.tech" for f in out["brief"]["facts"])
    assert len(out["variants"]) == 1 and out["writer"] == "writer"
    lead = {"email": "jobs@acme.example", "organization": "Acme", "title": "Hiring", "source": "hn"}
    inbox = _call("draft_email", lead=lead)["structuredContent"]
    assert inbox["brief"]["kind"] == "company" and inbox["angle"] == "inbox"
    bad = _call("draft_email", email="nobody@x.example")
    assert bad["isError"] is True


def test_api_ai_status_and_test(base, monkeypatch):
    import json as _json

    from openleads import ai
    monkeypatch.setattr(ai, "_which", lambda name: "/bin/claude" if name == "claude" else None)
    monkeypatch.setattr(ai, "_ollama_models", lambda timeout=0.4: [])
    st, s = get(base, "/api/ai")
    assert st == 200 and s["current"] is None
    assert [d["provider"] for d in s["detected"]] == ["claude"]
    assert "/bin/claude" not in _json.dumps(s)            # no local paths in the browser
    settings.set("ai_provider", "claude")
    monkeypatch.setattr(ai, "_run", lambda *a: (0, _json.dumps({"is_error": False,
                                                                "result": "ready"}), ""))
    st, s = get(base, "/api/ai")
    assert s["current"]["provider"] == "claude"
    st, t = post(base, "/api/ai/test", {})
    assert st == 200 and t["ok"] is True and "ready" in t["detail"]
    monkeypatch.setattr(ai, "_run", lambda *a: (1, "", "Please run /login"))
    st, t = post(base, "/api/ai/test", {})
    assert t["ok"] is False and "login" in t["detail"]
    settings.unset("ai_provider")
