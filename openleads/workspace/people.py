"""
People — search, filter, sort, page and edit the contacts in your CRM.

This is the Apollo "People" table over your own database: every lead a search ever
found, every row you imported. :func:`search` takes a filter dict (all optional):

    q               free text over name, email, company, title, domain, city
    stage, tier, seniority, department, source, evidence, country, company_size,
    industry, status                  lists of exact values (any-of)
    tags            contacts with any of these tags
    list_id         members of this list;   not_list_id  not in this list
    domain          one domain or a list;   title  comma-separated words (any-of)
    location        substring of city / state / country
    technologies    the company's site runs any of these (from its profile)
    score_min/max   email score;  fit_min  ICP fit score
    has_phone, has_linkedin           booleans
    contacted       "never" | "ever" | "7d" | "30d" | "90d"
    created_within  days
    sequence        "any" | "none" | a sequence id (active enrollment)
    owner           exact owner
    emails          an explicit selection

and returns ``{rows, total, page, per_page}``. :func:`facets` returns the counts
the filter sidebar shows next to each value.
"""
from __future__ import annotations

import json
import re
import time

from openleads.workspace import activity
from openleads.workspace import lists as listmod
from openleads.workspace import tags as tagmod
from openleads.workspace.stages import CONTACT_STAGE_KEYS, label

COLUMNS = (
    "email", "name", "first_name", "last_name", "title", "organization", "domain", "tier",
    "score", "fit_score", "stage", "status", "seniority", "department", "city", "state",
    "country", "phone", "linkedin_url", "website", "industry", "company_size", "employees",
    "source", "evidence", "confidence_pct", "owner", "last_contacted", "created", "updated",
)
_SELECT = "SELECT " + ", ".join(f"l.{c}" for c in COLUMNS) + " FROM leads l"

_SENIORITY_ORDER = ("owner", "founder", "c_suite", "partner", "vp", "head", "director",
                    "manager", "senior", "entry", "intern")
SORTS = {
    "name": "LOWER(COALESCE(NULLIF(l.name, ''), l.organization))",
    "organization": "LOWER(l.organization)", "title": "LOWER(l.title)", "email": "l.email",
    "score": "l.score", "fit": "l.fit_score", "created": "l.created", "updated": "l.updated",
    "last_contacted": "COALESCE(l.last_contacted, 0)", "stage": "l.stage",
    "seniority": "CASE l.seniority " + " ".join(
        f"WHEN '{k}' THEN {i}" for i, k in enumerate(_SENIORITY_ORDER)) + " ELSE 99 END",
    "location": "LOWER(l.city)",
}
LIST_FILTERS = ("stage", "tier", "seniority", "department", "source", "evidence", "country",
                "company_size", "industry", "status")
FACETS = ("stage", "tier", "seniority", "department", "source", "evidence", "country",
          "company_size", "industry")
EDITABLE = ("first_name", "last_name", "title", "organization", "phone", "linkedin_url",
            "website", "city", "state", "country", "industry", "seniority", "department",
            "owner", "stage")
MAX_PER_PAGE = 500
DAY = 86400
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


def _as_list(v) -> list:
    if v is None or v == "":
        return []
    if isinstance(v, str):
        return [p.strip() for p in v.split(",") if p.strip()]
    if isinstance(v, (list, tuple, set)):
        return [str(x).strip() for x in v if str(x).strip()]
    return [str(v)]


def _ids(v) -> list:
    """List ids from one id, '3,4', or a list; junk is ignored."""
    out = []
    for x in _as_list(v if not isinstance(v, int) else str(v)):
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def _truthy(v) -> bool:
    return v is True or str(v).lower() in ("1", "true", "yes", "on")


def build_where(filters: dict | None, skip: str | None = None) -> tuple:
    """``(sql, params)`` for a WHERE clause (always starts with ``WHERE 1=1``)."""
    f = filters or {}
    where, params = ["1=1"], []

    q = str(f.get("q") or "").strip().lower()
    if q:
        like = f"%{q}%"
        where.append("(LOWER(l.name) LIKE ? OR l.email LIKE ? OR LOWER(l.organization) LIKE ? "
                     "OR LOWER(l.title) LIKE ? OR l.domain LIKE ? OR LOWER(l.city) LIKE ?)")
        params += [like] * 6
    for col in LIST_FILTERS:
        if col == skip:
            continue
        vals = _as_list(f.get(col))
        if vals:
            if "" in vals or "(none)" in vals:
                vals = [v for v in vals if v not in ("", "(none)")]
                extra = f" OR COALESCE(l.{col}, '') = ''"
            else:
                extra = ""
            marks = ",".join("?" for _ in vals) or "NULL"
            where.append(f"(l.{col} IN ({marks}){extra})")
            params += vals
    tags = _as_list(f.get("tags"))
    if tags and skip != "tags":
        marks = ",".join("?" for _ in tags)
        where.append(f"l.email IN (SELECT email FROM contact_tags WHERE tag IN ({marks}))")
        params += tags
    ids = _ids(f.get("list_id"))
    if ids and skip != "list_id":
        where.append(f"l.email IN (SELECT ref FROM list_members WHERE list_id IN "
                     f"({','.join('?' for _ in ids)}))")
        params += ids
    not_ids = _ids(f.get("not_list_id"))
    if not_ids:
        where.append(f"l.email NOT IN (SELECT ref FROM list_members WHERE list_id IN "
                     f"({','.join('?' for _ in not_ids)}))")
        params += not_ids
    domains = [d.lower() for d in _as_list(f.get("domain"))]
    if domains:
        where.append(f"l.domain IN ({','.join('?' for _ in domains)})")
        params += domains
    titles = _as_list(f.get("title"))
    if titles:
        where.append("(" + " OR ".join("LOWER(l.title) LIKE ?" for _ in titles) + ")")
        params += [f"%{t.lower()}%" for t in titles]
    loc = str(f.get("location") or "").strip().lower()
    if loc:
        where.append("(LOWER(l.city) LIKE ? OR LOWER(l.state) LIKE ? OR LOWER(l.country) LIKE ?)")
        params += [f"%{loc}%"] * 3
    techs = _as_list(f.get("technologies"))
    if techs:
        where.append("l.domain IN (SELECT domain FROM accounts WHERE "
                     + " OR ".join("technologies LIKE ?" for _ in techs) + ")")
        params += [f"%|{t}|%" for t in techs]
    for key, col, op in (("score_min", "score", ">="), ("score_max", "score", "<="),
                         ("fit_min", "fit_score", ">=")):
        if f.get(key) not in (None, ""):
            try:
                params.append(int(f[key]))
                where.append(f"l.{col} {op} ?")
            except (TypeError, ValueError):
                pass
    if _truthy(f.get("has_phone")):
        where.append("COALESCE(l.phone, '') != ''")
    if _truthy(f.get("has_linkedin")):
        where.append("COALESCE(l.linkedin_url, '') != ''")
    contacted = str(f.get("contacted") or "")
    if contacted == "never":
        where.append("l.last_contacted IS NULL")
    elif contacted == "ever":
        where.append("l.last_contacted IS NOT NULL")
    elif re.fullmatch(r"\d+d", contacted):
        where.append("l.last_contacted >= ?")
        params.append(time.time() - int(contacted[:-1]) * DAY)
    if f.get("created_within") not in (None, ""):
        try:
            params.append(time.time() - float(f["created_within"]) * DAY)
            where.append("l.created >= ?")
        except (TypeError, ValueError):
            pass
    seq = f.get("sequence")
    if seq not in (None, ""):
        active = "SELECT email FROM enrollments WHERE status IN ('active', 'paused')"
        if str(seq) == "any":
            where.append(f"l.email IN ({active})")
        elif str(seq) == "none":
            where.append(f"l.email NOT IN ({active})")
        else:
            where.append(f"l.email IN ({active} AND sequence_id=?)")
            params.append(int(seq))
    if f.get("owner") not in (None, ""):
        where.append("l.owner = ?")
        params.append(str(f["owner"]))
    emails = [e.lower() for e in _as_list(f.get("emails"))]
    if emails:
        where.append(f"l.email IN ({','.join('?' for _ in emails)})")
        params += emails
    return "WHERE " + " AND ".join(where), params


def search(db, filters: dict | None = None, sort: str = "updated", direction: str = "desc",
           page: int = 1, per_page: int = 50, enrich: bool = True) -> dict:
    """One page of contacts matching ``filters``."""
    where, params = build_where(filters)
    order = SORTS.get(sort, SORTS["updated"])
    direction = "ASC" if str(direction).lower() == "asc" else "DESC"
    per_page = max(1, min(int(per_page or 50), MAX_PER_PAGE))
    page = max(1, int(page or 1))
    total = db.scalar(f"SELECT COUNT(*) FROM leads l {where}", params, default=0)
    rows = db.query(f"{_SELECT} {where} ORDER BY {order} {direction}, l.email ASC "
                    "LIMIT ? OFFSET ?", (*params, per_page, (page - 1) * per_page))
    if enrich and rows:
        decorate(db, rows)
    return {"rows": rows, "total": total, "page": page, "per_page": per_page,
            "pages": max(1, -(-total // per_page))}


def decorate(db, rows: list) -> list:
    """Attach tags, lists and the active sequence to each row (a few batched queries)."""
    emails = [r["email"] for r in rows]
    tag_map = tagmod.for_contacts(db, emails)
    list_map = listmod.lists_for_many(db, emails)
    seq_map: dict = {}
    for i in range(0, len(emails), 500):
        chunk = emails[i:i + 500]
        marks = ",".join("?" for _ in chunk)
        for r in db.query(
                f"SELECT e.email, e.status, e.step, s.id, s.name FROM enrollments e "
                f"JOIN sequences s ON s.id = e.sequence_id WHERE e.email IN ({marks}) "
                "AND e.status IN ('active', 'paused')", chunk):
            seq_map[r["email"]] = {"id": r["id"], "name": r["name"], "status": r["status"],
                                   "step": r["step"]}
    for r in rows:
        r["tags"] = tag_map.get(r["email"], [])
        r["lists"] = list_map.get(r["email"], [])
        r["sequence"] = seq_map.get(r["email"])
    return rows


def matching_emails(db, filters: dict | None, limit: int = 50000) -> list:
    """Every email matching ``filters`` (for 'select all N results' bulk actions)."""
    where, params = build_where(filters)
    return [r["email"] for r in db.query(f"SELECT l.email FROM leads l {where} LIMIT ?",
                                         (*params, limit))]


def facets(db, filters: dict | None = None, top: int = 40) -> dict:
    """Counts per value for each sidebar facet, honoring every *other* filter."""
    out: dict = {}
    for col in FACETS:
        where, params = build_where(filters, skip=col)
        rows = db.query(f"SELECT COALESCE(l.{col}, '') AS value, COUNT(*) AS count FROM leads l "
                        f"{where} GROUP BY value ORDER BY count DESC LIMIT ?", (*params, top))
        out[col] = rows
    where, params = build_where(filters, skip="tags")
    out["tags"] = db.query(
        f"SELECT t.tag AS value, COUNT(*) AS count FROM contact_tags t JOIN leads l "
        f"ON l.email = t.email {where} GROUP BY t.tag COLLATE NOCASE "
        "ORDER BY count DESC LIMIT ?", (*params, top))
    where, params = build_where(filters, skip="list_id")
    out["lists"] = db.query(
        f"SELECT m.list_id AS value, li.name AS label, COUNT(*) AS count FROM list_members m "
        f"JOIN lists li ON li.id = m.list_id JOIN leads l ON l.email = m.ref {where} "
        "GROUP BY m.list_id ORDER BY count DESC LIMIT ?", (*params, top))
    where, params = build_where(filters)
    out["total"] = db.scalar(f"SELECT COUNT(*) FROM leads l {where}", params, default=0)
    return out


def get(db, email: str) -> dict | None:
    rows = db.query(f"{_SELECT} WHERE l.email=?", ((email or "").lower().strip(),))
    if not rows:
        return None
    decorate(db, rows)
    return rows[0]


def detail(db, email: str) -> dict | None:
    """The full contact record: profile, company, tags, lists, notes, tasks, deals,
    sequences, signals, and the timeline."""
    from openleads.workspace import notes
    row = get(db, email)
    if not row:
        return None
    email = row["email"]
    raw = db.query_one("SELECT data FROM leads WHERE email=?", (email,)) or {}
    try:
        data = json.loads(raw.get("data") or "{}")
    except ValueError:
        data = {}
    account = db.query_one("SELECT * FROM accounts WHERE domain=?", (row["domain"],)) \
        if row["domain"] else None
    if account:
        account["technologies"] = [t for t in (account.get("technologies") or "").split("|") if t]
        account["people"] = db.scalar("SELECT COUNT(*) FROM leads WHERE domain=?",
                                      (row["domain"],), default=0)
    return {
        "contact": row,
        "reasons": data.get("reasons") or [],
        "signals": data.get("signals") or {},
        "socials": data.get("socials") or {},
        "account": account,
        "notes": notes.for_ref(db, "contact", email),
        "tasks": db.query("SELECT * FROM tasks WHERE contact=? ORDER BY status='done', "
                          "COALESCE(due, 9e18) ASC", (email,)),
        "deals": db.query("SELECT * FROM deals WHERE contact=? ORDER BY updated DESC", (email,)),
        "enrollments": db.query(
            "SELECT e.*, s.name AS sequence_name FROM enrollments e JOIN sequences s "
            "ON s.id = e.sequence_id WHERE e.email=? ORDER BY e.enrolled DESC", (email,)),
        "suppressed": db.is_suppressed(email),
        "timeline": activity.timeline(db, "contact", email, limit=100),
    }


def create(db, contact: dict) -> dict:
    """Add one contact by hand. The email is required and must look like one."""
    email = str(contact.get("email") or "").lower().strip()
    if not _EMAIL_RE.match(email):
        raise ValueError("a contact needs a valid email address")
    if db.get_lead(email):
        raise ValueError(f"{email} is already in your CRM")
    lead = {k: contact.get(k, "") for k in ("first_name", "last_name", "title", "organization",
                                             "phone", "linkedin_url", "website", "city",
                                             "state", "country", "industry")}
    lead.update(email=email, source=contact.get("source") or "manual",
                tier=contact.get("tier") or "", stage=contact.get("stage") or "new")
    db.upsert_lead(lead)
    if contact.get("tags"):
        tagmod.add(db, [email], contact["tags"])
    return get(db, email)


def update(db, email: str, fields: dict) -> dict | None:
    """Edit a contact. Edits stick: a later search that finds them again won't undo them."""
    email = (email or "").lower().strip()
    cur = get(db, email)
    if not cur:
        return None
    changes = {k: str(v if v is not None else "").strip() for k, v in (fields or {}).items()
               if k in EDITABLE}
    if "stage" in changes and changes["stage"] not in CONTACT_STAGE_KEYS:
        raise ValueError(f"unknown stage: {changes['stage']}")
    changes = {k: v for k, v in changes.items() if v != (cur.get(k) or "")}
    if not changes:
        return cur
    if "first_name" in changes or "last_name" in changes:
        first = changes.get("first_name", cur["first_name"])
        last = changes.get("last_name", cur["last_name"])
        changes["name"] = f"{first} {last}".strip()
    sets = ", ".join(f"{k}=?" for k in changes)
    db.execute(f"UPDATE leads SET {sets}, updated=? WHERE email=?",
               (*changes.values(), time.time(), email))
    _remember_edits(db, email, {k: v for k, v in changes.items() if k not in ("stage", "owner")})
    if "stage" in changes:
        activity.log(db, "contact", email, "stage",
                     f"{label(cur['stage'] or 'new')} → {label(changes['stage'])}",
                     {"from": cur["stage"], "to": changes["stage"], "auto": False})
    other = [k for k in changes if k not in ("stage", "name")]
    if other:
        activity.log(db, "contact", email, "updated", ", ".join(other), {"fields": other})
    return get(db, email)


def _remember_edits(db, email: str, edits: dict) -> None:
    """Store hand edits in the lead's JSON so upsert_lead re-applies them."""
    if not edits:
        return
    row = db.query_one("SELECT data FROM leads WHERE email=?", (email,)) or {}
    try:
        data = json.loads(row.get("data") or "{}")
    except ValueError:
        data = {}
    data["_edited"] = {**(data.get("_edited") or {}), **edits}
    db.execute("UPDATE leads SET data=? WHERE email=?", (json.dumps(data), email))


def delete(db, emails) -> int:
    """Remove contacts and their workspace data. Suppression and the send log stay,
    so a deleted contact who unsubscribed is still never emailed."""
    emails = sorted({(e or "").lower().strip() for e in emails or [] if e})
    n = 0
    for i in range(0, len(emails), 500):
        chunk = emails[i:i + 500]
        marks = ",".join("?" for _ in chunk)
        n += db.execute(f"DELETE FROM leads WHERE email IN ({marks})", chunk).rowcount
        db.execute(f"DELETE FROM contact_tags WHERE email IN ({marks})", chunk)
        db.execute(f"DELETE FROM list_members WHERE ref IN ({marks})", chunk)
        db.execute(f"DELETE FROM notes WHERE ref_type='contact' AND ref IN ({marks})", chunk)
        db.execute(f"DELETE FROM activity WHERE ref_type='contact' AND ref IN ({marks})", chunk)
        db.execute(f"DELETE FROM tasks WHERE status='open' AND contact IN ({marks})", chunk)
        db.execute(f"UPDATE enrollments SET status='removed', next_due=NULL, finished=? "
                   f"WHERE status IN ('active', 'paused') AND email IN ({marks})",
                   (time.time(), *chunk))
    return n


def _bulk_set(db, emails: list, col: str, value: str) -> int:
    """Set one column on many contacts in a few statements, logging real changes."""
    changed: list = []
    now = time.time()
    for i in range(0, len(emails), 500):
        chunk = emails[i:i + 500]
        marks = ",".join("?" for _ in chunk)
        rows = db.query(f"SELECT email, {col} AS old FROM leads WHERE email IN ({marks}) "
                        f"AND COALESCE({col}, '') != ?", (*chunk, value))
        if not rows:
            continue
        hit = [r["email"] for r in rows]
        hm = ",".join("?" for _ in hit)
        db.execute(f"UPDATE leads SET {col}=?, updated=? WHERE email IN ({hm})",
                   (value, now, *hit))
        changed += rows
    if col == "stage":
        for r in changed:
            activity.log(db, "contact", r["email"], "stage",
                         f"{label(r['old'] or 'new')} → {label(value)}",
                         {"from": r["old"], "to": value, "auto": False})
    elif changed:
        activity.log_many(db, "contact", [r["email"] for r in changed], "updated", col,
                          {"fields": [col]})
    return len(changed)


BULK_ACTIONS = ("stage", "owner", "tag", "untag", "list", "unlist", "delete", "do_not_contact")


def bulk(db, emails, action: str, value=None) -> dict:
    """Apply one action to many contacts. Returns ``{action, count}``."""
    emails = sorted({(e or "").lower().strip() for e in emails or [] if e})
    if action not in BULK_ACTIONS:
        raise ValueError(f"unknown bulk action: {action}")
    if not emails:
        return {"action": action, "count": 0}
    if action == "stage":
        if value not in CONTACT_STAGE_KEYS:
            raise ValueError(f"unknown stage: {value}")
        n = _bulk_set(db, emails, "stage", value)
    elif action == "owner":
        n = _bulk_set(db, emails, "owner", str(value or ""))
    elif action == "tag":
        n = tagmod.add(db, emails, value)
    elif action == "untag":
        n = tagmod.remove(db, emails, value)
    elif action == "list":
        target = value if isinstance(value, dict) else {"id": value}
        lst = listmod.get(db, target.get("id")) if target.get("id") else \
            listmod.ensure(db, str(target.get("name") or ""), "people")
        n = listmod.add(db, lst["id"], emails) if lst else 0
    elif action == "unlist":
        n = listmod.remove(db, value, emails)
    elif action == "delete":
        n = delete(db, emails)
    else:  # do_not_contact
        for e in emails:
            db.set_status(e, "do_not_contact")
        n = len(emails)
    return {"action": action, "count": n}
