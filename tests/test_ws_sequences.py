"""Sequences: definitions, enrollment rules, the runner, tasks and stats."""
import time
from datetime import datetime

import pytest

from openleads.db import DB
from openleads.models import SendResult
from openleads.workspace import people, tasks
from openleads.workspace import sequences as S

EMAIL = {"type": "auto_email", "delay_days": 0, "subject": "hi {{first_name}}",
         "body": "Hello {{first_name|there}}, about {{company}}."}


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    for e, tier in (("jane@acme.example", "safe"), ("john@acme.example", "safe"),
                    ("risky@beta.example", "risky"), ("gone@beta.example", "safe")):
        d.upsert_lead({"email": e, "first_name": e.split("@")[0].capitalize(),
                       "organization": "Acme", "tier": tier})
    d.suppress("gone@beta.example", "unsubscribed")
    yield d
    d.close()


@pytest.fixture
def sent(monkeypatch):
    """Replace the real sender: dry-run → preview, live → 'sent' (records touches)."""
    log = []

    def fake_send(drafts, dry_run=True, db=None, campaign="", step=1, on_progress=None, **kw):
        out = []
        for d in drafts:
            status = "preview" if dry_run else "sent"
            if not dry_run and db.is_suppressed(d.email):
                r = SendResult(d.email, "skipped", detail="suppressed: x")
            else:
                r = SendResult(d.email, status, message_id="<m>")
                if not dry_run:
                    db.record_touch(d.email, "sent", subject=d.subject, campaign=campaign, step=step)
                    db.set_status(d.email, "sent")
            log.append((d.email, d.subject, campaign, step, status))
            out.append(r)
        return out
    monkeypatch.setattr("openleads.outreach.sender.send_drafts", fake_send)
    return log


def test_normalize_steps_validation():
    steps = S.normalize_steps([EMAIL, {"type": "call", "note": "Call them"}])
    assert steps[0]["variants"] == [{"subject": "hi {{first_name}}",
                                     "body": "Hello {{first_name|there}}, about {{company}}."}]
    assert steps[1]["delay_days"] == 3 and steps[1]["type"] == "call"
    assert steps[0]["thread"] is False and len(steps[0]["id"]) == 8
    with pytest.raises(ValueError):
        S.normalize_steps([{"type": "fax"}])
    with pytest.raises(ValueError):
        S.normalize_steps([{"type": "auto_email", "subject": "", "body": ""}])
    with pytest.raises(ValueError):
        S.normalize_steps([{"type": "auto_email", "subject": "x", "body": "{{shoe}}"}])
    assert S.normalize_steps([{"type": "auto_email", "ai": True}])[0]["ai"] is True


def test_crud_and_status(db):
    s = S.create(db, "Q4 outbound", [EMAIL], {"daily_limit": "25", "junk": 1})
    assert s["status"] == "paused" and s["settings"]["daily_limit"] == 25
    assert "junk" not in s["settings"]
    with pytest.raises(ValueError):
        S.create(db, "q4 OUTBOUND")
    empty = S.create(db, "Empty")
    with pytest.raises(ValueError):
        S.set_status(db, empty["id"], "active")
    assert S.set_status(db, s["id"], "active")["status"] == "active"
    u = S.update(db, s["id"], name="Q4", settings={"allow_risky": True})
    assert u["name"] == "Q4" and u["settings"]["allow_risky"] and u["settings"]["daily_limit"] == 25
    assert S.get(db, "Q4")["id"] == s["id"]
    assert len(S.list_sequences(db)) == 2
    assert S.delete(db, empty["id"]) and not S.delete(db, empty["id"])


def test_enroll_rules(db):
    s = S.create(db, "A", [EMAIL])
    other = S.create(db, "B", [EMAIL])
    S.enroll(db, other["id"], ["john@acme.example"])
    res = S.enroll(db, s["id"], ["Jane@acme.example", "risky@beta.example", "gone@beta.example",
                                 "nobody@x.example", "john@acme.example"])
    assert res["enrolled"] == ["jane@acme.example"]
    reasons = {r["email"]: r["reason"] for r in res["skipped"]}
    assert reasons["risky@beta.example"].startswith("email is risky")
    assert reasons["gone@beta.example"].startswith("suppressed")
    assert reasons["nobody@x.example"] == "not in your CRM"
    assert reasons["john@acme.example"] == "active in another sequence"
    again = S.enroll(db, s["id"], ["jane@acme.example"])
    assert again["skipped"][0]["reason"] == "already in this sequence"
    people.update(db, "jane@acme.example", {"stage": "do_not_contact"})
    assert people.search(db, {"sequence": s["id"]})["total"] == 1


def test_dry_run_changes_nothing(db, sent):
    s = S.create(db, "A", [EMAIL, {"type": "call"}], status="active")
    S.enroll(db, s["id"], ["jane@acme.example"])
    out = S.process(db, dry_run=True)
    assert out["previewed"] == 1 and out["sent"] == 0
    assert sent[0][1] == "hi Jane" and sent[0][2] == f"seq:{s['id']}"
    enr = S.enrollments(db, s["id"])[0]
    assert enr["step"] == 0 and enr["status"] == "active"


def test_paused_sequence_previews_but_never_sends(db, sent):
    s = S.create(db, "A", [EMAIL])                       # created paused
    S.enroll(db, s["id"], ["jane@acme.example"])
    assert S.process(db, dry_run=True)["due"] == 0       # global tick skips paused
    assert S.process(db, dry_run=True, seq_id=s["id"])["previewed"] == 1
    assert S.process(db, dry_run=False, seq_id=s["id"])["due"] == 0
    assert not [x for x in sent if x[4] == "sent"]


def test_live_run_sends_threads_and_waits_on_tasks(db, sent):
    s = S.create(db, "A", [EMAIL,
                           {"type": "auto_email", "delay_days": 0, "subject": "ignored",
                            "body": "Bump, {{first_name}}"},
                           {"type": "call", "delay_days": 0, "note": "Call {{first_name}}"}],
                 settings={"skip_weekends": False}, status="active")
    S.enroll(db, s["id"], ["jane@acme.example"])
    now = time.time()
    out = S.process(db, now=now, dry_run=False)
    assert out["sent"] == 1
    assert people.get(db, "jane@acme.example")["stage"] == "approaching"
    out = S.process(db, now=now + 1, dry_run=False)          # step 2: threaded reply
    assert out["sent"] == 1 and sent[-1][1] == "re: hi Jane" and sent[-1][3] == 2
    out = S.process(db, now=now + 2, dry_run=False)          # step 3: a call task
    assert out["tasks"] == 1
    task = tasks.list_tasks(db, "open")[0]
    assert task["title"] == "Call Jane" and task["kind"] == "call"
    assert task["sequence_name"] == "A"
    assert S.process(db, now=now + 3, dry_run=False)["due"] == 0   # waiting on the task
    tasks.complete(db, task["id"])
    enr = S.enrollments(db, s["id"])[0]
    assert enr["status"] == "finished"
    assert people.get(db, "jane@acme.example")["stage"] == "unresponsive"
    st = S.stats(db, s["id"])
    assert st["summary"]["sent"] == 2 and st["summary"]["finished"] == 1
    assert [x["sent"] for x in st["steps"]] == [1, 1, 0] and st["steps"][2]["tasks_done"] == 1


def test_reply_stops_the_sequence(db, sent):
    s = S.create(db, "A", [EMAIL, dict(EMAIL, delay_days=0)],
                 settings={"skip_weekends": False}, status="active")
    S.enroll(db, s["id"], ["jane@acme.example"])
    S.process(db, dry_run=False)
    db.set_status("jane@acme.example", "replied")
    assert S.process(db, dry_run=False)["due"] == 0
    st = S.stats(db, s["id"])["summary"]
    assert st["replied"] == 1 and st["reply_rate"] == 100.0


def test_window_daily_limit_and_suppression(db, sent):
    s = S.create(db, "A", [EMAIL], settings={"daily_limit": 1, "skip_weekends": False},
                 status="active")
    S.enroll(db, s["id"], ["jane@acme.example", "john@acme.example"])
    assert S.process(db, dry_run=False, send_window_ok=False)["waiting_window"] == 2
    out = S.process(db, dry_run=False)
    assert out["sent"] == 1 and out["capped"] == 1
    db.suppress("john@acme.example", "unsubscribed")
    S.update(db, s["id"], settings={"daily_limit": 0})
    out = S.process(db, dry_run=False)
    assert out["skipped"] == 1
    assert {e["email"]: e["status"] for e in S.enrollments(db, s["id"])}["john@acme.example"] \
        == "unsubscribed"


def test_variants_are_stable_and_counted(db, sent):
    step = {"type": "auto_email", "variants": [{"subject": "A {{first_name}}", "body": "a"},
                                               {"subject": "B {{first_name}}", "body": "b"}]}
    s = S.create(db, "AB", [step], settings={"skip_weekends": False}, status="active")
    norm = S.get(db, s["id"])["steps"][0]
    assert S.pick_variant(norm, "jane@acme.example") == S.pick_variant(norm, "jane@acme.example")
    S.enroll(db, s["id"], ["jane@acme.example", "john@acme.example"])
    S.process(db, dry_run=False)
    variants = S.stats(db, s["id"])["steps"][0]["variants"]
    assert sum(v["sent"] for v in variants) == 2 and len(variants) == 2


def test_unenroll_pause_and_due_after(db):
    s = S.create(db, "A", [{"type": "call"}], status="active")
    S.enroll(db, s["id"], ["jane@acme.example", "john@acme.example"])
    assert S.set_enrollment_status(db, s["id"], ["jane@acme.example"], "paused") == 1
    assert S.unenroll(db, s["id"], ["john@acme.example"]) == 1
    assert {e["email"]: e["status"] for e in S.enrollments(db, s["id"])} == {
        "jane@acme.example": "paused", "john@acme.example": "removed"}
    fri = datetime(2026, 10, 16, 10, 0).timestamp()
    assert datetime.fromtimestamp(S.due_after(fri, 1)).weekday() == 0          # → Monday
    assert datetime.fromtimestamp(S.due_after(fri, 1, False)).weekday() == 5   # Saturday


def test_starter_steps_are_valid():
    steps = S.starter_steps()
    assert [s["type"] for s in steps] == ["auto_email", "auto_email", "call", "linkedin",
                                          "auto_email"]


def test_scheduler_tick_runs_sequences(db, sent, monkeypatch):
    from openleads.automate import scheduler
    monkeypatch.setattr("openleads.automate.sendtime.in_send_window", lambda now=None: True)
    s = S.create(db, "A", [EMAIL, {"type": "task", "delay_days": 0}],
                 settings={"skip_weekends": False}, status="active")
    S.enroll(db, s["id"], ["jane@acme.example"])
    dry = scheduler.tick(db=db, dry_run=True)
    assert dry["sequences"]["previewed"] == 1 and dry["sequence_sent"] == 0
    live = scheduler.tick(db=db, dry_run=False)
    assert live["sequence_sent"] == 1
    live = scheduler.tick(db=db, dry_run=False)
    assert live["sequence_tasks"] == 1


def test_clone_copies_steps_and_settings_not_people(db):
    s = S.create(db, "Q4", [EMAIL, {"type": "call"}], {"daily_limit": 9}, status="active")
    S.enroll(db, s["id"], ["jane@acme.example"])
    c = S.clone(db, s["id"])
    assert c["name"] == "Q4 (copy)" and c["status"] == "paused"
    assert [st["type"] for st in c["steps"]] == ["auto_email", "call"]
    assert c["settings"]["daily_limit"] == 9 and S.enrollments(db, c["id"]) == []
    assert S.clone(db, s["id"])["name"] == "Q4 (copy) (2)"
    assert S.clone(db, "Q4", "Q1 2027")["name"] == "Q1 2027"
    with pytest.raises(ValueError):
        S.clone(db, 999)
