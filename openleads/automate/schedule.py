"""
Schedules for timed runs — plain English or cron, parsed into one shape.

A recipe or watcher carries a ``schedule`` string. Any of these work:

    daily 09:00          9am            every day at 9:30pm
    weekdays 08:30       weekends 10am  mon,wed,fri 14:00     monday at 9
    hourly               every 2h       every 30m             every 90 minutes
    0 9 * * 1-5          (standard 5-field cron: minute hour day month weekday)

The OS agent installed by ``openleads schedule on`` wakes every few minutes and runs
whatever is due, so one agent serves every schedule. ``is_due`` is the whole
decision: a job is due when a scheduled moment has passed since it last ran.

Pure and stdlib-only, so it's unit-tested directly.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta

_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]   # Python weekday() order
_DAY_ALIASES = {
    "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1, "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3, "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5, "sunday": 6, "sun": 6,
}
ALL_DAYS = frozenset(range(7))
WEEKDAYS = frozenset(range(5))
WEEKENDS = frozenset({5, 6})

# How far back to look for the last scheduled moment. A job that missed more than
# this (machine off for a week) runs once on wake, not once per missed slot.
LOOKBACK = timedelta(days=8)


class ScheduleError(ValueError):
    """The schedule text couldn't be understood."""


@dataclass(frozen=True)
class Schedule:
    """When a job fires. Either cron-style sets, or a fixed interval in minutes."""

    text: str
    minutes: frozenset = frozenset({0})
    hours: frozenset = frozenset(range(24))
    weekdays: frozenset = ALL_DAYS          # 0 = Monday
    monthdays: frozenset = frozenset(range(1, 32))
    months: frozenset = frozenset(range(1, 13))
    interval: int = 0                       # minutes; >0 means "every N minutes"

    def matches(self, dt: datetime) -> bool:
        """True if ``dt`` (to the minute) is a scheduled moment."""
        if self.interval:
            return (dt.hour * 60 + dt.minute) % self.interval == 0
        return (dt.minute in self.minutes and dt.hour in self.hours
                and dt.weekday() in self.weekdays and dt.day in self.monthdays
                and dt.month in self.months)

    def previous(self, now: datetime) -> datetime | None:
        """The most recent scheduled moment at or before ``now``."""
        t = now.replace(second=0, microsecond=0)
        stop = t - LOOKBACK
        while t >= stop:
            if self.matches(t):
                return t
            t -= timedelta(minutes=1)
        return None

    def next(self, now: datetime) -> datetime | None:
        """The next scheduled moment strictly after ``now``."""
        t = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
        stop = t + LOOKBACK
        while t <= stop:
            if self.matches(t):
                return t
            t += timedelta(minutes=1)
        return None

    def describe(self) -> str:
        return describe(self)


def _parse_time(text: str) -> tuple[int, int]:
    """'9', '9am', '9:30', '21:15', '9:30 pm', 'noon', 'midnight' → (hour, minute)."""
    t = text.strip().lower().replace(".", "")
    if t in ("noon", "midday"):
        return 12, 0
    if t == "midnight":
        return 0, 0
    m = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", t)
    if not m:
        raise ScheduleError(f"can't read the time {text!r} (try 09:00 or 9am)")
    hour, minute, ampm = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if ampm:
        if not 1 <= hour <= 12:
            raise ScheduleError(f"bad 12-hour time {text!r}")
        hour = hour % 12 + (12 if ampm == "pm" else 0)
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ScheduleError(f"time out of range: {text!r}")
    return hour, minute


def _cron_field(field: str, lo: int, hi: int, names: dict | None = None) -> frozenset:
    out: set[int] = set()
    for part in field.split(","):
        step = 1
        if "/" in part:
            part, s = part.split("/", 1)
            step = int(s)
            if step < 1:
                raise ScheduleError("cron step must be ≥ 1")
        if part in ("*", ""):
            a, b = lo, hi
        elif "-" in part:
            a_s, b_s = part.split("-", 1)
            a, b = _cron_num(a_s, names), _cron_num(b_s, names)
        else:
            a = b = _cron_num(part, names)
            if "/" in field:
                b = hi
        if not (lo <= a <= hi and lo <= b <= hi) or a > b:
            raise ScheduleError(f"cron value out of range: {field!r}")
        out.update(range(a, b + 1, step))
    return frozenset(out)


def _cron_num(s: str, names: dict | None) -> int:
    s = s.strip().lower()
    if names and s in names:
        return names[s]
    if not s.isdigit():
        raise ScheduleError(f"not a cron number: {s!r}")
    return int(s)


_CRON_DOW = {d: i for i, d in enumerate(["sun", "mon", "tue", "wed", "thu", "fri", "sat"])}


def _parse_cron(text: str) -> Schedule:
    f = text.split()
    minutes = _cron_field(f[0], 0, 59)
    hours = _cron_field(f[1], 0, 23)
    monthdays = _cron_field(f[2], 1, 31)
    months = _cron_field(f[3], 1, 12)
    # Cron weekdays: 0/7 = Sunday. Convert to Python's 0 = Monday.
    raw = _cron_field(f[4].replace("7", "0"), 0, 6, _CRON_DOW)
    weekdays = frozenset((d - 1) % 7 for d in raw)
    return Schedule(text=text, minutes=minutes, hours=hours, weekdays=weekdays,
                    monthdays=monthdays, months=months)


def _parse_days(text: str) -> frozenset | None:
    t = text.strip().lower()
    if t in ("", "daily", "every day", "everyday", "day", "each day"):
        return ALL_DAYS
    if t in ("weekdays", "weekday", "every weekday", "workdays", "business days"):
        return WEEKDAYS
    if t in ("weekends", "weekend", "every weekend"):
        return WEEKENDS
    t = re.sub(r"^(every|on)\s+", "", t)
    days = set()
    for tok in re.split(r"[,\s/&]+|\band\b", t):
        tok = tok.strip().rstrip("s") if tok.strip() not in ("tues", "thurs") else tok.strip()
        if not tok:
            continue
        if tok not in _DAY_ALIASES:
            return None
        days.add(_DAY_ALIASES[tok])
    return frozenset(days) or None


def parse(text: str) -> Schedule:
    """Parse a schedule string. Raises :class:`ScheduleError` if it can't."""
    raw = (text or "").strip()
    t = re.sub(r"\s+", " ", raw.lower())
    if not t:
        raise ScheduleError("empty schedule")

    if len(t.split()) == 5 and re.fullmatch(r"[\d*/,\-a-z ]+", t) and any(
            c in t for c in "*0123456789"):
        try:
            return _parse_cron(t)
        except (ScheduleError, ValueError):
            pass

    if t in ("hourly", "every hour"):
        return Schedule(text=raw, minutes=frozenset({0}))

    m = re.fullmatch(r"every (\d+) ?(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)", t)
    if m:
        n = int(m.group(1))
        unit = m.group(2)
        mins = n * 60 if unit.startswith("h") else n
        if mins < 1 or mins > 24 * 60:
            raise ScheduleError("interval must be between 1 minute and 24 hours")
        if mins % 60 == 0 and 24 % (mins // 60) == 0:
            return Schedule(text=raw, minutes=frozenset({0}),
                            hours=frozenset(range(0, 24, mins // 60)))
        if 60 % mins == 0:
            return Schedule(text=raw, minutes=frozenset(range(0, 60, mins)))
        return Schedule(text=raw, interval=mins)

    # "<days> [at] <time>" or "<time> [on] <days>" or just "<time>".
    m = re.fullmatch(r"(?:(.+?)\s+)?(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)"
                     r"(?:\s+(?:on\s+)?(.+))?", t)
    if m:
        days_text = (m.group(1) or m.group(3) or "").strip()
        days_text = re.sub(r"\s+at$", "", days_text)
        days = _parse_days(days_text)
        if days is None:
            raise ScheduleError(f"can't read the days in {raw!r}")
        hour, minute = _parse_time(m.group(2))
        return Schedule(text=raw, minutes=frozenset({minute}), hours=frozenset({hour}),
                        weekdays=days)

    raise ScheduleError(f"can't understand schedule {raw!r} — try 'weekdays 9am', "
                        "'every 2h', or cron like '0 9 * * 1-5'")


def from_spec(spec: dict) -> Schedule | None:
    """The schedule for a recipe/watcher spec, honouring the old send_hour fields."""
    text = (spec or {}).get("schedule")
    if text:
        return parse(text)
    if "send_hour" in (spec or {}):
        hour = int(spec.get("send_hour", 9))
        minute = int(spec.get("send_minute", 0) or 0)
        return Schedule(text=f"daily {hour:02d}:{minute:02d}", minutes=frozenset({minute}),
                        hours=frozenset({hour}))
    return None


def is_due(sched: Schedule, now: datetime, last_run: datetime | None,
           created: datetime | None = None) -> bool:
    """True if a scheduled moment has passed since ``last_run``.

    A job that has never run fires at its first scheduled moment after it was
    created; without a creation time, at any scheduled moment earlier today.
    """
    prev = sched.previous(now)
    if prev is None:
        return False
    if last_run is not None:
        return prev > last_run
    if created is not None:
        return prev >= created.replace(second=0, microsecond=0)
    return prev.date() == now.date()


def parse_ts(value) -> datetime | None:
    """Read a stored ISO timestamp (or a legacy YYYY-MM-DD date) back into a datetime."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def describe(sched: Schedule) -> str:
    """A short human description: 'weekdays at 09:00', 'every 2 hours', …"""
    if sched.interval:
        return f"every {sched.interval} minutes"
    if len(sched.hours) == 24 and sched.weekdays == ALL_DAYS and len(sched.months) == 12 \
            and len(sched.monthdays) == 31:
        if sched.minutes == frozenset({0}):
            return "every hour"
        if len(sched.minutes) > 1:
            step = sorted(sched.minutes)[1] - sorted(sched.minutes)[0]
            return f"every {step} minutes"
    if len(sched.hours) > 1 and sched.minutes == frozenset({0}) and sched.weekdays == ALL_DAYS:
        hs = sorted(sched.hours)
        step = hs[1] - hs[0]
        if all(b - a == step for a, b in zip(hs, hs[1:])) and len(hs) * step == 24:
            return f"every {step} hours"
    if len(sched.hours) == 1 and len(sched.minutes) == 1 and len(sched.months) == 12 \
            and len(sched.monthdays) == 31:
        at = f"{next(iter(sched.hours)):02d}:{next(iter(sched.minutes)):02d}"
        if sched.weekdays == ALL_DAYS:
            return f"daily at {at}"
        if sched.weekdays == WEEKDAYS:
            return f"weekdays at {at}"
        if sched.weekdays == WEEKENDS:
            return f"weekends at {at}"
        return ", ".join(_DAYS[d].title() for d in sorted(sched.weekdays)) + f" at {at}"
    return sched.text
