"""
The activity log — one timeline of everything that happened to a contact, company
or deal: found by a search, stage changed, note added, emailed, replied, added to a
list, enrolled in a sequence, task completed, deal moved.

Workspace modules call :func:`log` as they change things. Sent emails already live
in the ``touches`` table, so :func:`timeline` merges them in rather than storing
them twice.
"""
from __future__ import annotations

import json
import time

# kind → (label, icon) for the UI. Unknown kinds still render with their key.
KINDS = {
    "created": ("Added to CRM", "plus"),
    "found": ("Found by a search", "find"),
    "imported": ("Imported", "upload"),
    "updated": ("Details updated", "edit"),
    "stage": ("Stage changed", "flag"),
    "note": ("Note", "note"),
    "tag": ("Tagged", "tag"),
    "list_add": ("Added to list", "list"),
    "list_remove": ("Removed from list", "list"),
    "enrolled": ("Enrolled in sequence", "sequence"),
    "sequence_step": ("Sequence step", "sequence"),
    "sequence_done": ("Finished sequence", "sequence"),
    "sequence_stopped": ("Left sequence", "sequence"),
    "task_created": ("Task created", "task"),
    "task_done": ("Task completed", "check"),
    "deal_created": ("Deal created", "deal"),
    "deal_stage": ("Deal moved", "deal"),
    "email_sent": ("Email sent", "send"),
    "email_error": ("Email failed", "x"),
    "email_skipped": ("Email skipped", "x"),
    "replied": ("Replied", "reply"),
    "bounced": ("Bounced", "x"),
    "merged": ("Merged duplicate", "merge"),
    "enriched": ("Enriched", "spark"),
    "search": ("Search", "find"),
}


def log(db, ref_type: str, ref: str, kind: str, summary: str = "", data: dict | None = None,
        ts: float | None = None) -> int:
    """Append one event. ``ref`` is an email, a domain or a deal id (as text)."""
    cur = db.execute(
        "INSERT INTO activity (ref_type, ref, kind, summary, data, ts) VALUES (?,?,?,?,?,?)",
        (ref_type, _norm(ref), kind, summary or "", json.dumps(data or {}),
         ts if ts is not None else time.time()))
    return cur.lastrowid


def log_many(db, ref_type: str, refs, kind: str, summary: str = "",
             data: dict | None = None) -> int:
    now = time.time()
    payload = json.dumps(data or {})
    return db.executemany(
        "INSERT INTO activity (ref_type, ref, kind, summary, data, ts) VALUES (?,?,?,?,?,?)",
        [(ref_type, _norm(r), kind, summary or "", payload, now) for r in refs])


def _norm(ref) -> str:
    return str(ref or "").lower().strip()


def _row(r: dict) -> dict:
    try:
        r["data"] = json.loads(r.get("data") or "{}")
    except (ValueError, TypeError):
        r["data"] = {}
    label, icon = KINDS.get(r["kind"], (r["kind"].replace("_", " ").capitalize(), "dot"))
    r["label"], r["icon"] = label, icon
    return r


def _touch_rows(db, where: str, params, limit: int) -> list:
    rows = db.query(
        "SELECT id, email, campaign, step, subject, status, error, ts FROM touches "
        f"WHERE status IN ('sent', 'error', 'skipped') AND {where} ORDER BY ts DESC LIMIT ?",
        (*params, limit))
    out = []
    for t in rows:
        out.append(_row({
            "id": f"t{t['id']}", "ref_type": "contact", "ref": t["email"],
            "kind": f"email_{t['status']}", "summary": t["subject"] or "",
            "data": json.dumps({"campaign": t["campaign"], "step": t["step"],
                                "error": t["error"] or ""}),
            "ts": t["ts"]}))
    return out


def timeline(db, ref_type: str, ref: str, limit: int = 100) -> list:
    """Newest-first events for one record. Contacts include their sent emails."""
    ref = _norm(ref)
    rows = [_row(r) for r in db.query(
        "SELECT * FROM activity WHERE ref_type=? AND ref=? ORDER BY ts DESC, id DESC LIMIT ?",
        (ref_type, ref, limit))]
    if ref_type == "contact":
        rows += _touch_rows(db, "email=?", (ref,), limit)
    elif ref_type == "company":
        # A company's timeline is its own events plus everything its people did.
        rows += [_row(r) for r in db.query(
            "SELECT a.* FROM activity a JOIN leads l ON a.ref = l.email "
            "WHERE a.ref_type='contact' AND l.domain=? ORDER BY a.ts DESC LIMIT ?",
            (ref, limit))]
        rows += _touch_rows(db, "email IN (SELECT email FROM leads WHERE domain=?)",
                            (ref,), limit)
    rows.sort(key=lambda r: r["ts"], reverse=True)
    return rows[:limit]


# A search adds dozens of contacts at once; the home feed would drown in them.
FEED_EXCLUDE = ("created", "updated")


def recent(db, limit: int = 50, kinds=None, exclude=FEED_EXCLUDE, before: float | None = None,
           ref_type: str | None = None) -> list:
    """The workspace-wide feed, newest first.

    ``kinds`` keeps only those event kinds (``email_sent`` and friends come from
    the send log); ``before`` pages back from a timestamp; ``ref_type`` keeps
    one kind of record (contact, company, deal, search).
    """
    where, params = [], []
    if kinds:
        where.append(f"kind IN ({','.join('?' for _ in kinds)})")
        params += list(kinds)
    elif exclude:
        where.append(f"kind NOT IN ({','.join('?' for _ in exclude)})")
        params += list(exclude)
    if before is not None:
        where.append("ts < ?")
        params.append(float(before))
    if ref_type:
        where.append("ref_type = ?")
        params.append(ref_type)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    out = [_row(r) for r in db.query(f"SELECT * FROM activity {clause} "
                                     "ORDER BY ts DESC, id DESC LIMIT ?", (*params, limit))]
    wants_email = (not kinds or any(k.startswith("email_") for k in kinds)) \
        and ref_type in (None, "contact")
    if wants_email:
        touch_where, touch_params = "1=1", []
        if before is not None:
            touch_where, touch_params = "ts < ?", [float(before)]
        email_kinds = [k[6:] for k in (kinds or ()) if k.startswith("email_")]
        if email_kinds:
            touch_where += f" AND status IN ({','.join('?' for _ in email_kinds)})"
            touch_params += email_kinds
        out += _touch_rows(db, touch_where, touch_params, limit)
    out.sort(key=lambda r: r["ts"], reverse=True)
    if not ref_type:
        out = _dedupe(out)
    out = out[:limit]
    _attach_names(db, out)
    return out


# A deal event is logged on the deal and on its contact; the feed shows it once,
# on the deal.
def _dedupe(rows: list) -> list:
    """Drop the contact copy of an event also logged on a deal or company."""
    owners = {(r["kind"], r["summary"], int(r["ts"])) for r in rows
              if r["ref_type"] in ("deal", "company") and r["summary"]}
    return [r for r in rows if r["ref_type"] != "contact"
            or (r["kind"], r["summary"], int(r["ts"])) not in owners]


def _attach_names(db, rows: list) -> None:
    """Give each feed row a display name: person, company or deal."""
    names = _names(db, {r["ref"] for r in rows if r["ref_type"] == "contact"})
    domains = list({r["ref"] for r in rows if r["ref_type"] == "company"})
    deal_ids = [int(r["ref"]) for r in rows if r["ref_type"] == "deal" and str(r["ref"]).isdigit()]
    companies = {}
    if domains:
        marks = ",".join("?" for _ in domains)
        companies = {a["domain"]: a["name"] for a in db.query(
            f"SELECT domain, name FROM accounts WHERE domain IN ({marks})", domains)}
    deals = {}
    if deal_ids:
        marks = ",".join("?" for _ in deal_ids)
        deals = {str(d["id"]): d["name"] for d in db.query(
            f"SELECT id, name FROM deals WHERE id IN ({marks})", deal_ids)}
    for r in rows:
        if r["ref_type"] == "contact":
            r["name"] = names.get(r["ref"], "")
        elif r["ref_type"] == "company":
            r["name"] = companies.get(r["ref"]) or r["ref"]
        elif r["ref_type"] == "deal":
            r["name"] = deals.get(str(r["ref"]), "")


def counts_by_kind(db, since: float | None = None) -> dict:
    """How many of each event kind happened (since a timestamp), sends included."""
    params = [] if since is None else [float(since)]
    cond = "" if since is None else "WHERE ts >= ?"
    out = {r["kind"]: r["n"] for r in db.query(
        f"SELECT kind, COUNT(*) AS n FROM activity {cond} GROUP BY kind", params)}
    for r in db.query("SELECT status, COUNT(*) AS n FROM touches WHERE status IN "
                      f"('sent', 'error', 'skipped') {'AND ts >= ?' if since is not None else ''} "
                      "GROUP BY status", params):
        out[f"email_{r['status']}"] = r["n"]
    return out


def _names(db, emails) -> dict:
    emails = list(emails)
    if not emails:
        return {}
    out = {}
    for i in range(0, len(emails), 500):
        chunk = emails[i:i + 500]
        marks = ",".join("?" for _ in chunk)
        for r in db.query(f"SELECT email, name, organization FROM leads WHERE email IN ({marks})",
                          chunk):
            out[r["email"]] = r["name"] or r["organization"] or ""
    return out
