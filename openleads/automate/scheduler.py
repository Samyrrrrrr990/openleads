"""
On-device send automation — let your machine run outreach for you, on a schedule.

Two layers:

* **OS scheduling** (this is the "on device" part): generate *and install* a real
  launchd agent (macOS) or crontab line (Linux) that wakes daily and runs the drip.
  ``install``/``uninstall``/``status`` manage it; the plist/cron text is produced by
  pure functions so it's testable without touching the system.
* **The daily tick** (:func:`tick`): one cycle of actual work — run any **scheduled
  campaigns** whose hour has arrived (find → write → send, warmup-capped) and send
  any sequence **follow-ups** that are due. Idempotent and safe to run repeatedly.

A campaign configured by the chat assistant ("send 50 emails for X at 9am") is just a
row saved via :func:`save_scheduled_campaign`; installing the agent at that hour is
what makes it fire unattended.
"""
from __future__ import annotations

import subprocess
import sys
import time
from datetime import date
from pathlib import Path

from openleads import config
from openleads import db as dbmod
from openleads import settings
from openleads.outreach import sequences as seqmod
from openleads.outreach.sender import send_drafts

DAY = 86400
LABEL = "dev.openleads.drip"


def _openleads_cmd() -> str:
    """The command the scheduler runs. Prefer the installed console script."""
    return f"{sys.executable} -m openleads drip --live"


# --- pure generators (unit-tested) -------------------------------------------- #
def cron_line(hour: int = 9, minute: int = 0, command: str | None = None) -> str:
    """A crontab line that runs the daily drip at ``hour:minute`` local time."""
    return f"{minute} {hour} * * *  {command or _openleads_cmd()}  # OpenLeads daily drip"


# Back-compat alias (v3.1 name).
def cron_snippet(hour: int = 9, command: str = "openleads run --drip --live") -> str:
    return cron_line(hour, 0, command)


def launchd_plist(hour: int = 9, minute: int = 0, command: str | None = None,
                  label: str = LABEL) -> str:
    """Generate a launchd agent plist that runs the drip daily at ``hour:minute``."""
    cmd = command or _openleads_cmd()
    args = "".join(f"      <string>{a}</string>\n" for a in cmd.split())
    log = str(config.home() / "drip.log")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0">\n'
        '<dict>\n'
        f'    <key>Label</key>\n    <string>{label}</string>\n'
        '    <key>ProgramArguments</key>\n    <array>\n'
        f'{args}    </array>\n'
        '    <key>StartCalendarInterval</key>\n    <dict>\n'
        f'      <key>Hour</key>\n      <integer>{hour}</integer>\n'
        f'      <key>Minute</key>\n      <integer>{minute}</integer>\n'
        '    </dict>\n'
        f'    <key>StandardOutPath</key>\n    <string>{log}</string>\n'
        f'    <key>StandardErrorPath</key>\n    <string>{log}</string>\n'
        '    <key>RunAtLoad</key>\n    <false/>\n'
        '</dict>\n</plist>\n'
    )


def launchd_snippet(hour: int = 9, command: str = "openleads drip --live") -> str:
    return (f"# macOS: install a launchd agent with `openleads schedule --at {hour:02d}:00`,\n"
            f"# or add this crontab line:\n{cron_line(hour, 0, command)}")


def _plist_path(label: str = LABEL) -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"


# --- OS install / uninstall / status ------------------------------------------ #
def install(hour: int = 9, minute: int = 0) -> dict:
    """Install an on-device daily drip at ``hour:minute``. Picks launchd on macOS,
    crontab on Linux. Returns ``{ok, kind, detail, path?}``."""
    if sys.platform == "darwin":
        return _install_launchd(hour, minute)
    return _install_cron(hour, minute)


def uninstall() -> dict:
    if sys.platform == "darwin":
        return _uninstall_launchd()
    return _uninstall_cron()


def status() -> dict:
    """Report whether on-device automation is currently installed."""
    if sys.platform == "darwin":
        p = _plist_path()
        return {"installed": p.exists(), "kind": "launchd", "path": str(p)}
    installed = "OpenLeads daily drip" in _read_crontab()
    return {"installed": installed, "kind": "cron", "path": "crontab"}


def _install_launchd(hour: int, minute: int) -> dict:
    path = _plist_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(launchd_plist(hour, minute), encoding="utf-8")
    # Reload so the new schedule takes effect (ignore failures in headless/CI).
    subprocess.run(["launchctl", "unload", str(path)],
                   capture_output=True, check=False)
    r = subprocess.run(["launchctl", "load", str(path)], capture_output=True, check=False)
    loaded = r.returncode == 0
    return {"ok": True, "kind": "launchd", "path": str(path),
            "detail": f"agent installed at {hour:02d}:{minute:02d} daily"
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


def _read_crontab() -> str:
    r = subprocess.run(["crontab", "-l"], capture_output=True, text=True, check=False)
    return r.stdout if r.returncode == 0 else ""


def _write_crontab(text: str) -> bool:
    r = subprocess.run(["crontab", "-"], input=text, text=True,
                       capture_output=True, check=False)
    return r.returncode == 0


def _install_cron(hour: int, minute: int) -> dict:
    existing = [ln for ln in _read_crontab().splitlines()
                if "OpenLeads daily drip" not in ln]
    existing.append(cron_line(hour, minute))
    ok = _write_crontab("\n".join(existing) + "\n")
    return {"ok": ok, "kind": "cron",
            "detail": f"crontab updated for {hour:02d}:{minute:02d} daily" if ok
                      else "could not write crontab (is cron available?)"}


def _uninstall_cron() -> dict:
    lines = [ln for ln in _read_crontab().splitlines()
             if "OpenLeads daily drip" not in ln]
    ok = _write_crontab("\n".join(lines) + "\n")
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
        db.save_campaign(name, spec)
    finally:
        if own:
            db.close()


def due_campaigns(db, now=None) -> list[dict]:
    """Scheduled campaigns whose hour has arrived today and that haven't run today."""
    now = now or time.localtime()
    today = date.today().isoformat()
    out = []
    for row in db.list_campaigns():
        spec = row.get("data") or {}
        if not spec.get("enabled", True):
            continue
        if spec.get("last_run") == today:
            continue
        if now.tm_hour >= int(spec.get("send_hour", 9)):
            out.append({"name": row["name"], "spec": spec})
    return out


# --- the daily tick ----------------------------------------------------------- #
def tick(db=None, dry_run: bool = True, campaign: str = "default", on_progress=None) -> dict:
    """One drip cycle: run due scheduled campaigns, then send due follow-ups."""
    own_db = False
    if db is None:
        db = dbmod.DB()
        own_db = True
    on_progress = on_progress or (lambda *_: None)
    summary = {"campaigns_run": 0, "campaign_sent": 0, "due": 0, "sent": 0, "results": []}
    try:
        # 1) scheduled campaigns (initial outreach)
        from openleads.automate import pipeline
        for item in due_campaigns(db):
            spec = item["spec"]
            on_progress("campaign", item["name"])
            out = pipeline.quick(spec.get("query", ""), count=int(spec.get("count", 25)),
                                 send=True, dry_run=dry_run,
                                 overrides={"sender_context": spec.get("context")} if
                                 spec.get("context") else None)
            summary["campaigns_run"] += 1
            summary["campaign_sent"] += sum(1 for r in out.get("results", [])
                                            if r.status == "sent")
            spec["last_run"] = date.today().isoformat()
            db.save_campaign(item["name"], spec)

        # 2) sequence follow-ups
        due = seqmod.due(db, campaign=campaign)
        summary["due"] = len(due)
        drafts = []
        sender_name = settings.get("sender_name") or "Me"
        for d in due:
            lead = db.get_lead(d["email"]) or {}
            lead["first_name"] = (lead.get("name") or "").split(" ")[0]
            drafts.append(seqmod.followup_draft(lead, d["step"], sender=sender_name))
        results = send_drafts(drafts, dry_run=dry_run, db=db, campaign=campaign,
                              step=0, on_progress=lambda r: on_progress("send", r)) \
            if drafts else []
        summary["sent"] = sum(1 for r in results if r.status == "sent")
        summary["results"] = results
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
