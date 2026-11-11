"""`openleads today`: the briefing in a terminal, with one-key actions on a TTY."""
import io
import json
import time

import pytest

from openleads import cli, cli_today
from openleads.db import DB
from openleads.models import Draft, SendResult
from openleads.outreach import replies
from openleads.workspace import drafts, tasks

REF = {"campaign": "ask", "step": 1}


@pytest.fixture(autouse=True)
def home(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    return tmp_path


@pytest.fixture
def seeded_db():
    db = DB()
    for e in ("ada@globex.example", "bo@initech.example", "cy@hooli.example"):
        db.upsert_lead({"email": e, "first_name": e.split("@")[0].title(), "organization": "Co",
                        "tier": "safe"})
    now = time.time()
    replies.record(db, "ada@globex.example", "Re: hi", "Can you send pricing?", "<m@x>", now - 3600)
    d1 = drafts.enqueue(db, Draft(email="bo@initech.example", subject="quick one", body="Hi Bo"),
                        "ask", REF)
    drafts.enqueue(db, Draft(email="cy@hooli.example", subject="quick one", body="Hi Cy"), "ask", REF)
    t = tasks.create(db, "Call Bo", contact="bo@initech.example", due=now - 2 * 86400)
    db.close()
    return {"draft": d1["id"], "task": t["id"]}


@pytest.fixture
def fake_send(monkeypatch):
    class Rec:
        calls = []

    def send(drafts_, dry_run=True, db=None, campaign="", step=1, **kw):
        Rec.calls.append(drafts_[0])
        return [SendResult(d.email, "sent", message_id="<m>") for d in drafts_]
    monkeypatch.setattr("openleads.outreach.sender.send_drafts", send)
    return Rec


@pytest.fixture
def tty(monkeypatch):
    monkeypatch.setattr(cli_today, "_interactive", lambda: True)


@pytest.fixture
def keys(monkeypatch):
    """Feed single key presses; the list runs out into 'q'."""
    pressed = []

    def feed(*seq):
        pressed.extend(seq)
    it = iter(pressed)
    monkeypatch.setattr(cli_today, "_read_key", lambda prompt: next(it, "q"))
    return feed


def test_today_json_roundtrip(capsys, seeded_db):
    assert cli.main(["today", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert set(data) >= {"replies", "drafts", "tasks", "new_leads", "heads_up", "counts"}
    assert data["counts"]["drafts"] == 2 and data["counts"]["replies"] == 1


def test_today_non_tty_never_reads_stdin(capsys, seeded_db, monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO(""))   # not a TTY
    monkeypatch.setattr("builtins.input",
                        lambda *a: (_ for _ in ()).throw(AssertionError("read stdin")))
    monkeypatch.setattr(cli_today, "_read_key",
                        lambda p: (_ for _ in ()).throw(AssertionError("read a key")))
    assert cli.main(["today"]) == 0
    out = capsys.readouterr().out
    assert "emails to approve" in out
    assert out.index("Replies") < out.index("Emails to approve") < out.index("Tasks")
    assert out.rstrip().endswith("1 reply, 2 emails to approve, 1 task. Nothing else needs you.")


def test_today_no_input_flag_never_reads_keys(capsys, seeded_db, tty, monkeypatch):
    monkeypatch.setattr(cli_today, "_read_key",
                        lambda p: (_ for _ in ()).throw(AssertionError("read a key")))
    assert cli.main(["today", "--no-input"]) == 0


def test_today_empty_workspace(capsys):
    assert cli.main(["today", "--no-input"]) == 0
    out = capsys.readouterr().out
    assert "Nothing needs you right now." in out and "Mailbox not connected" in out


def test_today_marks_seen(capsys, seeded_db):
    cli.main(["today", "--no-input"])
    db = DB()
    try:
        assert db.kv_get("today.last_seen", None) is not None
    finally:
        db.close()


def test_today_tty_approve_key_sends(capsys, seeded_db, fake_send, tty, keys):
    keys("n", "a", "q")          # skip past the reply, approve the first draft, quit
    assert cli.main(["today"]) == 0
    assert len(fake_send.calls) == 1 and fake_send.calls[0].email == "bo@initech.example"
    db = DB()
    try:
        assert drafts.get(db, seeded_db["draft"])["status"] == "sent"
        assert drafts.count_waiting(db) == 1
    finally:
        db.close()


def test_today_tty_skip_draft(capsys, seeded_db, fake_send, tty, keys):
    keys("n", "s", "q")
    cli.main(["today"])
    db = DB()
    try:
        assert drafts.get(db, seeded_db["draft"])["status"] == "skipped" and fake_send.calls == []
    finally:
        db.close()


def test_today_tty_edit_then_approve(capsys, seeded_db, fake_send, tty, keys, monkeypatch):
    def fake_editor(cmd):
        with open(cmd[-1], "w", encoding="utf-8") as f:
            f.write("Subject: better subject\n\nBetter body.\n")
        return 0
    monkeypatch.setenv("EDITOR", "vi")
    monkeypatch.setattr(cli_today.subprocess, "call", fake_editor)
    keys("n", "e", "q")
    cli.main(["today"])
    [sent] = fake_send.calls
    assert sent.subject == "better subject" and sent.body == "Better body."


def test_today_tty_reply_done_and_task_snooze(capsys, seeded_db, tty, keys):
    keys("d", "n", "n", "z")     # reply done, pass both drafts, snooze the task
    cli.main(["today"])
    db = DB()
    try:
        assert replies.waiting(db) == []
        due = tasks.get(db, seeded_db["task"])["due"]
        assert due > time.time() and tasks.list_tasks(db, bucket="overdue") == []
    finally:
        db.close()


def test_today_tty_reply_snooze_hides_until_tomorrow(capsys, seeded_db, tty, keys):
    keys("z", "q")
    cli.main(["today"])
    db = DB()
    try:
        assert replies.waiting(db) == []
        assert replies.waiting(db, now=time.time() + 2 * 86400) != []
    finally:
        db.close()


def test_today_tty_task_done(capsys, seeded_db, tty, keys):
    keys("n", "n", "n", "d")
    cli.main(["today"])
    db = DB()
    try:
        assert tasks.get(db, seeded_db["task"])["status"] == "done"
    finally:
        db.close()


def test_parse_edited_text():
    assert cli_today._parse_edited("Subject: Hi there\n\nLine one\nLine two\n") == (
        "Hi there", "Line one\nLine two")
    assert cli_today._parse_edited("no subject header\n\nbody") is None
