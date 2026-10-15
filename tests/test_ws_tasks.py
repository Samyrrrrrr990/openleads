"""Tasks and due-date parsing."""
from datetime import datetime, timedelta

import pytest

from openleads.db import DB
from openleads.workspace import activity, tasks

NOW = datetime(2026, 10, 15, 14, 30).timestamp()      # a Thursday afternoon


def _nine(days):
    d = datetime(2026, 10, 15) + timedelta(days=days)
    return d.replace(hour=9).timestamp()


@pytest.mark.parametrize("value,expected", [
    ("today", _nine(0)), ("tomorrow", _nine(1)), ("+3d", _nine(3)), ("3d", _nine(3)),
    ("+1w", _nine(7)), ("mon", _nine(4)), ("thursday", _nine(7)), ("2026-10-20", _nine(5)),
    ("+2h", NOW + 7200), (1234.0, 1234.0), (None, None), ("", None),
])
def test_parse_due(value, expected):
    assert tasks.parse_due(value, now=NOW) == expected


def test_parse_due_rejects_garbage():
    with pytest.raises(ValueError):
        tasks.parse_due("whenever", now=NOW)


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    d.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "last_name": "Doe",
                   "organization": "Acme", "phone": "+15125550100"})
    yield d
    d.close()


def test_buckets_counts_and_join(db):
    import time
    now = time.time()
    tasks.create(db, "Call Jane", kind="call", contact="Jane@acme.example", due=now - 86400 * 2,
                 priority="high")
    tasks.create(db, "Send deck", kind="email", due="today")
    tasks.create(db, "Connect on LinkedIn", kind="linkedin", due="+3d")
    tasks.create(db, "Think about pricing")
    c = tasks.counts(db)
    assert (c["overdue"], c["today"], c["upcoming"], c["nodate"], c["open"]) == (1, 1, 1, 1, 4)
    overdue = tasks.list_tasks(db, "overdue")
    assert overdue[0]["contact_name"] == "Jane Doe" and overdue[0]["account"] == "acme.example"
    assert overdue[0]["contact_phone"] == "+15125550100"
    assert [t["title"] for t in tasks.list_tasks(db, "open")][:2] == ["Call Jane", "Send deck"]
    assert len(tasks.list_tasks(db, "open", kind="call")) == 1
    assert len(tasks.list_tasks(db, "all", contact="jane@acme.example")) == 1


def test_complete_skip_reopen_update_delete(db):
    t = tasks.create(db, "Call Jane", kind="call", contact="jane@acme.example")
    assert tasks.complete(db, t["id"])["status"] == "done"
    assert tasks.counts(db)["done_today"] == 1
    assert activity.timeline(db, "contact", "jane@acme.example")[0]["kind"] == "task_done"
    assert tasks.reopen(db, t["id"])["status"] == "open"
    assert tasks.skip(db, t["id"])["status"] == "skipped"
    assert tasks.list_tasks(db, "done")[0]["id"] == t["id"]
    u = tasks.update(db, t["id"], {"title": "Call Jane back", "due": "tomorrow",
                                   "priority": "high", "status": "hacked"})
    assert u["title"] == "Call Jane back" and u["due"] and u["status"] == "skipped"
    with pytest.raises(ValueError):
        tasks.update(db, t["id"], {"kind": "fax"})
    assert tasks.delete(db, t["id"]) and tasks.get(db, t["id"]) is None


def test_create_validation(db):
    with pytest.raises(ValueError):
        tasks.create(db, "  ")
    with pytest.raises(ValueError):
        tasks.create(db, "x", kind="carrier-pigeon")
    assert tasks.create(db, "x", priority="urgent!!")["priority"] == "normal"


def test_a_reply_puts_one_reply_task_in_the_queue(tmp_path):
    from openleads.db import DB
    from openleads.workspace import tasks
    db = DB(tmp_path / "r.db")
    db.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "last_name": "Doe"})
    db.set_status("jane@acme.example", "sent")
    db.set_status("jane@acme.example", "replied")
    db.set_status("jane@acme.example", "replied")              # a second reply: no duplicate
    open_ = tasks.list_tasks(db, "open")
    assert [(t["title"], t["kind"], t["priority"]) for t in open_] == \
        [("Reply to Jane Doe", "email", "high")]
    assert tasks.counts(db)["overdue"] + tasks.counts(db)["today"] == 1
    tasks.complete(db, open_[0]["id"])
    db.set_status("jane@acme.example", "replied")              # replied again later: new task
    assert len(tasks.list_tasks(db, "open")) == 1
    db.set_status("jane@acme.example", "bounced")
    assert len(tasks.list_tasks(db, "open")) == 1               # bounces don't make tasks
    db.close()
