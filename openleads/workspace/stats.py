"""
Numbers for the home dashboard and the data-health report.

:func:`home` is one call that answers "how is outreach going": contacts and
companies, emails sent / replies / bounces with rates, tasks due, active sequences,
the open pipeline, 30-day series for charts, the stage funnel, fit-grade
distribution, recent activity and a getting-started checklist.

:func:`health` lists data problems worth fixing, each with the People filter that
shows the affected contacts, so every number on the page is clickable.
"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta

from openleads.workspace import activity, deals, duplicates, scoring
from openleads.workspace import tasks as taskmod
from openleads.workspace.stages import CONTACT_STAGES

DAY = 86400


def _midnight(ts: float) -> float:
    return datetime.combine(datetime.fromtimestamp(ts).date(), datetime.min.time()).timestamp()


def _series(db, sql: str, params, days: int, now: float) -> list:
    """Per-day counts for the last ``days`` days (oldest first), zero-filled."""
    start = _midnight(now) - (days - 1) * DAY
    counts: dict = {}
    for r in db.query(sql, (*params, start)):
        d = datetime.fromtimestamp(r["ts"]).date().isoformat()
        counts[d] = counts.get(d, 0) + 1
    first = date.fromtimestamp(start)
    return [{"date": (first + timedelta(days=i)).isoformat(),
             "count": counts.get((first + timedelta(days=i)).isoformat(), 0)}
            for i in range(days)]


def home(db, now: float | None = None, days: int = 30, checklist: bool = True) -> dict:
    from openleads.outreach import deliverability
    now = time.time() if now is None else now
    today = _midnight(now)
    total = db.scalar("SELECT COUNT(*) FROM leads", default=0)
    sent_since = lambda t: db.scalar(  # noqa: E731
        "SELECT COUNT(*) FROM touches WHERE status='sent' AND ts >= ?", (t,), default=0)
    contacted = db.scalar("SELECT COUNT(*) FROM leads WHERE last_contacted IS NOT NULL",
                          default=0)
    replied = db.scalar("SELECT COUNT(*) FROM leads WHERE status='replied' OR stage IN "
                        "('replied', 'interested', 'meeting', 'customer')", default=0)
    bounced = db.scalar("SELECT COUNT(*) FROM leads WHERE status='bounced'", default=0)
    stage_counts = {r["stage"]: r["n"] for r in db.query(
        "SELECT COALESCE(stage, 'new') AS stage, COUNT(*) AS n FROM leads GROUP BY stage")}
    board = deals.board(db)["totals"]
    month_start = datetime.fromtimestamp(now).replace(day=1, hour=0, minute=0, second=0,
                                                      microsecond=0).timestamp()
    won_month = db.query_one("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS v FROM deals "
                             "WHERE stage='won' AND closed >= ?", (month_start,)) or {}
    out = {
        "contacts": {"total": total,
                     "new_today": db.scalar("SELECT COUNT(*) FROM leads WHERE created >= ?",
                                            (today,), default=0),
                     "new_7d": db.scalar("SELECT COUNT(*) FROM leads WHERE created >= ?",
                                         (now - 7 * DAY,), default=0),
                     "safe": db.scalar("SELECT COUNT(*) FROM leads WHERE tier='safe'", default=0)},
        "companies": {"total": db.scalar("SELECT COUNT(*) FROM accounts", default=0)},
        "lists": {"total": db.scalar("SELECT COUNT(*) FROM lists", default=0)},
        "emails": {"sent_today": sent_since(today), "sent_7d": sent_since(now - 7 * DAY),
                   "sent_30d": sent_since(now - 30 * DAY), "contacted": contacted,
                   "replied": replied, "bounced": bounced,
                   "reply_rate": round(100 * replied / contacted, 1) if contacted else 0.0,
                   "bounce_rate": round(100 * bounced / contacted, 1) if contacted else 0.0,
                   "warmup": deliverability.warmup_status(db)},
        "tasks": taskmod.counts(db, now),
        "sequences": {
            "active": db.scalar("SELECT COUNT(*) FROM sequences WHERE status='active'", default=0),
            "total": db.scalar("SELECT COUNT(*) FROM sequences WHERE status != 'archived'",
                               default=0),
            "enrolled": db.scalar("SELECT COUNT(*) FROM enrollments WHERE status='active'",
                                  default=0),
            "due_now": db.scalar("SELECT COUNT(*) FROM enrollments e JOIN sequences s ON "
                                 "s.id = e.sequence_id WHERE e.status='active' AND "
                                 "s.status='active' AND e.task_id IS NULL AND e.next_due <= ?",
                                 (now,), default=0)},
        "deals": {**board, "won_month_count": int(won_month.get("n") or 0),
                  "won_month_value": round(float(won_month.get("v") or 0), 2)},
        "series": {
            "sent": _series(db, "SELECT ts FROM touches WHERE status='sent' AND ts >= ?", (),
                            days, now),
            "replied": _series(db, "SELECT ts FROM activity WHERE kind='replied' AND ts >= ?",
                               (), days, now),
            "added": _series(db, "SELECT created AS ts FROM leads WHERE created >= ?", (),
                             days, now),
        },
        "funnel": [{"key": k, "label": lab, "tone": tone, "count": stage_counts.get(k, 0)}
                   for k, lab, tone in CONTACT_STAGES],
        "grades": scoring.distribution(db),
        "activity": activity.recent(db, limit=20),
    }
    if checklist:
        out["checklist"] = setup_checklist(db, total)
    return out


def setup_checklist(db, total_contacts: int | None = None) -> list:
    from openleads import settings
    if total_contacts is None:
        total_contacts = db.scalar("SELECT COUNT(*) FROM leads", default=0)
    items = [
        ("search", "Find your first leads", total_contacts > 0, "prospect"),
        ("mailbox", "Connect a mailbox", bool(settings.get("smtp_user")), "settings"),
        ("pitch", "Write your one-line pitch", bool(settings.get("sender_context")), "settings"),
        ("list", "Save people to a list",
         db.scalar("SELECT COUNT(*) FROM lists", default=0) > 0, "people"),
        ("sequence", "Launch a sequence",
         db.scalar("SELECT COUNT(*) FROM sequences WHERE status='active'", default=0) > 0,
         "sequences"),
        ("icp", "Describe your ideal customer", bool(db.kv_get(scoring.KV_KEY)), "settings"),
    ]
    return [{"key": k, "label": lab, "done": bool(done), "route": route}
            for k, lab, done, route in items]


def health(db, now: float | None = None) -> dict:
    """Data problems worth fixing, each with the People filter that lists them."""
    now = time.time() if now is None else now
    total = db.scalar("SELECT COUNT(*) FROM leads", default=0)

    def count(where: str, params=()) -> int:
        return db.scalar(f"SELECT COUNT(*) FROM leads l WHERE {where}", params, default=0)

    checks = [
        ("unverified", "Email not verified safe", count("COALESCE(tier, '') != 'safe'"),
         {"tier": ["risky", "(none)"]}, "warn"),
        ("guessed", "Email is a guess", count("evidence = 'guessed'"),
         {"evidence": ["guessed"]}, "warn"),
        ("bounced", "Bounced", count("status = 'bounced'"), {"status": ["bounced"]}, "bad"),
        ("no_title", "Missing job title",
         count("COALESCE(title, '') IN ('', 'Team member', 'Team / contact address') "
               "AND COALESCE(first_name, '') != ''"), {"seniority": ["(none)"]}, "info"),
        ("no_phone", "No phone number", count("COALESCE(phone, '') = ''"),
         {"has_phone": "no"}, "info"),
        ("no_linkedin", "No LinkedIn", count("COALESCE(linkedin_url, '') = ''"),
         {"has_linkedin": "no"}, "info"),
        ("company_only", "Company address, no person", count("COALESCE(first_name, '') = ''"),
         {"seniority": ["(none)"]}, "info"),
        ("stale", "Untouched for 90 days",
         count("updated < ? AND last_contacted IS NULL", (now - 90 * DAY,)),
         {"contacted": "never"}, "info"),
    ]
    dup_groups = duplicates.find(db, limit=100000)
    return {
        "total": total,
        "checks": [{"key": k, "label": lab, "count": n, "filter": f, "tone": tone,
                    "pct": round(100 * n / total, 1) if total else 0.0}
                   for k, lab, n, f, tone in checks],
        "duplicates": {"groups": len(dup_groups),
                       "contacts": sum(len(g) - 1 for g in dup_groups)},
        "suppressed": db.scalar("SELECT COUNT(*) FROM suppression", default=0),
        "unprofiled_companies": db.scalar("SELECT COUNT(*) FROM accounts WHERE profiled IS NULL",
                                          default=0),
    }
