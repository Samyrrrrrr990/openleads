"""The opt-in pre-send hook: a command or URL that can hold an email."""
import json
import sys

import pytest

from openleads.db import DB
from openleads.models import Draft
from openleads.outreach import presend, providers, sender
from openleads.workspace import activity


def _draft(email="a@x.co"):
    return Draft(email=email, subject="quick question", body="Hi Ada, short note.")


def _hook(tmp_path, name, code):
    p = tmp_path / name
    p.write_text(code)
    return f"{sys.executable} {p}"


def test_no_hook_sends():
    assert presend.check(_draft()) == ("send", "")


def test_command_hook_holds(set_setting, tmp_path):
    set_setting("presend_hook", _hook(tmp_path, "h.py",
                "import json,sys; d=json.load(sys.stdin); "
                "print(json.dumps({'action':'hold','reason':'consent needed for '+d['to']}))"))
    assert presend.check(_draft()) == ("hold", "consent needed for a@x.co")


def test_command_hook_receives_the_email(set_setting, tmp_path):
    out = tmp_path / "seen.json"
    set_setting("presend_hook", _hook(tmp_path, "h.py",
                f"import json,sys; d=json.load(sys.stdin); open({str(out)!r},'w').write(json.dumps(d)); "
                "print(json.dumps({'action':'send'}))"))
    assert presend.check(_draft(), lead={"organization": "Acme"}, first=False) == ("send", "")
    seen = json.loads(out.read_text())
    assert seen["to"] == "a@x.co" and seen["subject"] == "quick question"
    assert seen["first_email"] is False and seen["lead"]["organization"] == "Acme"


def test_hanging_hook_times_out_to_on_error(set_setting, tmp_path):
    set_setting("presend_hook", _hook(tmp_path, "slow.py", "import time; time.sleep(5)"))
    set_setting("presend_hook_timeout", 1)
    action, reason = presend.check(_draft())
    assert action == "hold" and "timed out" in reason
    set_setting("presend_hook_on_error", "send")
    assert presend.check(_draft())[0] == "send"


def test_garbage_answer_is_an_error(set_setting, tmp_path):
    set_setting("presend_hook", _hook(tmp_path, "bad.py", 'print("yes please")'))
    action, reason = presend.check(_draft())
    assert action == "hold" and reason.startswith("pre-send hook failed")


def test_unknown_action_is_an_error(set_setting, tmp_path):
    set_setting("presend_hook", _hook(tmp_path, "odd.py", 'print(\'{"action": "maybe"}\')'))
    assert presend.check(_draft())[0] == "hold"


def test_failing_command_is_an_error(set_setting, tmp_path):
    set_setting("presend_hook", _hook(tmp_path, "die.py", "import sys; sys.exit(3)"))
    action, reason = presend.check(_draft())
    assert action == "hold" and "exit" in reason


def test_plain_http_to_remote_host_is_refused(set_setting):
    set_setting("presend_hook", "http://example.com/check")
    action, reason = presend.check(_draft())
    assert action == "hold" and "https" in reason


def test_url_hook_posts_json(set_setting, monkeypatch):
    seen = {}

    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"action": "hold", "reason": "blocked"}'

    def fake_urlopen(req, timeout=None):
        seen["url"], seen["body"], seen["timeout"] = req.full_url, json.loads(req.data), timeout
        return Resp()
    monkeypatch.setattr(presend.urllib.request, "urlopen", fake_urlopen)
    set_setting("presend_hook", "https://check.example/v1")
    assert presend.check(_draft()) == ("hold", "blocked")
    assert seen["url"] == "https://check.example/v1" and seen["body"]["to"] == "a@x.co"
    assert seen["timeout"] == 10


@pytest.fixture
def smtp(monkeypatch, set_setting):
    sent = []

    class FakeSMTP:
        def send_message(self, msg):
            sent.append(msg["To"])

        def quit(self):
            pass
    monkeypatch.setattr(providers, "smtp_config", lambda overrides=None: {"user": "me@x.co",
                                                                         "provider": "custom"})
    monkeypatch.setattr(providers, "connect_smtp", lambda cfg: FakeSMTP())
    set_setting("save_to_sent", "never")
    return sent


def test_send_drafts_reports_held_and_logs_activity(tmp_path, smtp, set_setting):
    set_setting("presend_hook", _hook(tmp_path, "h.py",
                "print('{\"action\": \"hold\", \"reason\": \"consent needed\"}')"))
    db = DB(tmp_path / "w.db")
    try:
        [res] = sender.send_drafts([_draft()], dry_run=False, db=db)
        assert res.status == "skipped" and res.detail == "held: consent needed"
        assert smtp == []
        assert "presend_hold" in [r["kind"] for r in activity.timeline(db, "contact", "a@x.co")]
    finally:
        db.close()


def test_send_drafts_sends_when_hook_allows(tmp_path, smtp, set_setting):
    set_setting("presend_hook", _hook(tmp_path, "ok.py", "print('{\"action\": \"send\"}')"))
    db = DB(tmp_path / "w.db")
    try:
        [res] = sender.send_drafts([_draft()], dry_run=False, db=db)
        assert res.status == "sent" and smtp == ["a@x.co"]
    finally:
        db.close()


def test_dry_run_never_calls_hook(tmp_path, set_setting):
    marker = tmp_path / "called"
    set_setting("presend_hook", _hook(tmp_path, "h.py",
                f"open({str(marker)!r},'w').write('x'); print('{{\"action\": \"send\"}}')"))
    db = DB(tmp_path / "w.db")
    try:
        [res] = sender.send_drafts([_draft()], dry_run=True, db=db)
        assert res.status == "preview" and not marker.exists()
    finally:
        db.close()
