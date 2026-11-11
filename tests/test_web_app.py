"""5.5: the app is served at /, the classic dashboard at /classic/, and the ask box
has its own endpoints (plan first, then run the plan you saw)."""
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from openleads import ask
from openleads.web import server as srv


@pytest.fixture
def app_dir(tmp_path, monkeypatch):
    d = tmp_path / "app"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<!doctype html><title>OpenLeads</title><div id=root>APP</div>")
    (d / "assets" / "index-abc123.js").write_text("console.log('app')")
    monkeypatch.setattr(srv, "APP_DIR", d)
    return d


@pytest.fixture
def base(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(srv, "CLASSIC", False)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), srv.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def get(base, path):
    try:
        with urllib.request.urlopen(base + path, timeout=10) as r:
            return r.status, r.headers, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode("utf-8", "replace")


def post(base, path, body):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def stream(base, path, body):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return [json.loads(line) for line in r.read().decode().splitlines() if line.strip()]


# --- serving ------------------------------------------------------------------ #
def test_the_app_is_home_when_it_is_built(app_dir, base):
    st, _, body = get(base, "/")
    assert st == 200 and "APP" in body


def test_app_assets_are_served_and_cached_by_hash(app_dir, base):
    st, headers, body = get(base, "/assets/index-abc123.js")
    assert st == 200 and "console.log" in body
    assert "immutable" in headers.get("Cache-Control", "")
    assert "no-cache" in get(base, "/")[1].get("Cache-Control", "")


def test_classic_dashboard_stays_at_classic(app_dir, base):
    st, _, body = get(base, "/classic/")
    assert st == 200 and "APP" not in body and "styles.css" in body
    st, headers, _ = get(base, "/classic/styles.css")
    assert st == 200 and "text/css" in headers.get("Content-Type", "")


def test_without_a_build_home_is_the_classic_dashboard(tmp_path, monkeypatch, base):
    monkeypatch.setattr(srv, "APP_DIR", tmp_path / "missing")
    st, _, body = get(base, "/")
    assert st == 200 and "styles.css" in body


def test_classic_flag_makes_the_old_dashboard_home(app_dir, base, monkeypatch):
    monkeypatch.setattr(srv, "CLASSIC", True)
    assert "APP" not in get(base, "/")[2]


def test_unknown_paths_fall_back_to_the_app_and_never_leave_it(app_dir, base):
    assert "APP" in get(base, "/people/someone")[2]
    st, _, body = get(base, "/assets/../../server.py")
    assert "def serve" not in body
    st, _, body = get(base, "/classic/../server.py")
    assert "def serve" not in body


# --- the ask box -------------------------------------------------------------- #
def test_plan_comes_back_before_anything_runs(base, monkeypatch):
    monkeypatch.setattr(ask, "run_plan", lambda *a, **k: pytest.fail("a plan never runs itself"))
    st, r = post(base, "/api/ask/plan",
                 {"text": "every weekday at 9am email 20 agencies in Miami about our SEO audit"})
    assert st == 200 and r["kind"] == "plan" and r["id"]
    assert r["plan"]["kind"] == "workflow" and r["plan"]["schedule"]
    assert any("Schedule" in s for s in r["plan"]["steps"]) and r["plan"]["by"] == "rules"
    assert "graph" not in r["plan"]            # the browser gets the steps, not the graph
    assert r["runnable"] is True


def test_plan_for_an_empty_request_is_a_400(base):
    st, r = post(base, "/api/ask/plan", {"text": "  "})
    assert st == 400


def test_unsupported_request_says_what_to_use(base):
    st, r = post(base, "/api/ask/plan", {"text": "tag maya@x.example as hot"})
    assert r["kind"] == "plan" and r["runnable"] is False and r["plan"]["suggestion"]


def test_a_workspace_question_is_answered_not_planned(base, monkeypatch):
    monkeypatch.setattr(ask, "question", lambda text, db: "Maya replied yesterday.")
    st, r = post(base, "/api/ask/plan", {"text": "who replied this week?"})
    assert r == {"kind": "answer", "answer": "Maya replied yesterday."}


def test_run_runs_the_plan_you_saw_and_never_live(base, monkeypatch):
    seen = {}

    def run_plan(plan, *, live=False, db=None, emit=None):
        seen.update(text=plan.text, live=live)
        emit({"type": "node", "id": "find", "status": "ok"})
        return {"ok": True, "leads": 3, "verified": 3, "drafts_waiting": 3, "sent": 0,
                "workflow": "", "message": ""}
    monkeypatch.setattr(ask, "run_plan", run_plan)
    _, r = post(base, "/api/ask/plan", {"text": "email 3 dentists in Austin about reminders"})
    events = stream(base, "/api/ask/run", {"id": r["id"], "live": True})
    assert seen == {"text": "email 3 dentists in Austin about reminders", "live": False}
    assert events[0]["type"] == "node"
    done = events[-1]
    assert done["type"] == "done" and done["result"]["drafts_waiting"] == 3
    assert "3 drafts are waiting" in done["answer"]


def test_a_plan_runs_once(base, monkeypatch):
    monkeypatch.setattr(ask, "run_plan", lambda plan, **k: {"ok": True, "leads": 0})
    _, r = post(base, "/api/ask/plan", {"text": "email 3 dentists in Austin about reminders"})
    stream(base, "/api/ask/run", {"id": r["id"]})
    again = stream(base, "/api/ask/run", {"id": r["id"]})
    assert again[-1]["type"] == "error"


def test_run_with_an_unknown_plan_is_an_error_event(base):
    assert stream(base, "/api/ask/run", {"id": "nope"})[-1]["type"] == "error"


def test_a_plan_the_model_widened_needs_the_explicit_yes(base, monkeypatch):
    real = ask.make_plan

    def widened(text, **kw):
        p = real(text, **{k: v for k, v in kw.items() if k != "use_model"})
        p.needs_yes = True
        p.by = "claude:sonnet"
        return p
    monkeypatch.setattr(ask, "make_plan", widened)
    ran = []
    monkeypatch.setattr(ask, "run_plan", lambda plan, **k: ran.append(1) or {"ok": True, "leads": 0})
    _, r = post(base, "/api/ask/plan", {"text": "email 3 dentists in Austin about reminders"})
    assert r["plan"]["needs_yes"] is True
    assert stream(base, "/api/ask/run", {"id": r["id"]})[-1]["type"] == "error" and not ran
    _, r = post(base, "/api/ask/plan", {"text": "email 3 dentists in Austin about reminders"})
    assert stream(base, "/api/ask/run", {"id": r["id"], "confirmed": True})[-1]["type"] == "done"


def test_waiting_drafts_can_be_listed_past_the_twenty_today_shows(base, tmp_path):
    from openleads.db import DB
    from openleads.models import Draft
    from openleads.workspace import drafts
    db = DB()
    try:
        for i in range(25):
            db.upsert_lead({"email": f"p{i}@list.example", "first_name": "P", "tier": "safe"})
            drafts.enqueue(db, Draft(email=f"p{i}@list.example", subject=f"s{i}", body="b"),
                           source="workflow", ref={"n": i})
    finally:
        db.close()
    st, _, body = get(base, "/api/drafts/waiting")
    r = json.loads(body)
    assert st == 200 and r["count"] == 25 and len(r["drafts"]) == 25
    assert r["drafts"][0]["subject"] == "s0"


def test_web_copy_never_tells_you_to_type_a_command(base, monkeypatch):
    _, r = post(base, "/api/ask/plan",
                {"text": "every weekday at 9am email 20 agencies in Miami about our SEO audit"})
    assert not any("openleads " in s for s in r["plan"]["steps"])
    assert any("approval queue on Today" in s for s in r["plan"]["steps"])
    monkeypatch.setattr(ask, "run_plan", lambda plan, **k: {
        "ok": True, "leads": 0, "workflow": "ask-agencies-in-miami", "scheduled": "weekdays 09:00"})
    done = stream(base, "/api/ask/run", {"id": r["id"]})[-1]
    assert "openleads " not in done["answer"] and "ask-agencies-in-miami" in done["answer"]
    monkeypatch.setattr(ask, "run_plan", lambda plan, **k: {
        "ok": True, "leads": 3, "verified": 3, "drafts_waiting": 3, "sent": 0})
    _, r = post(base, "/api/ask/plan", {"text": "email 3 dentists in Austin about reminders"})
    done = stream(base, "/api/ask/run", {"id": r["id"]})[-1]
    assert "openleads " not in done["answer"] and "3 drafts are waiting for your yes" in done["answer"]


def test_terminal_answers_keep_their_commands():
    assert "openleads today" in ask.answer({"ok": True, "leads": 2, "verified": 2,
                                            "drafts_waiting": 2})


# --- the app shows classic screens inside itself ------------------------------- #
def test_only_the_classic_dashboard_can_be_framed_and_only_by_this_origin(app_dir, base):
    _, headers, _ = get(base, "/classic/")
    assert headers["X-Frame-Options"] == "SAMEORIGIN"
    assert "frame-ancestors 'self'" in headers["Content-Security-Policy"]
    for path in ("/", "/assets/index-abc123.js", "/api/state", "/api/nope"):
        _, headers, _ = get(base, path)
        assert headers["X-Frame-Options"] == "DENY", path
        assert "frame-ancestors 'none'" in headers["Content-Security-Policy"], path


def test_classic_at_home_is_not_frameable(tmp_path, monkeypatch, base):
    """Without a build the classic dashboard is the top-level page: nothing frames it."""
    monkeypatch.setattr(srv, "APP_DIR", tmp_path / "missing")
    _, headers, _ = get(base, "/")
    assert headers["X-Frame-Options"] == "DENY"


def test_the_app_page_has_no_inline_script():
    """The server's CSP is script-src 'self': an inline script would silently not run."""
    import pathlib
    import re
    html = (pathlib.Path(__file__).resolve().parent.parent / "app" / "index.html").read_text()
    for tag in re.findall(r"<script\b[^>]*>(.*?)</script>", html, re.S):
        assert not tag.strip(), "inline script in app/index.html"
