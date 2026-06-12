"""IMAP Sent-folder visibility: mailbox discovery, save policy, APPEND (no network)."""
from openleads import settings
from openleads.outreach import providers


class FakeIMAP:
    """Minimal stand-in for an imaplib server for parse/append tests."""

    def __init__(self, list_data, append_ok=True):
        self._list_data = list_data
        self._append_ok = append_ok
        self.appended = []

    def list(self):
        return "OK", self._list_data

    def append(self, mailbox, flags, date_time, message):
        self.appended.append((mailbox, flags, message))
        return ("OK", [b"[APPENDUID 1 1]"]) if self._append_ok else ("NO", [b"denied"])

    def logout(self):
        pass


def test_find_sent_via_special_use():
    data = [
        b'(\\HasNoChildren) "/" "INBOX"',
        b'(\\HasNoChildren \\Sent) "/" "[Gmail]/Sent Mail"',
        b'(\\HasNoChildren \\Trash) "/" "[Gmail]/Trash"',
    ]
    assert providers.find_sent_mailbox(FakeIMAP(data)) == "[Gmail]/Sent Mail"


def test_find_sent_via_fallback_name():
    data = [
        b'(\\HasNoChildren) "/" "INBOX"',
        b'(\\HasNoChildren) "/" "Sent Items"',
    ]
    assert providers.find_sent_mailbox(FakeIMAP(data)) == "Sent Items"


def test_find_sent_none_when_absent():
    data = [b'(\\HasNoChildren) "/" "INBOX"', b'(\\HasNoChildren) "/" "Archive"']
    assert providers.find_sent_mailbox(FakeIMAP(data)) is None


def test_should_save_to_sent_auto_skips_gmail():
    settings.set("save_to_sent", "auto")
    try:
        assert providers.should_save_to_sent("gmail") is False
        assert providers.should_save_to_sent("workspace") is False
        assert providers.should_save_to_sent("custom") is True
        assert providers.should_save_to_sent("outlook") is True
    finally:
        settings.unset("save_to_sent")


def test_should_save_to_sent_modes():
    settings.set("save_to_sent", "never")
    try:
        assert providers.should_save_to_sent("custom") is False
    finally:
        settings.unset("save_to_sent")
    settings.set("save_to_sent", "always")
    try:
        assert providers.should_save_to_sent("gmail") is True
    finally:
        settings.unset("save_to_sent")


def test_append_to_sent_success(monkeypatch):
    fake = FakeIMAP([b'(\\Sent) "/" "Sent"'])
    monkeypatch.setattr(providers, "connect_imap", lambda cfg: fake)
    ok, detail = providers.append_to_sent(
        b"From: a@b.com\r\nTo: c@d.com\r\nSubject: hi\r\n\r\nbody",
        cfg={"host": "imap.x", "user": "u", "password": "p"})
    assert ok and "Sent" in detail
    assert len(fake.appended) == 1
    assert fake.appended[0][0] == '"Sent"'


def test_append_to_sent_no_creds():
    ok, detail = providers.append_to_sent(b"x", cfg={"host": "", "user": "", "password": ""})
    assert not ok and "IMAP" in detail


def test_append_to_sent_never_raises(monkeypatch):
    def boom(cfg):
        raise OSError("connection refused")
    monkeypatch.setattr(providers, "connect_imap", boom)
    ok, detail = providers.append_to_sent(b"x", cfg={"host": "h", "user": "u", "password": "p"})
    assert not ok and "refused" in detail
