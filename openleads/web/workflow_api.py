"""
The workflow editor's JSON API. Same rules as every other endpoint (the server
enforces them): loopback Host only, writes must be ``application/json``, and a
cross-site Origin is refused.

    GET  /api/workflows                 the list (workflows + recipes as graphs)
    GET  /api/workflows/get?name=       one graph, its problems and waiting items
    GET  /api/workflows/catalog         node types, condition fields, live options
    GET  /api/workflows/templates       ready-made workflows
    GET  /api/workflows/runs?name=      recent runs (summaries)
    GET  /api/workflows/run?id=         one run with per-node results and samples
    GET  /api/workflows/export?name=    the portable JSON document
    POST /api/workflows/save            {workflow, create?}
    POST /api/workflows/validate        {workflow}
    POST /api/workflows/delete          {name}
    POST /api/workflows/flags           {name, active?, live?}
    POST /api/workflows/new             {template, name}
    POST /api/workflows/import          {doc, name?}
    POST /api/workflows/run   (NDJSON)  {name | workflow, mode: test|run, live?}

Runs from the dashboard are test runs unless the request says ``mode: "run"``;
an unsaved graph can only be test-run. Live sending also needs ``live: true``.
"""
from __future__ import annotations

from openleads.db import DB

GET: dict = {}
POST: dict = {}
STREAM: dict = {}


def _route(table: dict, path: str):
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


def _name(p: dict) -> str:
    name = str(p.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    return name


@_route(GET, "/api/workflows")
def workflows_list(db, p):
    from openleads.automate.workflow import store
    rows = []
    for g in store.list_all(db):
        row = store.describe(g)
        row["waiting"] = store.waiting(db, g["name"])["count"] if g.get("kind") == "workflow" else 0
        rows.append(row)
    return {"workflows": rows}


@_route(GET, "/api/workflows/get")
def workflows_get(db, p):
    from openleads.automate.workflow import graph, store
    g = store.get(db, _name(p))
    if not g:
        raise ValueError(f"no workflow named '{p.get('name')}'")
    return {"workflow": g, "problems": graph.validate(g),
            "waiting": store.waiting_by_node(db, g["name"]) if g.get("kind") == "workflow" else {}}


@_route(GET, "/api/workflows/catalog")
def workflows_catalog(db, p):
    from openleads.automate.workflow import nodes
    from openleads.workspace import lists, sequences, stages, templates
    return {
        "nodes": nodes.catalog(), "groups": list(nodes.GROUPS), "fields": nodes.fields(),
        "ops": [{"value": k, "label": v} for k, v in nodes.OPS],
        "options": {
            "list": [x["name"] for x in lists.all_lists(db, "people")],
            "sequence": [x["name"] for x in sequences.list_sequences(db)],
            "template": [x["name"] for x in templates.list_templates(db)],
            "stage": [{"value": k, "label": label} for k, label, _ in stages.CONTACT_STAGES],
        },
    }


@_route(GET, "/api/workflows/templates")
def workflows_templates(db, p):
    from openleads.automate.workflow import templates
    return {"templates": templates.list_templates()}


@_route(GET, "/api/workflows/runs")
def workflows_runs(db, p):
    from openleads.automate.workflow import store
    name = str(p.get("name") or "").strip() or None
    try:
        limit = int(p.get("limit") or 20)
    except ValueError:
        limit = 20
    return {"runs": store.runs(db, name, limit), "waiting": store.waiting(db, name)}


@_route(GET, "/api/workflows/run")
def workflows_run_get(db, p):
    from openleads.automate.workflow import store
    try:
        run_id = int(p.get("id"))
    except (TypeError, ValueError):
        raise ValueError("id must be a number") from None
    run = store.get_run(db, run_id)
    if not run:
        raise ValueError("no such run")
    for n in run.get("nodes") or []:
        n.pop("trace", None)
    return {"run": run}


@_route(GET, "/api/workflows/export")
def workflows_export(db, p):
    from openleads.automate.workflow import store
    return {"doc": store.export(db, _name(p))}


def _graph_error(e) -> dict:
    return {"ok": False, "error": str(e), "problems": getattr(e, "problems", [])}


@_route(POST, "/api/workflows/save")
def workflows_save(db, p):
    from openleads.automate.workflow import graph, store
    wf = p.get("workflow")
    if not isinstance(wf, dict):
        raise ValueError("workflow must be an object")
    try:
        saved = store.save(db, wf, create=bool(p.get("create")))
    except graph.GraphError as e:
        return _graph_error(e)
    return {"ok": True, "workflow": saved, "problems": graph.validate(saved)}


@_route(POST, "/api/workflows/validate")
def workflows_validate(db, p):
    from openleads.automate.workflow import graph
    wf = p.get("workflow")
    if not isinstance(wf, dict):
        raise ValueError("workflow must be an object")
    return {"problems": graph.validate(wf, check_name=bool(p.get("check_name", True)))}


@_route(POST, "/api/workflows/delete")
def workflows_delete(db, p):
    from openleads.automate.workflow import store
    return {"ok": store.delete(db, _name(p))}


@_route(POST, "/api/workflows/flags")
def workflows_flags(db, p):
    from openleads.automate.workflow import graph, store
    try:
        g = store.set_flags(db, _name(p),
                            active=bool(p["active"]) if "active" in p else None,
                            live=bool(p["live"]) if "live" in p else None)
    except graph.GraphError as e:
        return _graph_error(e)
    return {"ok": True, "workflow": g}


@_route(POST, "/api/workflows/new")
def workflows_new(db, p):
    from openleads.automate.workflow import graph, store, templates
    g = templates.instantiate(str(p.get("template") or ""), name=str(p.get("name") or "") or None)
    try:
        return {"ok": True, "workflow": store.save(db, g, create=True)}
    except graph.GraphError as e:
        return _graph_error(e)


@_route(POST, "/api/workflows/import")
def workflows_import(db, p):
    from openleads.automate.workflow import graph, store
    try:
        return {"ok": True, "workflow": store.import_doc(db, p.get("doc") or {},
                                                         name=p.get("name") or None)}
    except graph.GraphError as e:
        return _graph_error(e)


@_route(STREAM, "/api/workflows/run")
def workflows_run(db, p, emit):
    """Run a workflow, streaming node progress. Test mode unless ``mode: run``."""
    from openleads.automate.workflow import executor, graph, store
    from openleads.automate.workflow.runtime import RUN, TEST
    mode = RUN if p.get("mode") == "run" else TEST
    if isinstance(p.get("workflow"), dict) and mode == TEST:
        g = p["workflow"]
    else:
        g = store.get(db, _name(p))
        if not g:
            emit({"type": "error", "message": f"no workflow named '{p.get('name')}'"})
            return
    try:
        executor.run(g, db=db, mode=mode, live=bool(p.get("live")) and mode == RUN,
                     items=p.get("items") if isinstance(p.get("items"), list) else None,
                     emit=emit, trigger_label="dashboard")
    except graph.GraphError as e:
        emit({"type": "error", "message": str(e), "problems": e.problems})
