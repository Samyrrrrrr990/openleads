"""Replies: keep the text, sort them, and notice when you've answered."""
from email.message import EmailMessage

import pytest

from openleads.db import DB
from openleads.outreach import inbox, providers, replies


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    for e in ("ada@globex.example", "bo@initech.example", "cy@hooli.example", "di@acme.example"):
        d.upsert_lead({"email": e, "first_name": e.split("@")[0].title(), "tier": "safe"})
        d.record_touch(e, "sent", subject="quick question", campaign="c", step=1)
        d.set_status(e, "sent")
    d.execute("UPDATE touches SET ts=500.0")     # our emails went out before any reply
    yield d
    d.close()


@pytest.mark.parametrize("subject,body,want", [
    ("Automatic reply: hello", "I am out of the office until Monday.", "out_of_office"),
    ("Re: quick one", "I'm on leave until the 20th with limited access to email.", "out_of_office"),
    ("Re: quick one", "Please remove me from your list.", "unsubscribe"),
    ("Re: quick one", "Stop emailing me.", "unsubscribe"),
    ("Re: quick one", "No thanks, we're all set.", "not_interested"),
    ("Re: quick one", "Not interested.", "not_interested"),
    ("Re: quick one", "Sounds interesting, can you send pricing?", "needs_you"),
    ("Re: quick one", "Not right now, maybe in Q2.", "needs_you"),
])
def test_classify(subject, body, want):
    assert replies.classify(subject, body) == want


def test_classify_bounce():
    assert replies.classify("Undeliverable: quick one", "", "Mail Delivery Subsystem "
                            "<mailer-daemon@x.example>") == "bounce"


def test_classify_reads_only_the_new_text():
    body = "Yes, send it over.\n\nOn Mon, 3 Nov 2026 at 09:00, Sam wrote:\n> reply 'remove me' to stop"
    assert replies.classify("Re: hi", body) == "needs_you"


def test_new_text_strips_quoted_history():
    body = "Sure, Tuesday works.\n\nOn Mon, 3 Nov 2026 at 09:00, Sam <s@x.co> wrote:\n> hi there"
    assert replies.new_text(body) == "Sure, Tuesday works."


def test_new_text_strips_signature_and_quote_markers():
    assert replies.new_text("Sounds good.\n-- \nAda Lovelace\nCTO") == "Sounds good."
    assert replies.new_text("Great\n> old line\n>> older") == "Great"


def test_snippet_is_short_and_single_line():
    s = replies.snippet("Line one.\n\nLine two " + "x" * 400, limit=50)
    assert "\n" not in s and len(s) <= 50 and s.startswith("Line one. Line two")


def test_record_is_idempotent_by_message_id(db):
    first = replies.record(db, "ada@globex.example", "Re: hi", "yes please", "<m1@x>", 100.0)
    assert first and first["category"] == "needs_you" and first["snippet"] == "yes please"
    assert replies.record(db, "ada@globex.example", "Re: hi", "yes please", "<m1@x>", 100.0) is None


def test_unsubscribe_reply_suppresses(db):
    replies.record(db, "ada@globex.example", "Re: hi", "remove me", "<m2@x>", 100.0)
    assert db.is_suppressed("ada@globex.example")


def test_waiting_drops_answered_done_and_snoozed(db):
    emails = ["ada@globex.example", "bo@initech.example", "cy@hooli.example", "di@acme.example"]
    for i, e in enumerate(emails):
        replies.record(db, e, "Re: hi", "interested", f"<m{i}@x>", 1000.0 + i)
    replies.mark_answered(db, "ada@globex.example", 2000.0)
    replies.mark_done(db, "bo@initech.example", now=2000.0)
    db.kv_set("snooze.reply.cy@hooli.example", 10_000.0)
    got = replies.waiting(db, now=3000.0)
    assert [r["email"] for r in got] == ["di@acme.example"]
    assert got[0]["snippet"] == "interested" and got[0]["subject"] == "Re: hi"


def test_waiting_oldest_first_and_only_needs_you(db):
    replies.record(db, "bo@initech.example", "Re: hi", "pricing?", "<b@x>", 1002.0)
    replies.record(db, "ada@globex.example", "Re: hi", "call me", "<a@x>", 1001.0)
    replies.record(db, "cy@hooli.example", "Automatic reply", "out of office", "<c@x>", 1000.0)
    assert [r["email"] for r in replies.waiting(db, now=2000.0)] == ["ada@globex.example",
                                                                      "bo@initech.example"]


def test_a_later_send_counts_as_answered(db):
    replies.record(db, "ada@globex.example", "Re: hi", "pricing?", "<a@x>", 1000.0)
    db.execute("INSERT INTO touches (email, status, subject, campaign, step, ts) "
               "VALUES ('ada@globex.example', 'sent', 'Re: hi', 'manual', 2, 1500.0)")
    assert replies.waiting(db, now=2000.0) == []


def test_a_new_reply_after_done_shows_again(db):
    replies.record(db, "ada@globex.example", "Re: hi", "pricing?", "<a1@x>", 1000.0)
    replies.mark_done(db, "ada@globex.example", now=1500.0)
    replies.record(db, "ada@globex.example", "Re: hi", "and one more thing", "<a2@x>", 1600.0)
    [r] = replies.waiting(db, now=2000.0)
    assert r["snippet"] == "and one more thing"


# --- the IMAP scan ------------------------------------------------------------ #
def _msg(frm, subject, body=None, html=None, mid="<x@y>", date="Mon, 10 Nov 2026 09:00:00 +0000",
         to="me@yourco.example"):
    m = EmailMessage()
    m["From"], m["To"], m["Subject"], m["Message-ID"], m["Date"] = frm, to, subject, mid, date
    if body is not None:
        m.set_content(body)
        if html:
            m.add_alternative(html, subtype="html")
    else:
        m.set_content(html, subtype="html")
    return m.as_bytes()


class FakeIMAP:
    def __init__(self, inbox_msgs, sent_msgs=()):
        self.boxes = {"INBOX": list(inbox_msgs), "Sent": list(sent_msgs)}
        self.current = "INBOX"

    def list(self):
        return "OK", [b'(\\HasNoChildren) "/" "INBOX"', b'(\\HasNoChildren \\Sent) "/" "Sent"']

    def select(self, name, readonly=False):
        self.current = name.strip('"')
        return "OK", [str(len(self.boxes[self.current])).encode()]

    def search(self, charset, *criteria):
        n = len(self.boxes[self.current])
        return "OK", [" ".join(str(i + 1) for i in range(n)).encode()]

    def fetch(self, num, what):
        raw = self.boxes[self.current][int(num) - 1]
        return "OK", [(b"1 (RFC822 {1})", raw)]

    def logout(self):
        pass


@pytest.fixture
def imap(monkeypatch):
    holder = {}
    monkeypatch.setattr(providers, "imap_config", lambda overrides=None: {"host": "imap.x"})
    monkeypatch.setattr(providers, "connect_imap", lambda cfg: holder["server"])
    return holder


def test_scan_records_replies_including_html_only(db, imap):
    imap["server"] = FakeIMAP([
        _msg("Ada <ada@globex.example>", "Re: quick question", "Yes, send pricing.", mid="<a@x>"),
        _msg("Bo <bo@initech.example>", "Re: quick question", html="<p>Can we talk <b>Tuesday</b>?</p>",
             mid="<b@x>"),
        _msg("stranger@else.example", "hello", "not a lead", mid="<s@x>"),
    ])
    out = inbox.scan(db)
    assert out["replied"] == 2 and out["recorded"] == 2 and out["error"] == ""
    got = {r["email"]: r for r in replies.waiting(db)}
    assert got["ada@globex.example"]["snippet"] == "Yes, send pricing."
    assert got["bo@initech.example"]["snippet"] == "Can we talk Tuesday?"
    assert inbox.scan(db)["recorded"] == 0          # same messages, nothing new


def test_scan_notices_your_reply_in_sent(db, imap):
    imap["server"] = FakeIMAP(
        [_msg("Ada <ada@globex.example>", "Re: quick question", "Pricing?", mid="<a@x>",
              date="Mon, 10 Nov 2026 09:00:00 +0000")],
        [_msg("me@yourco.example", "Re: quick question", "Here it is.", mid="<r@x>",
              date="Mon, 10 Nov 2026 11:00:00 +0000", to="Ada <ada@globex.example>")])
    out = inbox.scan(db)
    assert out["answered"] == 1 and replies.waiting(db) == []


def test_sent_folder_failure_does_not_fail_the_scan(db, imap):
    server = FakeIMAP([_msg("Ada <ada@globex.example>", "Re: q", "Pricing?", mid="<a@x>")])

    def broken_list():
        raise OSError("LIST not allowed")
    server.list = broken_list
    imap["server"] = server
    out = inbox.scan(db)
    assert out["recorded"] == 1 and out["error"] == ""


def test_marking_done_closes_the_reply_task(db):
    db.set_status("ada@globex.example", "replied")      # opens "Reply to Ada"
    assert db.scalar("SELECT COUNT(*) FROM tasks WHERE status='open'") == 1
    replies.record(db, "ada@globex.example", "Re: hi", "pricing?", "<a@x>", 1000.0)
    replies.mark_done(db, "ada@globex.example", now=1500.0)
    assert db.scalar("SELECT COUNT(*) FROM tasks WHERE status='open'") == 0


def test_answering_closes_the_reply_task(db):
    db.set_status("ada@globex.example", "replied")
    replies.mark_answered(db, "ada@globex.example", 2000.0)
    assert db.scalar("SELECT COUNT(*) FROM tasks WHERE status='open'") == 0
