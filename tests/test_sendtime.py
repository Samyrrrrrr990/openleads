"""Send-time planner: windows, weekdays, timezone inference, caps, determinism."""
from datetime import datetime, timedelta, timezone

from openleads.automate import sendtime
from openleads.automate.sendtime import SendPolicy, schedule_times, tz_offset_for


def _local(dt_utc: datetime, offset: int) -> datetime:
    return dt_utc + timedelta(hours=offset)


def test_tz_offset_city_beats_country():
    assert tz_offset_for(country="USA", city="San Francisco") == -8
    assert tz_offset_for(country="USA") == -6
    assert tz_offset_for(city="Bangalore") == 5
    assert tz_offset_for(country="Narnia", default=3) == 3


def test_schedule_empty():
    assert schedule_times(0) == []


def test_times_land_in_local_windows():
    policy = SendPolicy(jitter=False)
    # A Wednesday 06:00 UTC start, recipient at UTC+0.
    start = datetime(2026, 6, 10, 6, 0, tzinfo=timezone.utc)
    times = schedule_times(10, policy, start=start, tz_offset_hours=0)
    assert len(times) == 10
    for t in times:
        local = _local(t, 0)
        assert local.weekday() < 5
        hour = local.hour + local.minute / 60
        assert any(s <= hour < e for s, e in policy.windows), local


def test_timezone_shifts_to_recipient_morning():
    policy = SendPolicy(jitter=False)
    # 16:00 UTC Wednesday. A San Francisco recipient (UTC-8) is at 08:00 local.
    start = datetime(2026, 6, 10, 16, 0, tzinfo=timezone.utc)
    times = schedule_times(3, policy, start=start, tz_offset_hours=-8)
    first_local = _local(times[0], -8)
    assert first_local.hour == 8   # lands at the start of their morning window


def test_weekday_only_skips_weekend():
    policy = SendPolicy(jitter=False)
    # Saturday 09:00 UTC → must roll to Monday.
    start = datetime(2026, 6, 13, 9, 0, tzinfo=timezone.utc)  # 2026-06-13 is a Saturday
    times = schedule_times(2, policy, start=start, tz_offset_hours=0)
    assert all(_local(t, 0).weekday() == 0 for t in times)   # Monday


def test_per_day_cap_rolls_to_next_day():
    policy = SendPolicy(jitter=False, per_day=3, min_gap_sec=60, max_gap_sec=60)
    start = datetime(2026, 6, 10, 6, 0, tzinfo=timezone.utc)
    times = schedule_times(7, policy, start=start, tz_offset_hours=0)
    by_day = {}
    for t in times:
        by_day.setdefault(_local(t, 0).date(), 0)
        by_day[_local(t, 0).date()] += 1
    assert all(n <= 3 for n in by_day.values())
    assert len(by_day) >= 3   # 7 sends, ≤3/day → at least 3 distinct days


def test_gaps_are_deterministic_with_seed():
    a = SendPolicy(seed=42).gaps(5)
    b = SendPolicy(seed=42).gaps(5)
    assert a == b
    assert all(90 <= g <= 600 for g in a)


def test_describe_mentions_policy():
    text = sendtime.describe(SendPolicy())
    assert "weekdays" in text and "/day" in text
