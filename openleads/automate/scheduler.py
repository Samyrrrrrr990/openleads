"""
On-device automation — let your machine run your recipes on a schedule.

Two layers:

* **OS scheduling** (the "on device" part): install a launchd agent (macOS), a
  crontab line (Linux), or a Task Scheduler task (Windows). By default it's a
  **heartbeat**: it wakes every 15 minutes and runs ``openleads drip``, which fires
  whatever is due. Each recipe/watcher carries its own schedule ("weekdays 9am",
  "every 2h", cron), so one agent serves all of them. The legacy fixed daily time
  (``openleads schedule 09:00``) still works.
* **The tick** (:func:`tick`): one cycle of work — run every recipe and watcher whose
  schedule says it's due, then send due follow-ups. Each job is timed, logged to the
  run history, and isolated: one failure alerts you and the rest still run.

The plist/cron/schtasks text comes from pure functions so it's testable without
touching the system.
"""
from __future__ import annotations

import shlex
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

from openleads import config, settings
from openleads import db as dbmod
from openleads.automate import history
from openleads.automate import schedule as schedmod
from openleads.outreach import sequences as seqmod
from openleads.outreach.sender import send_drafts

DAY = 86400
LABEL = "dev.openleads.drip"
WIN_TASK = "OpenLeads Drip"
HEARTBEAT_MINUTES = 15
# Marker comments identifying our crontab lines (daily = legacy fixed time).
CRON_MARKERS = ("OpenLeads daily drip", "OpenLeads drip heartbeat")
# Watchers without their own schedule run once a day at this time.
DEFAULT_WATCH_SCHEDULE = "daily 09:00"


def command_args() -> list[str]:
    """The argv the OS agent runs. A list, so paths with spaces survive intact."""
    return [sys.executable, "-m", "openleads", "drip", "--live"]


def _openleads_cmd() -> str:
    """The agent command as one shell-quoted string (for cron)."""
    return " ".join(shlex.quote(a) for a in command_args())


def _args(command: str | list | None) -> list[str]:
    if command is None:
        return command_args()
    if isinstance(command, str):
        return shlex.split(command)
    return list(command)


# --- pure generators (unit-tested) -------------------------------------------- #
def cron_line(hour: int | None = 9, minute: int = 0, command: str | list | None = None,
              every_minutes: int = HEARTBEAT_MINUTES) -> str:
    """A crontab line: daily at ``hour:minute``, or every ``every_minutes`` if hour is None."""
    cmd = " ".join(shlex.quote(a) for a in _args(command))
    if hour is None:
        return f"*/{every_minutes} * * * *  {cmd}  # {CRON_MARKERS[1]}"
    return f"{minute} {hour} * * *  {cmd}  # {CRON_MARKERS[0]}"


def launchd_plist(hour: int | None = 9, minute: int = 0, command: str | list | None = None,
                  label: str = LABEL, every_minutes: int = HEARTBEAT_MINUTES) -> str:
    """A launchd agent plist: daily at ``hour:minute``, or every N minutes if hour is None."""
    args = "".join(f"      <string>{escape(a)}</string>\n" for a in _args(command))
    log = escape(str(config.home() / "drip.log"))
    if hour is None:
        when = f"    <key>StartInterval</key>\n    <integer>{every_minutes * 60}</integer>\n"
    else:
        when = ('    <key>StartCalendarInterval</key>\n    <dict>\n'
                f'      <key>Hour</key>\n      <integer>{hour}</integer>\n'
                f'      <key>Minute</key>\n      <integer>{minute}</integer>\n'
                '    </dict>\n')
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0">\n'
        '<dict>\n'
        f'    <key>Label</key>\n    <string>{escape(label)}</string>\n'
        '    <key>ProgramArguments</key>\n    <array>\n'
        f'{args}    </array>\n'
        f'{when}'
        f'    <key>StandardOutPath</key>\n    <string>{log}</string>\n'
        f'    <key>StandardErrorPath</key>\n    <string>{log}</string>\n'
        '    <key>RunAtLoad</key>\n    <false/>\n'
        '</dict>\n</plist>\n'
    )


def schtasks_args(hour: int | None = None, minute: int = 0, command: str | list | None = None,
                  every_minutes: int = HEARTBEAT_MINUTES, name: str = WIN_TASK) -> list[str]:
    """``schtasks /Create`` argv for Windows (daily, or every N minutes)."""
    tr = subprocess.list2cmdline(_args(command))
    base = ["schtasks", "/Create", "/F", "/TN", name, "/TR", tr]
    if hour is None:
        return base + ["/SC", "MINUTE", "/MO", str(every_minutes)]
    return base + ["/SC", "DAILY", "/ST", f"{hour:02d}:{minute:02d}"]


def _plist_path(label: str = LABEL) -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"


def _describe(hour, minute, every_minutes) -> str:
    if hour is None:
        return f"heartbeat every {every_minutes} min (runs whatever is due)"
    return f"daily at {hour:02d}:{minute:02d}"


# --- OS install / uninstall / status ------------------------------------------ #
def install(hour: int | None = None, minute: int = 0,
            every_minutes: int = HEARTBEAT_MINUTES) -> dict:
    """Install the on-device agent. ``hour=None`` (default) installs the heartbeat;
    an hour installs the legacy fixed daily run. Returns ``{ok, kind, detail, path?}``."""
    if sys.platform == "darwin":
        return _install_launchd(hour, minute, every_minutes)
    if sys.platform.startswith("win"):
        return _install_windows(hour, minute, every_minutes)
    return _install_cron(hour, minute, every_minutes)


def uninstall() -> dict:
    if sys.platform == "darwin":
        return _uninstall_launchd()
    if sys.platform.startswith("win"):
        return _uninstall_windows()
    return _uninstall_cron()


def status() -> dict:
    """Report whether on-device automation is currently installed."""
    if sys.platform == "darwin":
        p = _plist_path()
        mode = ""
        if p.exists():
            mode = "heartbeat" if "StartInterval" in p.read_text(encoding="utf-8") else "daily"
        return {"installed": p.exists(), "kind": "launchd", "path": str(p), "mode": mode}
    if sys.platform.startswith("win"):
        r = subprocess.run(["schtasks", "/Query", "/TN", WIN_TASK], capture_output=True,
                           text=True, check=False)
        return {"installed": r.returncode == 0, "kind": "schtasks", "path": WIN_TASK,
                "mode": ""}
    tab = _read_crontab()
    mode = "heartbeat" if CRON_MARKERS[1] in tab else ("daily" if CRON_MARKERS[0] in tab else "")
    return {"installed": bool(mode), "kind": "cron", "path": "crontab", "mode": mode}


def _install_launchd(hour, minute, every_minutes) -> dict:
    path = _plist_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(launchd_plist(hour, minute, every_minutes=every_minutes), encoding="utf-8")
    # Reload so the new schedule takes effect (ignore failures in headless/CI).
    subprocess.run(["launchctl", "unload", str(path)], capture_output=True, check=False)
    r = subprocess.run(["launchctl", "load", str(path)], capture_output=True, check=False)
    loaded = r.returncode == 0
    return {"ok": True, "kind": "launchd", "path": str(path),
            "detail": f"agent installed — {_describe(hour, minute, every_minutes)}"
                      + ("" if loaded else " (run `launchctl load` to activate)")}


def _uninstall_launchd() -> dict:
    path = _plist_path()
    if not path.exists():
        return {"ok": True, "kind": "launchd", "detail": "no agent installed"}
    subprocess.run(["launchctl", "unload", str(path)], capture_output=True, check=False)
    try:
        path.unlink()
    except OSError as e:
        return {"ok": False, "kind": "launchd", "detail": str(e)}
    return {"ok": True, "kind": "launchd", "detail": "agent removed"}


def _install_windows(hour, minute, every_minutes) -> dict:
    r = subprocess.run(schtasks_args(hour, minute, every_minutes=every_minutes),
                       capture_output=True, text=True, check=False)
    ok = r.returncode == 0
    return {"ok": ok, "kind": "schtasks", "path": WIN_TASK,
            "detail": f"task installed — {_describe(hour, minute, every_minutes)}" if ok
                      else (r.stderr or r.stdout or "schtasks failed").strip()}


def _uninstall_windows() -> dict:
    r = subprocess.run(["schtasks", "/Delete", "/F", "/TN", WIN_TASK], capture_output=True,
                       text=True, check=False)
    return {"ok": r.returncode == 0, "kind": "schtasks",
            "detail": "task removed" if r.returncode == 0 else "no task installed"}


def _read_crontab() -> str:
    try:
        r = subprocess.run(["crontab", "-l"], capture_output=True, text=True, check=False)
    except OSError:
        return ""
    return r.stdout if r.returncode == 0 else ""


def _write_crontab(text: str) -> bool:
    try:
        r = subprocess.run(["crontab", "-"], input=text, text=True,
                           capture_output=True, check=False)
    except OSError:
        return False
    return r.returncode == 0


def _without_ours(tab: str) -> list[str]:
    return [ln for ln in tab.splitlines() if not any(m in ln for m in CRON_MARKERS)]


def _install_cron(hour, minute, every_minutes) -> dict:
    lines = _without_ours(_read_crontab())
    lines.append(cron_line(hour, minute, every_minutes=every_minutes))
    ok = _write_crontab("\n".join(lines) + "\n")
    return {"ok": ok, "kind": "cron",
            "detail": f"crontab updated — {_describe(hour, minute, every_minutes)}" if ok
                      else "could not write crontab (is cron available?)"}


def _uninstall_cron() -> dict:
    ok = _write_crontab("\n".join(_without_ours(_read_crontab())) + "\n")
    return {"ok": ok, "kind": "cron",
            "detail": "removed from crontab" if ok else "could not write crontab"}


# --- scheduled campaigns ------------------------------------------------------ #
def save_scheduled_campaign(name: str, spec: dict, db=None) -> None:
    """Persist a campaign the daily drip will run. ``spec`` carries query/count/
    context/send_hour/enabled."""
    own = db is None
    db = db or dbmod.DB()
    try:
        spec = dict(spec)
        spec.setdefault("enabled", True)
        spec.setdefault("send_hour", 9)
        spec.setdefault("created_at", datetime.now().isoformat(timespec="seconds"))
        db.save_campaign(name, spec)
    finally:
        if own:
            db.close()


def _as_datetime(now) -> datetime:
    if now is None:
        return datetime.now()
    if isinstance(now, datetime):
        return now
    return datetime(*now[:6])          # time.struct_time (older callers/tests)


def last_run_of(spec: dict) -> datetime | None:
    """When a job last ran. A legacy date-only ``last_run`` counts as end of that day."""
    at = schedmod.parse_ts(spec.get("last_run_at"))
    if at:
        return at
    day = schedmod.parse_ts(spec.get("last_run"))
    return day.replace(hour=23, minute=59) if day else None


def job_is_due(spec: dict, now=None, default: str | None = None) -> bool:
    """True if this recipe/watcher spec's schedule has a moment since it last ran."""
    if not spec.get("enabled", True):
        return False
    try:
        sched = schedmod.from_spec(spec) or (schedmod.parse(default) if default else None)
    except schedmod.ScheduleError:
        return False
    if sched is None:
        return False
    # A job that has never run catches up on today's slot (e.g. a 09:00 recipe saved
    # at 10:30 runs on the next heartbeat), matching how daily recipes always worked.
    return schedmod.is_due(sched, _as_datetime(now), last_run_of(spec))


def mark_ran(spec: dict, now=None) -> dict:
    now = _as_datetime(now)
    spec["last_run_at"] = now.isoformat(timespec="seconds")
    spec["last_run"] = now.date().isoformat()
    return spec


def due_campaigns(db, now=None) -> list[dict]:
    """Scheduled recipes/campaigns whose schedule has fired since they last ran."""
    out = []
    for row in db.list_campaigns():
        spec = row.get("data") or {}
        if job_is_due(spec, now):
            out.append({"name": row["name"], "spec": spec})
    return out


# --- the tick ------------------------------------------------------------------ #
def tick(db=None, dry_run: bool = True, campaign: str = "default", on_progress=None,
         now=None) -> dict:
    """One automation cycle, in order:

    1. **inbox sync** — mark replies/bounces (so sequences self-stop) if IMAP is set.
    2. **recipes** — run every recipe whose schedule is due (find → write → send → export).
    3. **watchers** — run every watcher whose schedule is due; deliver new matches.
    4. **follow-ups** — send due sequence steps to leads who haven't replied/bounced.

    Every job is timed and written to the run history; a failing job sends an alert
    and the tick carries on.
    """
    own_db = False
    if db is None:
        db = dbmod.DB()
        own_db = True
    on_progress = on_progress or (lambda *_: None)
    summary = {"inbox": {}, "campaigns_run": 0, "campaign_sent": 0, "failed": 0,
               "watchers_run": 0, "new_total": 0, "due": 0, "sent": 0, "results": []}
    try:
        from openleads.automate import recipes, watch
        from openleads.cache.store import Cache
        cache = Cache()

        # 1) inbox sync — keep the CRM honest before we follow up (optional/IMAP).
        if settings.get("imap_host") or settings.get("smtp_user"):
            try:
                from openleads.outreach import inbox
                summary["inbox"] = inbox.scan(db=db)
            except Exception:  # noqa: BLE001 — optional, never break the drip
                summary["inbox"] = {"error": "inbox scan skipped"}

        # 2) due recipes / scheduled campaigns (initial outreach + export)
        for item in due_campaigns(db, now):
            spec = dict(item["spec"])
            spec.setdefault("send", True)   # a scheduled recipe's purpose is to send
            spec["name"] = item["name"]
            on_progress("campaign", item["name"])
            res, entry = history.timed("recipe", item["name"], recipes.run, spec, db=db,
                                       cache=cache, dry_run=dry_run, on_progress=on_progress)
            summary["campaigns_run"] += 1
            if res is None:
                summary["failed"] += 1
            else:
                summary["campaign_sent"] += res.get("sent", 0)
            if not dry_run:
                stored = dict(item["spec"])
                db.save_campaign(item["name"], mark_ran(stored, now))

        # 3) watchers — new-match alerts, each on its own schedule (default daily).
        watchers = watch.list_watchers(db)
        for name, wspec in list(watchers.items()):
            if not job_is_due(wspec, now, default=DEFAULT_WATCH_SCHEDULE):
                continue
            on_progress("watch", name)
            res, _ = history.timed("watcher", name, watch.run_watcher, wspec, db=db,
                                   cache=cache, dry_run=dry_run, on_progress=on_progress)
            summary["watchers_run"] += 1
            if res is None:
                summary["failed"] += 1
            else:
                summary["new_total"] += res.get("new", 0)
            if not dry_run:
                current = watch.list_watchers(db)
                if name in current:
                    current[name] = mark_ran(current[name], now)
                    db.kv_set(watch.KV_KEY, current)

        # 4) sequence follow-ups
        def followups():
            due = seqmod.due(db, campaign=campaign)
            drafts = []
            sender_name = settings.get("sender_name") or "Me"
            for d in due:
                lead = db.get_lead(d["email"]) or {}
                lead["first_name"] = (lead.get("name") or "").split(" ")[0]
                drafts.append(seqmod.followup_draft(lead, d["step"], sender=sender_name))
            results = send_drafts(drafts, dry_run=dry_run, db=db, campaign=campaign,
                                  step=0, on_progress=lambda r: on_progress("send", r)) \
                if drafts else []
            return {"due": len(due), "sent": sum(1 for r in results if r.status == "sent"),
                    "results": results}

        res, _ = (followups(), None) if dry_run else history.timed(
            "follow-ups", campaign, followups)
        if res is None:
            summary["failed"] += 1
        else:
            summary.update(due=res["due"], sent=res["sent"], results=res["results"])
        cache.close()
        return summary
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
