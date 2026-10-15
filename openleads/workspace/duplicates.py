"""
Duplicate contacts — the same person at the same company under two addresses
(``jane@acme.com`` from a search, ``jane.doe@acme.com`` from an import).

:func:`find` groups contacts by company domain + normalized full name and puts the
best record first (safest tier, strongest evidence, highest score, oldest).
:func:`merge` folds the others into it: tags, lists, notes, tasks, deals, timeline
and sequence enrollments move over, blank fields fill in, and the extra rows go.
The send log and suppression list are left alone: they describe real addresses.
"""
from __future__ import annotations

import time

from openleads.emails.permute import ascii_fold
from openleads.workspace import activity

_TIER = {"safe": 0, "risky": 1, "": 2, None: 2, "bad": 3}
_EVIDENCE = {"found": 0, "pattern": 1, "guessed": 2, "": 3, None: 3, "none": 3}
_FILL = ("first_name", "last_name", "title", "organization", "phone", "linkedin_url", "website",
         "city", "state", "country", "industry", "employees", "company_size", "seniority",
         "department", "owner")


def name_key(row: dict) -> str:
    name = " ".join(p for p in (row.get("first_name"), row.get("last_name")) if p) \
        or row.get("name") or ""
    return " ".join(ascii_fold(name).lower().replace(".", " ").split())


def _rank(row: dict) -> tuple:
    return (_TIER.get(row.get("tier"), 2), _EVIDENCE.get(row.get("evidence"), 3),
            -(row.get("score") or 0), row.get("created") or 0, row["email"])


def find(db, limit: int = 500) -> list:
    """``[[primary, dup, ...], ...]`` — groups of the same person, best record first."""
    rows = db.query("SELECT email, name, first_name, last_name, title, organization, domain, "
                    "tier, evidence, score, created, stage FROM leads "
                    "WHERE COALESCE(domain, '') != ''")
    groups: dict = {}
    for r in rows:
        key = name_key(r)
        if len(key.split()) < 2:             # first-name-only matches are too loose
            continue
        groups.setdefault((r["domain"], key), []).append(r)
    out = [sorted(g, key=_rank) for g in groups.values() if len(g) > 1]
    out.sort(key=lambda g: (-len(g), g[0]["email"]))
    return out[:limit]


def merge(db, primary: str, others) -> dict:
    """Fold ``others`` into ``primary``. Returns ``{primary, merged: [...]}``."""
    primary = (primary or "").lower().strip()
    others = [o for o in {(e or "").lower().strip() for e in others or []} if o and o != primary]
    keep = db.get_lead(primary)
    if not keep:
        raise ValueError(f"{primary} is not in your CRM")
    merged = []
    for other in sorted(others):
        row = db.get_lead(other)
        if not row:
            continue
        fills = {k: row[k] for k in _FILL if row.get(k) and not keep.get(k)}
        if fills:
            sets = ", ".join(f"{k}=?" for k in fills)
            db.execute(f"UPDATE leads SET {sets} WHERE email=?", (*fills.values(), primary))
            keep.update(fills)
        db.execute("INSERT OR IGNORE INTO contact_tags (email, tag) "
                   "SELECT ?, tag FROM contact_tags WHERE email=?", (primary, other))
        db.execute("DELETE FROM contact_tags WHERE email=?", (other,))
        db.execute("INSERT OR IGNORE INTO list_members (list_id, ref, added) "
                   "SELECT list_id, ?, added FROM list_members WHERE ref=?", (primary, other))
        db.execute("DELETE FROM list_members WHERE ref=?", (other,))
        db.execute("UPDATE notes SET ref=? WHERE ref_type='contact' AND ref=?", (primary, other))
        db.execute("UPDATE activity SET ref=? WHERE ref_type='contact' AND ref=?", (primary, other))
        db.execute("UPDATE tasks SET contact=? WHERE contact=?", (primary, other))
        db.execute("UPDATE deals SET contact=? WHERE contact=?", (primary, other))
        db.execute("UPDATE OR IGNORE enrollments SET email=? WHERE email=?", (primary, other))
        db.execute("UPDATE enrollments SET status='removed', next_due=NULL, finished=? "
                   "WHERE email=? AND status IN ('active', 'paused')", (time.time(), other))
        db.execute("DELETE FROM leads WHERE email=?", (other,))
        merged.append(other)
    if merged:
        activity.log(db, "contact", primary, "merged", ", ".join(merged), {"merged": merged})
    return {"primary": primary, "merged": merged}


def merge_all(db) -> dict:
    """Merge every duplicate group into its best record."""
    groups = find(db, limit=100000)
    n = 0
    for g in groups:
        n += len(merge(db, g[0]["email"], [r["email"] for r in g[1:]])["merged"])
    return {"groups": len(groups), "merged": n}
