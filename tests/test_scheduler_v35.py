"""On-device scheduler: pure plist/cron generators + scheduled-campaign selection."""
import time

import pytest

from openleads.automate import scheduler


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    from openleads.db import DB
    d = DB(path=str(tmp_path / "ol.db"))
    yield d
    d.close()


def test_cron_line_format():
    line = scheduler.cron_line(hour=9, minute=30, command="openleads drip --live")
    assert line.startswith("30 9 * * *")
    assert "openleads drip --live" in line
    assert "OpenLeads daily drip" in line


def test_launchd_plist_is_valid_shape():
    xml = scheduler.launchd_plist(hour=9, minute=15, command="python -m openleads drip --live")
    assert xml.startswith("<?xml")
    assert "<key>StartCalendarInterval</key>" in xml
    assert "<integer>9</integer>" in xml
    assert "<integer>15</integer>" in xml
    # Each command token becomes a ProgramArguments <string>.
    for tok in ("python", "-m", "openleads", "drip", "--live"):
        assert f"<string>{tok}</string>" in xml
    assert scheduler.LABEL in xml


def test_due_campaigns_respects_hour_and_last_run(db):
    # A campaign scheduled for 09:00, never run.
    db.save_campaign("morning", {"query": "fintech founders", "count": 5,
                                 "send_hour": 9, "enabled": True})
    early = time.struct_time((2026, 6, 10, 8, 0, 0, 2, 161, -1))   # 08:00
    late = time.struct_time((2026, 6, 10, 10, 0, 0, 2, 161, -1))   # 10:00
    assert scheduler.due_campaigns(db, now=early) == []
    due = scheduler.due_campaigns(db, now=late)
    assert len(due) == 1 and due[0]["name"] == "morning"


def test_due_campaigns_skips_disabled(db):
    db.save_campaign("off", {"query": "x", "send_hour": 0, "enabled": False})
    late = time.struct_time((2026, 6, 10, 23, 0, 0, 2, 161, -1))
    assert scheduler.due_campaigns(db, now=late) == []


def test_save_scheduled_campaign_defaults(db):
    scheduler.save_scheduled_campaign("c1", {"query": "founders"}, db=db)
    rows = {r["name"]: r["data"] for r in db.list_campaigns()}
    assert rows["c1"]["enabled"] is True
    assert rows["c1"]["send_hour"] == 9
