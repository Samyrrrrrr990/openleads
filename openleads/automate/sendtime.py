"""
Send-time intelligence — *when* and *how* to send for the best response, on-device.

Cold email lands best when it arrives in the recipient's morning, on a weekday,
spaced out like a human (not blasted in one burst). This module is the pure,
deterministic brain for that:

* :class:`SendPolicy` captures the rules (business-hour windows, weekdays-only,
  per-day cap, human gaps + jitter).
* :func:`tz_offset_for` infers a recipient's UTC offset from their country/city
  with a small offline table (no tz database dependency, works on 3.8+).
* :func:`schedule_times` assigns each message an absolute UTC send time inside the
  recipient's next local window, rolling forward across windows/days as caps fill.

It's all arithmetic over timestamps — no I/O — so it unit-tests exactly. The OS
scheduler (:mod:`openleads.automate.scheduler`) is what actually wakes the machine
to act on these times.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass
class SendPolicy:
    """Rules for when/how to pace sends. Sensible cold-email defaults."""

    windows: tuple = ((8, 11), (13, 16))   # local-time hour ranges [start, end)
    weekdays_only: bool = True
    per_day: int = 40                       # max messages per local calendar day
    min_gap_sec: int = 90
    max_gap_sec: int = 600
    jitter: bool = True
    seed: int | None = None                 # set for deterministic gaps (tests)

    def gaps(self, n: int) -> list[int]:
        """``n`` inter-send gaps in seconds (jittered unless disabled)."""
        if not self.jitter:
            mid = (self.min_gap_sec + self.max_gap_sec) // 2
            return [mid] * n
        rnd = random.Random(self.seed)
        return [rnd.randint(self.min_gap_sec, self.max_gap_sec) for _ in range(n)]


# --- timezone inference (offline, approximate) -------------------------------- #
# Country / region → representative UTC offset (standard time). Approximate by
# design: good enough to land in someone's morning, with no tzdata dependency.
_COUNTRY_OFFSET = {
    "usa": -6, "united states": -6, "us": -6, "canada": -5, "mexico": -6,
    "brazil": -3, "argentina": -3, "chile": -3, "colombia": -5, "peru": -5,
    "uk": 0, "united kingdom": 0, "england": 0, "ireland": 0, "portugal": 0,
    "france": 1, "germany": 1, "spain": 1, "italy": 1, "netherlands": 1,
    "sweden": 1, "norway": 1, "denmark": 1, "poland": 1, "switzerland": 1,
    "austria": 1, "belgium": 1, "czechia": 1, "czech republic": 1, "hungary": 1,
    "greece": 2, "finland": 2, "romania": 2, "ukraine": 2, "israel": 2,
    "south africa": 2, "turkey": 3, "saudi arabia": 3, "uae": 4,
    "united arab emirates": 4, "india": 5, "pakistan": 5, "bangladesh": 6,
    "thailand": 7, "vietnam": 7, "indonesia": 7, "singapore": 8, "china": 8,
    "hong kong": 8, "taiwan": 8, "philippines": 8, "malaysia": 8,
    "japan": 9, "south korea": 9, "korea": 9, "australia": 10,
    "new zealand": 12,
}
# A few major cities whose offset differs from the country default or disambiguate.
_CITY_OFFSET = {
    "san francisco": -8, "los angeles": -8, "seattle": -8, "new york": -5,
    "boston": -5, "miami": -5, "chicago": -6, "denver": -7, "austin": -6,
    "toronto": -5, "vancouver": -8, "london": 0, "berlin": 1, "paris": 1,
    "amsterdam": 1, "madrid": 1, "lisbon": 0, "dublin": 0, "stockholm": 1,
    "bangalore": 5, "bengaluru": 5, "mumbai": 5, "delhi": 5, "singapore": 8,
    "tokyo": 9, "sydney": 10, "melbourne": 10, "dubai": 4, "tel aviv": 2,
    "são paulo": -3, "sao paulo": -3, "mexico city": -6,
}


def tz_offset_for(country: str = "", city: str = "", default: int = 0) -> int:
    """Best-effort UTC offset (hours) for a recipient. City wins over country."""
    c = (city or "").strip().lower()
    if c in _CITY_OFFSET:
        return _CITY_OFFSET[c]
    k = (country or "").strip().lower()
    if k in _COUNTRY_OFFSET:
        return _COUNTRY_OFFSET[k]
    return default


# --- the planner -------------------------------------------------------------- #
def _is_weekday(dt: datetime) -> bool:
    return dt.weekday() < 5   # Mon-Fri


def next_slot(after: datetime, policy: SendPolicy) -> datetime:
    """The first acceptable local-time instant at/after ``after`` (window + weekday).

    ``after`` is a naive datetime interpreted in the recipient's local time.
    """
    dt = after
    for _ in range(14 * len(policy.windows) + 14):   # bounded scan (≈2 weeks)
        if policy.weekdays_only and not _is_weekday(dt):
            dt = dt.replace(hour=0, minute=0, second=0) + timedelta(days=1)
            continue
        slot = _slot_in_windows(dt, policy)
        if slot is not None:
            return slot
        # Past today's last window → jump to the start of tomorrow.
        dt = dt.replace(hour=0, minute=0, second=0) + timedelta(days=1)
    return dt


def _slot_in_windows(dt: datetime, policy: SendPolicy) -> datetime | None:
    """If ``dt`` (today) can fit a window, return the in-window instant, else None."""
    hour = dt.hour + dt.minute / 60
    for start, end in policy.windows:
        if hour < start:
            return dt.replace(hour=start, minute=0, second=0, microsecond=0)
        if start <= hour < end:
            return dt.replace(microsecond=0)
    return None


def schedule_times(count: int, policy: SendPolicy | None = None,
                   start: datetime | None = None, tz_offset_hours: int = 0) -> list[datetime]:
    """Assign ``count`` send times as **UTC** datetimes.

    Each time lands inside the recipient's local business-hour window (weekdays
    only by default), spaced by human-like gaps, with at most ``policy.per_day``
    per local calendar day. ``tz_offset_hours`` is the recipient's offset from UTC.
    """
    policy = policy or SendPolicy()
    if count <= 0:
        return []
    # Work in the recipient's local time, then convert back to UTC at the end.
    now_utc = start or datetime.now(timezone.utc)
    if now_utc.tzinfo is not None:
        now_utc = now_utc.astimezone(timezone.utc).replace(tzinfo=None)
    local_now = now_utc + timedelta(hours=tz_offset_hours)

    gaps = policy.gaps(count)
    times: list[datetime] = []
    cursor = next_slot(local_now, policy)
    day_key = cursor.date()
    day_count = 0
    for i in range(count):
        if day_count >= policy.per_day:
            # Next day's first window.
            cursor = next_slot(cursor.replace(hour=0, minute=0, second=0)
                               + timedelta(days=1), policy)
            day_key = cursor.date()
            day_count = 0
        # Convert this local instant back to UTC.
        times.append(cursor - timedelta(hours=tz_offset_hours))
        day_count += 1
        # Advance by a gap, then snap forward into the next valid slot.
        cursor = next_slot(cursor + timedelta(seconds=gaps[i]), policy)
        if cursor.date() != day_key:
            day_key = cursor.date()
            day_count = 0
    return times


def describe(policy: SendPolicy | None = None) -> str:
    """One-line human summary of the active send-time policy."""
    p = policy or SendPolicy()
    wins = ", ".join(f"{s:02d}:00–{e:02d}:00" for s, e in p.windows)
    days = "weekdays" if p.weekdays_only else "any day"
    return (f"sends {days} during {wins} recipient-local, "
            f"≤{p.per_day}/day, {p.min_gap_sec}–{p.max_gap_sec}s apart")
