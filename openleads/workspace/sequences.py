"""
Sequences — multi-step, multi-channel outreach that runs itself.

A sequence is an ordered list of steps. Each step waits ``delay_days`` after the
previous one, then either **sends an email automatically** (``auto_email``) or
**creates a task** for a human (``manual_email``, ``call``, ``linkedin``, ``task``).
A manual step holds the contact in place until its task is completed or skipped,
exactly like Apollo. Contacts leave a sequence the moment they reply, bounce or
unsubscribe (see ``DB._after_status``).

Email steps can have A/B **variants** (each contact gets one, deterministically),
can reply **in the same thread** as the first email, and can be **AI-written**
(the free-LLM composer, falling back to the template drafter). Sends go through the
normal sender, so the warmup cap, suppression list, business-hours window and
dry-run default all apply.

:func:`process` is called by the scheduler heartbeat (``openleads drip``) and by the
dashboard's "Run now" button.
"""
from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timedelta

from openleads.workspace import activity
from openleads.workspace import tasks as taskmod
from openleads.workspace import templates as tplmod

DAY = 86400
STEP_TYPES = (
    ("auto_email", "Automatic email"),
    ("manual_email", "Manual email"),
    ("call", "Phone call"),
    ("linkedin", "LinkedIn task"),
    ("task", "Action item"),
)
STEP_TYPE_KEYS = tuple(k for k, _ in STEP_TYPES)
_TASK_KIND = {"manual_email": "email", "call": "call", "linkedin": "linkedin", "task": "todo"}
STATUSES = ("active", "paused", "archived")
ACTIVE_ENROLLMENT = ("active", "paused")
DEFAULT_SETTINGS = {
    "skip_weekends": True,       # due dates that land on Sat/Sun move to Monday
    "send_window": True,         # automatic emails wait for business hours
    "daily_limit": 0,            # max automatic emails per day from this sequence (0 = no cap)
    "allow_risky": False,        # enroll contacts whose email isn't 'safe'
    "one_active": True,          # skip contacts already active in another sequence
    "mark_unresponsive": True,   # finishing without a reply → stage 'unresponsive'
    "context": "",               # this sequence's pitch ({{sender_context}} / AI steps)
}
MAX_ERRORS = 3


# --- definitions ------------------------------------------------------------- #
def _step_id(i: int, step: dict) -> str:
    raw = json.dumps([i, step.get("type"), step.get("subject", "")], sort_keys=True)
    return hashlib.sha1(raw.encode()).hexdigest()[:8]


def normalize_steps(steps) -> list:
    """Validate and fill defaults for a list of step dicts."""
    out = []
    for i, raw in enumerate(steps or []):
        if not isinstance(raw, dict):
            raise ValueError(f"step {i + 1} must be an object")
        typ = raw.get("type") or "auto_email"
        if typ not in STEP_TYPE_KEYS:
            raise ValueError(f"step {i + 1}: unknown type '{typ}'")
        try:
            delay = max(0, min(int(raw.get("delay_days", 0 if i == 0 else 3)), 365))
        except (TypeError, ValueError):
            raise ValueError(f"step {i + 1}: delay_days must be a whole number") from None
        step = {"id": str(raw.get("id") or _step_id(i, raw)), "type": typ, "delay_days": delay,
                "note": str(raw.get("note") or "").strip()[:1000],
                "priority": raw.get("priority") if raw.get("priority") in taskmod.PRIORITIES
                else "normal"}
        if typ in ("auto_email", "manual_email"):
            variants = raw.get("variants") or [{"subject": raw.get("subject", ""),
                                                "body": raw.get("body", "")}]
            clean = []
            for v in variants:
                subj, body = str(v.get("subject") or "").strip(), str(v.get("body") or "").strip()
                if subj or body:
                    bad = tplmod.unknown_variables(subj + "\n" + body)
                    if bad:
                        raise ValueError(f"step {i + 1}: unknown variable(s) "
                                         + ", ".join("{{" + b + "}}" for b in bad))
                    clean.append({"subject": subj, "body": body})
            step["ai"] = bool(raw.get("ai"))
            step["thread"] = bool(raw.get("thread", i > 0))
            if not clean and not step["ai"] and typ == "auto_email":
                raise ValueError(f"step {i + 1}: an automatic email needs a subject and body "
                                 "(or turn on AI writing)")
            step["variants"] = clean
        out.append(step)
    return out


def _decode(row: dict | None) -> dict | None:
    if not row:
        return None
    try:
        row["steps"] = json.loads(row.get("steps") or "[]")
    except ValueError:
        row["steps"] = []
    try:
        stored = json.loads(row.get("settings") or "{}")
    except ValueError:
        stored = {}
    row["settings"] = {**DEFAULT_SETTINGS, **stored}
    return row


def _clean_settings(settings: dict | None) -> dict:
    s = {**DEFAULT_SETTINGS}
    for k, v in (settings or {}).items():
        if k not in DEFAULT_SETTINGS:
            continue
        if k == "daily_limit":
            try:
                s[k] = max(0, int(v or 0))
            except (TypeError, ValueError):
                raise ValueError("daily_limit must be a whole number") from None
        elif k == "context":
            s[k] = str(v or "").strip()[:2000]
        else:
            s[k] = bool(v)
    return s


def create(db, name: str, steps=None, settings: dict | None = None,
           status: str = "paused") -> dict:
    name = " ".join(str(name or "").split())[:80]
    if not name:
        raise ValueError("a sequence needs a name")
    if get(db, name):
        raise ValueError(f"a sequence named '{name}' already exists")
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    now = time.time()
    cur = db.execute(
        "INSERT INTO sequences (name, status, steps, settings, created, updated) "
        "VALUES (?,?,?,?,?,?)",
        (name, status, json.dumps(normalize_steps(steps or [])),
         json.dumps(_clean_settings(settings)), now, now))
    return get(db, cur.lastrowid)


def get(db, seq) -> dict | None:
    if isinstance(seq, dict):
        seq = seq.get("id")
    try:
        return _decode(db.query_one("SELECT * FROM sequences WHERE id=?", (int(seq),)))
    except (TypeError, ValueError):
        return _decode(db.query_one("SELECT * FROM sequences WHERE name=?", (str(seq),)))


def update(db, seq, name: str | None = None, steps=None, settings: dict | None = None) -> dict:
    cur = get(db, seq)
    if not cur:
        raise ValueError("no such sequence")
    if name is not None:
        name = " ".join(name.split())[:80]
        other = get(db, name)
        if not name or (other and other["id"] != cur["id"]):
            raise ValueError("that sequence name is empty or already taken")
        db.execute("UPDATE sequences SET name=? WHERE id=?", (name, cur["id"]))
    if steps is not None:
        new_steps = normalize_steps(steps)
        db.execute("UPDATE sequences SET steps=? WHERE id=?", (json.dumps(new_steps), cur["id"]))
        # Contacts past the new end finish on the next run; nobody points past the end.
    if settings is not None:
        merged = _clean_settings({**cur["settings"], **settings})
        db.execute("UPDATE sequences SET settings=? WHERE id=?", (json.dumps(merged), cur["id"]))
    db.execute("UPDATE sequences SET updated=? WHERE id=?", (time.time(), cur["id"]))
    return get(db, cur["id"])


def set_status(db, seq, status: str) -> dict:
    cur = get(db, seq)
    if not cur:
        raise ValueError("no such sequence")
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    if status == "active" and not cur["steps"]:
        raise ValueError("add at least one step before activating")
    db.execute("UPDATE sequences SET status=?, updated=? WHERE id=?",
               (status, time.time(), cur["id"]))
    return get(db, cur["id"])


def delete(db, seq) -> bool:
    cur = get(db, seq)
    if not cur:
        return False
    db.execute("DELETE FROM tasks WHERE sequence_id=? AND status='open'", (cur["id"],))
    db.execute("DELETE FROM enrollments WHERE sequence_id=?", (cur["id"],))
    db.execute("DELETE FROM sequences WHERE id=?", (cur["id"],))
    return True


def list_sequences(db) -> list:
    rows = [_decode(r) for r in db.query("SELECT * FROM sequences ORDER BY "
                                         "status='archived', updated DESC")]
    for r in rows:
        r["stats"] = summary_stats(db, r["id"])
    return rows


# --- scheduling ---------------------------------------------------------------- #
def due_after(ts: float, days: int, skip_weekends: bool = True) -> float:
    """``ts`` plus ``days``, moved to Monday (same time) if it lands on a weekend."""
    when = datetime.fromtimestamp(ts) + timedelta(days=days)
    if skip_weekends:
        while when.weekday() >= 5:
            when += timedelta(days=1)
    return when.timestamp()


def pick_variant(step: dict, email: str) -> int:
    n = len(step.get("variants") or [])
    if n <= 1:
        return 0
    h = hashlib.sha1(f"{email}:{step.get('id')}".encode()).hexdigest()
    return int(h[:8], 16) % n


# --- enrollment ---------------------------------------------------------------- #
def enroll(db, seq, emails, now: float | None = None, force: bool = False) -> dict:
    """Add contacts. Returns ``{enrolled: [...], skipped: [{email, reason}]}``.

    Skips (with a reason) anyone suppressed, marked do-not-contact or bad data, not
    'safe' (unless the sequence allows risky), already in this sequence, or active in
    another one (unless the sequence allows overlap).
    """
    cur = get(db, seq)
    if not cur:
        raise ValueError("no such sequence")
    if not cur["steps"]:
        raise ValueError("add at least one step before enrolling anyone")
    now = time.time() if now is None else now
    st = cur["settings"]
    enrolled, skipped = [], []
    first_due = due_after(now, cur["steps"][0]["delay_days"], st["skip_weekends"])
    for email in sorted({(e or "").lower().strip() for e in emails or [] if e}):
        lead = db.get_lead(email)
        reason = ""
        if not lead:
            reason = "not in your CRM"
        elif db.is_suppressed(email):
            reason = f"suppressed ({db.is_suppressed(email)})"
        elif lead.get("stage") in ("do_not_contact", "bad_data"):
            reason = f"stage is {lead['stage'].replace('_', ' ')}"
        elif lead.get("tier") != "safe" and not st["allow_risky"] and not force:
            reason = f"email is {lead.get('tier') or 'unverified'} (allow risky in settings)"
        else:
            prior = db.query_one("SELECT status FROM enrollments WHERE sequence_id=? AND email=?",
                                 (cur["id"], email))
            if prior and (prior["status"] in ACTIVE_ENROLLMENT or not force):
                reason = ("already in this sequence" if prior["status"] in ACTIVE_ENROLLMENT
                          else f"already went through it ({prior['status']})")
            elif st["one_active"] and not force and db.query_one(
                    "SELECT 1 AS x FROM enrollments WHERE email=? AND sequence_id != ? AND "
                    "status IN ('active', 'paused')", (email, cur["id"])):
                reason = "active in another sequence"
        if reason:
            skipped.append({"email": email, "reason": reason})
            continue
        db.execute(
            "INSERT INTO enrollments (sequence_id, email, status, step, next_due, enrolled, "
            "errors, last_error, thread_subject, task_id, finished) "
            "VALUES (?,?, 'active', 0, ?, ?, 0, '', '', NULL, NULL) "
            "ON CONFLICT(sequence_id, email) DO UPDATE SET status='active', step=0, "
            "next_due=excluded.next_due, enrolled=excluded.enrolled, errors=0, last_error='', "
            "thread_subject='', task_id=NULL, finished=NULL",
            (cur["id"], email, first_due, now))
        enrolled.append(email)
    if enrolled:
        activity.log_many(db, "contact", enrolled, "enrolled", cur["name"],
                          {"sequence_id": cur["id"]})
    return {"enrolled": enrolled, "skipped": skipped}


def _stop_tasks(db, enrollment_ids: list) -> None:
    for eid in enrollment_ids:
        db.execute("DELETE FROM tasks WHERE enrollment_id=? AND status='open'", (eid,))


def unenroll(db, seq, emails) -> int:
    cur = get(db, seq)
    if not cur:
        return 0
    emails = sorted({(e or "").lower().strip() for e in emails or [] if e})
    if not emails:
        return 0
    marks = ",".join("?" for _ in emails)
    ids = [r["id"] for r in db.query(
        f"SELECT id FROM enrollments WHERE sequence_id=? AND email IN ({marks}) "
        "AND status IN ('active', 'paused')", (cur["id"], *emails))]
    if not ids:
        return 0
    _stop_tasks(db, ids)
    db.execute(f"UPDATE enrollments SET status='removed', next_due=NULL, finished=? "
               f"WHERE id IN ({','.join('?' for _ in ids)})", (time.time(), *ids))
    activity.log_many(db, "contact", emails, "sequence_stopped", f"Removed from {cur['name']}",
                      {"sequence_id": cur["id"]})
    return len(ids)


def set_enrollment_status(db, seq, emails, status: str) -> int:
    """Pause or resume specific contacts inside a sequence."""
    if status not in ("active", "paused"):
        raise ValueError("status must be active or paused")
    cur = get(db, seq)
    emails = sorted({(e or "").lower().strip() for e in emails or [] if e})
    if not cur or not emails:
        return 0
    marks = ",".join("?" for _ in emails)
    frm = "paused" if status == "active" else "active"
    return db.execute(f"UPDATE enrollments SET status=?, errors=0 WHERE sequence_id=? AND "
                      f"status=? AND email IN ({marks})", (status, cur["id"], frm, *emails)).rowcount


def enrollments(db, seq, status: str | None = None, limit: int = 500) -> list:
    cur = get(db, seq)
    if not cur:
        return []
    where = "WHERE e.sequence_id=?" + (" AND e.status=?" if status else "")
    params = [cur["id"]] + ([status] if status else [])
    return db.query(
        "SELECT e.*, l.name, l.organization, l.title, l.tier, l.stage FROM enrollments e "
        f"LEFT JOIN leads l ON l.email = e.email {where} ORDER BY e.enrolled DESC LIMIT ?",
        (*params, limit))


# --- running ------------------------------------------------------------------- #
def _finish(db, enr: dict, seq: dict, status: str, now: float, reason: str = "") -> None:
    db.execute("UPDATE enrollments SET status=?, next_due=NULL, finished=?, task_id=NULL "
               "WHERE id=?", (status, now, enr["id"]))
    if status == "finished":
        activity.log(db, "contact", enr["email"], "sequence_done", seq["name"],
                     {"sequence_id": seq["id"]})
        lead = db.get_lead(enr["email"]) or {}
        if seq["settings"].get("mark_unresponsive") and lead.get("stage") in ("approaching", "new"):
            from openleads.workspace import people
            people.update(db, enr["email"], {"stage": "unresponsive"})
    else:
        activity.log(db, "contact", enr["email"], "sequence_stopped",
                     f"{seq['name']}: {reason or status}", {"sequence_id": seq["id"]})


def _advance(db, enr: dict, seq: dict, now: float, thread_subject: str = "") -> None:
    nxt = int(enr["step"]) + 1
    if nxt >= len(seq["steps"]):
        db.execute("UPDATE enrollments SET step=?, last_step_at=?, task_id=NULL WHERE id=?",
                   (nxt, now, enr["id"]))
        _finish(db, {**enr, "step": nxt}, seq, "finished", now)
        return
    due = due_after(now, seq["steps"][nxt]["delay_days"], seq["settings"]["skip_weekends"])
    db.execute("UPDATE enrollments SET step=?, next_due=?, last_step_at=?, task_id=NULL, "
               "errors=0, thread_subject=CASE WHEN thread_subject='' THEN ? ELSE thread_subject "
               "END WHERE id=?", (nxt, due, now, thread_subject, enr["id"]))


def task_closed(db, task: dict) -> None:
    """A sequence task was completed or skipped: move that contact to the next step."""
    if not task or not task.get("enrollment_id"):
        return
    enr = db.query_one("SELECT * FROM enrollments WHERE id=?", (task["enrollment_id"],))
    if not enr or enr["task_id"] != task["id"] or enr["status"] not in ACTIVE_ENROLLMENT:
        return
    seq = get(db, enr["sequence_id"])
    if seq:
        activity.log(db, "contact", enr["email"], "sequence_step",
                     f"{seq['name']} · step {enr['step'] + 1}",
                     {"sequence_id": seq["id"], "step": enr["step"], "task_id": task["id"]})
        _advance(db, enr, seq, time.time())


def _draft_for(db, seq: dict, step: dict, enr: dict, lead: dict):
    """``(Draft, variant_index, missing_vars)`` for one auto-email step."""
    from openleads.outreach import compose
    context = seq["settings"].get("context") or ""
    sender = {"sender_context": context} if context else None
    variant = pick_variant(step, enr["email"])
    variants = step.get("variants") or []
    if step.get("ai") and not variants:
        overrides = {"sender_context": context} if context else None
        draft, missing = compose.draft(lead, overrides), []
    else:
        v = variants[variant] if variants else {"subject": "", "body": ""}
        draft, missing = tplmod.render_draft(v["subject"], v["body"], lead, sender,
                                             seed=f"{enr['email']}:{step['id']}")
    if step.get("thread") and enr.get("thread_subject"):
        base = enr["thread_subject"]
        while base.lower().startswith("re:"):
            base = base[3:].strip()
        draft.subject = f"re: {base}"
    return draft, variant, missing


def due_enrollments(db, now: float | None = None, seq_id=None, paused_ok: bool = False) -> list:
    """Active enrollments whose next step is due. ``paused_ok`` also includes
    sequences that are paused (used to preview one before activating it)."""
    now = time.time() if now is None else now
    where = ("e.status='active' AND e.task_id IS NULL "
             "AND e.next_due IS NOT NULL AND e.next_due <= ?")
    if not paused_ok:
        where += " AND s.status='active'"
    params = [now]
    if seq_id is not None:
        where += " AND s.id=?"
        params.append(int(seq_id))
    return db.query(f"SELECT e.* FROM enrollments e JOIN sequences s ON s.id = e.sequence_id "
                    f"WHERE {where} ORDER BY e.next_due ASC, e.id ASC", params)


def _sent_today(db, seq_id: int, now: float) -> int:
    start = datetime.combine(datetime.fromtimestamp(now).date(), datetime.min.time()).timestamp()
    return db.scalar("SELECT COUNT(*) FROM touches WHERE campaign=? AND status='sent' AND ts>=?",
                     (f"seq:{seq_id}", start), default=0)


def process(db, now: float | None = None, dry_run: bool = True, send_window_ok: bool = True,
            seq_id=None, on_progress=None) -> dict:
    """Run every due step once. Dry-run previews emails and changes nothing.

    Returns counts: ``due, sent, previewed, tasks, finished, waiting_window, capped,
    errors`` plus per-email ``results``. A dry run of one sequence (``seq_id``)
    previews it even while it is paused, so it can be checked before activating.
    """
    from openleads.outreach.sender import send_drafts
    on_progress = on_progress or (lambda *_: None)
    now = time.time() if now is None else now
    out = {"due": 0, "sent": 0, "previewed": 0, "tasks": 0, "finished": 0,
           "waiting_window": 0, "capped": 0, "errors": 0, "skipped": 0, "results": []}
    seqs: dict = {}
    batches: dict = {}                  # (seq_id, step_idx) → [(enr, variant, draft)]
    for enr in due_enrollments(db, now, seq_id, paused_ok=dry_run and seq_id is not None):
        out["due"] += 1
        seq = seqs.get(enr["sequence_id"]) or get(db, enr["sequence_id"])
        seqs[enr["sequence_id"]] = seq
        idx = int(enr["step"])
        if idx >= len(seq["steps"]):
            if not dry_run:
                _finish(db, enr, seq, "finished", now)
            out["finished"] += 1
            continue
        lead = db.get_lead(enr["email"])
        if not lead:
            if not dry_run:
                _finish(db, enr, seq, "removed", now, "contact deleted")
            continue
        step = seq["steps"][idx]
        if step["type"] != "auto_email":
            if not dry_run:
                name = lead.get("name") or lead.get("organization") or enr["email"]
                default = {"manual_email": f"Email {name}", "call": f"Call {name}",
                           "linkedin": f"Connect with {name} on LinkedIn",
                           "task": f"Follow up with {name}"}[step["type"]]
                title, _ = tplmod.render(step.get("note") or default,
                                         tplmod.context_for(lead), seed=enr["email"])
                t = taskmod.create(db, title or default,
                                   kind=_TASK_KIND[step["type"]], contact=enr["email"], due=now,
                                   priority=step.get("priority", "normal"),
                                   sequence_id=seq["id"], enrollment_id=enr["id"], step=idx)
                db.execute("UPDATE enrollments SET task_id=? WHERE id=?", (t["id"], enr["id"]))
            out["tasks"] += 1
            continue
        if seq["settings"]["send_window"] and not send_window_ok:
            out["waiting_window"] += 1
            continue
        draft, variant, missing = _draft_for(db, seq, step, enr, lead)
        if missing:
            on_progress("phase", f"{enr['email']}: blank variable(s) "
                        + ", ".join("{{" + m + "}}" for m in missing))
        batches.setdefault((seq["id"], idx), []).append((enr, variant, draft))

    for (sid, idx), items in batches.items():
        seq = seqs[sid]
        limit = int(seq["settings"].get("daily_limit") or 0)
        if limit and not dry_run:
            room = max(0, limit - _sent_today(db, sid, now))
            if len(items) > room:
                out["capped"] += len(items) - room
                items = items[:room]
        if not items:
            continue
        results = send_drafts([d for _, _, d in items], dry_run=dry_run, db=db,
                              campaign=f"seq:{sid}", step=idx + 1,
                              on_progress=lambda r: on_progress("send", r))
        for (enr, variant, draft), res in zip(items, results):
            out["results"].append({**res.to_dict(), "sequence": seq["name"], "step": idx + 1,
                                   "variant": variant, "subject": draft.subject})
            if dry_run:
                out["previewed"] += 1
                continue
            if res.status == "sent":
                out["sent"] += 1
                activity.log(db, "contact", enr["email"], "sequence_step",
                             f"{seq['name']} · step {idx + 1}",
                             {"sequence_id": sid, "step": idx, "variant": variant,
                              "subject": draft.subject})
                _advance(db, enr, seq, now, thread_subject=draft.subject)
            elif res.status == "skipped" and "warmup" in (res.detail or ""):
                out["capped"] += 1               # stays due; tries again next run
            elif res.status == "skipped" and (res.detail or "").startswith("suppressed"):
                out["skipped"] += 1
                _finish(db, enr, seq, "unsubscribed", now, res.detail)
            else:
                out["errors"] += 1
                errors = int(enr.get("errors") or 0) + 1
                status = "paused" if errors >= MAX_ERRORS else "active"
                db.execute("UPDATE enrollments SET errors=?, last_error=?, status=? WHERE id=?",
                           (errors, res.error or res.detail or "send failed", status, enr["id"]))
    return out


# --- stats ----------------------------------------------------------------------- #
def summary_stats(db, seq_id: int) -> dict:
    counts = {r["status"]: r["n"] for r in db.query(
        "SELECT status, COUNT(*) AS n FROM enrollments WHERE sequence_id=? GROUP BY status",
        (seq_id,))}
    contacted = db.scalar("SELECT COUNT(DISTINCT email) FROM touches WHERE campaign=? "
                          "AND status='sent'", (f"seq:{seq_id}",), default=0)
    sent = db.scalar("SELECT COUNT(*) FROM touches WHERE campaign=? AND status='sent'",
                     (f"seq:{seq_id}",), default=0)
    replied = counts.get("replied", 0)
    bounced = counts.get("bounced", 0)
    return {
        "enrolled": sum(counts.values()), "active": counts.get("active", 0),
        "paused": counts.get("paused", 0), "finished": counts.get("finished", 0),
        "replied": replied, "bounced": bounced, "unsubscribed": counts.get("unsubscribed", 0),
        "removed": counts.get("removed", 0), "contacted": contacted, "sent": sent,
        "reply_rate": round(100 * replied / contacted, 1) if contacted else 0.0,
        "bounce_rate": round(100 * bounced / contacted, 1) if contacted else 0.0,
        "due_now": db.scalar("SELECT COUNT(*) FROM enrollments WHERE sequence_id=? AND "
                             "status='active' AND task_id IS NULL AND next_due <= ?",
                             (seq_id, time.time()), default=0),
        "open_tasks": db.scalar("SELECT COUNT(*) FROM tasks WHERE sequence_id=? AND "
                                "status='open'", (seq_id,), default=0),
    }


def stats(db, seq) -> dict:
    """Summary plus per-step and per-variant numbers for the sequence page."""
    cur = get(db, seq)
    if not cur:
        return {}
    sid = cur["id"]
    sent_by_step = {r["step"]: r["n"] for r in db.query(
        "SELECT step, COUNT(*) AS n FROM touches WHERE campaign=? AND status='sent' "
        "GROUP BY step", (f"seq:{sid}",))}
    at_step = {r["step"]: r["n"] for r in db.query(
        "SELECT step, COUNT(*) AS n FROM enrollments WHERE sequence_id=? AND "
        "status IN ('active', 'paused') GROUP BY step", (sid,))}
    tasks_by_step = {r["step"]: r["n"] for r in db.query(
        "SELECT step, COUNT(*) AS n FROM tasks WHERE sequence_id=? AND status='done' "
        "GROUP BY step", (sid,))}
    variant_sent: dict = {}
    for r in db.query("SELECT a.data, l.status FROM activity a LEFT JOIN leads l "
                      "ON l.email = a.ref WHERE a.kind='sequence_step' AND a.ref_type='contact'"):
        try:
            d = json.loads(r["data"] or "{}")
        except ValueError:
            continue
        if d.get("sequence_id") != sid or "variant" not in d:
            continue
        key = (d.get("step"), d["variant"])
        cell = variant_sent.setdefault(key, {"sent": 0, "replied": 0})
        cell["sent"] += 1
        if r["status"] == "replied":
            cell["replied"] += 1
    steps = []
    for i, st in enumerate(cur["steps"]):
        row = {"index": i, "type": st["type"], "delay_days": st["delay_days"],
               "waiting": at_step.get(i, 0),
               "sent": sent_by_step.get(i + 1, 0), "tasks_done": tasks_by_step.get(i, 0),
               "variants": []}
        for v in range(len(st.get("variants") or [])):
            cell = variant_sent.get((i, v), {"sent": 0, "replied": 0})
            row["variants"].append({**cell, "reply_rate": round(
                100 * cell["replied"] / cell["sent"], 1) if cell["sent"] else 0.0})
        steps.append(row)
    return {"summary": summary_stats(db, sid), "steps": steps}


def starter_steps() -> list:
    """A sensible 5-step, 2-week default: email, bump, call, LinkedIn, breakup."""
    by = {t[0]: t for t in tplmod.DEFAULTS}
    intro, bump, breakup = by["Short intro"], by["Follow-up bump"], by["Breakup"]
    return normalize_steps([
        {"type": "auto_email", "delay_days": 0, "subject": intro[2], "body": intro[3]},
        {"type": "auto_email", "delay_days": 3, "thread": True, "subject": bump[2],
         "body": bump[3]},
        {"type": "call", "delay_days": 2, "note": "Call {{first_name}} — reference the emails"},
        {"type": "linkedin", "delay_days": 2, "note": "Connect on LinkedIn with a short note"},
        {"type": "auto_email", "delay_days": 4, "thread": False, "subject": breakup[2],
         "body": breakup[3]},
    ])
