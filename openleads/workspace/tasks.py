"""
Tasks — the to-do list a seller works through each morning: calls to make, manual
emails to write, LinkedIn touches, and plain to-dos.

Sequences create tasks for their manual steps; you can also add them by hand on a
contact, company or deal. :func:`list_tasks` buckets them the way the Tasks page
shows them: overdue, due today, upcoming, no date, done.
"""
from __future__ import annotations

import re
import time
from datetime import date, datetime, timedelta

from openleads.workspace import activity

KINDS = (("call", "Call"), ("email", "Email"), ("linkedin", "LinkedIn"), ("todo", "To-do"))
KIND_KEYS = tuple(k for k, _ in KINDS)
PRIORITIES = ("low", "normal", "high")
BUCKETS = ("open", "overdue", "today", "upcoming", "nodate", "done", "all")
EDITABLE = ("title", "note", "kind", "priority", "due", "contact", "account", "deal_id")


def _day_bounds(now: float | None = None) -> tuple:
    now = time.time() if now is None else now
    start = datetime.combine(datetime.fromtimestamp(now).date(), datetime.min.time())
    return start.timestamp(), (start + timedelta(days=1)).timestamp()


def parse_due(value, now: float | None = None) -> float | None:
    """A due time from a timestamp, 'today', 'tomorrow', '+3d', '+2h', 'mon' or an ISO date.

    Dates without a time are due at 09:00 local time, when a seller would do them.
    """
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip().lower()
    now = time.time() if now is None else now
    today = datetime.fromtimestamp(now).date()

    def at_nine(d: date) -> float:
        return datetime.combine(d, datetime.min.time()).replace(hour=9).timestamp()

    if text in ("now",):
        return now
    if text == "today":
        return at_nine(today)
    if text == "tomorrow":
        return at_nine(today + timedelta(days=1))
    m = re.fullmatch(r"\+?(\d+)\s*([dhw])", text)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        if unit == "h":
            return now + n * 3600
        return at_nine(today + timedelta(days=n * (7 if unit == "w" else 1)))
    days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    if text[:3] in days and len(text) <= 9:
        ahead = (days.index(text[:3]) - today.weekday()) % 7 or 7
        return at_nine(today + timedelta(days=ahead))
    try:
        if len(text) == 10:
            return at_nine(date.fromisoformat(text))
        return datetime.fromisoformat(text.replace("z", "")).timestamp()
    except ValueError:
        try:
            return float(text)
        except ValueError:
            raise ValueError(f"couldn't read the due date '{value}'") from None


def create(db, title: str, kind: str = "todo", contact: str = "", account: str = "",
           due=None, note: str = "", priority: str = "normal", deal_id=None,
           sequence_id=None, enrollment_id=None, step=None) -> dict:
    title = " ".join(str(title or "").split())[:200]
    if not title:
        raise ValueError("a task needs a title")
    if kind not in KIND_KEYS:
        raise ValueError(f"task kind must be one of {KIND_KEYS}")
    if priority not in PRIORITIES:
        priority = "normal"
    contact = (contact or "").lower().strip()
    account = (account or "").lower().strip()
    if contact and not account and "@" in contact:
        account = contact.split("@", 1)[1]
    now = time.time()
    cur = db.execute(
        "INSERT INTO tasks (kind, title, note, contact, account, deal_id, due, priority, status, "
        "sequence_id, enrollment_id, step, created) VALUES (?,?,?,?,?,?,?,?, 'open', ?,?,?,?)",
        (kind, title, note or "", contact, account, deal_id, parse_due(due, now), priority,
         sequence_id, enrollment_id, step, now))
    if contact:
        activity.log(db, "contact", contact, "task_created", title,
                     {"task_id": cur.lastrowid, "kind": kind})
    return get(db, cur.lastrowid)


_SELECT = ("SELECT t.*, l.name AS contact_name, l.organization AS contact_org, "
           "l.title AS contact_title, l.phone AS contact_phone, "
           "l.linkedin_url AS contact_linkedin, s.name AS sequence_name FROM tasks t "
           "LEFT JOIN leads l ON l.email = t.contact "
           "LEFT JOIN sequences s ON s.id = t.sequence_id")


def get(db, task_id) -> dict | None:
    try:
        return db.query_one(_SELECT + " WHERE t.id=?", (int(task_id),))
    except (TypeError, ValueError):
        return None


def list_tasks(db, bucket: str = "open", kind: str | None = None, contact: str | None = None,
               limit: int = 500, now: float | None = None) -> list:
    start, end = _day_bounds(now)
    where, params = [], []
    if bucket == "open":
        where.append("t.status='open'")
    elif bucket == "overdue":
        where.append("t.status='open' AND t.due IS NOT NULL AND t.due < ?")
        params.append(start)
    elif bucket == "today":
        where.append("t.status='open' AND t.due >= ? AND t.due < ?")
        params += [start, end]
    elif bucket == "upcoming":
        where.append("t.status='open' AND t.due >= ?")
        params.append(end)
    elif bucket == "nodate":
        where.append("t.status='open' AND t.due IS NULL")
    elif bucket == "done":
        where.append("t.status IN ('done', 'skipped')")
    if kind:
        where.append("t.kind=?")
        params.append(kind)
    if contact:
        where.append("t.contact=?")
        params.append(contact.lower().strip())
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    order = ("t.completed DESC" if bucket == "done" else
             "COALESCE(t.due, 9e18) ASC, CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' "
             "THEN 1 ELSE 2 END, t.id ASC")
    return db.query(f"{_SELECT} {clause} ORDER BY {order} LIMIT ?", (*params, limit))


def counts(db, now: float | None = None) -> dict:
    start, end = _day_bounds(now)
    row = db.query_one(
        "SELECT "
        "SUM(CASE WHEN status='open' AND due IS NOT NULL AND due < ? THEN 1 ELSE 0 END) AS overdue,"
        "SUM(CASE WHEN status='open' AND due >= ? AND due < ? THEN 1 ELSE 0 END) AS today,"
        "SUM(CASE WHEN status='open' AND due >= ? THEN 1 ELSE 0 END) AS upcoming,"
        "SUM(CASE WHEN status='open' AND due IS NULL THEN 1 ELSE 0 END) AS nodate,"
        "SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open,"
        "SUM(CASE WHEN status='done' AND completed >= ? THEN 1 ELSE 0 END) AS done_today "
        "FROM tasks", (start, start, end, end, start)) or {}
    return {k: int(row.get(k) or 0) for k in
            ("overdue", "today", "upcoming", "nodate", "open", "done_today")}


def _close(db, task_id, status: str) -> dict | None:
    task = get(db, task_id)
    if not task or task["status"] != "open":
        return task
    db.execute("UPDATE tasks SET status=?, completed=? WHERE id=?",
               (status, time.time(), task["id"]))
    if task["contact"]:
        activity.log(db, "contact", task["contact"], "task_done",
                     ("Skipped: " if status == "skipped" else "") + task["title"],
                     {"task_id": task["id"], "kind": task["kind"], "status": status})
    return get(db, task["id"])


def complete(db, task_id) -> dict | None:
    return _close(db, task_id, "done")


def skip(db, task_id) -> dict | None:
    return _close(db, task_id, "skipped")


def reopen(db, task_id) -> dict | None:
    db.execute("UPDATE tasks SET status='open', completed=NULL WHERE id=?", (int(task_id),))
    return get(db, task_id)


def update(db, task_id, fields: dict) -> dict | None:
    task = get(db, task_id)
    if not task:
        return None
    changes = {k: v for k, v in (fields or {}).items() if k in EDITABLE}
    if "due" in changes:
        changes["due"] = parse_due(changes["due"])
    if "kind" in changes and changes["kind"] not in KIND_KEYS:
        raise ValueError(f"task kind must be one of {KIND_KEYS}")
    if "priority" in changes and changes["priority"] not in PRIORITIES:
        raise ValueError(f"priority must be one of {PRIORITIES}")
    if "title" in changes and not str(changes["title"]).strip():
        raise ValueError("a task needs a title")
    if changes:
        sets = ", ".join(f"{k}=?" for k in changes)
        db.execute(f"UPDATE tasks SET {sets} WHERE id=?", (*changes.values(), task["id"]))
    return get(db, task["id"])


def delete(db, task_id) -> bool:
    return db.execute("DELETE FROM tasks WHERE id=?", (int(task_id),)).rowcount > 0
