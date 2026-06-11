"""
Hands-off drip — keep outreach moving daily without babysitting a terminal.

Two modes:

* :func:`cron_snippet` / :func:`launchd_snippet` print a one-line OS scheduler
  entry so the machine runs a daily drip for you.
* :func:`run_daily_loop` is a simple foreground loop (handy in a tmux pane or a
  container) that wakes once a day, sends due follow-ups, and stops cleanly.

The actual work is one tick: send any sequence follow-ups that are due today,
within the warmup cap. Finding fresh leads stays an explicit user action.
"""
from __future__ import annotations

import time

from openleads import db as dbmod
from openleads import settings
from openleads.outreach import sequences as seqmod
from openleads.outreach.sender import send_drafts

DAY = 86400


def cron_snippet(hour: int = 9, command: str = "openleads run --drip --live") -> str:
    """A crontab line that runs the daily drip at ``hour``:00 local time."""
    return f"{0} {hour} * * *  {command}  # OpenLeads daily drip"


def launchd_snippet(hour: int = 9, command: str = "openleads run --drip --live") -> str:
    """A macOS launchd hint (kept short; full plist generation is out of scope)."""
    return (f"# macOS: run `{command}` daily at {hour:02d}:00 via launchd or, simplest,\n"
            f"# add this crontab line:\n{cron_snippet(hour, command)}")


def tick(db=None, dry_run: bool = True, campaign: str = "default", on_progress=None) -> dict:
    """One drip cycle: send all sequence follow-ups that are due now."""
    own_db = False
    if db is None:
        db = dbmod.DB()
        own_db = True
    on_progress = on_progress or (lambda *_: None)
    try:
        due = seqmod.due(db, campaign=campaign)
        drafts = []
        sender_name = settings.get("sender_name") or "Me"
        for item in due:
            lead = db.get_lead(item["email"]) or {}
            lead["first_name"] = (lead.get("name") or "").split(" ")[0]
            drafts.append(seqmod.followup_draft(lead, item["step"], sender=sender_name))
        results = send_drafts(drafts, dry_run=dry_run, db=db, campaign=campaign,
                              step=0, on_progress=lambda r: on_progress("send", r)) if drafts else []
        return {"due": len(due), "sent": sum(1 for r in results if r.status == "sent"),
                "results": results}
    finally:
        if own_db:
            db.close()


def run_daily_loop(dry_run: bool = True, campaign: str = "default",
                   ticks: int | None = None, on_progress=None) -> None:
    """Foreground loop: run :func:`tick` once per day. ``ticks`` bounds it (tests)."""
    on_progress = on_progress or (lambda *_: None)
    n = 0
    while ticks is None or n < ticks:
        summary = tick(dry_run=dry_run, campaign=campaign, on_progress=on_progress)
        on_progress("tick", summary)
        n += 1
        if ticks is not None and n >= ticks:
            break
        time.sleep(DAY)
