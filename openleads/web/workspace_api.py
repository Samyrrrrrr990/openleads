"""
The workspace JSON API — People, Companies, Lists, Tasks, Deals, Templates,
Sequences, saved searches, scoring, import and the home dashboard.

Every handler opens the local database, calls one ``openleads.workspace`` function
and returns plain JSON. Validation problems raise ``ValueError``, which the server
turns into a 400 with the message, so the UI can show it as-is.

Routes are collected in :data:`GET`, :data:`POST` and :data:`STREAM`, and merged
into the server's tables.
"""
from __future__ import annotations

from typing import Callable

from openleads.db import DB

GET: dict = {}
POST: dict = {}
STREAM: dict = {}


def route(table: dict, path: str) -> Callable:
    """Register ``fn(db, payload)`` at ``path``; the wrapper owns the DB lifecycle."""
    def deco(fn):
        if table is STREAM:
            def handler(payload, emit):
                db = DB()
                try:
                    return fn(db, payload or {}, emit)
                finally:
                    db.close()
        else:
            def handler(payload=None):
                db = DB()
                try:
                    return fn(db, payload or {})
                finally:
                    db.close()
        handler.__name__ = fn.__name__
        handler.__doc__ = fn.__doc__
        table[path] = handler
        return fn
    return deco


def _int(v, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _emails_from(db, p: dict) -> list:
    """A selection: explicit ``emails``, or every contact matching ``filters`` (``all``)."""
    from openleads.workspace import people
    if p.get("all"):
        return people.matching_emails(db, p.get("filters") or {})
    emails = p.get("emails") or []
    if isinstance(emails, str):
        emails = [e for e in emails.replace(",", " ").split() if e]
    return [str(e).lower().strip() for e in emails if str(e).strip()]


# --------------------------------------------------------------------------- #
# Meta + home                                                                 #
# --------------------------------------------------------------------------- #
@route(GET, "/api/meta")
def meta(db, p):
    """Vocabularies the UI renders: stages, seniorities, departments, sizes, …"""
    from openleads.automate.exporters import SINKS
    from openleads.insights import companysize, techstack, titles
    from openleads.workspace import lists, sequences, stages, tasks, templates
    return {
        "contact_stages": stages.as_options(stages.CONTACT_STAGES),
        "account_stages": stages.as_options(stages.ACCOUNT_STAGES),
        "deal_stages": stages.as_options(stages.DEAL_STAGES),
        "seniorities": [{"key": k, "label": v} for k, v in titles.SENIORITIES],
        "departments": [{"key": k, "label": v} for k, v in titles.DEPARTMENTS],
        "company_sizes": list(companysize.BUCKET_KEYS),
        "step_types": [{"key": k, "label": v} for k, v in sequences.STEP_TYPES],
        "task_kinds": [{"key": k, "label": v} for k, v in tasks.KINDS],
        "template_variables": [{"key": k, "label": d, "example": e}
                               for k, d, e in templates.VARIABLES],
        "technologies": list(techstack.NAMES),
        "list_colors": list(lists.COLORS),
        "export_sinks": list(SINKS),
        "export_formats": ["csv", "apollo", "hubspot", "json"],
    }


@route(GET, "/api/home")
def home(db, p):
    from openleads.workspace import stats
    return stats.home(db, days=_int(p.get("days"), 30) or 30)


@route(GET, "/api/health")
def health(db, p):
    from openleads.workspace import stats
    return stats.health(db)


# --------------------------------------------------------------------------- #
# People                                                                      #
# --------------------------------------------------------------------------- #
@route(POST, "/api/people/search")
def people_search(db, p):
    from openleads.workspace import people
    res = people.search(db, p.get("filters") or {}, sort=p.get("sort") or "updated",
                        direction=p.get("direction") or "desc", page=_int(p.get("page"), 1),
                        per_page=_int(p.get("per_page"), 50))
    if p.get("facets"):
        res["facets"] = people.facets(db, p.get("filters") or {})
    return res


@route(POST, "/api/people/facets")
def people_facets(db, p):
    from openleads.workspace import people
    return people.facets(db, p.get("filters") or {})


@route(GET, "/api/people/get")
def people_get(db, p):
    from openleads.workspace import people
    d = people.detail(db, p.get("email") or "")
    if d is None:
        raise ValueError("no such contact")
    return d


@route(POST, "/api/people/create")
def people_create(db, p):
    from openleads.workspace import people, scoring
    row = people.create(db, p.get("contact") or p)
    scoring.rescore(db, [row["email"]])
    return {"ok": True, "contact": people.get(db, row["email"])}


@route(POST, "/api/people/update")
def people_update(db, p):
    from openleads.workspace import people, scoring
    row = people.update(db, p.get("email") or "", p.get("fields") or {})
    if row is None:
        raise ValueError("no such contact")
    scoring.rescore(db, [row["email"]])
    return {"ok": True, "contact": people.get(db, row["email"])}


@route(POST, "/api/people/tags")
def people_tags(db, p):
    from openleads.workspace import tags
    return {"ok": True, "tags": tags.set_tags(db, p.get("email") or "", p.get("tags") or [])}


@route(POST, "/api/people/bulk")
def people_bulk(db, p):
    from openleads.workspace import people
    emails = _emails_from(db, p)
    return {"ok": True, **people.bulk(db, emails, p.get("action") or "", p.get("value"))}


# --------------------------------------------------------------------------- #
# Companies                                                                   #
# --------------------------------------------------------------------------- #
@route(POST, "/api/companies/search")
def companies_search(db, p):
    from openleads.workspace import companies
    res = companies.search(db, p.get("filters") or {}, sort=p.get("sort") or "people",
                           direction=p.get("direction") or "desc", page=_int(p.get("page"), 1),
                           per_page=_int(p.get("per_page"), 50))
    if p.get("facets"):
        res["facets"] = companies.facets(db, p.get("filters") or {})
    return res


@route(GET, "/api/companies/get")
def companies_get(db, p):
    from openleads.workspace import companies
    d = companies.detail(db, p.get("domain") or "")
    if d is None:
        raise ValueError("no such company")
    return d


@route(POST, "/api/companies/create")
def companies_create(db, p):
    from openleads.workspace import companies
    fields = {k: v for k, v in (p.get("fields") or {}).items()}
    return {"ok": True, "company": companies.create(db, p.get("domain") or "",
                                                    p.get("name") or "", **fields)}


@route(POST, "/api/companies/update")
def companies_update(db, p):
    from openleads.workspace import companies
    row = companies.update(db, p.get("domain") or "", p.get("fields") or {})
    if row is None:
        raise ValueError("no such company")
    return {"ok": True, "company": row}


@route(POST, "/api/companies/bulk")
def companies_bulk(db, p):
    from openleads.workspace import companies
    domains = p.get("domains") or []
    if p.get("all"):
        domains = [r["domain"] for r in companies.search(
            db, p.get("filters") or {}, per_page=500)["rows"]]
    return {"ok": True, **companies.bulk(db, domains, p.get("action") or "", p.get("value"))}


@route(POST, "/api/companies/profile")
def companies_profile(db, p):
    """Fetch a company's homepage profile (one cached GET) and fold it in."""
    from openleads.cache.store import Cache
    from openleads.insights.company import fetch_profile
    from openleads.workspace import companies, scoring
    domain = (p.get("domain") or "").lower().strip()
    if not domain:
        raise ValueError("domain is required")
    cache = Cache()
    try:
        prof = fetch_profile(domain, cache=cache, refresh=bool(p.get("refresh")))
    finally:
        cache.close()
    if prof.get("error"):
        return {"ok": False, "error": f"{domain}: {prof['error']}", "profile": prof}
    acc = companies.apply_profile(db, domain, prof)
    scoring.rescore(db, [r["email"] for r in db.query("SELECT email FROM leads WHERE domain=?",
                                                       (domain,))])
    return {"ok": True, "company": acc, "profile": prof}


@route(STREAM, "/api/companies/enrich")
def companies_enrich(db, p, emit):
    """Profile many companies, streaming one event per domain."""
    from openleads.cache.store import Cache
    from openleads.insights.company import fetch_profile
    from openleads.workspace import companies, scoring
    domains = p.get("domains") or companies.needs_profile(db, limit=_int(p.get("limit"), 25) or 25)
    emit({"type": "phase", "message": f"profiling {len(domains)} companies…"})
    cache = Cache()
    ok = 0
    try:
        for d in domains:
            prof = fetch_profile(d, cache=cache, refresh=bool(p.get("refresh")))
            if prof.get("error"):
                emit({"type": "company", "domain": d, "ok": False, "error": prof["error"]})
                continue
            acc = companies.apply_profile(db, d, prof)
            ok += 1
            emit({"type": "company", "domain": d, "ok": True,
                  "technologies": acc["technologies"], "name": acc["name"]})
    finally:
        cache.close()
    scoring.rescore(db)
    emit({"type": "done", "count": len(domains), "profiled": ok})


# --------------------------------------------------------------------------- #
# Lists, tags, notes, activity                                                #
# --------------------------------------------------------------------------- #
@route(GET, "/api/lists")
def lists_all(db, p):
    from openleads.workspace import lists
    return {"lists": lists.all_lists(db, p.get("kind") or None)}


@route(POST, "/api/lists/save")
def lists_save(db, p):
    from openleads.workspace import lists
    if p.get("id"):
        row = lists.update(db, p["id"], name=p.get("name"), description=p.get("description"),
                           color=p.get("color"))
        if row is None:
            raise ValueError("no such list")
        return {"ok": True, "list": row}
    return {"ok": True, "list": lists.create(db, p.get("name") or "", p.get("kind") or "people",
                                             p.get("description") or "", p.get("color") or "")}


@route(POST, "/api/lists/delete")
def lists_delete(db, p):
    from openleads.workspace import lists
    return {"ok": lists.delete(db, p.get("id"))}


@route(POST, "/api/lists/add")
def lists_add(db, p):
    """Add a selection to a list (by id, or by name — created if new)."""
    from openleads.workspace import lists
    kind = p.get("kind") or "people"
    lst = lists.get(db, p.get("id")) if p.get("id") else \
        lists.ensure(db, p.get("name") or "", kind)
    if not lst:
        raise ValueError("no such list")
    refs = p.get("refs") or (_emails_from(db, p) if lst["kind"] == "people" else [])
    added = lists.add(db, lst["id"], refs)
    return {"ok": True, "added": added, "list": lists.get(db, lst["id"])}


@route(POST, "/api/lists/remove")
def lists_remove(db, p):
    from openleads.workspace import lists
    return {"ok": True, "removed": lists.remove(db, p.get("id"), p.get("refs") or [])}


@route(GET, "/api/tags")
def tags_all(db, p):
    from openleads.workspace import tags
    return {"tags": tags.all_tags(db)}


@route(POST, "/api/tags/rename")
def tags_rename(db, p):
    from openleads.workspace import tags
    return {"ok": True, "count": tags.rename(db, p.get("old") or "", p.get("new") or "")}


@route(POST, "/api/tags/delete")
def tags_delete(db, p):
    from openleads.workspace import tags
    return {"ok": True, "count": tags.delete(db, p.get("tag") or "")}


@route(POST, "/api/notes/add")
def notes_add(db, p):
    from openleads.workspace import notes
    return {"ok": True, "note": notes.add(db, p.get("ref_type") or "contact", p.get("ref"),
                                          p.get("body") or "", bool(p.get("pinned")))}


@route(POST, "/api/notes/update")
def notes_update(db, p):
    from openleads.workspace import notes
    row = notes.update(db, p.get("id"), body=p.get("body"),
                       pinned=p.get("pinned") if "pinned" in p else None)
    if row is None:
        raise ValueError("no such note")
    return {"ok": True, "note": row}


@route(POST, "/api/notes/delete")
def notes_delete(db, p):
    from openleads.workspace import notes
    return {"ok": notes.delete(db, p.get("id"))}


@route(GET, "/api/activity")
def activity_feed(db, p):
    """A record's timeline (``ref_type`` + ``ref``) or the workspace feed."""
    from openleads.workspace import activity
    limit = max(1, min(_int(p.get("limit"), 50), 500))
    if p.get("ref_type") and p.get("ref"):
        return {"activity": activity.timeline(db, p["ref_type"], p["ref"], limit=limit)}
    kinds = [k for k in (p.get("kinds") or "").split(",") if k]
    return {"activity": activity.recent(db, limit=limit, kinds=kinds or None)}


# --------------------------------------------------------------------------- #
# Tasks + deals                                                               #
# --------------------------------------------------------------------------- #
@route(GET, "/api/tasks")
def tasks_list(db, p):
    from openleads.workspace import tasks
    bucket = p.get("bucket") or "open"
    if bucket not in tasks.BUCKETS:
        raise ValueError(f"bucket must be one of {tasks.BUCKETS}")
    return {"tasks": tasks.list_tasks(db, bucket, kind=p.get("kind") or None,
                                      contact=p.get("contact") or None),
            "counts": tasks.counts(db)}


@route(POST, "/api/tasks/save")
def tasks_save(db, p):
    from openleads.workspace import tasks
    if p.get("id"):
        row = tasks.update(db, p["id"], p)
        if row is None:
            raise ValueError("no such task")
        return {"ok": True, "task": row}
    return {"ok": True, "task": tasks.create(
        db, p.get("title") or "", kind=p.get("kind") or "todo", contact=p.get("contact") or "",
        account=p.get("account") or "", due=p.get("due"), note=p.get("note") or "",
        priority=p.get("priority") or "normal", deal_id=p.get("deal_id"))}


def _task_action(fn_name: str):
    def handler(db, p):
        from openleads.workspace import tasks
        row = getattr(tasks, fn_name)(db, p.get("id"))
        if row is None:
            raise ValueError("no such task")
        return {"ok": True, "task": row, "counts": tasks.counts(db)}
    handler.__name__ = f"tasks_{fn_name}"
    return handler


for _name in ("complete", "skip", "reopen"):
    route(POST, f"/api/tasks/{_name}")(_task_action(_name))


@route(POST, "/api/tasks/delete")
def tasks_delete(db, p):
    from openleads.workspace import tasks
    return {"ok": tasks.delete(db, p.get("id"))}


@route(GET, "/api/deals")
def deals_board(db, p):
    from openleads.workspace import deals
    return deals.board(db, q=p.get("q") or None, owner=p.get("owner") or None)


@route(POST, "/api/deals/save")
def deals_save(db, p):
    from openleads.workspace import deals
    if p.get("id"):
        row = deals.update(db, p["id"], p)
        if row is None:
            raise ValueError("no such deal")
        return {"ok": True, "deal": row}
    return {"ok": True, "deal": deals.create(
        db, p.get("name") or "", account=p.get("account") or "", contact=p.get("contact") or "",
        stage=p.get("stage") or "qualify", amount=p.get("amount"),
        currency=p.get("currency") or "USD", close_date=p.get("close_date") or "",
        owner=p.get("owner") or "", note=p.get("note") or "")}


@route(POST, "/api/deals/move")
def deals_move(db, p):
    from openleads.workspace import deals
    pos = p.get("position")
    row = deals.move(db, p.get("id"), p.get("stage") or "",
                     float(pos) if pos not in (None, "") else None)
    if row is None:
        raise ValueError("no such deal")
    return {"ok": True, "deal": row}


@route(POST, "/api/deals/delete")
def deals_delete(db, p):
    from openleads.workspace import deals
    return {"ok": deals.delete(db, p.get("id"))}


# --------------------------------------------------------------------------- #
# Templates + sequences                                                       #
# --------------------------------------------------------------------------- #
@route(GET, "/api/templates")
def templates_all(db, p):
    from openleads.workspace import templates
    return {"templates": templates.list_templates(db, p.get("category") or None)}


@route(POST, "/api/templates/save")
def templates_save(db, p):
    from openleads.workspace import templates
    if p.get("id"):
        row = templates.update(db, p["id"], p)
        if row is None:
            raise ValueError("no such template")
        return {"ok": True, "template": row}
    return {"ok": True, "template": templates.create(db, p.get("name") or "",
                                                     p.get("subject") or "", p.get("body") or "",
                                                     p.get("category") or "")}


@route(POST, "/api/templates/delete")
def templates_delete(db, p):
    from openleads.workspace import templates
    return {"ok": templates.delete(db, p.get("id"))}


_SAMPLE = {"email": "jane@acme.example", "first_name": "Jane", "last_name": "Doe",
           "title": "VP of Sales", "organization": "Acme", "city": "Austin", "country": "US",
           "industry": "Software"}


@route(POST, "/api/templates/preview")
def templates_preview(db, p):
    """Render a subject/body for one contact (or a sample) and lint it."""
    from openleads.workspace import templates
    contact = db.get_lead(p["email"]) if p.get("email") else None
    sender = {"sender_context": p["context"]} if p.get("context") else None
    draft, missing = templates.render_draft(p.get("subject") or "", p.get("body") or "",
                                            contact or _SAMPLE, sender)
    return {"draft": draft.to_dict(), "missing": missing, "sample": contact is None,
            "unknown": templates.unknown_variables((p.get("subject") or "") + "\n"
                                                   + (p.get("body") or ""))}


@route(GET, "/api/sequences")
def sequences_all(db, p):
    from openleads.workspace import sequences
    return {"sequences": sequences.list_sequences(db)}


@route(GET, "/api/sequences/get")
def sequences_get(db, p):
    from openleads.workspace import sequences
    seq = sequences.get(db, p.get("id"))
    if not seq:
        raise ValueError("no such sequence")
    return {"sequence": seq, "stats": sequences.stats(db, seq["id"]),
            "enrollments": sequences.enrollments(db, seq["id"], p.get("status") or None,
                                                 limit=_int(p.get("limit"), 500) or 500)}


@route(GET, "/api/sequences/starter")
def sequences_starter(db, p):
    from openleads.workspace import sequences
    return {"steps": sequences.starter_steps(), "settings": sequences.DEFAULT_SETTINGS}


@route(POST, "/api/sequences/save")
def sequences_save(db, p):
    from openleads.workspace import sequences
    if p.get("id"):
        seq = sequences.update(db, p["id"], name=p.get("name"), steps=p.get("steps"),
                               settings=p.get("settings"))
    else:
        steps = p.get("steps")
        if steps is None and p.get("starter"):
            steps = sequences.starter_steps()
        seq = sequences.create(db, p.get("name") or "", steps or [], p.get("settings"))
    return {"ok": True, "sequence": seq}


@route(POST, "/api/sequences/status")
def sequences_status(db, p):
    from openleads.workspace import sequences
    return {"ok": True, "sequence": sequences.set_status(db, p.get("id"), p.get("status") or "")}


@route(POST, "/api/sequences/delete")
def sequences_delete(db, p):
    from openleads.workspace import sequences
    return {"ok": sequences.delete(db, p.get("id"))}


@route(POST, "/api/sequences/enroll")
def sequences_enroll(db, p):
    """Enroll a selection, a list (``list_id``) or everyone matching ``filters``."""
    from openleads.workspace import lists, sequences
    emails = lists.members(db, p["list_id"]) if p.get("list_id") else _emails_from(db, p)
    res = sequences.enroll(db, p.get("id"), emails, force=bool(p.get("force")))
    return {"ok": True, **res}


@route(POST, "/api/sequences/unenroll")
def sequences_unenroll(db, p):
    from openleads.workspace import sequences
    return {"ok": True, "removed": sequences.unenroll(db, p.get("id"), _emails_from(db, p))}


@route(POST, "/api/sequences/pause")
def sequences_pause(db, p):
    """Pause (status=paused) or resume (status=active) contacts inside a sequence."""
    from openleads.workspace import sequences
    return {"ok": True, "count": sequences.set_enrollment_status(
        db, p.get("id"), _emails_from(db, p), p.get("status") or "paused")}


@route(POST, "/api/sequences/preview")
def sequences_preview(db, p):
    """What step N's email looks like for one contact (or a sample)."""
    from openleads.workspace import sequences
    seq = sequences.get(db, p.get("id"))
    if not seq:
        raise ValueError("no such sequence")
    idx = _int(p.get("step"), 0)
    if not 0 <= idx < len(seq["steps"]):
        raise ValueError("no such step")
    step = seq["steps"][idx]
    lead = db.get_lead(p["email"]) if p.get("email") else None
    enr = {"email": (lead or _SAMPLE)["email"], "thread_subject": ""}
    if step["type"] not in ("auto_email", "manual_email"):
        return {"type": step["type"], "note": step.get("note", "")}
    draft, variant, missing = sequences._draft_for(db, seq, step, enr, lead or _SAMPLE)
    return {"type": step["type"], "draft": draft.to_dict(), "variant": variant,
            "missing": missing, "sample": lead is None}


@route(STREAM, "/api/sequences/run")
def sequences_run(db, p, emit):
    """Run due steps now. Dry-run unless ``live``; outside the send window unless forced."""
    from datetime import datetime

    from openleads.automate.sendtime import in_send_window
    from openleads.workspace import sequences
    live = bool(p.get("live"))
    window = True if p.get("ignore_window") else in_send_window(datetime.now())
    emit({"type": "phase", "message": ("running" if live else "previewing")
          + " due sequence steps…"})

    def on_progress(kind, payload):
        if kind == "send":
            emit({"type": "send", "result": payload.to_dict()})
        elif kind == "phase":
            emit({"type": "phase", "message": str(payload)})
    res = sequences.process(db, dry_run=not live, send_window_ok=window,
                            seq_id=p.get("id") or None, on_progress=on_progress)
    emit({"type": "done", "live": live, **res})


# --------------------------------------------------------------------------- #
# Saved searches, scoring, import, duplicates, export                         #
# --------------------------------------------------------------------------- #
@route(GET, "/api/saved")
def saved_all(db, p):
    from openleads.workspace import saved
    return {"saved": saved.list_saved(db, p.get("kind") or None)}


@route(POST, "/api/saved/save")
def saved_save(db, p):
    from openleads.workspace import saved
    return {"ok": True, "saved": saved.save(db, p.get("name") or "", p.get("filters") or {},
                                            p.get("kind") or "people")}


@route(POST, "/api/saved/delete")
def saved_delete(db, p):
    from openleads.workspace import saved
    return {"ok": saved.delete(db, p.get("id"), p.get("kind") or "people")}


@route(GET, "/api/scoring")
def scoring_get(db, p):
    from openleads.workspace import scoring
    return {"model": scoring.get_model(db), "distribution": scoring.distribution(db),
            "default": scoring.DEFAULT_MODEL}


@route(POST, "/api/scoring/save")
def scoring_save(db, p):
    from openleads.workspace import scoring
    model = scoring.save_model(db, p.get("model") or {})
    changed = scoring.rescore(db)
    return {"ok": True, "model": model, "rescored": changed,
            "distribution": scoring.distribution(db)}


@route(POST, "/api/scoring/explain")
def scoring_explain(db, p):
    from openleads.workspace import scoring
    lead = db.get_lead(p.get("email") or "")
    if not lead:
        raise ValueError("no such contact")
    acc = db.query_one("SELECT technologies FROM accounts WHERE domain=?", (lead["domain"],))
    techs = [t for t in ((acc or {}).get("technologies") or "").split("|") if t]
    score, parts = scoring.explain(lead, scoring.get_model(db), techs)
    return {"score": score, "grade": scoring.grade(score),
            "reasons": [{"reason": r, "points": pts} for r, pts in parts]}


@route(POST, "/api/import/preview")
def import_preview(db, p):
    from openleads.workspace import importer
    return importer.preview(p.get("csv") or "", p.get("mapping") or None)


@route(POST, "/api/import")
def import_run(db, p):
    from openleads.workspace import importer
    if not (p.get("csv") or "").strip():
        raise ValueError("paste or upload a CSV first")
    res = importer.import_rows(db, p["csv"], p.get("mapping") or None,
                               list_name=p.get("list_name") or "", tags=p.get("tags") or [],
                               stage=p.get("stage") or "", source=p.get("source") or "import")
    res["emails"] = res["emails"][:1000]
    return {"ok": True, **res}


@route(GET, "/api/duplicates")
def duplicates_find(db, p):
    from openleads.workspace import duplicates
    groups = duplicates.find(db, limit=_int(p.get("limit"), 200) or 200)
    return {"groups": groups, "count": len(groups)}


@route(POST, "/api/duplicates/merge")
def duplicates_merge(db, p):
    from openleads.workspace import duplicates
    if p.get("all"):
        return {"ok": True, **duplicates.merge_all(db)}
    return {"ok": True, **duplicates.merge(db, p.get("primary") or "", p.get("others") or [])}


def _leads_for_export(db, emails: list) -> list:
    """CRM rows → Lead objects (with company tech/socials) for the writers."""
    import json

    from openleads.models import Lead
    out = []
    for i in range(0, len(emails), 500):
        chunk = emails[i:i + 500]
        marks = ",".join("?" for _ in chunk)
        accounts = {a["domain"]: a for a in db.query(
            f"SELECT * FROM accounts WHERE domain IN (SELECT domain FROM leads "
            f"WHERE email IN ({marks}))", chunk)}
        for r in db.query(f"SELECT * FROM leads WHERE email IN ({marks}) ORDER BY name", chunk):
            try:
                data = json.loads(r.get("data") or "{}")
            except ValueError:
                data = {}
            acc = accounts.get(r["domain"]) or {}
            socials = {k: acc.get(f"{k}_url") for k in ("linkedin", "twitter", "facebook",
                                                        "instagram") if acc.get(f"{k}_url")}
            out.append(Lead(
                first_name=r["first_name"] or "", last_name=r["last_name"] or "",
                email=r["email"], title=r["title"] or "", organization=r["organization"] or "",
                industry=r["industry"] or acc.get("industry") or "",
                employees=r["employees"] or acc.get("employees") or "",
                linkedin_url=r["linkedin_url"] or "", city=r["city"] or "",
                country=r["country"] or "", website=r["website"] or acc.get("website") or "",
                confidence=data.get("confidence", "none"), score=r["score"] or 0,
                source=r["source"] or "", tier=r["tier"] or "",
                signals=data.get("signals") or {}, reasons=data.get("reasons") or [],
                confidence_pct=r["confidence_pct"] or 0, seniority=r["seniority"] or "",
                department=r["department"] or "", phone=r["phone"] or acc.get("phone") or "",
                company_size=r["company_size"] or acc.get("company_size") or "",
                technologies=[t for t in (acc.get("technologies") or "").split("|") if t],
                socials=socials, description=acc.get("description") or ""))
    return out


@route(POST, "/api/people/export")
def people_export(db, p):
    """A selection (or everyone matching filters) as CSV / Apollo / HubSpot / JSON text."""
    import io
    import json

    from openleads import writers
    emails = _emails_from(db, p) if (p.get("emails") or p.get("all")) else \
        _emails_from(db, {"all": True, "filters": p.get("filters") or {}})
    fmt = p.get("format") or "csv"
    leads = _leads_for_export(db, emails)
    if fmt == "json":
        body = json.dumps([ld.to_dict() for ld in leads], indent=2, ensure_ascii=False)
    else:
        fields, row = {"csv": (None, None),
                       "apollo": (writers.APOLLO_FIELDS, writers.apollo_row),
                       "hubspot": (writers.HUBSPOT_FIELDS, writers.hubspot_row)}.get(fmt, (0, 0))
        if fields == 0:
            raise ValueError("format must be csv, apollo, hubspot or json")
        import csv as _csv
        buf = io.StringIO()
        if fields is None:
            from openleads.models import CSV_FIELDS
            w = _csv.DictWriter(buf, fieldnames=CSV_FIELDS)
            w.writeheader()
            for ld in leads:
                w.writerow(ld.to_csv_row())
        else:
            w = _csv.DictWriter(buf, fieldnames=fields)
            w.writeheader()
            for ld in leads:
                w.writerow(row(ld))
        body = buf.getvalue()
    ext = "json" if fmt == "json" else "csv"
    return {"ok": True, "count": len(leads), "format": fmt, "content": body,
            "filename": f"openleads-{fmt}-{len(leads)}.{ext}"}
