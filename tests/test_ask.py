"""ask: a request in plain words becomes a plan you can read before it runs."""
import pytest

from openleads import ask
from openleads.automate.workflow import graph
from openleads.db import DB


def _node(plan, type_):
    return next(n for n in plan.graph["nodes"] if n["type"] == type_)


def test_search_is_a_find_without_confirm():
    p = ask.make_plan("dentists in Austin")
    assert p.kind == "find" and p.confirm is False and p.query.location
    assert p.steps and p.steps[0].startswith("Find")


def test_campaign_graph_is_valid_and_queues_without_live():
    p = ask.make_plan("find 30 rust devs in Berlin and email them about our hiring tool")
    assert p.kind == "workflow" and p.confirm and graph.errors(p.graph, check_name=False) == []
    assert [n["type"] for n in p.graph["nodes"]] == ["trigger.manual", "find", "dedupe", "write",
                                                     "send"]
    assert _node(p, "dedupe")["params"]["skip_contacted"] is True
    assert _node(p, "send")["params"]["approve"] == "always"
    assert _node(p, "send")["params"]["respect_window"] is False
    assert _node(p, "find")["params"]["count"] == 30
    assert "hiring tool" in _node(p, "write")["params"]["pitch"]
    assert any("approve" in s.lower() for s in p.steps)


def test_campaign_live_sends_directly():
    p = ask.make_plan("email 10 fintech founders about x", live=True)
    assert _node(p, "send")["params"]["approve"] == "never"
    assert any("send" in s.lower() for s in p.steps)


def test_schedule_builds_active_scheduled_graph():
    p = ask.make_plan("every weekday at 9am email 20 agencies in Miami about our SEO audit")
    assert p.kind == "workflow" and p.confirm
    assert _node(p, "trigger.schedule")["params"]["schedule"] == "weekdays 09:00"
    assert p.graph["active"] is True and p.graph["live"] is False
    assert [n["type"] for n in p.graph["nodes"]] == ["trigger.schedule", "find", "split_tier",
                                                     "dedupe", "write", "send"]
    assert graph.errors(p.graph, check_name=False) == []
    # Not live: the plan promised the approval queue, and a non-live graph would only
    # ever preview with "auto". Every run would otherwise re-find the same people.
    assert _node(p, "send")["params"]["approve"] == "always"
    assert _node(p, "dedupe")["params"]["skip_contacted"] is True


def test_live_schedule_follows_the_approval_setting():
    p = ask.make_plan("every weekday at 9am email 20 agencies in Miami about our SEO audit",
                      live=True)
    assert p.graph["live"] is True and _node(p, "send")["params"]["approve"] == "auto"


def test_daily_schedule_without_weekday_words():
    p = ask.make_plan("schedule 15 dentists in Austin daily at 8:30am about reminders")
    assert _node(p, "trigger.schedule")["params"]["schedule"] in ("weekdays 08:30", "daily 08:30")


def test_enroll_known_and_unknown_sequence():
    p = ask.make_plan("add 20 fintech founders to my Founders sequence", sequence_names=["Founders"])
    assert p.kind == "workflow" and _node(p, "enroll")["params"]["sequence"] == "Founders"
    assert graph.errors(p.graph, check_name=False) == []
    u = ask.make_plan("add 20 fintech founders to my Nope sequence", sequence_names=["Founders"])
    assert u.kind == "unsupported" and "openleads seq list" in u.suggestion


@pytest.mark.parametrize("text,hint", [
    ("tag everyone from Stripe as hot", "openleads people tag"),
    ("move the Acme deal to won", "openleads deals move"),
    ("create a task to call Jane tomorrow", "openleads tasks add"),
    ("note that Jane prefers mornings", "openleads people note"),
    ("mark jane@acme.com as interested", "openleads people stage"),
])
def test_workspace_edits_are_unsupported_with_command_hint(text, hint):
    p = ask.make_plan(text)
    assert p.kind == "unsupported" and hint in p.suggestion


def test_answer_uses_only_result_numbers():
    s = ask.answer({"ok": True, "leads": 28, "verified": 19, "drafts_waiting": 19, "sent": 0})
    assert "28" in s and "19" in s and "—" not in s and "openleads today" in s
    assert "3" in ask.answer({"ok": True, "leads": 5, "sent": 3})
    assert ask.answer({"ok": False, "message": "SMTP login failed"}).startswith("That didn't work")


def test_answer_for_saved_schedule():
    s = ask.answer({"ok": True, "workflow": "seo-audit-agencies-miami", "scheduled": "weekdays 09:00"})
    assert "seo-audit-agencies-miami" in s and "weekdays 09:00" in s


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    d = DB(tmp_path / "w.db")
    yield d
    d.close()


def test_run_plan_schedule_saves_without_running(db, monkeypatch):
    monkeypatch.setattr("openleads.automate.workflow.executor.run",
                        lambda *a, **k: pytest.fail("a schedule must not run now"))
    p = ask.make_plan("every weekday at 9am email 20 agencies in Miami about our SEO audit")
    r = ask.run_plan(p, db=db)
    from openleads.automate.workflow import store
    saved = store.get(db, r["workflow"])
    assert r["ok"] and saved and saved["active"] is True and r["scheduled"] == "weekdays 09:00"


def test_run_plan_campaign_runs_for_real_and_counts(db, monkeypatch):
    seen = {}

    def fake_run(g, db=None, mode="test", live=False, trigger_label="", **kw):
        seen.update(mode=mode, live=live, trigger=trigger_label)
        return {"workflow": g["name"], "status": "ok", "error": "",
                "summary": {"found": 12, "drafted": 12, "sent": 0, "queued": 12}, "nodes": []}
    monkeypatch.setattr("openleads.automate.workflow.executor.run", fake_run)
    r = ask.run_plan(ask.make_plan("email 12 fintech founders about our tool"), db=db)
    assert seen == {"mode": "run", "live": False, "trigger": "ask"}
    assert r == {**r, "ok": True, "leads": 12, "drafts_waiting": 12, "sent": 0}


def test_run_plan_unsupported_does_nothing(db):
    r = ask.run_plan(ask.make_plan("tag everyone from Stripe as hot"), db=db)
    assert r["ok"] is False and "openleads people tag" in r["message"]


def test_save_plan_names_the_workflow(db):
    p = ask.make_plan("email 10 fintech founders about our tool")
    saved = ask.save_plan(p, "fintech-founders", db=db)
    assert saved["name"] == "fintech-founders"


# --- 5.4: the connected model reads the request ------------------------------------- #
@pytest.fixture
def model(monkeypatch):
    """A connected model whose answer each test sets; records every call."""
    import json as _json

    from openleads import ai
    state = {"reply": None, "calls": []}

    def chat(messages, m=None, **kw):
        state["calls"].append(messages)
        if isinstance(state["reply"], Exception):
            raise state["reply"]
        return _json.dumps(state["reply"]) if isinstance(state["reply"], dict) else state["reply"]
    monkeypatch.setattr(ai, "resolve", lambda overrides=None: ai.Model("claude", "sonnet"))
    monkeypatch.setattr(ai, "chat", chat)
    return state


ODD = ("I need to get in front of about forty heads of ops at logistics startups in "
       "Rotterdam, pitch our route-planning API")


def test_model_reads_what_the_rules_cannot(model):
    model["reply"] = {"kind": "campaign", "audience": "heads of operations at logistics "
                      "startups in Rotterdam", "count": 40, "goal": "our route-planning API"}
    p = ask.make_plan(ODD, use_model=True)
    assert p.kind == "workflow" and graph.errors(p.graph, check_name=False) == []
    assert _node(p, "find")["params"]["count"] == 40
    assert "Rotterdam" in _node(p, "find")["params"]["query"]
    assert _node(p, "write")["params"]["pitch"] == "our route-planning API"
    assert _node(p, "send")["params"]["approve"] == "always"       # the model never picks live
    assert p.by.startswith("claude") and ODD in model["calls"][0][-1]["content"]


def test_model_schedule(model):
    model["reply"] = {"kind": "schedule", "audience": "dental clinics in Austin", "count": 15,
                      "goal": "appointment reminders", "days": "weekdays", "time": "08:30"}
    p = ask.make_plan("each workday morning hit up fifteen Austin dentists re reminders",
                      use_model=True)
    assert _node(p, "trigger.schedule")["params"]["schedule"] == "weekdays 08:30"


def test_model_enroll_still_checks_the_sequence(model):
    model["reply"] = {"kind": "enroll", "audience": "fintech founders", "count": 20,
                      "sequence": "Nope"}
    p = ask.make_plan("stick twenty fintech founders into Nope", use_model=True,
                      sequence_names=["Founders"])
    assert p.kind == "unsupported" and "seq list" in p.suggestion


@pytest.mark.parametrize("reply", [
    {"kind": "delete_everything"},
    {"kind": "campaign", "audience": "", "count": 10},
    {"kind": "campaign", "audience": "x" * 400, "count": 10},
    {"kind": "schedule", "audience": "dentists", "count": 5, "days": "hourly", "time": "25:99"},
    "not json at all",
])
def test_bad_model_answers_fall_back_to_the_rules(model, reply):
    model["reply"] = reply
    text = "find 30 rust devs in Berlin and email them about our hiring tool"
    p = ask.make_plan(text, use_model=True)
    assert p.by == "rules" and _node(p, "find")["params"]["count"] == 30


def test_model_failure_falls_back(model):
    from openleads import ai
    model["reply"] = ai.AIError("not logged in")
    p = ask.make_plan("find 30 rust devs in Berlin and email them about x", use_model=True)
    assert p.kind == "workflow" and p.by == "rules"


def test_edits_with_their_own_command_never_ask_the_model(model):
    p = ask.make_plan("tag maya@x.co as hot", use_model=True)
    assert p.kind == "unsupported" and model["calls"] == []


def test_model_only_when_asked(model):
    ask.make_plan("find 30 rust devs in Berlin and email them about x")
    assert model["calls"] == []


def test_model_find_is_a_search(model):
    model["reply"] = {"kind": "find", "audience": "Series A fintech founders in London",
                      "count": 50}
    p = ask.make_plan("who are the series a fintech founders in london", use_model=True)
    assert p.kind == "find" and p.query.count == 50 and p.confirm is False
