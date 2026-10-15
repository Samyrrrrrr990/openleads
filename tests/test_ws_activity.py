"""Activity log and timelines."""
import pytest

from openleads.db import DB
from openleads.workspace import activity


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    yield d
    d.close()


def test_upsert_logs_created_and_status_logs_stage(db):
    db.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "source": "yc"})
    db.record_touch("jane@acme.example", "sent", subject="hello")
    db.set_status("jane@acme.example", "sent")
    db.set_status("jane@acme.example", "replied")
    kinds = [r["kind"] for r in activity.timeline(db, "contact", "Jane@Acme.example")]
    assert kinds[0] in ("replied", "stage")
    assert {"created", "stage", "replied", "email_sent"} <= set(kinds)
    stage_rows = [r for r in activity.timeline(db, "contact", "jane@acme.example")
                  if r["kind"] == "stage"]
    assert stage_rows[0]["summary"] == "Approaching → Replied"
    assert stage_rows[0]["data"]["auto"] is True


def test_reply_stops_active_enrollments(db):
    db.upsert_lead({"email": "a@x.example", "first_name": "A"})
    db.execute("INSERT INTO sequences (name, status) VALUES ('s', 'active')")
    db.execute("INSERT INTO enrollments (sequence_id, email, status, next_due) "
               "VALUES (1, 'a@x.example', 'active', 1)")
    db.set_status("a@x.example", "replied")
    row = db.query_one("SELECT status, next_due, finished FROM enrollments")
    assert row["status"] == "replied" and row["next_due"] is None and row["finished"]


def test_log_and_feed_excludes_bulk_creates(db):
    db.upsert_lead({"email": "a@x.example", "first_name": "A"})
    activity.log(db, "contact", "a@x.example", "note", "Called, left voicemail")
    activity.log_many(db, "contact", ["a@x.example", "b@x.example"], "list_add", "Q4 targets")
    feed = activity.recent(db)
    assert [r["kind"] for r in feed] == ["list_add", "list_add", "note"]
    assert feed[-1]["name"] == "A" and feed[-1]["label"] == "Note"
    assert len(activity.recent(db, kinds=["created"])) == 1


def test_company_timeline_includes_its_people(db):
    db.upsert_lead({"email": "a@acme.example", "first_name": "A", "organization": "Acme"})
    activity.log(db, "company", "acme.example", "note", "Big account")
    activity.log(db, "contact", "a@acme.example", "note", "Champion")
    summaries = [r["summary"] for r in activity.timeline(db, "company", "acme.example")]
    assert "Big account" in summaries and "Champion" in summaries
