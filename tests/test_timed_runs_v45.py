"""v4.5 timed runs: schedule parsing, due logic, OS agent text, history, isolation."""
from datetime import datetime

import pytest

from openleads.automate import history, scheduler
from openleads.automate import schedule as sm

WED_NOON = datetime(2026, 10, 7, 12, 7)     # a Wednesday


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    from openleads.db import DB
    d = DB(path=str(tmp_path / "ol.db"))
    yield d
    d.close()


# --- parsing -------------------------------------------------------------------- #
@pytest.mark.parametrize("text,desc", [
    ("daily 09:00", "daily at 09:00"),
    ("9am", "daily at 09:00"),
    ("every day at 9:30pm", "daily at 21:30"),
    ("weekdays 08:30", "weekdays at 08:30"),
    ("weekends 10am", "weekends at 10:00"),
    ("mon,wed,fri 14:00", "Mon, Wed, Fri at 14:00"),
    ("tuesdays 7pm", "Tue at 19:00"),
    ("hourly", "every hour"),
    ("every 2h", "every 2 hours"),
    ("every 30m", "every 30 minutes"),
    ("every 90 minutes", "every 90 minutes"),
    ("0 9 * * 1-5", "weekdays at 09:00"),
    ("*/15 * * * *", "every 15 minutes"),
    ("noon", "daily at 12:00"),
])
def test_parse_and_describe(text, desc):
    assert sm.parse(text).describe() == desc


@pytest.mark.parametrize("bad", ["", "sometimes", "every 0m", "25:00", "funday 9am"])
def test_parse_rejects_nonsense(bad):
    with pytest.raises(sm.ScheduleError):
        sm.parse(bad)


def test_cron_sunday_is_both_0_and_7():
    assert sm.parse("0 9 * * 0").weekdays == sm.parse("0 9 * * 7").weekdays == frozenset({6})


def test_previous_and_next():
    s = sm.parse("mon,wed,fri 14:00")
    assert s.previous(WED_NOON) == datetime(2026, 10, 5, 14, 0)
    assert s.next(WED_NOON) == datetime(2026, 10, 7, 14, 0)


# --- due logic -------------------------------------------------------------------- #
def test_due_after_slot_until_it_runs():
    s = sm.parse("daily 09:00")
    assert sm.is_due(s, WED_NOON, last_run=None)
    assert not sm.is_due(s, WED_NOON, last_run=datetime(2026, 10, 7, 9, 0, 30))
    assert sm.is_due(s, WED_NOON, last_run=datetime(2026, 10, 6, 9, 1))


def test_never_run_job_does_not_fire_for_an_old_slot():
    s = sm.parse("monday 3am")
    assert not sm.is_due(s, WED_NOON, last_run=None)


def test_interval_schedule_fires_each_slot():
    s = sm.parse("every 2h")
    assert sm.is_due(s, WED_NOON, last_run=datetime(2026, 10, 7, 10, 0))
    assert not sm.is_due(s, WED_NOON, last_run=datetime(2026, 10, 7, 12, 1))


def test_legacy_date_only_last_run_counts_as_that_whole_day():
    spec = {"send_hour": 9, "last_run": "2026-10-07"}
    assert not scheduler.job_is_due(spec, WED_NOON)
    spec["last_run"] = "2026-10-06"
    assert scheduler.job_is_due(spec, WED_NOON)


def test_job_is_due_uses_schedule_over_send_hour():
    spec = {"schedule": "every 30m", "send_hour": 23}
    assert scheduler.job_is_due(spec, WED_NOON)


def test_disabled_or_invalid_jobs_never_run():
    assert not scheduler.job_is_due({"schedule": "hourly", "enabled": False}, WED_NOON)
    assert not scheduler.job_is_due({"schedule": "whenever"}, WED_NOON)


# --- OS agent text: paths with spaces survive -------------------------------------- #
SPACED = ["/Users/me/Project - Website/.venv/bin/python", "-m", "openleads", "drip", "--live"]


def test_launchd_keeps_paths_with_spaces_as_one_argument():
    xml = scheduler.launchd_plist(None, command=SPACED)
    assert "<string>/Users/me/Project - Website/.venv/bin/python</string>" in xml
    assert "<key>StartInterval</key>" in xml and "<integer>900</integer>" in xml


def test_launchd_escapes_xml():
    xml = scheduler.launchd_plist(9, command=["/opt/a&b/python", "-m", "openleads"])
    assert "a&amp;b" in xml


def test_cron_quotes_paths_with_spaces():
    line = scheduler.cron_line(None, command=SPACED)
    assert line.startswith("*/15 * * * *")
    assert "'/Users/me/Project - Website/.venv/bin/python'" in line
    assert scheduler.CRON_MARKERS[1] in line


def test_windows_task_args():
    args = scheduler.schtasks_args(None, command=SPACED)
    assert args[:3] == ["schtasks", "/Create", "/F"]
    assert '"/Users/me/Project - Website/.venv/bin/python"' in args[args.index("/TR") + 1]
    assert args[-4:] == ["/SC", "MINUTE", "/MO", "15"]
    daily = scheduler.schtasks_args(8, 5, command=SPACED)
    assert daily[-4:] == ["/SC", "DAILY", "/ST", "08:05"]


# --- history + isolation ------------------------------------------------------------ #
def test_history_records_and_reads_back(tmp_path):
    p = tmp_path / "runs.jsonl"
    history.record("recipe", "a", True, 1.23, {"found": 4}, path=p)
    history.record("recipe", "b", False, 0.5, error="boom", path=p)
    rows = history.recent(10, path=p)
    assert [r["name"] for r in rows] == ["b", "a"]
    assert rows[0]["ok"] is False and rows[0]["error"] == "boom"
    assert rows[1]["detail"] == {"found": 4}


def test_timed_catches_failures_and_notifies(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    alerts = []
    monkeypatch.setattr(history, "notify", lambda t, m: alerts.append((t, m)))

    def boom():
        raise RuntimeError("source down")

    res, entry = history.timed("recipe", "growth", boom)
    assert res is None and entry["ok"] is False
    assert "source down" in alerts[0][1]
    assert history.recent(1)[0]["name"] == "growth"


def test_tick_runs_due_recipes_and_survives_a_failure(db, monkeypatch, tmp_path):
    from openleads.automate import recipes
    monkeypatch.setattr(history, "notify", lambda *a: None)
    recipes.save("ok", {"query": "a", "schedule": "every 30m"}, db=db)
    recipes.save("broken", {"query": "b", "schedule": "every 30m"}, db=db)
    recipes.save("later", {"query": "c", "schedule": "monday 3am"}, db=db)
    ran = []

    def fake_run(spec, **kw):
        ran.append(spec["name"])
        if spec["name"] == "broken":
            raise RuntimeError("nope")
        return {"found": 3, "sent": 1}

    monkeypatch.setattr(recipes, "run", fake_run)
    monkeypatch.setattr(scheduler.seqmod, "due", lambda db, campaign: [])
    summary = scheduler.tick(db=db, dry_run=False, now=WED_NOON)
    assert sorted(ran) == ["broken", "ok"]
    assert summary["campaigns_run"] == 2 and summary["failed"] == 1
    assert summary["campaign_sent"] == 1
    # Both due recipes are marked as run, so the next tick in the same slot is quiet.
    ran.clear()
    scheduler.tick(db=db, dry_run=False, now=WED_NOON)
    assert ran == []


def test_dry_run_tick_does_not_consume_the_slot(db, monkeypatch):
    from openleads.automate import recipes
    recipes.save("ok", {"query": "a", "schedule": "every 30m"}, db=db)
    monkeypatch.setattr(recipes, "run", lambda spec, **kw: {"found": 0, "sent": 0})
    monkeypatch.setattr(scheduler.seqmod, "due", lambda db, campaign: [])
    scheduler.tick(db=db, dry_run=True, now=WED_NOON)
    assert recipes.due(db, now=WED_NOON)
