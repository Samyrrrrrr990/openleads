"""
Warm-up: bring a new mailbox up to full volume without getting flagged.

A mailbox that goes from zero to two hundred cold emails on day one lands in spam.
Warm-up does two things at once, every day:

1. **Ramps cold volume** along a smooth curve (``gentle`` ~30 days, ``standard``
   ~3 weeks, ``fast`` ~12 days) instead of a straight line, with quieter weekends.
   :func:`allowance` is what every send path checks (via
   :func:`openleads.outreach.deliverability.warmup_status`).
2. **Sends warm-up emails** to *seed* addresses: your other inboxes, a friend, a
   colleague. Short, plain, human notes spread across your send window. A seed you
   give a password to does the rest by itself: OpenLeads logs in to it, records
   whether the note landed in the inbox or in spam (*placement*), moves it out of
   spam if it has to, marks it important, and answers some of them. Replies and
   rescues are the signals mailbox providers read as "people want this mail".

It also **watches health** (bounces, spam placement, unsubscribes, replies over the
last two weeks). Healthy days move the ramp forward; a warning holds it where it is;
a bad bounce rate pauses cold sending until you fix the list. Every decision comes
with a reason in plain words.

Planning is pure (:func:`curve`, :func:`plan_for`, :func:`slots_for`,
:func:`score`), so it tests exactly. :func:`tick` is the only part that talks to a
mail server; the 15-minute scheduler heartbeat calls it.
"""
from __future__ import annotations

import email.utils
import hashlib
import imaplib
import json
import random
import re
import time
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path

from openleads import settings
from openleads.config import home

SEEDS_FILE = "warmup_seeds.json"

PRESETS = {
    "gentle": {"label": "Gentle", "start": 5, "days": 30, "warm_start": 3, "warm_max": 20,
               "note": "About a month. For a brand-new domain."},
    "standard": {"label": "Standard", "start": 10, "days": 21, "warm_start": 4, "warm_max": 25,
                 "note": "About three weeks. Right for most new mailboxes."},
    "fast": {"label": "Fast", "start": 15, "days": 12, "warm_start": 6, "warm_max": 30,
             "note": "About twelve days. For a mailbox with some history."},
}
PLANS = ("gentle", "standard", "fast", "linear", "off")
WEEKEND_FACTOR = {"quiet": 0.35, "off": 0.0, "normal": 1.0}
MAINTAIN_SHARE = 0.4          # after the ramp, keep warming at 40% of the peak warm-up
PER_SEED_DAILY = 4            # never send one seed more than this a day
REPLY_SHARE = 0.4             # share of inbox-placed warm-ups an auto seed answers
SPAM_FOLDERS = ("[Gmail]/Spam", "Spam", "Junk", "Junk Email", "Junk E-mail", "Bulk Mail",
                "INBOX.Spam", "INBOX.Junk", "[Google Mail]/Spam")


# --------------------------------------------------------------------------- #
# The ramp (pure)                                                              #
# --------------------------------------------------------------------------- #
def _smooth(x: float) -> float:
    """Smoothstep: slow start, steady middle, gentle landing."""
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def curve(day: int, start: int, target: int, days: int) -> int:
    """Cold emails allowed on ``day`` (1-based) of a ramp from ``start`` to ``target``."""
    if target <= start or days <= 1:
        return max(0, target)
    frac = _smooth((day - 1) / (days - 1))
    return int(round(start + (target - start) * frac))


def warm_curve(day: int, preset: dict, days: int, cap: int = 0) -> int:
    """Warm-up emails on ``day``: climbs with the ramp, then settles to maintenance."""
    lo, hi = preset["warm_start"], cap or preset["warm_max"]
    if day <= days:
        return int(round(lo + (hi - lo) * _smooth((day - 1) / max(1, days - 1))))
    return max(lo, int(round(hi * MAINTAIN_SHARE)))


def plan_for(day: int, plan: str, target: int, *, weekday: int = 0, weekends: str = "quiet",
             start: int = 10, step: int = 5, warm_cap: int = 0) -> dict:
    """What ``day`` of ``plan`` allows: ``{"cold", "warmup", "ramping"}``.

    ``weekday`` is ``date.weekday()`` (5 and 6 are the weekend)."""
    factor = WEEKEND_FACTOR.get(weekends, 0.35) if weekday >= 5 else 1.0
    if plan == "off":
        return {"cold": int(target * factor), "warmup": 0, "ramping": False}
    if plan == "linear":
        cold = min(target, start + step * (day - 1))
        days = max(1, -(-(target - start) // max(1, step)) + 1)
        preset = PRESETS["standard"]
    else:
        preset = PRESETS.get(plan) or PRESETS["standard"]
        days = preset["days"]
        cold = curve(day, min(preset["start"], target), target, days)
    warm = warm_curve(day, preset, days, warm_cap)
    return {"cold": int(round(cold * factor)), "warmup": int(round(warm * factor)),
            "ramping": day < days, "days": days}


def ramp(plan: str, target: int, days: int = 0, **kw) -> list:
    """The whole plan, weekday volumes, for a chart: ``[{day, cold, warmup}]``."""
    first = plan_for(1, plan, target, **kw)
    n = days or (first.get("days", 21) + 7)
    return [{"day": d, **{k: v for k, v in plan_for(d, plan, target, **kw).items()
                          if k in ("cold", "warmup")}} for d in range(1, n + 1)]


# --------------------------------------------------------------------------- #
# Health (pure scoring + one DB read)                                          #
# --------------------------------------------------------------------------- #
def score(sent: int, bounced: int, unsubscribed: int, replied: int,
          inbox: int, spam: int, auth_grade: str = "") -> dict:
    """0-100 and what to do about it: ``grow``, ``hold`` or ``pause``.

    Bounces matter most (a provider's first signal), then spam placement from the
    seeds, then unsubscribes. Replies earn a little back. Too few sends to judge
    leaves the score alone rather than guessing."""
    signals = []
    points = 100.0
    action = "grow"
    if sent >= 10:
        b = bounced / sent
        if b > 0.08:
            points -= 45
            action = "pause"
            signals.append(("bad", f"{b:.0%} of recent emails bounced. Cold sending is paused "
                                   "until the list is cleaned (verify addresses first)."))
        elif b > 0.03:
            points -= 20
            action = "hold"
            signals.append(("warn", f"{b:.0%} bounced. The ramp holds until that drops under 3%."))
        else:
            signals.append(("good", f"Bounces are low ({b:.1%})."))
        u = unsubscribed / sent
        if u > 0.02:
            points -= 10
            action = "hold" if action == "grow" else action
            signals.append(("warn", f"{u:.0%} unsubscribed. Tighten who you email."))
        r = replied / sent
        if r >= 0.05:
            points += 5
            signals.append(("good", f"{r:.0%} of people replied."))
    placed = inbox + spam
    if placed >= 5:
        s = spam / placed
        if s > 0.4:
            points -= 35
            action = "pause"
            signals.append(("bad", f"{s:.0%} of warm-up emails landed in spam. Cold sending "
                                   "is paused while warm-up keeps going."))
        elif s > 0.15:
            points -= 15
            action = "hold" if action == "grow" else action
            signals.append(("warn", f"{s:.0%} of warm-up emails landed in spam. The ramp holds."))
        else:
            signals.append(("good", f"{inbox} of {placed} warm-up emails reached the inbox."))
    if auth_grade and auth_grade[:1] in ("D", "F"):
        points -= 15
        action = "hold" if action == "grow" else action
        signals.append(("warn", "SPF, DKIM or DMARC is missing. Fix DNS before ramping."))
    elif auth_grade:
        signals.append(("good", f"Domain authentication grade {auth_grade}."))
    if not signals:
        signals.append(("info", "Not enough sending yet to judge. Health fills in after ~10 emails."))
    points = max(0, min(100, int(round(points))))
    grade = "good" if points >= 80 else "fair" if points >= 60 else "poor"
    return {"score": points, "grade": grade, "action": action,
            "signals": [{"level": lvl, "text": txt} for lvl, txt in signals]}


def _health_counts(db, days: int = 14) -> dict:
    since = time.time() - days * 86400
    q = db.scalar
    sent = q("SELECT COUNT(*) FROM touches WHERE status='sent' AND ts>=?", (since,), 0)
    bounced = q("SELECT COUNT(*) FROM suppression WHERE reason LIKE 'bounce%' AND ts>=?",
                (since,), 0)
    unsub = q("SELECT COUNT(*) FROM suppression WHERE reason LIKE 'unsub%' AND ts>=?",
              (since,), 0)
    try:
        replied = q("SELECT COUNT(*) FROM activity WHERE kind='replied' AND ts>=?", (since,), 0)
    except Exception:  # noqa: BLE001 — older workspace without the activity table
        replied = 0
    inbox = q("SELECT COUNT(*) FROM warmup_log WHERE kind='placed' AND folder='inbox' AND ts>=?",
              (since,), 0)
    spam = q("SELECT COUNT(*) FROM warmup_log WHERE kind='placed' AND folder='spam' AND ts>=?",
             (since,), 0)
    return {"sent": sent, "bounced": bounced, "unsubscribed": unsub, "replied": replied,
            "inbox": inbox, "spam": spam}


def health(db) -> dict:
    counts = _health_counts(db)
    grade = (db.kv_get("warmup.auth_grade") or {}).get("grade", "")
    out = score(auth_grade=grade, **counts)
    out["counts"] = counts
    return out


# --------------------------------------------------------------------------- #
# The day counter: healthy days move forward, held days don't                  #
# --------------------------------------------------------------------------- #
def _first_day(db) -> date | None:
    started = db.kv_get("warmup.started")
    if started:
        try:
            return date.fromisoformat(started)
        except ValueError:
            pass
    return db.first_send_date()


def effective_day(db, today: date, action: str) -> int:
    """Calendar days since the first send, minus the days health held the ramp.

    Evaluated once per date: a ``hold`` or ``pause`` verdict on a new date adds a
    held day, so tomorrow's allowance is today's again rather than bigger."""
    first = _first_day(db)
    if first is None:
        return 1
    held = db.kv_get("warmup.held") or {"days": 0, "last": ""}
    iso = today.isoformat()
    if held.get("last") != iso:
        if action in ("hold", "pause") and today > first:
            held["days"] = int(held.get("days", 0)) + 1
        held["last"] = iso
        try:
            db.kv_set("warmup.held", held)
        except Exception:  # noqa: BLE001 — read-only callers still get an answer
            pass
    return max(1, (today - first).days + 1 - int(held.get("days", 0)))


# --------------------------------------------------------------------------- #
# Today's schedule (pure)                                                      #
# --------------------------------------------------------------------------- #
def parse_window(text: str) -> tuple:
    """"09:00-17:00" → (540, 1020) minutes. Bad input falls back to 9 to 5."""
    m = re.fullmatch(r"\s*(\d{1,2})(?::(\d\d))?\s*-\s*(\d{1,2})(?::(\d\d))?\s*", text or "")
    if not m:
        return (540, 1020)
    a = int(m.group(1)) * 60 + int(m.group(2) or 0)
    b = int(m.group(3)) * 60 + int(m.group(4) or 0)
    if not (0 <= a < b <= 24 * 60):
        return (540, 1020)
    return (a, b)


def slots_for(day: date, n: int, window: tuple, key: str = "") -> list:
    """``n`` send times inside ``window`` on ``day``: evenly spread, then jittered.

    Seeded by date and mailbox, so the schedule a heartbeat sees at 10:15 is the same
    one it saw at 10:00 (sends are tracked by slot index)."""
    if n <= 0:
        return []
    a, b = window
    span = b - a
    rnd = random.Random(int(hashlib.sha256(f"{day.isoformat()}|{key}".encode()).hexdigest()[:12], 16))
    step = span / n
    out = []
    for i in range(n):
        lo = a + step * i
        minute = lo + rnd.uniform(0.15, 0.85) * step
        out.append(datetime.combine(day, datetime.min.time()) + timedelta(minutes=minute,
                                                                          seconds=rnd.randint(0, 59)))
    return out


# --------------------------------------------------------------------------- #
# Seeds                                                                        #
# --------------------------------------------------------------------------- #
def _seeds_path() -> Path:
    return home() / SEEDS_FILE


def load_seeds() -> list:
    try:
        data = json.loads(_seeds_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [s for s in data if isinstance(s, dict) and s.get("email")] if isinstance(data, list) else []


def _save_seeds(seeds: list) -> None:
    from openleads.settings import _write_secret_file
    path = _seeds_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    _write_secret_file(path, seeds)


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def add_seed(email_addr: str, name: str = "", password: str = "", provider: str = "",
             imap_host: str = "", smtp_host: str = "", smtp_port: int = 0) -> dict:
    """Add (or update) a seed. A password makes it automatic: placement, rescue, replies."""
    email_addr = (email_addr or "").strip().lower()
    if not EMAIL_RE.match(email_addr):
        raise ValueError("enter a full email address for the seed")
    mine = (settings.get("smtp_user") or "").lower()
    if mine and email_addr == mine:
        raise ValueError("a seed must be a different mailbox from the one you send from")
    seeds = [s for s in load_seeds() if s["email"] != email_addr]
    old = next((s for s in load_seeds() if s["email"] == email_addr), {})
    seed = {"email": email_addr, "name": (name or old.get("name") or "").strip()[:60],
            "provider": provider or old.get("provider") or _guess_provider(email_addr),
            "password": password or old.get("password", ""),
            "imap_host": imap_host or old.get("imap_host", ""),
            "smtp_host": smtp_host or old.get("smtp_host", ""),
            "smtp_port": int(smtp_port or old.get("smtp_port") or 0),
            "added": old.get("added") or time.time()}
    seeds.append(seed)
    _save_seeds(seeds)
    return public_seed(seed)


def remove_seed(email_addr: str) -> bool:
    email_addr = (email_addr or "").strip().lower()
    seeds = load_seeds()
    kept = [s for s in seeds if s["email"] != email_addr]
    _save_seeds(kept)
    return len(kept) != len(seeds)


def _guess_provider(addr: str) -> str:
    dom = addr.rsplit("@", 1)[-1]
    if dom in ("gmail.com", "googlemail.com"):
        return "gmail"
    if dom in ("outlook.com", "hotmail.com", "live.com", "msn.com"):
        return "outlook"
    if dom.startswith("zoho"):
        return "zoho"
    return "custom"


def public_seed(seed: dict) -> dict:
    """What the dashboard may see: never the password."""
    return {"email": seed["email"], "name": seed.get("name", ""),
            "provider": seed.get("provider", ""), "automatic": bool(seed.get("password")),
            "added": seed.get("added")}


def _seed_imap(seed: dict) -> dict:
    from openleads.outreach import providers
    p = providers.preset(seed.get("provider") or "custom")
    return {"host": seed.get("imap_host") or p["imap_host"] or _host_guess("imap", seed["email"]),
            "user": seed["email"], "password": seed.get("password", "")}


def _seed_smtp(seed: dict) -> dict:
    from openleads.outreach import providers
    p = providers.preset(seed.get("provider") or "custom")
    port = int(seed.get("smtp_port") or p["smtp_port"] or 465)
    return {"host": seed.get("smtp_host") or p["smtp_host"] or _host_guess("smtp", seed["email"]),
            "port": port, "ssl": port != 587, "user": seed["email"],
            "password": seed.get("password", "")}


def _host_guess(kind: str, addr: str) -> str:
    return f"{kind}.{addr.rsplit('@', 1)[-1]}"


# --------------------------------------------------------------------------- #
# Status: everything the dashboard shows                                       #
# --------------------------------------------------------------------------- #
def _today_counts(db, iso: str) -> dict:
    rows = db.query("SELECT kind, COUNT(*) AS n FROM warmup_log WHERE day=? GROUP BY kind", (iso,))
    return {r["kind"]: r["n"] for r in rows}


def status(db, now: datetime | None = None) -> dict:
    """Plan, day, today's allowance and schedule, health and seeds, in one read."""
    now = now or datetime.now()
    today = now.date()
    plan = settings.get("warmup_plan") or "standard"
    if plan not in PLANS:
        plan = "standard"
    target = int(settings.get("daily_cap"))
    weekends = settings.get("warmup_weekends") or "quiet"
    window = parse_window(settings.get("warmup_window"))
    hl = health(db)
    action = hl["action"]
    override = db.kv_get("warmup.override") == today.isoformat()
    if override and action == "pause":
        action = "hold"
    day = effective_day(db, today, action)
    kw = {"weekday": today.weekday(), "weekends": weekends,
          "start": int(settings.get("warmup_start")), "step": int(settings.get("warmup_step")),
          "warm_cap": int(settings.get("warmup_volume") or 0)}
    p = plan_for(day, plan, target, **kw)
    seeds = load_seeds()
    paused = bool(db.kv_get("warmup.paused"))
    cold = 0 if action == "pause" else p["cold"]
    warm_planned = 0 if (paused or not seeds or plan == "off") else min(
        p["warmup"], PER_SEED_DAILY * len(seeds))
    sent_today = db.sent_today()
    counts = _today_counts(db, today.isoformat())
    times = slots_for(today, warm_planned, window, settings.get("smtp_user") or "")
    done = set(db.kv_get(f"warmup.slots.{today.isoformat()}") or [])
    schedule = [{"at": t.isoformat(timespec="minutes"), "kind": "warmup",
                 "status": "sent" if i in done else ("due" if t <= now else "planned")}
                for i, t in enumerate(times)]
    upcoming = [s for s in schedule if s["status"] == "planned"]
    if plan == "off":
        phase = "off"
    elif action == "pause":
        phase = "paused"
    elif p.get("ramping"):
        phase = "ramping"
    else:
        phase = "maintaining"
    return {
        "plan": plan, "plans": [{"key": k, **{x: v for x, v in PRESETS[k].items()
                                              if x in ("label", "note", "days")}}
                                for k in ("gentle", "standard", "fast")],
        "phase": phase, "day": day, "days": p.get("days", 0), "target": target,
        "weekend": today.weekday() >= 5, "weekends": weekends,
        "window": settings.get("warmup_window") or "09:00-17:00",
        "allowance": cold, "cap": target, "sent_today": sent_today,
        "remaining": max(0, cold - sent_today),
        "warmup": {"planned": warm_planned, "sent": counts.get("sent", 0),
                   "replies": counts.get("reply", 0), "rescued": counts.get("rescued", 0),
                   "paused": paused,
                   "next": upcoming[0]["at"] if upcoming else ""},
        "schedule": schedule,
        "health": hl, "override": override,
        "seeds": [public_seed(s) for s in seeds],
        "ramp": ramp(plan, target, start=kw["start"], step=kw["step"], warm_cap=kw["warm_cap"]),
        "history": history(db),
        "mailbox": settings.get("smtp_user") or "",
    }


def history(db, days: int = 21) -> list:
    """Per-day sends for the chart: cold (touches) and warm-up (log)."""
    since_day = date.today() - timedelta(days=days - 1)
    since = datetime.combine(since_day, datetime.min.time()).timestamp()
    cold = {}
    for r in db.query("SELECT ts FROM touches WHERE status='sent' AND ts>=?", (since,)):
        d = datetime.fromtimestamp(r["ts"]).date().isoformat()
        cold[d] = cold.get(d, 0) + 1
    warm = {r["day"]: r["n"] for r in db.query(
        "SELECT day, COUNT(*) AS n FROM warmup_log WHERE kind='sent' AND day>=? GROUP BY day",
        (since_day.isoformat(),))}
    out = []
    for i in range(days):
        d = (since_day + timedelta(days=i)).isoformat()
        out.append({"date": d, "cold": cold.get(d, 0), "warmup": warm.get(d, 0)})
    return out


def allowance(db) -> dict:
    """The cap every cold send path checks. Same keys as before 5.6, plus why."""
    s = status(db)
    return {"day": s["day"], "allowance": s["allowance"], "cap": s["cap"],
            "sent_today": s["sent_today"], "remaining": s["remaining"],
            "plan": s["plan"], "phase": s["phase"]}


# --------------------------------------------------------------------------- #
# Content: short, plain, different every time                                  #
# --------------------------------------------------------------------------- #
_SUBJECTS = [
    "quick question", "following up on {topic}", "{topic}", "re: {topic}", "thoughts on {topic}?",
    "{topic} this week", "about {topic}", "a quick one", "checking in", "{day} works?",
]
_TOPICS = [
    "the schedule", "Thursday", "the draft", "lunch", "the notes from Monday", "the book you mentioned",
    "next steps", "the photos", "the plan for the weekend", "the call", "the invoice", "the trip",
    "the playlist", "the recipe", "the slides", "the new place", "the update",
]
_OPENERS = [
    "Hey {name},", "Hi {name},", "Hi {name},", "{name},", "Morning {name},", "Hey,", "Hi there,",
]
_LINES = [
    "Hope the week is going well so far.",
    "Just wanted to check in about {topic}.",
    "Did you get a chance to look at {topic}?",
    "I was thinking about {topic} again this morning.",
    "No rush on this, whenever you have a minute.",
    "Let me know if {day} still works for you.",
    "I moved a few things around, so I am free most of {day}.",
    "Thanks again for the help last time, it made a real difference.",
    "I found the thing I was looking for, so that part is sorted.",
    "Can you send me your notes when you get a second?",
    "I think we are close on {topic}, just one or two small things left.",
    "Happy to jump on a quick call if that is easier.",
    "I will be around all afternoon if you want to talk it through.",
    "Also, I finally tried that place you recommended. You were right.",
]
_CLOSERS = ["Thanks!", "Talk soon,", "Cheers,", "Best,", "Thanks,", "See you soon,", "Speak soon,"]
_REPLIES = [
    "Thanks for this! {day} works for me.",
    "Got it, thank you. I will take a look later today.",
    "Sounds good to me.",
    "Yes, that works. Thanks for sorting it out.",
    "Perfect, appreciate it. Talk soon.",
    "Thanks! I will get back to you on {topic} tomorrow.",
    "Great, thanks for the update.",
    "Nice, glad that part is done. Speak soon.",
]
_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "tomorrow", "next week"]


def compose(rnd: random.Random, to_name: str = "", from_name: str = "") -> tuple:
    """(subject, body) for one warm-up email. No links, no images, nothing to track."""
    topic, day = rnd.choice(_TOPICS), rnd.choice(_DAYS)
    first = (to_name or "").split(" ")[0] or ""
    subj = rnd.choice(_SUBJECTS).format(topic=topic, day=day)
    subj = subj[:1].upper() + subj[1:]
    opener = rnd.choice(_OPENERS).format(name=first) if first else rnd.choice(["Hey,", "Hi,", "Hi there,"])
    lines = rnd.sample(_LINES, k=rnd.randint(2, 3))
    body = "\n\n".join([opener, " ".join(l.format(topic=topic, day=day) for l in lines),
                        rnd.choice(_CLOSERS) + ("\n" + from_name.split(" ")[0] if from_name else "")])
    return subj, body


def compose_reply(rnd: random.Random) -> str:
    return rnd.choice(_REPLIES).format(topic=rnd.choice(_TOPICS), day=rnd.choice(_DAYS))


# --------------------------------------------------------------------------- #
# The tick: send what's due, then work the seed inboxes                        #
# --------------------------------------------------------------------------- #
def _log(db, kind: str, seed: str = "", message_id: str = "", subject: str = "",
         folder: str = "", detail: str = "", when: datetime | None = None) -> None:
    when = when or datetime.now()
    db.execute("INSERT INTO warmup_log (ts, day, kind, seed, message_id, subject, folder, detail) "
               "VALUES (?,?,?,?,?,?,?,?)",
               (when.timestamp(), when.date().isoformat(), kind, seed, message_id, subject,
                folder, detail))


def _pick_seed(seeds: list, db, iso: str, rnd: random.Random) -> dict | None:
    used = {r["seed"]: r["n"] for r in db.query(
        "SELECT seed, COUNT(*) AS n FROM warmup_log WHERE day=? AND kind='sent' GROUP BY seed", (iso,))}
    free = [s for s in seeds if used.get(s["email"], 0) < PER_SEED_DAILY]
    if not free:
        return None
    least = min(used.get(s["email"], 0) for s in free)
    return rnd.choice([s for s in free if used.get(s["email"], 0) == least])


def send_due(db, now: datetime | None = None, dry_run: bool = False, server=None) -> dict:
    """Send every warm-up slot whose time has passed and isn't sent yet."""
    from openleads.outreach import providers
    now = now or datetime.now()
    st = status(db, now)
    iso = now.date().isoformat()
    due = [i for i, s in enumerate(st["schedule"]) if s["status"] == "due"]
    out = {"due": len(due), "sent": 0, "failed": 0, "errors": []}
    if not due:
        return out
    seeds = load_seeds()
    done = list(db.kv_get(f"warmup.slots.{iso}") or [])
    rnd = random.Random(f"{iso}|{len(done)}|{time.time()}")
    own = server is None and not dry_run
    cfg = providers.smtp_config()
    try:
        if own:
            server = providers.connect_smtp(cfg)
        domain = (cfg.get("user") or "x@localhost").rsplit("@", 1)[-1]
        sender_name = settings.get("sender_name") or ""
        # A heartbeat that was asleep for hours sends at most three at once: a
        # burst is the thing warm-up exists to avoid. The rest roll forward.
        for i in due[:3]:
            seed = _pick_seed(seeds, db, iso, rnd)
            if not seed:
                break
            subject, body = compose(rnd, seed.get("name", ""), sender_name)
            msg = EmailMessage()
            msg["From"] = email.utils.formataddr((sender_name, cfg.get("user", ""))) if sender_name else cfg.get("user", "")
            msg["To"] = seed["email"]
            msg["Subject"] = subject
            msg["Date"] = email.utils.formatdate(localtime=True)
            mid = email.utils.make_msgid(domain=domain)
            msg["Message-ID"] = mid
            msg.set_content(body)
            try:
                if not dry_run:
                    server.send_message(msg)
                _log(db, "sent", seed["email"], mid, subject, detail="dry run" if dry_run else "")
                done.append(i)
                out["sent"] += 1
            except Exception as e:  # noqa: BLE001 — one failure must not stop the rest
                out["failed"] += 1
                out["errors"].append(str(e)[:200])
                _log(db, "error", seed["email"], mid, subject, detail=str(e)[:300])
        db.kv_set(f"warmup.slots.{iso}", sorted(set(done)))
    finally:
        if own and server is not None:
            try:
                server.quit()
            except Exception:  # noqa: BLE001
                pass
    return out


def _find_folder(server, candidates) -> str | None:
    try:
        typ, data = server.list()
    except Exception:  # noqa: BLE001
        return None
    names = []
    for line in data or []:
        s = line.decode("utf-8", "replace") if isinstance(line, bytes) else str(line)
        m = re.search(r'"([^"]+)"\s*$', s) or re.search(r"\s(\S+)$", s)
        if m:
            names.append(m.group(1))
        if "\\Junk" in s and m:
            return m.group(1)
    for c in candidates:
        for n in names:
            if n.lower() == c.lower():
                return n
    return None


def _search_mid(server, mid: str) -> list:
    try:
        typ, data = server.search(None, "HEADER", "Message-ID", mid)
        return data[0].split() if typ == "OK" and data and data[0] else []
    except Exception:  # noqa: BLE001
        return []


def check_seed(db, seed: dict, connect=None, reply_sender=None, rnd=None, days: int = 3) -> dict:
    """Log in to one automatic seed: record placement, rescue from spam, flag, reply.

    ``connect``/``reply_sender`` are injectable for tests."""
    from openleads.outreach import providers
    rnd = rnd or random.Random()
    since_iso = (date.today() - timedelta(days=days)).isoformat()
    pending = db.query(
        "SELECT message_id, subject FROM warmup_log WHERE kind='sent' AND seed=? AND day>=? "
        "AND message_id NOT IN (SELECT message_id FROM warmup_log WHERE kind='placed' AND seed=?)",
        (seed["email"], since_iso, seed["email"]))
    out = {"seed": seed["email"], "checked": 0, "inbox": 0, "spam": 0, "rescued": 0,
           "replied": 0, "missing": 0}
    if not pending:
        return out
    server = (connect or (lambda s: providers.connect_imap(_seed_imap(s))))(seed)
    try:
        spam_box = _find_folder(server, SPAM_FOLDERS)
        for row in pending:
            mid = row["message_id"]
            out["checked"] += 1
            folder = None
            server.select("INBOX")
            hits = _search_mid(server, mid)
            if hits:
                folder = "inbox"
            elif spam_box:
                server.select(f'"{spam_box}"')
                hits = _search_mid(server, mid)
                if hits:
                    folder = "spam"
                    # Rescue: copy to the inbox and remove it from spam. Moving mail
                    # out of spam is the strongest "this is wanted" signal there is.
                    for num in hits:
                        server.copy(num, "INBOX")
                        server.store(num, "+FLAGS", "\\Deleted")
                    server.expunge()
                    _log(db, "rescued", seed["email"], mid, row["subject"], folder="spam")
                    out["rescued"] += 1
                    server.select("INBOX")
                    hits = _search_mid(server, mid)
            if not folder:
                out["missing"] += 1
                continue
            out[folder] += 1
            _log(db, "placed", seed["email"], mid, row["subject"], folder=folder)
            for num in hits:
                server.store(num, "+FLAGS", "(\\Seen \\Flagged)")
            if rnd.random() < REPLY_SHARE:
                try:
                    (reply_sender or _send_reply)(seed, row["subject"], mid, compose_reply(rnd))
                    _log(db, "reply", seed["email"], mid, row["subject"])
                    out["replied"] += 1
                except Exception as e:  # noqa: BLE001
                    _log(db, "error", seed["email"], mid, row["subject"], detail=f"reply: {e}"[:300])
    finally:
        try:
            server.logout()
        except Exception:  # noqa: BLE001
            pass
    return out


def _send_reply(seed: dict, subject: str, in_reply_to: str, body: str) -> None:
    from openleads.outreach import providers
    cfg = _seed_smtp(seed)
    msg = EmailMessage()
    msg["From"] = email.utils.formataddr((seed.get("name") or "", seed["email"]))
    msg["To"] = settings.get("smtp_user") or ""
    msg["Subject"] = subject if subject.lower().startswith("re:") else f"Re: {subject}"
    msg["In-Reply-To"] = in_reply_to
    msg["References"] = in_reply_to
    msg["Date"] = email.utils.formatdate(localtime=True)
    msg["Message-ID"] = email.utils.make_msgid(domain=seed["email"].rsplit("@", 1)[-1])
    msg.set_content(body)
    server = providers.connect_smtp(cfg)
    try:
        server.send_message(msg)
    finally:
        try:
            server.quit()
        except Exception:  # noqa: BLE001
            pass


def tick(db, now: datetime | None = None, dry_run: bool = False) -> dict:
    """One heartbeat of warm-up: send due emails, then check automatic seeds."""
    now = now or datetime.now()
    out = {"sent": 0, "checked": 0, "rescued": 0, "replied": 0, "errors": []}
    plan = settings.get("warmup_plan") or "standard"
    if plan == "off" or db.kv_get("warmup.paused") or not load_seeds():
        return out
    if not (settings.get("smtp_user") and settings.get("smtp_pass")):
        out["errors"].append("connect a mailbox first")
        return out
    try:
        res = send_due(db, now, dry_run=dry_run)
        out["sent"] = res["sent"]
        out["errors"] += res["errors"]
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"send: {e}"[:200])
    if dry_run:
        return out
    # Seeds are checked at most every 30 minutes; mail takes a moment to arrive.
    last = db.kv_get("warmup.checked_at") or 0
    if time.time() - float(last) < 1800:
        return out
    db.kv_set("warmup.checked_at", time.time())
    for seed in load_seeds():
        if not seed.get("password"):
            continue
        try:
            r = check_seed(db, seed)
            for k in ("checked", "rescued", "replied"):
                out[k] += r[k]
        except (imaplib.IMAP4.error, OSError, RuntimeError) as e:
            out["errors"].append(f"{seed['email']}: {e}"[:200])
    return out


def set_plan(plan: str) -> None:
    if plan not in PLANS:
        raise ValueError(f"plan must be one of {', '.join(PLANS)}")
    settings.set("warmup_plan", plan)


def pause(db, paused: bool = True) -> None:
    db.kv_set("warmup.paused", bool(paused))


def override_today(db) -> None:
    """Send cold email today even though health says pause (your call, logged)."""
    db.kv_set("warmup.override", date.today().isoformat())
    _log(db, "override", detail="cold sending resumed for today by hand")


def restart(db) -> None:
    """Start the ramp again from day 1 (after a domain change, say)."""
    db.kv_set("warmup.started", date.today().isoformat())
    db.kv_set("warmup.held", {"days": 0, "last": ""})
