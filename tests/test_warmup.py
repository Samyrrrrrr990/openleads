"""Warm-up: the ramp, health verdicts, the day's schedule, seeds and the tick."""
from __future__ import annotations

import os
import stat
import time
from datetime import date, datetime, timedelta

import pytest

from openleads.outreach import warmup


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    monkeypatch.setenv("CAMPAIGN_MAX", "40")
    from openleads.db import DB
    d = DB(path=str(tmp_path / "ol.db"))
    yield d
    d.close()


def test_curve_starts_low_and_lands_on_target():
    assert warmup.curve(1, 10, 40, 21) == 10
    assert warmup.curve(21, 10, 40, 21) == 40
    assert warmup.curve(60, 10, 40, 21) == 40
    days = [warmup.curve(d, 10, 40, 21) for d in range(1, 22)]
    assert days == sorted(days)                      # never goes down
    assert days[1] - days[0] < days[10] - days[9]    # slow start, faster middle


def test_presets_order_by_speed():
    g = warmup.plan_for(7, "gentle", 40)["cold"]
    s = warmup.plan_for(7, "standard", 40)["cold"]
    f = warmup.plan_for(7, "fast", 40)["cold"]
    assert g < s < f


def test_weekends_quiet_off_normal():
    wk = warmup.plan_for(10, "standard", 40, weekday=2)
    quiet = warmup.plan_for(10, "standard", 40, weekday=5, weekends="quiet")
    off = warmup.plan_for(10, "standard", 40, weekday=6, weekends="off")
    normal = warmup.plan_for(10, "standard", 40, weekday=6, weekends="normal")
    assert 0 < quiet["cold"] < wk["cold"]
    assert off == {**off, "cold": 0, "warmup": 0}
    assert normal["cold"] == wk["cold"]


def test_linear_plan_matches_the_old_ramp():
    assert warmup.plan_for(1, "linear", 40, start=10, step=5)["cold"] == 10
    assert warmup.plan_for(3, "linear", 40, start=10, step=5)["cold"] == 20
    assert warmup.plan_for(30, "linear", 40, start=10, step=5)["cold"] == 40


def test_off_is_just_the_cap():
    p = warmup.plan_for(1, "off", 40)
    assert p["cold"] == 40 and p["warmup"] == 0


def test_warmup_keeps_going_after_the_ramp():
    after = warmup.plan_for(60, "standard", 40)
    assert after["warmup"] > 0 and not after["ramping"]


def test_score_verdicts():
    assert warmup.score(100, 1, 0, 6, 20, 1)["action"] == "grow"
    assert warmup.score(100, 5, 0, 0, 0, 0)["action"] == "hold"
    bad = warmup.score(100, 12, 0, 0, 0, 0)
    assert bad["action"] == "pause" and bad["grade"] in ("fair", "poor")
    assert warmup.score(10, 0, 0, 0, 2, 8)["action"] == "pause"     # mostly spam
    quiet = warmup.score(2, 1, 0, 0, 0, 0)                            # too little to judge
    assert quiet["action"] == "grow" and quiet["score"] == 100
    assert warmup.score(50, 0, 0, 0, 0, 0, auth_grade="F")["action"] == "hold"


def test_slots_are_stable_spread_and_inside_the_window():
    day = date(2026, 11, 17)
    a = warmup.slots_for(day, 6, (540, 1020), "me@x.com")
    b = warmup.slots_for(day, 6, (540, 1020), "me@x.com")
    assert a == b and len(a) == 6 and a == sorted(a)
    assert all(9 <= t.hour < 17 for t in a)
    assert warmup.slots_for(day + timedelta(days=1), 6, (540, 1020), "me@x.com") != a


def test_parse_window():
    assert warmup.parse_window("08:30-16:00") == (510, 960)
    assert warmup.parse_window("9-17") == (540, 1020)
    assert warmup.parse_window("nonsense") == (540, 1020)
    assert warmup.parse_window("18:00-09:00") == (540, 1020)


def test_held_days_slow_the_ramp(db):
    first = date.today() - timedelta(days=5)
    db.kv_set("warmup.started", first.isoformat())
    assert warmup.effective_day(db, date.today(), "grow") == 6
    db.kv_set("warmup.held", {"days": 0, "last": ""})
    assert warmup.effective_day(db, date.today(), "hold") == 5
    # evaluated once per date: asking again today doesn't hold again
    assert warmup.effective_day(db, date.today(), "hold") == 5


def test_seeds_are_private_and_never_show_passwords(db, tmp_path):
    s = warmup.add_seed("Friend@Gmail.com", "Sam Friend", password="app-pass")
    assert s == {**s, "email": "friend@gmail.com", "automatic": True, "provider": "gmail"}
    assert "password" not in s
    warmup.add_seed("pal@example.org")
    path = tmp_path / warmup.SEEDS_FILE
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    st = warmup.status(db)
    assert {x["email"] for x in st["seeds"]} == {"friend@gmail.com", "pal@example.org"}
    assert "app-pass" not in str(st)
    # re-adding without a password keeps the stored one
    warmup.add_seed("friend@gmail.com", "Sam")
    assert warmup.load_seeds()[-1]["password"] == "app-pass"
    assert warmup.remove_seed("pal@example.org") and not warmup.remove_seed("nobody@x.com")
    with pytest.raises(ValueError):
        warmup.add_seed("not-an-email")


def test_seed_cannot_be_the_sending_mailbox(db, monkeypatch):
    monkeypatch.setenv("SMTP_USER", "me@agency.com")
    with pytest.raises(ValueError):
        warmup.add_seed("me@agency.com")


def test_status_shape_and_no_warmup_without_seeds(db):
    st = warmup.status(db)
    assert st["plan"] == "standard" and st["day"] == 1
    assert st["allowance"] == 10 and st["remaining"] == 10
    assert st["warmup"]["planned"] == 0 and st["schedule"] == []
    assert len(st["ramp"]) > 20 and len(st["history"]) == 21
    assert st["health"]["signals"]


def test_paused_health_stops_cold_and_override_lifts_it(db):
    now = time.time()
    for i in range(20):
        db.execute("INSERT INTO touches (email, status, ts) VALUES (?,?,?)", (f"p{i}@x.com", "sent", now))
    for i in range(4):
        db.execute("INSERT INTO suppression (email, reason, ts) VALUES (?,?,?)", (f"p{i}@x.com", "bounced", now))
    st = warmup.status(db)
    assert st["phase"] == "paused" and st["allowance"] == 0
    warmup.override_today(db)
    assert warmup.status(db)["allowance"] > 0


class FakeSMTP:
    def __init__(self):
        self.sent = []

    def send_message(self, msg):
        self.sent.append(msg)

    def quit(self):
        pass


def test_send_due_sends_due_slots_once_and_spreads_seeds(db, monkeypatch):
    monkeypatch.setenv("SMTP_USER", "me@agency.com")
    warmup.add_seed("a@x.com", "Ann")
    warmup.add_seed("b@y.com", "Bo")
    late = datetime.combine(date.today(), datetime.min.time()) + timedelta(hours=23, minutes=59)
    server = FakeSMTP()
    res = warmup.send_due(db, late, server=server)
    assert res["sent"] == 3                       # never more than three at once
    assert {m["To"] for m in server.sent} == {"a@x.com", "b@y.com"}
    for m in server.sent:
        body = m.get_content()
        assert "http" not in body and "—" not in body
        assert m["Message-ID"]
    again = warmup.send_due(db, late, server=FakeSMTP())
    total = res["sent"] + again["sent"]
    st = warmup.status(db, late)
    assert st["warmup"]["sent"] == total
    assert sum(1 for s in st["schedule"] if s["status"] == "sent") == total


class FakeIMAP:
    """INBOX holds one message, Spam holds another."""

    def __init__(self, inbox_mid, spam_mid):
        self.boxes = {"INBOX": {b"1": inbox_mid}, "[Gmail]/Spam": {b"2": spam_mid}}
        self.cur = "INBOX"
        self.flags = []

    def list(self):
        return "OK", [b'(\\HasNoChildren) "/" "INBOX"', b'(\\HasNoChildren \\Junk) "/" "[Gmail]/Spam"']

    def select(self, box):
        self.cur = box.strip('"')
        return "OK", [b"1"]

    def search(self, _charset, _h, _name, mid):
        hits = [k for k, v in self.boxes[self.cur].items() if v == mid]
        return "OK", [b" ".join(hits)]

    def copy(self, num, box):
        self.boxes[box][b"9"] = self.boxes[self.cur][num]

    def store(self, num, op, flags):
        self.flags.append((self.cur, num, flags))
        if "Deleted" in flags:
            self.boxes[self.cur].pop(num, None)

    def expunge(self):
        pass

    def logout(self):
        pass


def test_check_seed_records_placement_rescues_and_replies(db):
    import random
    seed = {"email": "a@x.com", "password": "p"}
    warmup._log(db, "sent", "a@x.com", "<one@me>", "Hi")
    warmup._log(db, "sent", "a@x.com", "<two@me>", "Hey")
    fake = FakeIMAP("<one@me>", "<two@me>")
    replies = []
    out = warmup.check_seed(db, seed, connect=lambda s: fake,
                            reply_sender=lambda *a: replies.append(a), rnd=random.Random(1))
    assert out["inbox"] == 1 and out["spam"] == 1 and out["rescued"] == 1
    assert b"9" in fake.boxes["INBOX"]                 # moved out of spam
    h = warmup.health(db)
    assert h["counts"]["inbox"] == 1 and h["counts"]["spam"] == 1
    # checked messages aren't checked again
    again = warmup.check_seed(db, seed, connect=lambda s: fake, reply_sender=lambda *a: None)
    assert again["checked"] == 0


def test_compose_is_varied_and_plain():
    import random
    rnd = random.Random(7)
    seen = {warmup.compose(rnd, "Ann Lee", "Sam")[1] for _ in range(30)}
    assert len(seen) > 20
    for body in seen:
        assert "http" not in body and "—" not in body


def test_tick_does_nothing_without_seeds_or_mailbox(db):
    assert warmup.tick(db)["sent"] == 0
    warmup.add_seed("a@x.com")
    assert "connect a mailbox first" in warmup.tick(db)["errors"]
