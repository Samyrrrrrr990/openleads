"""
ICP fit scoring — a 0–100 score (and an A–D grade) for how well a contact matches
the customer you're after, with the reasons that produced it.

The model is a plain dict of points, stored in the workspace and editable from the
dashboard:

* ``seniority``      points per seniority ("vp": 25)
* ``departments``    points per department ("marketing": 15)
* ``titles``         ``[{keyword, points}]``: title contains the keyword
* ``industries``     points per industry ("Dental": 15)
* ``locations``      ``[{match, points}]``: city/state/country contains ``match``
* ``company_sizes``  points per headcount bucket ("11-50": 10)
* ``technologies``   points per technology the company's site runs ("HubSpot": 10)
* ``email``          points per tier ("safe": 25)
* ``evidence``       points per email evidence ("found": 10)
* ``has_phone`` / ``has_linkedin``   flat points

Scores are capped to 0–100. Unconfigured sections score nothing, so the default
model ranks by seniority and reachability until you describe your ICP.
"""
from __future__ import annotations

import copy

KV_KEY = "fit_model"
DEFAULT_MODEL = {
    "seniority": {"owner": 30, "founder": 30, "c_suite": 30, "partner": 25, "vp": 25,
                  "head": 22, "director": 20, "manager": 12, "senior": 8, "entry": 3,
                  "intern": 0},
    "departments": {},
    "titles": [],
    "industries": {},
    "locations": [],
    "company_sizes": {},
    "technologies": {},
    "email": {"safe": 25, "risky": 8},
    "evidence": {"found": 10, "pattern": 6, "guessed": 0},
    "has_phone": 5,
    "has_linkedin": 5,
}
_MAPS = ("seniority", "departments", "industries", "company_sizes", "technologies", "email",
         "evidence")
_LISTS = (("titles", "keyword"), ("locations", "match"))
GRADES = ((75, "A"), (55, "B"), (35, "C"), (0, "D"))


def grade(score: int) -> str:
    for floor, g in GRADES:
        if score >= floor:
            return g
    return "D"


def _pts(v) -> int:
    try:
        return max(-100, min(100, int(round(float(v)))))
    except (TypeError, ValueError):
        raise ValueError(f"points must be numbers, got {v!r}") from None


def normalize_model(model: dict | None) -> dict:
    """Fill defaults, coerce points to ints in [-100, 100], drop junk."""
    out = copy.deepcopy(DEFAULT_MODEL)
    m = model or {}
    for key in _MAPS:
        if isinstance(m.get(key), dict):
            out[key] = {str(k): _pts(v) for k, v in m[key].items() if str(k).strip()}
    for key, field in _LISTS:
        if isinstance(m.get(key), list):
            out[key] = [{field: str(r.get(field, "")).strip(), "points": _pts(r.get("points", 0))}
                        for r in m[key] if isinstance(r, dict) and str(r.get(field, "")).strip()]
    for key in ("has_phone", "has_linkedin"):
        if key in m:
            out[key] = _pts(m[key])
    return out


def get_model(db) -> dict:
    return normalize_model(db.kv_get(KV_KEY) or {})


def save_model(db, model: dict) -> dict:
    clean = normalize_model(model)
    db.kv_set(KV_KEY, clean)
    return clean


def explain(contact: dict, model: dict | None = None, technologies=None) -> tuple:
    """``(score, [(reason, points), ...])`` for one contact (pure)."""
    m = normalize_model(model) if model is not None else copy.deepcopy(DEFAULT_MODEL)
    c = contact or {}
    parts: list = []

    def add(reason: str, pts: int) -> None:
        if pts:
            parts.append((reason, pts))

    sen = c.get("seniority") or ""
    add(f"seniority: {sen}", m["seniority"].get(sen, 0) if sen else 0)
    dep = c.get("department") or ""
    add(f"department: {dep}", m["departments"].get(dep, 0) if dep else 0)
    title = (c.get("title") or "").lower()
    for row in m["titles"]:
        if row["keyword"].lower() in title:
            add(f"title has '{row['keyword']}'", row["points"])
    ind = c.get("industry") or ""
    for k, v in m["industries"].items():
        if ind and k.lower() == ind.lower():
            add(f"industry: {ind}", v)
    place = " ".join(str(c.get(k) or "") for k in ("city", "state", "country")).lower()
    for row in m["locations"]:
        if place and row["match"].lower() in place:
            add(f"location: {row['match']}", row["points"])
    size = c.get("company_size") or ""
    add(f"company size: {size}", m["company_sizes"].get(size, 0) if size else 0)
    techs = {t.lower() for t in (technologies or [])}
    for k, v in m["technologies"].items():
        if k.lower() in techs:
            add(f"uses {k}", v)
    tier = c.get("tier") or ""
    add(f"email {tier}", m["email"].get(tier, 0) if tier else 0)
    ev = c.get("evidence") or ""
    add(f"email {ev}", m["evidence"].get(ev, 0) if ev else 0)
    if c.get("phone"):
        add("has a phone", m["has_phone"])
    if c.get("linkedin_url"):
        add("has LinkedIn", m["has_linkedin"])
    score = max(0, min(100, sum(p for _, p in parts)))
    return score, parts


def score(contact: dict, model: dict | None = None, technologies=None) -> int:
    return explain(contact, model, technologies)[0]


_FIELDS = ("email", "seniority", "department", "title", "industry", "city", "state", "country",
           "company_size", "tier", "evidence", "phone", "linkedin_url", "domain", "fit_score")


def rescore(db, emails=None) -> int:
    """Recompute ``fit_score`` for ``emails`` (or everyone). Returns rows changed."""
    model = get_model(db)
    if emails is None:
        rows = db.query(f"SELECT {', '.join(_FIELDS)} FROM leads")
    else:
        emails = sorted({(e or "").lower().strip() for e in emails if e})
        rows = []
        for i in range(0, len(emails), 500):
            chunk = emails[i:i + 500]
            marks = ",".join("?" for _ in chunk)
            rows += db.query(f"SELECT {', '.join(_FIELDS)} FROM leads WHERE email IN ({marks})",
                             chunk)
    techs = {r["domain"]: [t for t in (r["technologies"] or "").split("|") if t]
             for r in db.query("SELECT domain, technologies FROM accounts "
                               "WHERE COALESCE(technologies, '') != ''")}
    updates = []
    for r in rows:
        s = score(r, model, techs.get(r["domain"]))
        if s != (r["fit_score"] or 0):
            updates.append((s, r["email"]))
    if updates:
        db.executemany("UPDATE leads SET fit_score=? WHERE email=?", updates)
    return len(updates)


def simulate(db, model: dict, top: int = 8) -> dict:
    """Score everyone with a draft ``model`` without saving it: the grade
    distribution, how many grades would change, and the best matches."""
    m = normalize_model(model)
    techs = {r["domain"]: [t for t in (r["technologies"] or "").split("|") if t]
             for r in db.query("SELECT domain, technologies FROM accounts "
                               "WHERE COALESCE(technologies, '') != ''")}
    dist = {g: 0 for _, g in GRADES}
    moved = 0
    scored = []
    for r in db.query(f"SELECT {', '.join(_FIELDS)}, name, organization FROM leads"):
        s = score(r, m, techs.get(r["domain"]))
        g = grade(s)
        dist[g] += 1
        moved += g != grade(r["fit_score"] or 0)
        scored.append((s, r))
    scored.sort(key=lambda x: (-x[0], x[1]["email"]))
    return {"distribution": dist, "changed": moved,
            "top": [{"email": r["email"], "name": r["name"], "title": r["title"],
                     "organization": r["organization"], "score": s, "grade": grade(s)}
                    for s, r in scored[:top]]}


def distribution(db) -> dict:
    """How many contacts sit in each grade (for the dashboard)."""
    out = {g: 0 for _, g in GRADES}
    for r in db.query("SELECT fit_score FROM leads"):
        out[grade(r["fit_score"] or 0)] += 1
    return out
