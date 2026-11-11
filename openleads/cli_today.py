"""
``openleads today``: what needs you, in a terminal.

Prints the Today briefing (:mod:`openleads.today`) in priority order: replies,
emails to approve, tasks, new leads, heads-ups. On a real terminal it then steps
through the replies, drafts and tasks with one-key actions. Piped, with
``--no-input`` or ``--json`` it only prints and never reads stdin.
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import tempfile
import time
from datetime import datetime

from openleads import today, ui
from openleads.db import DB

_LEVEL_MARK = {"bad": ("✗", ui.RED), "warn": ("!", ui.AMBER), "info": ("·", ui.GREY)}


# --------------------------------------------------------------------------- #
# Terminal input                                                              #
# --------------------------------------------------------------------------- #
def _interactive() -> bool:
    try:
        return sys.stdin.isatty() and sys.stdout.isatty()
    except (AttributeError, ValueError):
        return False


def _read_key(prompt: str) -> str:
    """One key press, lower-cased. Ctrl-C, Ctrl-D and end of input mean quit."""
    sys.stdout.write(prompt)
    sys.stdout.flush()
    try:
        import termios
        import tty
    except ImportError:            # Windows: read a line instead
        try:
            line = input()
        except (EOFError, KeyboardInterrupt):
            print()
            return "q"
        return (line.strip()[:1] or "n").lower()
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        ch = sys.stdin.read(1)
    except KeyboardInterrupt:
        ch = "q"
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    print(ch if ch.isprintable() else "")
    if not ch or ch in ("\x03", "\x04", "\x1b"):
        return "q"
    return ch.lower()


def _ask(prompt: str, allowed: str) -> str:
    while True:
        key = _read_key(prompt)
        if key in allowed:
            return key


def _parse_edited(text: str) -> tuple | None:
    """``Subject: ...`` then a blank line then the body, as (subject, body)."""
    head, sep, body = (text or "").replace("\r\n", "\n").partition("\n\n")
    if not head.lower().startswith("subject:"):
        return None
    return head[len("subject:"):].strip(), body.strip()


def _edit(subject: str, body: str) -> tuple | None:
    editor = os.environ.get("VISUAL") or os.environ.get("EDITOR") or (
        "notepad" if os.name == "nt" else "vi")
    fd, path = tempfile.mkstemp(suffix=".txt", prefix="openleads-draft-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(f"Subject: {subject}\n\n{body}\n")
        if subprocess.call(shlex.split(editor) + [path]) != 0:
            return None
        with open(path, encoding="utf-8") as f:
            return _parse_edited(f.read())
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


# --------------------------------------------------------------------------- #
# Printing                                                                    #
# --------------------------------------------------------------------------- #
def _ago(ts, now: float) -> str:
    secs = max(0, now - float(ts or now))
    if secs < 3600:
        return f"{max(1, int(secs // 60))}m ago"
    if secs < 86400:
        return f"{int(secs // 3600)}h ago"
    return f"{int(secs // 86400)}d ago"


def _due(ts, now: float) -> str:
    if not ts:
        return "no date"
    d = datetime.fromtimestamp(float(ts))
    days = (d.date() - datetime.fromtimestamp(now).date()).days
    if days < 0:
        return f"{-days}d overdue"
    return "today " + d.strftime("%H:%M")


def _who(name: str, email: str, org: str = "") -> str:
    who = f"{name} <{email}>" if name else email
    return f"{who} · {org}" if org else who


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _reply_line(r: dict, now: float) -> str:
    return (f"  {_who(r.get('name'), r['email'], r.get('organization'))}  "
            + ui.c(_ago(r.get("received"), now), ui.GREY)
            + f"\n    \"{r.get('snippet') or r.get('subject') or ''}\"")


def _draft_line(d: dict) -> str:
    score = d.get("quality")
    extra = ui.c(f"  quality {int(score)}", ui.GREY) if score is not None else ""
    return f"  #{d['id']} to {d['email']}  \"{d['subject']}\"{extra}"


def _task_line(t: dict, now: float) -> str:
    who = f"  ({t['contact']})" if t.get("contact") else ""
    return f"  {t['title']}{who}  " + ui.c(_due(t.get("due"), now), ui.GREY)


def summary(b: dict) -> str:
    n = b["counts"]
    parts = []
    if n["replies"]:
        parts.append(_plural(n["replies"], "reply", "replies"))
    if n["drafts"]:
        parts.append(_plural(n["drafts"], "email to approve", "emails to approve"))
    if n["tasks"]:
        parts.append(_plural(n["tasks"], "task", "tasks"))
    if not parts:
        return "Nothing needs you right now."
    return ", ".join(parts) + ". Nothing else needs you."


def render(b: dict, now: float) -> str:
    lines = [ui.c("Today", ui.BOLD)]

    def section(title: str, rows: list) -> None:
        if rows:
            lines.extend(["", ui.c(title, ui.BOLD)] + rows)

    section(f"Replies ({len(b['replies'])})", [_reply_line(r, now) for r in b["replies"]])
    more = b["counts"]["drafts"] - len(b["drafts"])
    section(f"Emails to approve ({b['counts']['drafts']})",
            [_draft_line(d) for d in b["drafts"]] + ([f"  …and {more} more"] if more > 0 else []))
    due = b["tasks"]["overdue"] + b["tasks"]["today"]
    section(f"Tasks ({len(due)})", [_task_line(t, now) for t in due])
    nl = b["new_leads"]
    rows = [f"  {_who(x.get('name'), x['email'], x.get('organization'))}" for x in nl["items"]]
    if nl["count"] > len(nl["items"]):
        rows.append(f"  …and {nl['count'] - len(nl['items'])} more (openleads people)")
    section(f"New leads ({nl['count']} since you last looked)", rows)
    marks = []
    for h in b["heads_up"]:
        mark, color = _LEVEL_MARK.get(h["level"], ("·", ui.GREY))
        marks.append(f"  {ui.c(mark, color)} {h['message']}")
    section("Heads-up", marks)
    lines += ["", summary(b)]
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# One-key actions                                                             #
# --------------------------------------------------------------------------- #
def _tomorrow_nine(now: float) -> float:
    from openleads.workspace import tasks
    return tasks.parse_due("tomorrow", now=now)


def _step(db, b: dict, now: float) -> None:
    from openleads.outreach import replies
    from openleads.workspace import drafts, tasks
    for r in b["replies"]:
        print("\n" + _reply_line(r, now))
        key = _ask("  [d]one  [z] snooze to tomorrow 9:00  [n]ext  [q]uit  ", "dznq")
        if key == "q":
            return
        if key == "d":
            replies.mark_done(db, r["email"])
            print(ui.c("  marked done", ui.GREEN))
        elif key == "z":
            today.snooze(db, "reply", r["email"], _tomorrow_nine(now))
            print(ui.c("  snoozed until tomorrow 9:00", ui.GREY))
    for d in b["drafts"]:
        print("\n" + _draft_line(d) + "\n\n" + "\n".join("    " + x for x in d["body"].splitlines()))
        key = _ask("  [a]pprove  [e]dit  [s]kip  [n]ext  [q]uit  ", "aesnq")
        if key == "q":
            return
        if key == "s":
            drafts.skip(db, d["id"])
            print(ui.c("  skipped", ui.GREY))
        elif key in "ae":
            edits = {}
            if key == "e":
                got = _edit(d["subject"], d["body"])
                if got is None:
                    print(ui.c("  couldn't read the edit (keep the 'Subject:' line); "
                               "draft left waiting", ui.AMBER))
                    continue
                edits = {"subject": got[0], "body": got[1]}
            res = drafts.approve(db, d["id"], **edits)
            color = ui.GREEN if res["status"] == "sent" else ui.AMBER
            print(ui.c(f"  {res['status']}" + (f": {res['detail']}" if res.get("detail") else ""),
                       color))
    for t in b["tasks"]["overdue"] + b["tasks"]["today"]:
        print("\n" + _task_line(t, now))
        key = _ask("  [d]one  [z] snooze to tomorrow 9:00  [n]ext  [q]uit  ", "dznq")
        if key == "q":
            return
        if key == "d":
            tasks.complete(db, t["id"])
            print(ui.c("  done", ui.GREEN))
        elif key == "z":
            today.snooze(db, "task", str(t["id"]), _tomorrow_nine(now))
            print(ui.c("  moved to tomorrow 9:00", ui.GREY))


def cmd_today(args) -> int:
    now = time.time()
    db = DB()
    try:
        b = today.briefing(db, now=now)
        if args.json:
            print(json.dumps(b, indent=2, default=str))
        else:
            print(render(b, now))
        today.mark_seen(db, now=now)
        has_items = b["replies"] or b["drafts"] or b["tasks"]["overdue"] or b["tasks"]["today"]
        if not args.json and not args.no_input and has_items and _interactive():
            _step(db, b, now)
    finally:
        db.close()
    return 0


def register(sub) -> None:
    td = sub.add_parser("today", help="what needs you: replies, approvals, tasks, new leads",
                        description="Replies waiting on you, emails to approve, tasks due, new "
                                    "leads and heads-ups. On a terminal, act on each with one key.",
                        formatter_class=argparse.RawDescriptionHelpFormatter)
    td.add_argument("--json", action="store_true", help="print the briefing as JSON")
    td.add_argument("--no-input", action="store_true", help="print only; never ask for a key")
    td.set_defaults(func=cmd_today)
