"""Today: one briefing for replies, approvals, tasks, new leads and heads-ups."""
import pytest

from openleads import today
from openleads.db import DB
from openleads.models import Draft
from openleads.outreach import replies
from openleads.workspace import drafts, tasks

NOW = 1_000_000.0


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    yield d
    d.close()


def _lead(db, email, created=NOW):
    db.upsert_lead({"email": email, "first_name": email[0].upper(), "tier": "safe"})
    db.execute("UPDATE leads SET created=? WHERE email=?", (created, email))


def _sends(db, n, bounced=0, ts=NOW - 3600):
    for i in range(n):
        e = f"p{i}@send.example"
        _lead(db, e, created=1.0)
        db.execute("INSERT INTO touches (email, status, subject, campaign, step, ts) "
                   "VALUES (?, 'sent', 's', 'c', 1, ?)", (e, ts))
        if i < bounced:
            db.execute("INSERT INTO activity (ref_type, ref, kind, summary, data, ts) "
                       "VALUES ('contact', ?, 'bounced', '', '{}', ?)", (e, ts + 60))


def _messages(b):
    return [h["message"] for h in b["heads_up"]]


def test_empty_workspace_briefing_is_calm(db):
    b = today.briefing(db, now=NOW)
    assert b["counts"] == {"replies": 0, "drafts": 0, "tasks": 0, "new_leads": 0}
    assert b["replies"] == [] and b["drafts"] == [] and b["tasks"] == {"overdue": [], "today": []}
    warn = [h for h in b["heads_up"] if "Mailbox not connected" in h["message"]]
    assert warn and warn[0]["level"] == "warn"
    assert not any(h["level"] == "bad" for h in b["heads_up"])


def test_connected_mailbox_has_no_mailbox_lines(db, set_setting):
    set_setting("smtp_host", "smtp.x.example")
    set_setting("imap_host", "imap.x.example")
    msgs = _messages(today.briefing(db, now=NOW))
    assert not any("Mailbox not connected" in m or "Replies aren't" in m for m in msgs)


def test_no_imap_is_an_info_line(db, set_setting):
    set_setting("smtp_host", "smtp.x.example")
    [line] = [h for h in today.briefing(db, now=NOW)["heads_up"] if "Replies aren't" in h["message"]]
    assert line["level"] == "info"


def test_new_leads_since_last_seen(db):
    _lead(db, "a@x.co", created=900.0)
    _lead(db, "b@x.co", created=1100.0)
    today.mark_seen(db, now=1000.0)
    nl = today.briefing(db, now=1200.0)["new_leads"]
    assert [x["email"] for x in nl["items"]] == ["b@x.co"] and nl["count"] == 1


def test_new_leads_default_to_last_day(db):
    _lead(db, "old@x.co", created=NOW - 2 * 86400)
    _lead(db, "new@x.co", created=NOW - 3600)
    assert [x["email"] for x in today.briefing(db, now=NOW)["new_leads"]["items"]] == ["new@x.co"]


def test_new_leads_items_capped_at_ten_but_counted(db):
    for i in range(12):
        _lead(db, f"n{i}@x.co", created=NOW - 60)
    nl = today.briefing(db, now=NOW)["new_leads"]
    assert nl["count"] == 12 and len(nl["items"]) == 10


def test_counts_match_sections(db):
    for e in ("a@x.co", "b@x.co", "c@x.co"):
        _lead(db, e, created=1.0)
    replies.record(db, "a@x.co", "Re: hi", "Can you send pricing?", "<m@x>", NOW - 500)
    drafts.enqueue(db, Draft(email="b@x.co", subject="s", body="b"), "ask", {"campaign": "c", "step": 1})
    drafts.enqueue(db, Draft(email="c@x.co", subject="s", body="b"), "ask", {"campaign": "c", "step": 1})
    tasks.create(db, "Call Bo", contact="b@x.co", due=NOW - 3 * 86400)
    b = today.briefing(db, now=NOW)
    assert b["counts"] == {"replies": 1, "drafts": 2, "tasks": 1, "new_leads": 0}
    assert b["replies"][0]["email"] == "a@x.co" and len(b["drafts"]) == 2
    assert [t["title"] for t in b["tasks"]["overdue"]] == ["Call Bo"]


def test_tasks_due_today_are_listed(db):
    tasks.create(db, "Send deck", due=NOW + 60)
    b = today.briefing(db, now=NOW)
    assert [t["title"] for t in b["tasks"]["today"]] == ["Send deck"] and b["counts"]["tasks"] == 1


def test_bounce_heads_up_needs_20_sends(db):
    _sends(db, 10, bounced=2)
    assert not any("bounced" in m for m in _messages(today.briefing(db, now=NOW)))


def test_bounce_heads_up_over_five_percent(db):
    _sends(db, 20, bounced=3)
    [line] = [h for h in today.briefing(db, now=NOW)["heads_up"] if "bounced" in h["message"]]
    assert line["level"] == "bad"
    assert line["message"] == ("15% of last week's emails bounced. "
                               "Check your list before sending more.")


def test_old_bounces_do_not_count(db):
    _sends(db, 20, bounced=3, ts=NOW - 10 * 86400)
    assert not any("bounced" in m for m in _messages(today.briefing(db, now=NOW)))


def test_warmup_cap_reached(db, monkeypatch):
    monkeypatch.setattr("openleads.outreach.deliverability.warmup_status",
                        lambda db: {"remaining": 0, "allowance": 10, "sent_today": 10})
    assert "Today's sending limit is reached; the rest go tomorrow." in _messages(
        today.briefing(db, now=NOW))


def test_failed_workflow_in_last_day(db):
    from openleads.automate.workflow import store
    store.runs(db)          # make sure the tables exist
    db.execute("INSERT INTO workflow_runs (workflow, mode, status, started, finished, error) "
               "VALUES ('Weekly leads', 'live', 'error', ?, ?, 'SMTP login failed')",
               (NOW - 3600, NOW - 3500))
    db.execute("INSERT INTO workflow_runs (workflow, mode, status, started, finished, error) "
               "VALUES ('Ancient', 'live', 'error', ?, ?, 'old')", (NOW - 5 * 86400, NOW - 5 * 86400))
    lines = [h for h in today.briefing(db, now=NOW)["heads_up"] if h["message"].startswith("Workflow")]
    assert [(h["level"], h["message"]) for h in lines] == [
        ("warn", "Workflow Weekly leads failed: SMTP login failed.")]


def test_presend_holds_in_last_day(db):
    for e in ("a@x.co", "b@x.co"):
        db.execute("INSERT INTO activity (ref_type, ref, kind, summary, data, ts) "
                   "VALUES ('contact', ?, 'presend_hold', 'held', '{}', ?)", (e, NOW - 600))
    assert "2 emails were held by your pre-send hook." in _messages(today.briefing(db, now=NOW))


def test_one_presend_hold_is_singular(db):
    db.execute("INSERT INTO activity (ref_type, ref, kind, summary, data, ts) "
               "VALUES ('contact', 'a@x.co', 'presend_hold', 'held', '{}', ?)", (NOW - 600,))
    assert "1 email was held by your pre-send hook." in _messages(today.briefing(db, now=NOW))


def test_snooze_reply_hides_until(db):
    _lead(db, "a@x.co", created=1.0)
    replies.record(db, "a@x.co", "Re: hi", "pricing?", "<m@x>", NOW - 500)
    today.snooze(db, "reply", "A@X.co", NOW + 3600)
    assert today.briefing(db, now=NOW)["replies"] == []
    assert [r["email"] for r in today.briefing(db, now=NOW + 7200)["replies"]] == ["a@x.co"]


def test_snooze_task_moves_due(db):
    t = tasks.create(db, "Call", due=NOW - 86400)
    out = today.snooze(db, "task", str(t["id"]), NOW + 5 * 86400)
    assert out["due"] == NOW + 5 * 86400
    assert today.briefing(db, now=NOW)["counts"]["tasks"] == 0


def test_snooze_unknown_task_raises(db):
    with pytest.raises(ValueError):
        today.snooze(db, "task", "999", NOW)


def test_snooze_unknown_kind_raises(db):
    with pytest.raises(ValueError):
        today.snooze(db, "deal", "1", 0.0)
