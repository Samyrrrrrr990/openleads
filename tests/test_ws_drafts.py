"""The approval queue: first emails that wait in Today until someone says yes."""
import pytest

from openleads.db import DB
from openleads.models import Draft, SendResult
from openleads.workspace import drafts
from openleads.workspace import sequences as S

EMAIL = {"type": "auto_email", "delay_days": 0, "subject": "hi {{first_name}}",
         "body": "Hello {{first_name|there}}, about {{company}}."}
REF = {"campaign": "ask", "step": 1}


def _draft(email="a@x.co", subject="s", body="b"):
    return Draft(email=email, subject=subject, body=body)


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    for e in ("a@x.co", "b@x.co"):
        d.upsert_lead({"email": e, "first_name": e[0].upper(), "organization": "X", "tier": "safe"})
    yield d
    d.close()


@pytest.fixture
def fake_send(monkeypatch):
    class Rec:
        calls = []

    def send(drafts_, dry_run=True, db=None, campaign="", step=1, on_progress=None, **kw):
        Rec.calls.append((drafts_[0], dry_run, campaign, step))
        out = []
        for d in drafts_:
            if not dry_run and db is not None:
                db.record_touch(d.email, "sent", subject=d.subject, campaign=campaign, step=step)
                db.set_status(d.email, "sent")
            out.append(SendResult(d.email, "sent" if not dry_run else "preview", message_id="<m>"))
        return out
    Rec.calls = []
    monkeypatch.setattr("openleads.outreach.sender.send_drafts", send)
    return Rec


def test_fresh_workspace_defaults_approval_on(tmp_path):
    d = DB(tmp_path / "fresh.db")
    try:
        assert drafts.approval_on(d) is True
    finally:
        d.close()


def test_existing_workspace_defaults_approval_off(tmp_path):
    path = tmp_path / "old.db"
    d = DB(path)
    d.record_touch("a@x.co", "sent", subject="s", campaign="c", step=1)
    d.execute("DELETE FROM kv WHERE k='approval.default'")
    d.execute("PRAGMA user_version = 4")        # as if this database predates 5.3
    d.close()
    d = DB(path)
    try:
        assert drafts.approval_on(d) is False
    finally:
        d.close()


def test_setting_overrides_default(tmp_path, set_setting):
    d = DB(tmp_path / "fresh.db")
    try:
        set_setting("approve_first_emails", "off")
        assert drafts.approval_on(d) is False
        set_setting("approve_first_emails", "on")
        assert drafts.approval_on(d) is True
    finally:
        d.close()


def test_enqueue_and_waiting_oldest_first(db):
    a = drafts.enqueue(db, _draft("a@x.co", "s1"), "ask", REF)
    b = drafts.enqueue(db, _draft("b@x.co", "s2"), "ask", REF)
    assert [d["id"] for d in drafts.waiting(db)] == [a["id"], b["id"]]
    assert drafts.count_waiting(db) == 2
    assert a["status"] == "waiting" and a["ref"] == REF and a["subject"] == "s1"


def test_approve_sends_once(db, fake_send):
    d = drafts.enqueue(db, _draft(), "ask", REF)
    assert drafts.approve(db, d["id"])["status"] == "sent"
    again = drafts.approve(db, d["id"])
    assert again["status"] == "error" and "already" in again["detail"]
    assert len(fake_send.calls) == 1
    assert fake_send.calls[0][1] is False and fake_send.calls[0][2:] == ("ask", 1)
    assert drafts.count_waiting(db) == 0 and drafts.get(db, d["id"])["status"] == "sent"


def test_approve_unknown_id_is_an_error(db, fake_send):
    assert drafts.approve(db, 999)["status"] == "error" and fake_send.calls == []


def test_approve_with_edits_sends_edited_text(db, fake_send):
    d = drafts.enqueue(db, _draft(), "ask", REF)
    drafts.approve(db, d["id"], subject="new s", body="new b")
    sent = fake_send.calls[0][0]
    assert sent.subject == "new s" and sent.body == "new b"
    assert drafts.get(db, d["id"])["subject"] == "new s"


@pytest.mark.parametrize("status", ["replied", "bounced"])
def test_approve_skips_contact_who_moved_on(db, fake_send, status):
    d = drafts.enqueue(db, _draft(), "ask", REF)
    db.set_status("a@x.co", status)
    r = drafts.approve(db, d["id"])
    assert r["status"] == "skipped" and status in r["detail"] and fake_send.calls == []


def test_approve_skips_do_not_contact(db, fake_send):
    d = drafts.enqueue(db, _draft(), "ask", REF)
    db.execute("UPDATE leads SET stage='do_not_contact' WHERE email='a@x.co'")
    assert drafts.approve(db, d["id"])["status"] == "skipped" and fake_send.calls == []


def test_skip(db, fake_send):
    d = drafts.enqueue(db, _draft(), "ask", REF)
    assert drafts.skip(db, d["id"])["status"] == "skipped"
    assert drafts.approve(db, d["id"])["status"] == "error" and fake_send.calls == []


def _held_enrollment(db):
    seq = S.create(db, "Q4", [EMAIL, {**EMAIL, "delay_days": 3}])
    S.set_status(db, seq["id"], "active")
    S.enroll(db, seq["id"], ["a@x.co", "b@x.co"])
    rows = db.query("SELECT * FROM enrollments ORDER BY id")
    for r in rows:   # what Task 8's queueing does: keep the enrollment, take it off the schedule
        db.execute("UPDATE enrollments SET next_due=NULL WHERE id=?", (r["id"],))
    return seq, rows


def test_sequence_draft_approve_advances(db, fake_send):
    seq, (a, _) = _held_enrollment(db)
    d = drafts.enqueue(db, _draft("a@x.co"), "sequence",
                       {"campaign": f"seq:{seq['id']}", "step": 1, "enrollment_id": a["id"],
                        "sequence_id": seq["id"]})
    assert drafts.approve(db, d["id"])["status"] == "sent"
    row = db.query_one("SELECT * FROM enrollments WHERE id=?", (a["id"],))
    assert row["status"] == "active" and row["step"] == 1 and row["next_due"]
    assert row["thread_subject"] == "s"


def test_sequence_draft_skip_removes_from_sequence(db, fake_send):
    seq, (_, b) = _held_enrollment(db)
    d = drafts.enqueue(db, _draft("b@x.co"), "sequence",
                       {"campaign": f"seq:{seq['id']}", "step": 1, "enrollment_id": b["id"],
                        "sequence_id": seq["id"]})
    drafts.skip(db, d["id"])
    assert db.query_one("SELECT status FROM enrollments WHERE id=?", (b["id"],))["status"] == "removed"


def test_sequence_draft_for_contact_who_left_is_skipped(db, fake_send):
    seq, (a, _) = _held_enrollment(db)
    d = drafts.enqueue(db, _draft("a@x.co"), "sequence",
                       {"campaign": f"seq:{seq['id']}", "step": 1, "enrollment_id": a["id"],
                        "sequence_id": seq["id"]})
    db.execute("UPDATE enrollments SET status='unsubscribed' WHERE id=?", (a["id"],))
    r = drafts.approve(db, d["id"])
    assert r["status"] == "skipped" and "sequence" in r["detail"] and fake_send.calls == []


@pytest.mark.parametrize("result", [SendResult("a@x.co", "skipped", detail="daily warmup cap reached"),
                                    SendResult("a@x.co", "error", error="SMTP timeout")])
def test_transient_failure_keeps_draft_waiting(db, monkeypatch, result):
    monkeypatch.setattr("openleads.outreach.sender.send_drafts", lambda *a, **k: [result])
    d = drafts.enqueue(db, _draft(), "ask", REF)
    r = drafts.approve(db, d["id"])
    assert r["status"] == "error" and r["detail"]
    assert drafts.get(db, d["id"])["status"] == "waiting" and drafts.count_waiting(db) == 1
