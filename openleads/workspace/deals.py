"""
Deals — the pipeline: opportunities moving from qualify to won (or lost).

Each deal can point at a company (domain) and a primary contact (email). The board
groups deals by stage with count, total and probability-weighted value per column,
which is what a forecast is. Winning a deal marks its contact and company as
customers.
"""
from __future__ import annotations

import re
import time

from openleads.workspace import activity
from openleads.workspace.stages import (
    DEAL_PROBABILITY,
    DEAL_STAGE_KEYS,
    DEAL_STAGES,
    OPEN_DEAL_STAGES,
    label,
)

EDITABLE = ("name", "account", "contact", "amount", "currency", "close_date", "owner", "note")
_SELECT = ("SELECT d.*, a.name AS account_name, l.name AS contact_name FROM deals d "
           "LEFT JOIN accounts a ON a.domain = d.account LEFT JOIN leads l ON l.email = d.contact")


def _amount(value) -> float:
    """'$12,000', '2.5k', '1.2m', '900 USD' or a number → a float."""
    if value in (None, ""):
        return 0.0
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return round(float(value), 2)
    text = str(value).strip().lower().replace(",", "")
    m = re.fullmatch(r"[^\d\-.]*(-?\d+(?:\.\d+)?)\s*([km])?\b\s*[a-z]*", text)
    if not m:
        raise ValueError(f"couldn't read the amount '{value}'")
    scale = {"k": 1e3, "m": 1e6}.get(m.group(2) or "", 1)
    return round(float(m.group(1)) * scale, 2)


def _date(value) -> str:
    value = str(value or "").strip()
    if value and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("close date must be YYYY-MM-DD")
    return value


def create(db, name: str, account: str = "", contact: str = "", stage: str = "qualify",
           amount=0, currency: str = "USD", close_date: str = "", owner: str = "",
           note: str = "") -> dict:
    name = " ".join(str(name or "").split())[:160]
    if not name:
        raise ValueError("a deal needs a name")
    if stage not in DEAL_STAGE_KEYS:
        raise ValueError(f"deal stage must be one of {DEAL_STAGE_KEYS}")
    contact = (contact or "").lower().strip()
    account = (account or "").lower().strip() or (contact.split("@", 1)[1] if "@" in contact else "")
    now = time.time()
    position = (db.scalar("SELECT MAX(position) FROM deals WHERE stage=?", (stage,), default=0)
                or 0) + 1
    cur = db.execute(
        "INSERT INTO deals (name, account, contact, stage, amount, currency, close_date, owner, "
        "note, position, created, updated, closed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (name, account, contact, stage, _amount(amount), (currency or "USD").upper()[:3],
         _date(close_date), owner or "", note or "", position, now, now,
         now if stage in ("won", "lost") else None))
    deal_id = cur.lastrowid
    activity.log(db, "deal", deal_id, "deal_created", name, {"stage": stage})
    if contact:
        activity.log(db, "contact", contact, "deal_created", name, {"deal_id": deal_id})
    return get(db, deal_id)


def get(db, deal_id) -> dict | None:
    try:
        return db.query_one(_SELECT + " WHERE d.id=?", (int(deal_id),))
    except (TypeError, ValueError):
        return None


def list_deals(db, stage: str | None = None, q: str | None = None,
               owner: str | None = None) -> list:
    where, params = [], []
    if stage:
        where.append("d.stage=?")
        params.append(stage)
    if q:
        where.append("(LOWER(d.name) LIKE ? OR d.account LIKE ? OR LOWER(a.name) LIKE ?)")
        params += [f"%{q.lower()}%"] * 3
    if owner:
        where.append("d.owner=?")
        params.append(owner)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    return db.query(f"{_SELECT} {clause} ORDER BY d.position ASC, d.updated DESC", params)


def board(db, q: str | None = None, owner: str | None = None) -> dict:
    """Deals grouped by stage, with per-column and pipeline-wide totals."""
    deals = list_deals(db, q=q, owner=owner)
    columns = []
    for key, name, prob in DEAL_STAGES:
        items = [d for d in deals if d["stage"] == key]
        total = sum(d["amount"] or 0 for d in items)
        columns.append({"key": key, "label": name, "probability": prob, "deals": items,
                        "count": len(items), "total": round(total, 2),
                        "weighted": round(total * prob / 100, 2)})
    open_cols = [c for c in columns if c["key"] in OPEN_DEAL_STAGES]
    won = next(c for c in columns if c["key"] == "won")
    lost = next(c for c in columns if c["key"] == "lost")
    closed = won["count"] + lost["count"]
    return {
        "columns": columns,
        "totals": {
            "open_count": sum(c["count"] for c in open_cols),
            "open_value": round(sum(c["total"] for c in open_cols), 2),
            "weighted": round(sum(c["weighted"] for c in open_cols), 2),
            "won_count": won["count"], "won_value": won["total"], "lost_count": lost["count"],
            "win_rate": round(100 * won["count"] / closed, 1) if closed else 0.0,
        },
    }


def move(db, deal_id, stage: str, position: float | None = None) -> dict | None:
    deal = get(db, deal_id)
    if not deal:
        return None
    if stage not in DEAL_STAGE_KEYS:
        raise ValueError(f"deal stage must be one of {DEAL_STAGE_KEYS}")
    now = time.time()
    if position is None:
        position = (db.scalar("SELECT MAX(position) FROM deals WHERE stage=?", (stage,),
                              default=0) or 0) + 1
    closed = now if stage in ("won", "lost") else None
    db.execute("UPDATE deals SET stage=?, position=?, updated=?, closed=? WHERE id=?",
               (stage, float(position), now, closed, deal["id"]))
    if stage != deal["stage"]:
        summary = f"{deal['name']}: {label(deal['stage'], DEAL_STAGES)} → {label(stage, DEAL_STAGES)}"
        activity.log(db, "deal", deal["id"], "deal_stage", summary,
                     {"from": deal["stage"], "to": stage})
        if deal["contact"]:
            activity.log(db, "contact", deal["contact"], "deal_stage", summary,
                         {"deal_id": deal["id"], "to": stage})
        if stage == "won":
            _mark_customer(db, deal)
    return get(db, deal["id"])


def _mark_customer(db, deal: dict) -> None:
    from openleads.workspace import companies, people
    if deal["contact"] and people.get(db, deal["contact"]):
        people.update(db, deal["contact"], {"stage": "customer"})
    if deal["account"] and companies.get(db, deal["account"]):
        companies.update(db, deal["account"], {"stage": "customer"})


def update(db, deal_id, fields: dict) -> dict | None:
    deal = get(db, deal_id)
    if not deal:
        return None
    changes = {k: v for k, v in (fields or {}).items() if k in EDITABLE}
    if "amount" in changes:
        changes["amount"] = _amount(changes["amount"])
    if "close_date" in changes:
        changes["close_date"] = _date(changes["close_date"])
    if "name" in changes and not str(changes["name"]).strip():
        raise ValueError("a deal needs a name")
    for k in ("account", "contact"):
        if k in changes:
            changes[k] = str(changes[k] or "").lower().strip()
    if changes:
        sets = ", ".join(f"{k}=?" for k in changes)
        db.execute(f"UPDATE deals SET {sets}, updated=? WHERE id=?",
                   (*changes.values(), time.time(), deal["id"]))
    if fields and fields.get("stage") and fields["stage"] != deal["stage"]:
        return move(db, deal["id"], fields["stage"])
    return get(db, deal["id"])


def delete(db, deal_id) -> bool:
    return db.execute("DELETE FROM deals WHERE id=?", (int(deal_id),)).rowcount > 0


def forecast(db) -> float:
    """Probability-weighted value of every open deal."""
    rows = db.query("SELECT stage, SUM(amount) AS total FROM deals GROUP BY stage")
    return round(sum((r["total"] or 0) * DEAL_PROBABILITY.get(r["stage"], 0) / 100
                     for r in rows if r["stage"] in OPEN_DEAL_STAGES), 2)
