"""
The executor — runs a workflow graph node by node and reports as it goes.

Order is topological (upstream first). Each node receives the items on its
incoming edges, merged and de-duplicated by email, and returns items per output
port. An edge carries items only if there are some, except edges out of a
trigger, which always wake the next node: that's how *Schedule → Find leads* runs
a search with nothing coming in, while an *IF* whose false branch is empty leaves
that branch asleep.

Every node gets a result: items in, items out per port, milliseconds, an error if
it failed, a few sample items and the notes it wrote. Errors honour the node's
``on_error``: ``stop`` (default) ends the run there, ``continue`` lets the other
branches finish.

``emit`` streams NDJSON-friendly events for the dashboard:

    {"type": "run",  "id": 7, "workflow": "...", "mode": "test", "live": false}
    {"type": "node", "id": "n2", "status": "running"}
    {"type": "progress", "node": "n2", "count": 14}       # leads found so far
    {"type": "phase"|"log", "node": "n2", "message": "..."}
    {"type": "node", "id": "n2", "status": "ok", "in": 0, "out": {"out": 18}, "ms": 812}
    {"type": "edge", "from": "n2", "from_port": "out", "to": "n3", "count": 18}
    {"type": "done", ...run summary...}

A Wait node, or a live Send outside business hours, *parks* its items in
``workflow_waits``; :mod:`.runner` resumes them from the scheduler's drip cycle by
running only what lies downstream of that node.
"""
from __future__ import annotations

import time
import traceback
from datetime import datetime

from openleads.automate.workflow import graph as gmod
from openleads.automate.workflow import nodes as nodemod
from openleads.automate.workflow import store
from openleads.automate.workflow.runtime import RUN, TEST, Context, item_key

SAMPLE = 3
_SAMPLE_KEYS = ("email", "name", "organization", "title", "tier", "evidence", "confidence_pct",
                "fit_score", "stage", "seniority", "industry", "phone", "domain")
SOURCE_TYPES = ("find", "contacts", "enrich", "trigger.new_leads", "trigger.reply",
                "trigger.manual")


def sample(item: dict) -> dict:
    """A small, display-safe view of an item for run history."""
    out = {k: item[k] for k in _SAMPLE_KEYS if item.get(k) not in (None, "", [], {})}
    d = item.get("draft")
    if isinstance(d, dict):
        out["subject"] = str(d.get("subject", ""))[:140]
        out["body"] = str(d.get("body", ""))[:600]
    s = item.get("send")
    if isinstance(s, dict):
        out["send"] = f"{s.get('status', '')}{': ' + s['detail'] if s.get('detail') else ''}"
    return out


def _merge(lists: list) -> list:
    out, seen = [], set()
    for items in lists:
        for it in items:
            k = item_key(it)
            if k in seen:
                continue
            seen.add(k)
            out.append(dict(it))
    return out


def run(graph: dict, db=None, cache=None, mode: str = TEST, live: bool = False,
        triggers: list | None = None, items: list | None = None, resume: dict | None = None,
        services: dict | None = None, now: datetime | None = None, emit=None,
        record: bool = True, trigger_label: str = "manual") -> dict:
    """Run ``graph`` once. Returns the run: status, summary and per-node results.

    * ``mode`` — ``"test"`` (dry run, no side effects) or ``"run"`` (real).
    * ``live`` — on a real run, Send really sends. Ignored in test mode.
    * ``triggers`` — trigger node ids to fire (default: every trigger).
    * ``items`` — items handed to a Manual trigger (API/MCP callers).
    * ``resume`` — ``{"node": wait_id, "items": [...]}``: continue after a Wait.
    """
    from openleads import db as dbmod
    own_db = db is None
    if own_db:
        db = dbmod.DB()
    own_cache = cache is None
    if own_cache:
        from openleads.cache.store import Cache
        cache = Cache()
    try:
        return _run(graph, db, cache, mode, live, triggers, items, resume, services, now, emit,
                    record, trigger_label)
    finally:
        if own_cache and cache is not None:
            cache.close()
        if own_db:
            db.close()


def _run(graph, db, cache, mode, live, triggers, items, resume, services, now, emit, record,
         trigger_label) -> dict:
    mode = RUN if mode == RUN else TEST
    g = gmod.ensure_valid(graph, check_name=False)
    name = g["name"] or "untitled"
    native = bool(g["name"]) and store.is_native(db, g["name"])
    state = store.get_state(db, name) if native else {}
    started = time.time()
    run_id = store.start_run(db, name, mode, bool(live) and mode == RUN,
                             trigger_label) if record else None
    ctx = Context(db, g, mode=mode, live=live, cache=cache, services=services, now=now,
                  emit=emit, run_id=run_id, state=state,
                  trigger={"items": list(items or [])},
                  unattended=trigger_label == "schedule" or trigger_label.startswith("resume:"))
    ctx.emit({"type": "run", "id": run_id, "workflow": name, "mode": mode, "live": ctx.live})

    by_id = {n["id"]: n for n in g["nodes"]}
    incoming: dict = {n["id"]: [] for n in g["nodes"]}
    outgoing: dict = {n["id"]: [] for n in g["nodes"]}
    for e in g["edges"]:
        incoming[e["to"]].append(e)
        outgoing[e["from"]].append(e)
    order = gmod.topo_order(g)
    scope = None
    outputs: dict = {}
    if resume:
        start = resume["node"]
        if start not in by_id:
            raise ValueError(f"node '{start}' is no longer in the workflow")
        scope = gmod.downstream(g, start) - {start}
        t = nodemod.get_type(by_id[start]["type"])
        seeded = list(resume.get("items") or [])
        if t and t.on_resume:
            ctx.node = by_id[start]
            seeded = t.on_resume(ctx, by_id[start]["params"], seeded)
        first_port = t.outputs[0] if t and t.outputs else "out"
        outputs[start] = {first_port: seeded}
        ctx.emit({"type": "node", "id": start, "status": "ok", "in": len(seeded),
                  "out": {first_port: len(seeded)}, "ms": 0, "resumed": True})
    fire = set(triggers) if triggers is not None else None

    results: dict = {}
    status, error, stopped = "ok", "", False
    for v in order:
        n = by_id[v]
        t = nodemod.get_type(n["type"])
        if scope is not None and v not in scope:
            continue
        res = {"id": v, "type": n["type"], "status": "skipped", "in": 0, "out": {}, "ms": 0}
        results[v] = res
        if stopped:
            continue
        if t.trigger:
            if resume is not None or (fire is not None and v not in fire):
                continue
            inputs = []
        else:
            active = []
            for e in incoming[v]:
                src = by_id[e["from"]]
                got = (outputs.get(e["from"]) or {}).get(e["from_port"])
                if got is None:
                    continue
                src_t = nodemod.get_type(src["type"])
                # A bare trigger pulse wakes the next node; an event trigger that
                # found nothing (no new leads, no replies) doesn't.
                if got or (src_t and src_t.trigger and not src_t.quiet_when_empty):
                    active.append(got)
            if not active:
                continue
            inputs = _merge(active)
        res["in"] = len(inputs)
        ctx.node = n
        ctx.notes = []
        ctx.emit({"type": "node", "id": v, "status": "running", "in": len(inputs)})
        t0 = time.monotonic()
        try:
            if n.get("disabled"):
                out = {t.outputs[0]: inputs} if t.outputs else {}
                res["status"] = "disabled"
            else:
                out = t.run(ctx, n["params"], inputs) or {}
                res["status"] = "ok"
            out = {p: list(out.get(p) or []) for p in t.outputs}
        except Exception as e:  # noqa: BLE001 — one node's failure is reported, not raised
            out = {p: [] for p in t.outputs}
            res["status"] = "error"
            res["error"] = f"{type(e).__name__}: {e}" if not isinstance(e, ValueError) else str(e)
            res["trace"] = traceback.format_exc(limit=3)[-600:]
            if n.get("on_error") == "continue":
                status = "partial" if status == "ok" else status
            else:
                status, error, stopped = "error", f"{_label(n)}: {res['error']}", True
        res["ms"] = int((time.monotonic() - t0) * 1000)
        res["out"] = {p: len(v_) for p, v_ in out.items()}
        res["samples"] = {p: [sample(x) for x in v_[:SAMPLE]] for p, v_ in out.items() if v_}
        if ctx.notes:
            res["notes"] = list(ctx.notes)
        outputs[v] = out
        ev = {k: res[k] for k in ("id", "status", "in", "out", "ms")}
        ev["type"] = "node"
        for k in ("error", "notes"):
            if res.get(k):
                ev[k] = res[k]
        ctx.emit(ev)
        for e in outgoing[v]:
            count = len(out.get(e["from_port"]) or [])
            ctx.emit({"type": "edge", "from": v, "from_port": e["from_port"], "to": e["to"],
                      "count": count})

    if status == "ok" and resume is None and _quiet(by_id, results):
        status = "empty"          # only event triggers ran, and they found nothing

    parked = 0
    if mode == RUN and ctx.parked:
        held = bool(g["name"]) and not g["active"] and native
        for node_id, its, wake in ctx.parked:
            parked += store.park(db, name, run_id, node_id, its, wake, live=ctx.live)
            if node_id in results:
                results[node_id]["waiting"] = len(its)
        if held:
            ctx.notes = []
            ctx.emit({"type": "log", "node": "", "message":
                      f"{parked} items are waiting; this workflow is paused, so they continue "
                      f"once you activate it"})
    if mode == RUN and native:
        store.set_state(db, name, ctx.state)
        if status != "empty":
            store.mark_ran(db, name)

    summary = _summary(g, results, ctx, parked)
    seconds = round(time.time() - started, 1)
    ordered = [results[v] for v in order if v in results]
    if record:
        if status == "empty":
            store.drop_run(db, run_id)
        else:
            store.finish_run(db, run_id, status, ordered, summary, error)
            _history(name, mode, ctx.live, status, seconds, summary, error)
    out = {"id": run_id if status != "empty" else None, "workflow": name, "mode": mode,
           "live": ctx.live, "status": status, "error": error, "seconds": seconds,
           "summary": summary, "nodes": ordered}
    ctx.emit({"type": "done", **{k: v for k, v in out.items() if k != "nodes"}})
    return out


def _quiet(by_id: dict, results: dict) -> bool:
    ran = [v for v, r in results.items() if r["status"] != "skipped"]
    if not ran:
        return True
    for v in ran:
        t = nodemod.get_type(by_id[v]["type"])
        if not (t.trigger and t.quiet_when_empty and not sum(results[v]["out"].values())):
            return False
    return True


def _label(n: dict) -> str:
    t = nodemod.get_type(n["type"])
    return n.get("name") or (t.label if t else n["type"])


def _summary(g: dict, results: dict, ctx: Context, parked: int) -> dict:
    by_id = {n["id"]: n for n in g["nodes"]}
    found = drafted = 0
    for v, r in results.items():
        t = by_id[v]["type"]
        if t in SOURCE_TYPES and r["status"] == "ok":
            found += sum(r["out"].values())
        if t == "write" and r["status"] == "ok":
            drafted += sum(r["out"].values())
    return {"found": found, "drafted": drafted, "sent": int(ctx.vars.get("sent", 0)),
            "previewed": int(ctx.vars.get("previewed", 0)),
            "queued": int(ctx.vars.get("queued", 0)),
            "exported": int(ctx.vars.get("exported", 0)), "waiting": parked,
            "errors": sum(1 for r in results.values() if r["status"] == "error"),
            "nodes_run": sum(1 for r in results.values() if r["status"] in ("ok", "error",
                                                                               "disabled"))}


def _history(name: str, mode: str, live: bool, status: str, seconds: float, summary: dict,
             error: str) -> None:
    """One line in ~/.openleads/runs.jsonl so ``openleads runs`` shows workflow runs."""
    from openleads.automate import history
    kind = "workflow" if mode == RUN else "wf-test"
    detail = {k: v for k, v in summary.items() if v and k in ("found", "drafted", "sent",
                                                              "previewed", "queued",
                                                              "exported", "waiting",
                                                              "errors")}
    if mode == RUN:
        detail["live"] = bool(live)
    history.record(kind, name, status in ("ok", "partial"), seconds, detail=detail, error=error)
