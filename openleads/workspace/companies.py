"""
Companies — accounts rolled up from your contacts, enriched from their websites.

Every company domain you have a contact at becomes an account automatically (see
``schema.sync_account``). This module searches and edits them, attaches homepage
profiles (tech stack, socials, phone, description), and builds the company record:
its people, notes, deals and timeline.

Filters for :func:`search`: ``q``, ``industry``, ``company_size``, ``country``,
``stage``, ``technologies`` (any-of), ``list_id``, ``has_phone``, ``min_people``,
``domains``.
"""
from __future__ import annotations

import json
import re
import time

from openleads.insights import companysize
from openleads.schema import tech_column
from openleads.workspace import activity
from openleads.workspace import lists as listmod
from openleads.workspace.people import _as_list, _ids, _truthy
from openleads.workspace.stages import ACCOUNT_STAGE_KEYS, ACCOUNT_STAGES, label

_PEOPLE = "(SELECT COUNT(*) FROM leads l WHERE l.domain = a.domain)"
_SAFE = "(SELECT COUNT(*) FROM leads l WHERE l.domain = a.domain AND l.tier = 'safe')"
_CONTACTED = ("(SELECT COUNT(*) FROM leads l WHERE l.domain = a.domain "
              "AND l.last_contacted IS NOT NULL)")
_SELECT = (f"SELECT a.*, {_PEOPLE} AS people, {_SAFE} AS safe, {_CONTACTED} AS contacted "
           "FROM accounts a")
SORTS = {
    "name": "LOWER(COALESCE(NULLIF(a.name, ''), a.domain))", "domain": "a.domain",
    "people": "people", "updated": "a.updated", "created": "a.created",
    "industry": "LOWER(a.industry)", "size": "a.company_size", "stage": "a.stage",
}
EDITABLE = ("name", "website", "industry", "employees", "city", "state", "country", "phone",
            "description", "linkedin_url", "twitter_url", "facebook_url", "instagram_url",
            "founded", "stage", "owner")
FACETS = ("industry", "company_size", "country", "stage")
_DOMAIN_RE = re.compile(r"^(?:[a-z0-9-]+\.)+[a-z]{2,}$")


def _decode(row: dict) -> dict:
    row["technologies"] = [t for t in (row.get("technologies") or "").split("|") if t]
    try:
        row["data"] = json.loads(row.get("data") or "{}")
    except (ValueError, TypeError):
        row["data"] = {}
    return row


def build_where(filters: dict | None, skip: str | None = None) -> tuple:
    f = filters or {}
    where, params = ["1=1"], []
    q = str(f.get("q") or "").strip().lower()
    if q:
        where.append("(LOWER(a.name) LIKE ? OR a.domain LIKE ? OR LOWER(a.industry) LIKE ? "
                     "OR LOWER(a.city) LIKE ? OR LOWER(a.description) LIKE ?)")
        params += [f"%{q}%"] * 5
    for col in FACETS:
        if col == skip:
            continue
        vals = _as_list(f.get(col))
        if vals:
            blank = "(none)" in vals or "" in vals
            vals = [v for v in vals if v not in ("", "(none)")]
            parts = []
            if vals:
                parts.append(f"a.{col} IN ({','.join('?' for _ in vals)})")
                params += vals
            if blank:
                parts.append(f"COALESCE(a.{col}, '') = ''")
            where.append("(" + " OR ".join(parts) + ")")
    techs = _as_list(f.get("technologies"))
    if techs and skip != "technologies":
        where.append("(" + " OR ".join("a.technologies LIKE ?" for _ in techs) + ")")
        params += [f"%|{t}|%" for t in techs]
    ids = _ids(f.get("list_id"))
    if ids and skip != "list_id":
        where.append(f"a.domain IN (SELECT ref FROM list_members WHERE list_id IN "
                     f"({','.join('?' for _ in ids)}))")
        params += ids
    if _truthy(f.get("has_phone")):
        where.append("COALESCE(a.phone, '') != ''")
    if f.get("min_people") not in (None, ""):
        where.append(f"{_PEOPLE} >= ?")
        params.append(int(f["min_people"]))
    domains = [d.lower() for d in _as_list(f.get("domains"))]
    if domains:
        where.append(f"a.domain IN ({','.join('?' for _ in domains)})")
        params += domains
    return "WHERE " + " AND ".join(where), params


def search(db, filters: dict | None = None, sort: str = "people", direction: str = "desc",
           page: int = 1, per_page: int = 50) -> dict:
    where, params = build_where(filters)
    order = SORTS.get(sort, SORTS["people"])
    direction = "ASC" if str(direction).lower() == "asc" else "DESC"
    per_page = max(1, min(int(per_page or 50), 500))
    page = max(1, int(page or 1))
    total = db.scalar(f"SELECT COUNT(*) FROM accounts a {where}", params, default=0)
    rows = [_decode(r) for r in db.query(
        f"{_SELECT} {where} ORDER BY {order} {direction}, a.domain ASC LIMIT ? OFFSET ?",
        (*params, per_page, (page - 1) * per_page))]
    lmap = listmod.lists_for_many(db, [r["domain"] for r in rows])
    for r in rows:
        r["lists"] = lmap.get(r["domain"], [])
    return {"rows": rows, "total": total, "page": page, "per_page": per_page,
            "pages": max(1, -(-total // per_page))}


def facets(db, filters: dict | None = None, top: int = 40) -> dict:
    out: dict = {}
    for col in FACETS:
        where, params = build_where(filters, skip=col)
        out[col] = db.query(f"SELECT COALESCE(a.{col}, '') AS value, COUNT(*) AS count "
                            f"FROM accounts a {where} GROUP BY value ORDER BY count DESC "
                            "LIMIT ?", (*params, top))
    where, params = build_where(filters, skip="technologies")
    counts: dict = {}
    for r in db.query(f"SELECT a.technologies FROM accounts a {where} "
                      "AND COALESCE(a.technologies, '') != ''", params):
        for t in r["technologies"].split("|"):
            if t:
                counts[t] = counts.get(t, 0) + 1
    out["technologies"] = [{"value": k, "count": v} for k, v in
                           sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:top]]
    where, params = build_where(filters)
    out["total"] = db.scalar(f"SELECT COUNT(*) FROM accounts a {where}", params, default=0)
    return out


def get(db, domain: str) -> dict | None:
    row = db.query_one(f"{_SELECT} WHERE a.domain=?", ((domain or "").lower().strip(),))
    return _decode(row) if row else None


def detail(db, domain: str) -> dict | None:
    from openleads.workspace import notes, people
    acc = get(db, domain)
    if not acc:
        return None
    domain = acc["domain"]
    staff = people.search(db, {"domain": domain}, sort="seniority", direction="asc",
                          per_page=200)["rows"]
    return {
        "account": acc,
        "people": staff,
        "lists": listmod.lists_for(db, domain),
        "notes": notes.for_ref(db, "company", domain),
        "deals": db.query("SELECT * FROM deals WHERE account=? ORDER BY updated DESC", (domain,)),
        "tasks": db.query("SELECT * FROM tasks WHERE account=? AND status='open' "
                          "ORDER BY COALESCE(due, 9e18)", (domain,)),
        "timeline": activity.timeline(db, "company", domain, limit=100),
        "stages": [{"key": k, "label": lab} for k, lab, _ in ACCOUNT_STAGES],
    }


def create(db, domain: str, name: str = "", **fields) -> dict:
    domain = (domain or "").lower().strip().replace("https://", "").replace("http://", "")
    domain = domain.split("/")[0]
    if domain.startswith("www."):
        domain = domain[4:]
    if not _DOMAIN_RE.match(domain):
        raise ValueError("a company needs a valid domain, like acme.com")
    if get(db, domain):
        raise ValueError(f"{domain} is already a company in your workspace")
    now = time.time()
    db.execute("INSERT INTO accounts (domain, name, website, source, created, updated) "
               "VALUES (?,?,?,?,?,?)", (domain, name or "", f"https://{domain}", "manual", now, now))
    if fields:
        update(db, domain, fields)
    activity.log(db, "company", domain, "created", "added by hand")
    return get(db, domain)


def update(db, domain: str, fields: dict) -> dict | None:
    acc = get(db, domain)
    if not acc:
        return None
    changes = {k: str(v if v is not None else "").strip() for k, v in (fields or {}).items()
               if k in EDITABLE}
    if "stage" in changes and changes["stage"] not in ACCOUNT_STAGE_KEYS:
        raise ValueError(f"unknown account stage: {changes['stage']}")
    changes = {k: v for k, v in changes.items() if v != (acc.get(k) or "")}
    if not changes:
        return acc
    if "employees" in changes:
        changes["company_size"] = companysize.bucket(changes["employees"])
    sets = ", ".join(f"{k}=?" for k in changes)
    db.execute(f"UPDATE accounts SET {sets}, updated=? WHERE domain=?",
               (*changes.values(), time.time(), acc["domain"]))
    if "stage" in changes:
        activity.log(db, "company", acc["domain"], "stage",
                     f"{label(acc['stage'] or 'prospect', ACCOUNT_STAGES)} → "
                     f"{label(changes['stage'], ACCOUNT_STAGES)}",
                     {"from": acc["stage"], "to": changes["stage"]})
    return get(db, acc["domain"])


def apply_profile(db, domain: str, profile: dict) -> dict | None:
    """Fold a homepage profile (``insights.company``) into the account.

    Blank fields fill in; the tech stack is replaced (it's a fresh observation).
    """
    domain = (domain or "").lower().strip()
    if not profile or profile.get("error"):
        return get(db, domain)
    if not get(db, domain):
        now = time.time()
        db.execute("INSERT INTO accounts (domain, source, created, updated) VALUES (?,?,?,?)",
                   (domain, "profile", now, now))
    socials = profile.get("socials") or {}
    addr = profile.get("address") or {}
    fill = {
        "name": profile.get("name", ""), "description": profile.get("description", ""),
        "industry": profile.get("industry", ""), "phone": profile.get("phone", ""),
        "employees": profile.get("employees", ""), "company_size": profile.get("size", ""),
        "founded": profile.get("founded", ""), "city": addr.get("city", ""),
        "state": addr.get("region", ""), "country": addr.get("country", ""),
        "linkedin_url": socials.get("linkedin", ""), "twitter_url": socials.get("twitter", ""),
        "facebook_url": socials.get("facebook", ""),
        "instagram_url": socials.get("instagram", ""),
        "website": f"https://{domain}",
    }
    fill = {k: v for k, v in fill.items() if v}
    sets = ", ".join(f"{k} = CASE WHEN COALESCE({k}, '') = '' THEN ? ELSE {k} END" for k in fill)
    now = time.time()
    db.execute(f"UPDATE accounts SET {sets + ', ' if sets else ''}technologies=?, profiled=?, "
               "updated=? WHERE domain=?",
               (*fill.values(), tech_column(profile.get("technologies")), now, now, domain))
    techs = profile.get("technologies") or []
    activity.log(db, "company", domain, "enriched",
                 f"{len(techs)} technologies" if techs else "profile refreshed",
                 {"technologies": techs[:20]})
    return get(db, domain)


def delete(db, domains) -> int:
    """Remove accounts (their contacts stay in People)."""
    domains = sorted({(d or "").lower().strip() for d in domains or [] if d})
    n = 0
    for i in range(0, len(domains), 500):
        chunk = domains[i:i + 500]
        marks = ",".join("?" for _ in chunk)
        n += db.execute(f"DELETE FROM accounts WHERE domain IN ({marks})", chunk).rowcount
        db.execute(f"DELETE FROM list_members WHERE ref IN ({marks})", chunk)
        db.execute(f"DELETE FROM notes WHERE ref_type='company' AND ref IN ({marks})", chunk)
    return n


def bulk(db, domains, action: str, value=None) -> dict:
    domains = sorted({(d or "").lower().strip() for d in domains or [] if d})
    if action == "stage":
        if value not in ACCOUNT_STAGE_KEYS:
            raise ValueError(f"unknown account stage: {value}")
        n = sum(1 for d in domains if (get(db, d) or {}).get("stage") != value
                and update(db, d, {"stage": value}))
    elif action == "owner":
        n = sum(1 for d in domains if update(db, d, {"owner": value or ""}) is not None)
    elif action == "list":
        target = value if isinstance(value, dict) else {"id": value}
        lst = listmod.get(db, target.get("id")) if target.get("id") else \
            listmod.ensure(db, str(target.get("name") or ""), "companies")
        n = listmod.add(db, lst["id"], domains) if lst else 0
    elif action == "unlist":
        n = listmod.remove(db, value, domains)
    elif action == "delete":
        n = delete(db, domains)
    else:
        raise ValueError(f"unknown bulk action: {action}")
    return {"action": action, "count": n}


def needs_profile(db, limit: int = 50, older_than_days: int = 30) -> list:
    """Domains never profiled (or profiled long ago), most people first."""
    cutoff = time.time() - older_than_days * 86400
    return [r["domain"] for r in db.query(
        f"SELECT a.domain, {_PEOPLE} AS people FROM accounts a WHERE a.profiled IS NULL "
        "OR a.profiled < ? ORDER BY people DESC LIMIT ?", (cutoff, limit))]
