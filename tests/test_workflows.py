"""Workflow graphs: validation, the executor, waits, recipes as graphs, the runner."""
import json
from datetime import datetime, timedelta

import pytest

from openleads.automate.workflow import convert, executor, graph, nodes, runner, store, templates
from openleads.automate.workflow.runtime import RUN, TEST
from openleads.models import Lead, SendResult

WED_10 = datetime(2026, 10, 7, 10, 5)      # a Wednesday, inside the send window
WED_20 = datetime(2026, 10, 7, 20, 0)      # a Wednesday evening, outside it


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    from openleads.db import DB
    d = DB(path=str(tmp_path / "ol.db"))
    yield d
    d.close()


def L(email, tier="safe", conf=90, **kw):
    first = kw.pop("first_name", email.split("@")[0].title())
    return Lead(first_name=first, last_name="Doe", email=email, organization=kw.pop("org", "Acme"),
                tier=tier, confidence_pct=conf, score=conf, source="test", **kw)


class Fakes:
    """Every outward-facing service, recorded."""

    def __init__(self, leads=()):
        self.leads = list(leads)
        self.calls = {k: [] for k in ("build", "send", "export", "notify", "write", "profile",
                                      "verify", "inbox", "enrich")}
        self.window = True

    def services(self):
        return {
            "build_leads": self.build, "send_drafts": self.send, "export": self.export,
            "notify": self.notify, "write_email": self.write, "fetch_profile": self.profile,
            "verify_address": self.verify, "inbox_scan": self.inbox,
            "enrich_rows": self.enrich, "in_send_window": lambda now: self.window,
            "next_send_slot": lambda now: now.replace(hour=8, minute=0) + timedelta(days=1)
            if now.hour >= 16 else now,
        }

    def build(self, q, cache=None, db=None, on_progress=None):
        self.calls["build"].append(q)
        on_progress("phase", "searching")
        for ld in self.leads:
            on_progress("lead", ld)
        return list(self.leads)

    def send(self, drafts, dry_run=True, db=None, campaign="", on_progress=None):
        self.calls["send"].append({"emails": [d["email"] for d in drafts], "dry_run": dry_run,
                                   "campaign": campaign})
        return [SendResult(d["email"], "preview" if dry_run else "sent") for d in drafts]

    def export(self, leads, sink="csv", target=None):
        self.calls["export"].append({"count": len(leads), "sink": sink, "target": target})
        return {"ok": True, "count": len(leads), "sink": sink}

    def notify(self, title, message, channel="desktop", url=""):
        self.calls["notify"].append((title, message))
        return {"desktop": True}

    def write(self, lead, pitch="", template="", db=None):
        self.calls["write"].append(lead["email"])
        return {"subject": f"hi {lead.get('first_name', '')}", "body": f"about {pitch}",
                "lint": {}, "model": "fake"}

    def profile(self, domain, cache=None):
        self.calls["profile"].append(domain)
        return {"domain": domain, "industry": "Dental", "phone": "+15125550100",
                "technologies": ["WordPress"]}

    def verify(self, email, cache=None, db=None):
        from openleads.models import EmailResult
        self.calls["verify"].append(email)
        return EmailResult(email=email, tier="risky", score=50, confidence="pattern_guess")

    def inbox(self, db):
        self.calls["inbox"].append(1)
        return {}

    def enrich(self, rows, cache=None, db=None, deep=False, on_progress=None):
        self.calls["enrich"].append(len(rows))
        return [L(f"row{i}@enr.example") for i, _ in enumerate(rows)]


def N(id_, type_, **params):
    return {"id": id_, "type": type_, "params": params}


def E(a, b, port="out"):
    return {"from": a, "from_port": port, "to": b}


def G(nodes_, edges, name="wf", **kw):
    return {"name": name, "nodes": nodes_, "edges": edges, **kw}


def run(g, db, fakes, mode=TEST, **kw):
    kw.setdefault("now", WED_10)
    return executor.run(g, db=db, cache=None, mode=mode, services=fakes.services(), **kw)


def by_node(res):
    return {r["id"]: r for r in res["nodes"]}


# --------------------------------------------------------------------------- #
# Graph validation                                                             #
# --------------------------------------------------------------------------- #
def _msgs(g, level="error"):
    return [p["message"] for p in graph.validate(g) if p["level"] == level]


def test_valid_graph_has_no_problems():
    g = G([N("t", "trigger.manual"), N("f", "find", query="dentists in Austin"),
           N("w", "write"), N("s", "send")], [E("t", "f"), E("f", "w"), E("w", "s")])
    assert graph.validate(g) == []


def test_cycles_are_rejected():
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"), N("a", "limit"), N("b", "dedupe")],
          [E("t", "f"), E("f", "a"), E("a", "b"), E("b", "a")])
    assert any("loops back" in m for m in _msgs(g))
    assert set(graph.find_cycle(graph.normalize(g))) == {"a", "b"}


def test_dangling_and_wrong_ports():
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"), N("i", "filter")],
          [E("t", "f"), E("f", "ghost"), E("f", "i", port="true"), E("i", "t", port="true")])
    msgs = _msgs(g)
    assert any("doesn't exist" in m for m in msgs)
    assert any("no 'true' output" in m for m in msgs)
    assert any("can't have inputs" in m for m in msgs)


def test_param_types_are_checked():
    g = G([N("t", "trigger.schedule", schedule="funday 9am"),
           N("f", "find", query="", count=5000),
           N("x", "export", sink="fax")], [E("t", "f"), E("f", "x")])
    msgs = " | ".join(_msgs(g))
    assert "When it runs" in msgs and "Audience is required" in msgs
    assert "at most 1000" in msgs and "must be one of" in msgs


def test_item_types_send_needs_write_and_logic_needs_leads():
    g = G([N("t", "trigger.manual"), N("s", "send")], [E("t", "s")])
    assert any("needs drafts" in m for m in _msgs(g))
    g = G([N("t", "trigger.schedule", schedule="9am"), N("i", "filter")], [E("t", "i")])
    assert any("needs leads" in m for m in _msgs(g))
    # Mixed branches into Send: one drafted, one not → still an error.
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"), N("w", "write"), N("s", "send")],
          [E("t", "f"), E("f", "w"), E("w", "s"), E("f", "s")])
    assert any("needs drafts" in m for m in _msgs(g))


def test_missing_trigger_duplicate_ids_bad_name_and_unconnected_warning():
    g = G([N("a", "find", query="x"), N("a", "limit")], [], name="bad name!")
    msgs = " | ".join(_msgs(g))
    assert "add a trigger" in msgs and "share the id" in msgs and "letters, numbers" in msgs
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"), N("lonely", "limit")],
          [E("t", "f")])
    assert _msgs(g) == [] and any("never runs" in m for m in _msgs(g, "warning"))


def test_unknown_condition_field_and_node_type():
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"),
           N("i", "filter", conditions=[{"field": "shoe_size", "op": "is", "value": 9}]),
           N("z", "teleport")], [E("t", "f"), E("f", "i")])
    msgs = " | ".join(_msgs(g))
    assert "unknown field 'shoe_size'" in msgs and "unknown node type 'teleport'" in msgs


def test_normalize_types_params_and_topo_order():
    g = graph.normalize(G([N("t", "trigger.manual"), N("f", "find", query="x", count="12",
                                                        verified_only="false")],
                          [E("t", "f")]))
    f = g["nodes"][1]
    assert f["params"]["count"] == 12 and f["params"]["verified_only"] is False
    assert f["params"]["location"] == "" and f["on_error"] == "stop"
    assert graph.topo_order(g) == ["t", "f"]
    assert graph.downstream(g, "t") == {"t", "f"}


def test_every_template_is_valid_and_catalog_is_documented():
    assert len(templates.TEMPLATES) >= 6
    for t in templates.TEMPLATES:
        assert graph.validate(templates.instantiate(t["key"])) == [], t["key"]
    cat = nodes.catalog()
    types = {c["type"] for c in cat}
    assert {"trigger.manual", "trigger.schedule", "trigger.new_leads", "trigger.reply", "find",
            "enrich", "lookup_company", "verify", "filter", "split_tier", "dedupe", "limit",
            "write", "wait", "send", "add_to_list", "enroll", "set_stage", "create_task", "tag",
            "export", "notify"} <= types
    assert all(c["doc"] and c["label"] for c in cat)
    json.dumps(cat)


# --------------------------------------------------------------------------- #
# Executor                                                                     #
# --------------------------------------------------------------------------- #
def test_if_branching_routes_items(db):
    fk = Fakes([L("founder@a.example", seniority="founder"),
                L("dev@b.example", org="Beta", seniority="senior")])
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"),
           N("i", "filter", conditions=[{"field": "seniority", "op": "in",
                                         "value": "founder, owner"}]),
           N("yes", "tag", tags="decision-maker"), N("no", "add_to_list", list="Later")],
          [E("t", "f"), E("f", "i"), E("i", "yes", "true"), E("i", "no", "false")])
    res = run(g, db, fk, mode=RUN)
    assert res["status"] == "ok"
    r = by_node(res)
    assert r["i"]["out"] == {"true": 1, "false": 1}
    assert r["i"]["samples"]["true"][0]["email"] == "founder@a.example"
    from openleads.workspace import lists, tags
    assert tags.for_contact(db, "founder@a.example") == ["decision-maker"]
    assert tags.for_contact(db, "dev@b.example") == []
    assert lists.members(db, lists.by_name(db, "Later")["id"]) == ["dev@b.example"]


def test_filter_conditions_any_all_and_db_fields(db):
    fk = Fakes([L("a@a.example", phone="+1 555"), L("b@b.example", tier="risky", conf=40)])
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"),
           N("i", "filter", match="any", conditions=[
               {"field": "has_phone", "op": "is_true", "value": ""},
               {"field": "confidence_pct", "op": "gte", "value": "80"}]),
           N("i2", "filter", conditions=[{"field": "stage", "op": "is", "value": "new"},
                                         {"field": "fit_grade", "op": "in", "value": "A,B,C,D"}])],
          [E("t", "f"), E("f", "i"), E("f", "i2")])
    r = by_node(run(g, db, fk))
    assert r["i"]["out"] == {"true": 1, "false": 1}
    assert r["i2"]["out"] == {"true": 2, "false": 0}


def test_split_by_tier_and_empty_branch_sleeps(db):
    fk = Fakes([L("s@a.example"), L("r@b.example", tier="risky"), L("x@c.example", tier="bad")])
    g = G([N("t", "trigger.manual"), N("f", "find", query="x", verified_only=False),
           N("sp", "split_tier"), N("ws", "write"), N("wr", "write"), N("lb", "limit"),
           N("i", "filter", conditions=[{"field": "tier", "op": "is", "value": "nope"}]),
           N("never", "write")],
          [E("t", "f"), E("f", "sp"), E("sp", "ws", "safe"), E("sp", "wr", "risky"),
           E("sp", "lb", "bad"), E("f", "i"), E("i", "never", "true")])
    r = by_node(run(g, db, fk))
    assert r["sp"]["out"] == {"safe": 1, "risky": 1, "bad": 1}
    assert r["ws"]["out"] == {"out": 1} and r["wr"]["out"] == {"out": 1}
    assert r["never"]["status"] == "skipped"          # empty true port didn't wake it


def test_test_mode_never_sends_exports_notifies_or_writes(db):
    fk = Fakes([L("a@a.example"), L("b@b.example", org="Beta")])
    from openleads.workspace import sequences
    seq = sequences.create(db, "Nurture", steps=[{"type": "auto_email", "subject": "s",
                                                  "body": "b", "delay_days": 0}])
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"), N("w", "write"),
           N("s", "send"), N("x", "export", sink="webhook", target="https://hook.example"),
           N("n", "notify", channel="both"), N("l", "add_to_list", list="L"),
           N("tg", "tag", tags="t1"), N("st", "set_stage", stage="interested"),
           N("tk", "create_task", title="Call {{first_name}}"), N("en", "enroll",
                                                                    sequence=seq["name"]),
           N("wt", "wait", days=2), N("after", "tag", tags="after-wait")],
          [E("t", "f"), E("f", "w"), E("w", "s"), E("s", "x"), E("x", "n"), E("f", "l"),
           E("f", "tg"), E("f", "st"), E("f", "tk"), E("f", "en"), E("s", "wt"),
           E("wt", "after")])
    res = run(g, db, fk, mode=TEST, live=True)
    assert res["status"] == "ok" and res["live"] is False
    assert fk.calls["send"] == [] and fk.calls["export"] == [] and fk.calls["notify"] == []
    assert db.scalar("SELECT COUNT(*) FROM touches", default=0) == 0
    assert db.scalar("SELECT COUNT(*) FROM tasks", default=0) == 0
    assert db.scalar("SELECT COUNT(*) FROM contact_tags", default=0) == 0
    assert db.scalar("SELECT COUNT(*) FROM lists", default=0) == 0
    assert db.scalar("SELECT COUNT(*) FROM enrollments", default=0) == 0
    assert db.scalar("SELECT COUNT(*) FROM workflow_waits", default=0) == 0
    assert {ld["stage"] for ld in db.list_leads()} == {"new"}
    r = by_node(res)
    assert r["s"]["out"] == {"out": 2} and r["after"]["status"] == "ok"   # wait passes through
    assert any("would send 2" in n for n in r["s"]["notes"])
    assert any("would create 2 tasks" in n and "Call A" in n for n in r["tk"]["notes"])


def test_real_run_previews_sends_unless_live(db):
    fk = Fakes([L("a@a.example")])
    g = G([N("t", "trigger.manual"), N("f", "find", query="dentists"), N("w", "write"),
           N("s", "send")], [E("t", "f"), E("f", "w"), E("w", "s")])
    res = run(g, db, fk, mode=RUN, live=False)
    assert fk.calls["send"][-1]["dry_run"] is True and res["summary"]["previewed"] == 1
    res = run(g, db, fk, mode=RUN, live=True)
    assert fk.calls["send"][-1]["dry_run"] is False and res["summary"]["sent"] == 1


def test_live_send_outside_window_parks_until_next_slot(db):
    fk = Fakes([L("a@a.example")])
    fk.window = False
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"), N("w", "write"),
           N("s", "send"), N("tk", "create_task", title="sent to {{first_name}}")],
          [E("t", "f"), E("f", "w"), E("w", "s"), E("s", "tk")], active=True, live=True)
    store.save(db, g)
    res = run(store.get(db, "wf"), db, fk, mode=RUN, live=True, now=WED_20)
    assert fk.calls["send"] == [] and res["summary"]["waiting"] == 1
    rows = store.due_waits(db, (WED_20 + timedelta(days=2)).timestamp())
    assert rows[0]["node"] == "s" and rows[0]["live"] == 1
    assert datetime.fromtimestamp(rows[0]["wake_at"]) == datetime(2026, 10, 8, 8, 0)


def test_wait_parks_and_resumes_downstream_only(db):
    fk = Fakes([L("a@a.example"), L("b@b.example", org="Beta")])
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"),
           N("wt", "wait", days=2, business_hours=False),
           N("tk", "create_task", title="Call {{first_name}}", due="today")],
          [E("t", "f"), E("f", "wt"), E("wt", "tk")], active=True)
    store.save(db, g)
    res = run(store.get(db, "wf"), db, fk, mode=RUN)
    assert res["summary"]["waiting"] == 2 and by_node(res)["tk"]["status"] == "skipped"
    assert store.waiting(db, "wf")["count"] == 2
    assert db.scalar("SELECT COUNT(*) FROM tasks", default=0) == 0
    # Not due yet.
    out = runner.resume_waits(db, WED_10 + timedelta(days=1), services=fk.services())
    assert out["due"] == 0
    # One of them replied meanwhile: Wait drops them on wake-up.
    db.set_status("b@b.example", "sent")
    db.set_status("b@b.example", "replied")
    builds = len(fk.calls["build"])
    out = runner.resume_waits(db, WED_10 + timedelta(days=3), services=fk.services())
    assert out == {"due": 2, "resumed": 2, "runs": 1, "failed": 0, "held": 0}
    assert len(fk.calls["build"]) == builds                 # upstream Find did not rerun
    titles = [r["title"] for r in db.query("SELECT title FROM tasks WHERE title LIKE 'Call%'")]
    assert titles == ["Call A"]
    assert store.waiting(db, "wf")["count"] == 0
    last = store.runs(db, "wf", 1)[0]
    assert last["trigger"] == "resume:wt" and last["status"] == "ok"
    # A second pass finds nothing left to resume.
    assert runner.resume_waits(db, WED_10 + timedelta(days=4), services=fk.services())["due"] == 0


def test_paused_workflow_holds_waits_and_deleted_cancels(db):
    fk = Fakes([L("a@a.example")])
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"), N("wt", "wait", days=1,
                                                                   business_hours=False),
           N("tg", "tag", tags="later")], [E("t", "f"), E("f", "wt"), E("wt", "tg")])
    store.save(db, g)                                      # paused
    run(store.get(db, "wf"), db, fk, mode=RUN)
    out = runner.resume_waits(db, WED_10 + timedelta(days=2), services=fk.services())
    assert out["held"] == 1 and store.waiting(db, "wf")["count"] == 1
    store.delete(db, "wf")
    assert store.waiting(db, "wf")["count"] == 0


def test_node_errors_stop_or_continue(db):
    fk = Fakes([L("a@a.example")])
    fk.export = lambda leads, sink="csv", target=None: {"ok": False, "error": "hook down"}
    nodes_ = [N("t", "trigger.manual"), N("f", "find", query="x"),
              N("x", "export", sink="webhook", target="https://h.example"),
              N("after", "tag", tags="exported"), N("other", "tag", tags="other")]
    edges = [E("t", "f"), E("f", "x"), E("x", "after"), E("f", "other")]
    res = run(G(nodes_, edges), db, fk, mode=RUN)
    r = by_node(res)
    assert res["status"] == "error" and "hook down" in res["error"]
    assert r["x"]["status"] == "error" and r["after"]["status"] == "skipped"
    nodes_[2]["on_error"] = "continue"
    res = run(G(nodes_, edges), db, fk, mode=RUN)
    r = by_node(res)
    assert res["status"] == "partial" and r["other"]["status"] == "ok"
    assert r["after"]["status"] == "skipped"


def test_dedupe_limit_and_merge_without_duplicates(db):
    db.upsert_lead({"email": "old@a.example", "first_name": "Old"})
    db.set_status("old@a.example", "sent")
    db.execute("UPDATE leads SET last_contacted=? WHERE email=?", (WED_10.timestamp(), "old@a.example"))
    db.suppress("gone@b.example", "bounced")
    fk = Fakes([L("old@a.example"), L("gone@b.example"), L("new@c.example", org="C"),
                L("new2@c.example", org="C"), L("x@d.example", org="D")])
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"),
           N("d", "dedupe", per_company=True), N("lim", "limit", max=1),
           N("a", "filter"), N("b", "filter"), N("m", "limit", max=100)],
          [E("t", "f"), E("f", "d"), E("d", "lim"), E("f", "a"), E("f", "b"),
           E("a", "m", "true"), E("b", "m", "true")])
    r = by_node(run(g, db, fk))
    assert r["d"]["out"] == {"out": 2}
    assert "1 contacted" in r["d"]["notes"][0] and "1 suppressed" in r["d"]["notes"][0]
    assert r["lim"]["out"] == {"out": 1}
    assert r["m"]["in"] == 5                              # both branches merged by email


def test_new_leads_trigger_remembers_seen_companies(db):
    fk = Fakes([L("a@a.example"), L("b@b.example", org="B")])
    g = G([N("t", "trigger.new_leads", query="agencies", schedule="daily 09:00"),
           N("tg", "tag", tags="new")], [E("t", "tg")], active=True)
    store.save(db, g)
    assert by_node(run(store.get(db, "wf"), db, fk))["t"]["out"] == {"out": 2}
    assert store.get_state(db, "wf") .get("seen:t") is None       # test runs don't remember
    run(store.get(db, "wf"), db, fk, mode=RUN)
    assert store.get_state(db, "wf")["seen:t"] == ["a.example", "b.example"]
    fk.leads.append(L("c@c.example", org="C"))
    res = run(store.get(db, "wf"), db, fk, mode=RUN)
    assert by_node(res)["t"]["out"] == {"out": 1}
    fk.leads = fk.leads[:2]
    res = run(store.get(db, "wf"), db, fk, mode=RUN)
    assert res["status"] == "empty" and res["id"] is None         # quiet, not logged


def test_reply_trigger_fires_once_per_reply(db):
    fk = Fakes()
    db.upsert_lead({"email": "jo@a.example", "first_name": "Jo"})
    g = G([N("t", "trigger.reply", scan_inbox=True),
           N("st", "set_stage", stage="interested")], [E("t", "st")], active=True)
    store.save(db, g)
    res = run(store.get(db, "wf"), db, fk, mode=RUN)
    assert res["status"] == "empty" and fk.calls["inbox"] == [1]
    db.set_status("jo@a.example", "sent")
    db.set_status("jo@a.example", "replied")
    res = run(store.get(db, "wf"), db, fk, mode=RUN, now=datetime.now())
    assert by_node(res)["t"]["out"] == {"out": 1}
    assert db.get_lead("jo@a.example")["stage"] == "interested"
    res = run(store.get(db, "wf"), db, fk, mode=RUN, now=datetime.now())
    assert res["status"] == "empty"


def test_lookup_verify_enrich_contacts_and_notify(db, tmp_path):
    fk = Fakes([L("a@a.example")])
    db.upsert_lead({"email": "cold@z.example", "first_name": "Cold", "tier": "safe"})
    db.execute("UPDATE leads SET stage='unresponsive', last_contacted=? WHERE email=?",
               ((WED_10 - timedelta(days=60)).timestamp(), "cold@z.example"))
    csv = tmp_path / "p.csv"
    csv.write_text("name,company\nAda Lovelace,Acme\nAlan Turing,Bletchley\n")
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"), N("lk", "lookup_company"),
           N("v", "verify"), N("e", "enrich", source="csv", path=str(csv)),
           N("c", "contacts", stage="unresponsive", contacted="older", days=30),
           N("n", "notify", message="{count} for {workflow}")],
          [E("t", "f"), E("f", "lk"), E("lk", "v"), E("t", "e"), E("t", "c"), E("c", "n")])
    res = run(g, db, fk, mode=RUN)
    r = by_node(res)
    assert res["status"] == "ok", res["error"]
    assert r["lk"]["samples"]["out"][0]["industry"] == "Dental"
    assert r["v"]["samples"]["out"][0]["tier"] == "risky"
    assert r["e"]["out"] == {"out": 2} and fk.calls["enrich"] == [2]
    assert r["c"]["samples"]["out"][0]["email"] == "cold@z.example"
    assert fk.calls["notify"] == [("OpenLeads: wf", "1 for wf")]


def test_run_is_logged_to_db_and_history(db):
    from openleads.automate import history
    fk = Fakes([L("a@a.example")])
    g = G([N("t", "trigger.manual"), N("f", "find", query="x")], [E("t", "f")], name="logged")
    res = run(g, db, fk, mode=RUN)
    saved = store.get_run(db, res["id"])
    assert saved["status"] == "ok" and saved["nodes"][1]["out"] == {"out": 1}
    assert saved["nodes"][1]["samples"]["out"][0]["email"] == "a@a.example"
    line = history.recent(1)[0]
    assert line["kind"] == "workflow" and line["name"] == "logged" and line["detail"]["found"] == 1


def test_streams_events_in_order(db):
    fk = Fakes([L("a@a.example")])
    events = []
    g = G([N("t", "trigger.manual"), N("f", "find", query="x"), N("w", "write")],
          [E("t", "f"), E("f", "w")])
    run(g, db, fk, emit=events.append)
    kinds = [e["type"] for e in events]
    assert kinds[0] == "run" and kinds[-1] == "done"
    assert {"node", "edge", "progress", "phase", "log"} <= set(kinds)
    edge = next(e for e in events if e["type"] == "edge" and e["from"] == "f")
    assert edge["count"] == 1 and edge["to"] == "w"


def test_broken_listener_does_not_stop_the_run(db):
    fk = Fakes([L("a@a.example")])

    def boom(_):
        raise BrokenPipeError()
    g = G([N("t", "trigger.manual"), N("f", "find", query="x")], [E("t", "f")])
    assert run(g, db, fk, mode=RUN, emit=boom)["status"] == "ok"


# --------------------------------------------------------------------------- #
# Recipes as graphs                                                            #
# --------------------------------------------------------------------------- #
SPECS = [
    {"query": "dentists in Austin", "count": 10},
    {"query": "agencies in Miami", "count": 5, "verified_only": False, "send": True,
     "context": "SEO audits", "export": {"sink": "csv", "target": "/tmp/x.csv"}},
    {"query": "fintech founders", "send": True, "sequence": True, "schedule": "weekdays 9am",
     "enabled": False},
    {"query": "plumbers", "verified_only": False, "export": {"sink": "webhook",
                                                             "target": "https://h.example"}},
]


@pytest.mark.parametrize("spec", SPECS)
def test_recipe_graph_round_trips(spec):
    from openleads.automate import recipes
    g = convert.recipe_to_graph({**spec, "name": "r"})
    assert graph.validate(g) == []
    back = convert.graph_to_recipe(g)
    want = recipes.normalize_spec(spec)
    got = recipes.normalize_spec(back)
    for k in ("query", "count", "verified_only", "send", "sequence", "context", "enabled",
              "export"):
        assert got[k] == want[k], k
    assert recipes.describe_schedule(got) == recipes.describe_schedule(want)


def test_graph_with_extra_nodes_is_not_a_recipe():
    g = convert.recipe_to_graph({"query": "x", "name": "r"})
    g["nodes"].append({"id": "tg", "type": "tag", "params": {"tags": "x"}})
    g["edges"].append({"from": "write", "from_port": "out", "to": "tg"})
    assert convert.graph_to_recipe(g) is None


@pytest.mark.parametrize("spec", SPECS)
def test_recipe_and_its_graph_do_the_same_thing(db, monkeypatch, spec):
    """recipes.run(dry_run=True) ≡ executor real run, not live (sends preview, exports run)."""
    from openleads import engine
    from openleads.automate import exporters, pipeline, recipes
    leads = [L("safe@a.example"), L("hi@b.example", tier="risky", conf=70, org="B"),
             L("lo@c.example", tier="risky", conf=30, org="C")]

    def fake_build(q, cache=None, db=None, on_progress=None):
        found = [ld for ld in leads if ld.tier == "safe" or not q.verified_only]
        for ld in found:
            (on_progress or (lambda *_: None))("lead", ld)
        return found
    exports = []
    monkeypatch.setattr(engine, "build_leads", fake_build)
    monkeypatch.setattr(pipeline, "build_leads", fake_build)
    monkeypatch.setattr(exporters, "export", lambda ls, sink="csv", target=None: exports.append(
        (len(ls), sink, target)) or {"ok": True, "count": len(ls), "sink": sink})
    monkeypatch.setattr("openleads.outreach.deliverability.preflight", lambda **kw: {})

    def touches():
        rows = db.query("SELECT email, status, campaign FROM touches ORDER BY email")
        db.execute("DELETE FROM touches")
        return rows

    full = {**spec, "name": "r"}
    old = recipes.run(full, db=db, dry_run=True)
    old_touches, old_exports = touches(), list(exports)
    exports.clear()
    res = executor.run(convert.recipe_to_graph(full), db=db, mode=RUN, live=False, now=WED_10,
                       record=False)
    assert res["status"] == "ok", res["error"]
    assert res["summary"]["found"] == old["found"]
    assert res["summary"]["drafted"] == old["drafted"]
    assert res["summary"]["sent"] == old["sent"] == 0
    assert touches() == old_touches
    assert exports == old_exports


def test_recipes_listed_as_graphs_and_saved_back(db):
    from openleads.automate import recipes
    recipes.save("miami", {"query": "agencies in Miami", "send": True, "schedule": "9am"}, db=db)
    rows = {g["name"]: g for g in store.list_all(db)}
    assert rows["miami"]["kind"] == "recipe" and rows["miami"]["live"] is True
    g = store.get(db, "miami")
    next(n for n in g["nodes"] if n["type"] == "find")["params"]["count"] = 7
    saved = store.save(db, g)
    assert saved["kind"] == "recipe" and recipes.get("miami", db=db)["count"] == 7
    assert not store.is_native(db, "miami")
    # Add a node: it becomes a full workflow, and the recipe row goes (no double runs).
    db.save_campaign("miami", {**db.get_campaign("miami")["data"],
                               "last_run_at": "2026-10-07T09:00:00"})
    g = store.get(db, "miami")
    g["nodes"].append({"id": "tg", "type": "tag", "params": {"tags": "miami"}})
    g["edges"].append({"from": "send", "from_port": "out", "to": "tg"})
    saved = store.save(db, g)
    assert saved["kind"] == "workflow" and recipes.get("miami", db=db) is None
    assert store.get_state(db, "miami")["fired:trigger"] == "2026-10-07T09:00:00"
    assert [x["name"] for x in store.list_all(db)].count("miami") == 1


def test_migration_v4_creates_tables_and_old_recipes_appear(tmp_path, monkeypatch):
    import sqlite3

    from openleads import schema
    from openleads.db import DB
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    path = tmp_path / "old.db"
    d = DB(path=str(path))
    d.save_campaign("legacy", {"query": "roofers in Ohio", "send_hour": 8, "enabled": True})
    d.close()
    conn = sqlite3.connect(str(path))
    conn.executescript("DROP TABLE workflows; DROP TABLE workflow_runs; DROP TABLE workflow_waits;"
                       "PRAGMA user_version = 3;")
    conn.close()
    d = DB(path=str(path))
    try:
        assert d.schema_version == schema.latest() >= 4
        g = store.get(d, "legacy")
        assert g["kind"] == "recipe" and g["nodes"][0]["params"]["schedule"] == "daily 08:00"
        assert store.list_all(d)[0]["name"] == "legacy"
    finally:
        d.close()


# --------------------------------------------------------------------------- #
# Store: import/export, flags                                                  #
# --------------------------------------------------------------------------- #
def test_export_import_round_trip_arrives_paused(db):
    g = templates.instantiate("founder-outreach", name="fo")
    g.update(active=True, live=True)
    store.save(db, g)
    doc = store.export(db, "fo")
    assert doc["openleads_workflow"] == 1 and "state" not in doc
    with pytest.raises(ValueError):
        store.import_doc(db, doc)                       # name taken
    got = store.import_doc(db, json.loads(json.dumps(doc)), name="fo2")
    assert got["active"] is False and got["live"] is False and len(got["nodes"]) == len(g["nodes"])
    assert store.import_doc(db, doc, replace=True)["name"] == "fo"
    with pytest.raises(ValueError):
        store.import_doc(db, {"nodes": "nope"})


def test_save_rejects_invalid_graphs(db):
    with pytest.raises(graph.GraphError) as e:
        store.save(db, G([N("t", "trigger.manual"), N("s", "send")], [E("t", "s")]))
    assert any("needs drafts" in p["message"] for p in e.value.problems)


# --------------------------------------------------------------------------- #
# Runner (the drip cycle)                                                      #
# --------------------------------------------------------------------------- #
def test_tick_fires_due_schedules_once(db):
    fk = Fakes([L("a@a.example")])
    g = G([N("t", "trigger.schedule", schedule="daily 09:00"), N("f", "find", query="x"),
           N("tg", "tag", tags="ticked")], [E("t", "f"), E("f", "tg")], name="daily", active=True)
    store.save(db, g)
    store.update_state(db, "daily", {"activated_at": "2026-10-06T12:00:00"})
    store.save(db, G([N("t", "trigger.schedule", schedule="daily 09:00"),
                      N("f", "find", query="y")], [E("t", "f")], name="paused"))
    early = datetime(2026, 10, 7, 8, 30)
    assert runner.tick(db, dry_run=False, now=early, services=fk.services())["run"] == 0
    out = runner.tick(db, dry_run=False, now=WED_10, services=fk.services())
    assert out["run"] == 1 and len(fk.calls["build"]) == 1
    assert runner.tick(db, dry_run=False, now=WED_10 + timedelta(minutes=15),
                       services=fk.services())["run"] == 0
    from openleads.workspace import tags
    assert tags.for_contact(db, "a@a.example") == ["ticked"]


def test_dry_tick_test_runs_and_does_not_mark_fired(db):
    fk = Fakes([L("a@a.example")])
    store.save(db, G([N("t", "trigger.schedule", schedule="daily 09:00"),
                      N("f", "find", query="x"), N("tg", "tag", tags="x")],
                     [E("t", "f"), E("f", "tg")], name="d", active=True))
    store.update_state(db, "d", {"activated_at": "2026-10-06T12:00:00"})
    assert runner.tick(db, dry_run=True, now=WED_10, services=fk.services())["run"] == 1
    assert runner.tick(db, dry_run=True, now=WED_10, services=fk.services())["run"] == 1
    assert db.scalar("SELECT COUNT(*) FROM contact_tags", default=0) == 0


def test_due_triggers_is_pure():
    g = graph.normalize(G([N("s", "trigger.schedule", schedule="mon,wed 09:30"),
                           N("r", "trigger.reply"), N("m", "trigger.manual")], []))
    state = {"activated_at": "2026-10-01T00:00:00"}
    assert runner.due_triggers(g, state, WED_10) == ["s", "r"]
    state["fired:s"] = "2026-10-07T09:30:00"
    assert runner.due_triggers(g, state, WED_10) == ["r"]


def test_scheduler_tick_includes_workflows(db, monkeypatch):
    from openleads.automate import scheduler
    called = {}

    def fake_tick(db, cache=None, dry_run=True, now=None, on_progress=None):
        called["dry"] = dry_run
        return {"run": 2, "failed": 0, "sent": 0, "waits": {"due": 0}}
    monkeypatch.setattr(runner, "tick", fake_tick)
    summary = scheduler.tick(db=db, dry_run=True, now=WED_10)
    assert called == {"dry": True} and summary["workflows_run"] == 2


# --- 5.3: Send can wait for approval ------------------------------------------ #
def _send_graph(**send_params):
    return G([N("t", "trigger.manual"), N("f", "find", query="dentists"), N("w", "write"),
              N("s", "send", **send_params)], [E("t", "f"), E("f", "w"), E("w", "s")])


def test_scheduled_live_workflow_queues(db, set_setting):
    from openleads.workspace import drafts
    set_setting("approve_first_emails", "on")
    fk = Fakes([L("a@a.example"), L("b@a.example")])
    res = run(_send_graph(), db, fk, mode=RUN, live=True, trigger_label="schedule")
    assert fk.calls["send"] == [] and drafts.count_waiting(db) == 2
    [d, _] = drafts.waiting(db)
    assert d["source"] == "workflow" and d["ref"]["workflow"] == "wf" and d["ref"]["step"] == 1
    assert "waiting for approval" in " ".join(by_node(res)["s"]["notes"])


def test_manual_live_workflow_sends(db, set_setting):
    set_setting("approve_first_emails", "on")
    fk = Fakes([L("a@a.example")])
    run(_send_graph(), db, fk, mode=RUN, live=True, trigger_label="dashboard")
    assert fk.calls["send"][-1]["dry_run"] is False


def test_approve_always_queues_even_when_not_live(db):
    from openleads.workspace import drafts
    fk = Fakes([L("a@a.example")])
    run(_send_graph(approve="always"), db, fk, mode=RUN, live=False)
    assert fk.calls["send"] == [] and drafts.count_waiting(db) == 1


def test_approve_never_sends_on_schedule(db, set_setting):
    set_setting("approve_first_emails", "on")
    fk = Fakes([L("a@a.example")])
    run(_send_graph(approve="never"), db, fk, mode=RUN, live=True, trigger_label="schedule")
    assert fk.calls["send"][-1]["dry_run"] is False


def test_test_mode_never_queues(db, set_setting):
    from openleads.workspace import drafts
    set_setting("approve_first_emails", "on")
    fk = Fakes([L("a@a.example")])
    run(_send_graph(approve="always"), db, fk, mode=TEST, trigger_label="schedule")
    assert drafts.count_waiting(db) == 0


def test_steps_after_a_queued_send_run_once_approved(db, monkeypatch):
    """Spec 6.3: the workflow step after Send waits on the draft, not dropped."""
    from openleads.workspace import drafts, tags
    monkeypatch.setattr("openleads.outreach.sender.send_drafts",
                        lambda ds, **k: [SendResult(d.email, "sent", message_id="<m>") for d in ds])
    g = G([N("t", "trigger.manual"), N("f", "find", query="dentists"), N("w", "write"),
           N("s", "send", approve="always"), N("tg", "tag", tags="emailed")],
          [E("t", "f"), E("f", "w"), E("w", "s"), E("s", "tg")], active=True)
    store.save(db, g)
    fk = Fakes([L("a@a.example"), L("b@a.example")])
    run(store.get(db, "wf"), db, fk, mode=RUN, live=False)
    assert drafts.count_waiting(db) == 2 and tags.for_contact(db, "a@a.example") == []
    a, b = drafts.waiting(db)
    assert runner.resume_waits(db, WED_10 + timedelta(minutes=1), services=fk.services())["due"] == 0
    t = (WED_10 + timedelta(minutes=1)).timestamp()
    assert drafts.approve(db, a["id"], now=t)["status"] == "sent"
    drafts.skip(db, b["id"], now=t)
    res = runner.resume_waits(db, WED_10 + timedelta(minutes=2), services=fk.services())
    assert res["resumed"] == 1
    assert tags.for_contact(db, a["email"]) == ["emailed"] and tags.for_contact(db, b["email"]) == []


def test_queued_send_with_nothing_after_it_parks_nothing(db):
    fk = Fakes([L("a@a.example")])
    store.save(db, G(_send_graph(approve="always")["nodes"], _send_graph()["edges"], active=True))
    run(store.get(db, "wf"), db, fk, mode=RUN, live=False)
    assert db.scalar("SELECT COUNT(*) FROM workflow_waits", default=0) == 0
