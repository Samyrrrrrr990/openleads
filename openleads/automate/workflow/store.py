"""
Where workflows live: the ``workflows``, ``workflow_runs`` and ``workflow_waits``
tables (schema v4), plus the bridge to recipes.

There are two kinds of workflow and one list:

* **workflow** — a graph saved by the editor, the CLI (``workflow import`` /
  ``workflow new``) or a template. Stored here; the scheduler fires its triggers.
* **recipe** — a recipe from ``openleads recipe add``. Stored as before in the
  ``campaigns`` table and run by the scheduler exactly as before. It is listed
  here as its equivalent graph (:mod:`.convert`). Saving that graph writes back to
  the recipe while it still is one; adding any other node turns it into a workflow
  (the recipe row is removed in the same step, so it never runs twice).
"""
from __future__ import annotations

import json
import time
from datetime import datetime

from openleads.automate.workflow import convert
from openleads.automate.workflow import graph as gmod

EXPORT_FORMAT = 1


def _ensure(db) -> None:
    """The workflow tables exist (normally created by the v4 migration)."""
    if getattr(db, "_wf_tables", False):
        return
    if not db.scalar("SELECT name FROM sqlite_master WHERE type='table' AND name='workflows'"):
        from openleads import schema
        for stmt in schema.WORKFLOW_SQL.split(";"):
            if stmt.strip():
                db.execute(stmt)
    try:
        db._wf_tables = True
    except AttributeError:
        pass


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _loads(text, default):
    try:
        v = json.loads(text or "")
    except (TypeError, ValueError):
        return default
    return v if isinstance(v, type(default)) else default


# --------------------------------------------------------------------------- #
# Read                                                                         #
# --------------------------------------------------------------------------- #
def _from_row(row: dict) -> dict:
    g = _loads(row.get("graph"), {})
    g["name"] = row["name"]
    g["active"] = bool(row.get("active"))
    g["live"] = bool(row.get("live"))
    g = gmod.normalize(g)
    g["kind"] = "workflow"
    if row.get("last_run_at"):
        g["last_run_at"] = row["last_run_at"]
    if row.get("created"):
        g["created_at"] = datetime.fromtimestamp(row["created"]).isoformat(timespec="seconds")
    if row.get("updated"):
        g["updated_at"] = datetime.fromtimestamp(row["updated"]).isoformat(timespec="seconds")
    return g


def _native(db, name: str) -> dict | None:
    _ensure(db)
    return db.query_one("SELECT * FROM workflows WHERE name = ?", (name,))


def _recipe(db, name: str) -> dict | None:
    from openleads.automate import recipes
    return recipes.get(name, db=db)


def get(db, name: str) -> dict | None:
    """One workflow (native first, then a recipe of that name) as a full graph."""
    name = (name or "").strip()
    if not name:
        return None
    row = _native(db, name)
    if row:
        return _from_row(row)
    spec = _recipe(db, name)
    if spec:
        return convert.recipe_to_graph(spec)
    return None


def list_all(db) -> list:
    """Every workflow and recipe, as graphs, newest first."""
    _ensure(db)
    from openleads.automate import recipes
    out = [_from_row(r) for r in db.query("SELECT * FROM workflows ORDER BY updated DESC")]
    names = {g["name"] for g in out}
    for spec in recipes.list_recipes(db):
        if spec["name"] not in names:
            out.append(convert.recipe_to_graph(spec))
    return out


def describe(g: dict) -> dict:
    """A list row: name, kind, schedule text, counts, last run, waiting items."""
    from openleads.automate import schedule as schedmod
    from openleads.automate.workflow import nodes as nodemod
    when = []
    for n in g["nodes"]:
        t = nodemod.get_type(n["type"])
        if not t or not t.trigger:
            continue
        if n["params"].get("schedule"):
            try:
                text = schedmod.parse(n["params"]["schedule"]).describe()
            except schedmod.ScheduleError:
                text = "invalid schedule"
            when.append(text if n["type"] == "trigger.schedule" else f"{t.label.lower()}, {text}")
        elif n["type"] == "trigger.reply":
            when.append("on reply")
        elif n["type"] == "trigger.manual":
            when.append("manual")
    return {"name": g["name"], "kind": g.get("kind", "workflow"), "description": g.get("description", ""),
            "active": g["active"], "live": g["live"], "nodes": len(g["nodes"]),
            "when": ", ".join(dict.fromkeys(when)) or "manual",
            "last_run_at": g.get("last_run_at", ""), "updated_at": g.get("updated_at", "")}


# --------------------------------------------------------------------------- #
# Write                                                                        #
# --------------------------------------------------------------------------- #
def _upsert(db, g: dict, state: dict | None = None, last_run_at: str | None = None) -> None:
    _ensure(db)
    now = time.time()
    body = {k: v for k, v in g.items() if k in ("description", "nodes", "edges", "version")}
    body["version"] = EXPORT_FORMAT
    prev = _native(db, g["name"])
    if prev:
        db.execute("UPDATE workflows SET graph=?, active=?, live=?, updated=?"
                   + (", last_run_at=?" if last_run_at else "") + " WHERE name=?",
                   (json.dumps(body), int(g["active"]), int(g["live"]), now,
                    *([last_run_at] if last_run_at else []), g["name"]))
    else:
        db.execute("INSERT INTO workflows (name, graph, active, live, state, last_run_at, created, "
                   "updated) VALUES (?,?,?,?,?,?,?,?)",
                   (g["name"], json.dumps(body), int(g["active"]), int(g["live"]),
                    json.dumps(state or {}), last_run_at or "", now, now))


def save(db, graph: dict, create: bool = False) -> dict:
    """Validate and save. ``create`` refuses to overwrite an existing name.

    Returns the saved graph (``kind`` says where it went). Raises
    :class:`~.graph.GraphError` on validation problems and ``ValueError`` on a name clash.
    """
    from openleads.automate import recipes
    g = gmod.ensure_valid(graph)
    name = g["name"]
    native = _native(db, name)
    recipe = None if native else _recipe(db, name)
    if create and (native or recipe):
        raise ValueError(f"a workflow named '{name}' already exists")
    if recipe:
        spec = convert.graph_to_recipe(g)
        prev = (db.get_campaign(name) or {}).get("data") or {}
        if spec is not None:
            recipes.save(name, {**prev, **spec}, db=db)
            return get(db, name)
        # It grew past a recipe: becomes a workflow, keeping when it last ran.
        state = {f"fired:{n['id']}": prev.get("last_run_at") for n in g["nodes"]
                 if n["type"] == "trigger.schedule" and prev.get("last_run_at")}
        if g["active"]:
            state["activated_at"] = _now_iso()
        _upsert(db, g, state=state, last_run_at=prev.get("last_run_at"))
        recipes.delete(name, db=db)
        return get(db, name)
    was_active = bool(native and native.get("active"))
    _upsert(db, g)
    if g["active"] and not was_active:
        update_state(db, name, {"activated_at": _now_iso()})
    return get(db, name)


def set_flags(db, name: str, active: bool | None = None, live: bool | None = None) -> dict:
    """Activate / pause (``active``) or switch live sending on/off without a full save."""
    g = get(db, name)
    if not g:
        raise ValueError(f"no workflow named '{name}'")
    if active is not None:
        g["active"] = bool(active)
    if live is not None:
        g["live"] = bool(live)
    return save(db, g)


def delete(db, name: str) -> bool:
    """Delete a workflow (or the recipe behind it), its waiting items and its state."""
    from openleads.automate import recipes
    _ensure(db)
    gone = db.execute("DELETE FROM workflows WHERE name = ?", (name,)).rowcount > 0
    if not gone:
        gone = recipes.delete(name, db=db)
    db.execute("UPDATE workflow_waits SET status='cancelled' WHERE workflow=? AND status='waiting'",
               (name,))
    return gone


def is_native(db, name: str) -> bool:
    return _native(db, name) is not None


# --------------------------------------------------------------------------- #
# State (trigger memory: seen domains, last reply, last fired)                 #
# --------------------------------------------------------------------------- #
def get_state(db, name: str) -> dict:
    row = _native(db, name)
    return _loads((row or {}).get("state"), {})


def update_state(db, name: str, changes: dict) -> dict:
    state = get_state(db, name)
    state.update(changes)
    db.execute("UPDATE workflows SET state=? WHERE name=?", (json.dumps(state), name))
    return state


def set_state(db, name: str, state: dict) -> None:
    db.execute("UPDATE workflows SET state=? WHERE name=?", (json.dumps(state or {}), name))


def mark_ran(db, name: str, when: str | None = None) -> None:
    db.execute("UPDATE workflows SET last_run_at=? WHERE name=?", (when or _now_iso(), name))


# --------------------------------------------------------------------------- #
# Import / export                                                              #
# --------------------------------------------------------------------------- #
def export(db, name: str) -> dict:
    """A portable JSON document (no run state) for ``workflow export``."""
    g = get(db, name)
    if not g:
        raise ValueError(f"no workflow named '{name}'")
    return {"openleads_workflow": EXPORT_FORMAT, "name": g["name"],
            "description": g.get("description", ""), "active": False, "live": False,
            "nodes": g["nodes"], "edges": g["edges"]}


def import_doc(db, doc: dict, name: str | None = None, replace: bool = False) -> dict:
    """Save an exported document. Imports arrive paused and not live, whatever they say."""
    if not isinstance(doc, dict) or not isinstance(doc.get("nodes"), list):
        raise ValueError("not an OpenLeads workflow (expected a JSON object with nodes and edges)")
    g = {**doc, "name": name or doc.get("name") or "", "active": False, "live": False}
    g.pop("kind", None)
    g.pop("recipe", None)
    if replace and get(db, g["name"]):
        delete(db, g["name"])
    return save(db, g, create=True)


# --------------------------------------------------------------------------- #
# Runs                                                                         #
# --------------------------------------------------------------------------- #
def start_run(db, name: str, mode: str, live: bool, trigger: str = "") -> int:
    _ensure(db)
    cur = db.execute("INSERT INTO workflow_runs (workflow, mode, live, trigger, status, started) "
                     "VALUES (?,?,?,?, 'running', ?)", (name, mode, int(live), trigger, time.time()))
    return int(cur.lastrowid)


def finish_run(db, run_id: int, status: str, nodes: list, summary: dict, error: str = "") -> None:
    db.execute("UPDATE workflow_runs SET status=?, finished=?, nodes=?, summary=?, error=? WHERE id=?",
               (status, time.time(), json.dumps(nodes, default=str),
                json.dumps(summary, default=str), error or "", run_id))
    # Keep the log bounded: the newest 200 runs per workflow.
    db.execute("DELETE FROM workflow_runs WHERE workflow = (SELECT workflow FROM workflow_runs "
               "WHERE id=?) AND id NOT IN (SELECT id FROM workflow_runs WHERE workflow = "
               "(SELECT workflow FROM workflow_runs WHERE id=?) ORDER BY id DESC LIMIT 200)",
               (run_id, run_id))


def drop_run(db, run_id: int) -> None:
    db.execute("DELETE FROM workflow_runs WHERE id=?", (run_id,))


def _run_row(r: dict, full: bool) -> dict:
    out = {k: r[k] for k in ("id", "workflow", "mode", "trigger", "status", "started", "finished",
                             "error")}
    out["live"] = bool(r["live"])
    out["summary"] = _loads(r.get("summary"), {})
    out["seconds"] = round((r["finished"] or r["started"]) - r["started"], 1)
    if full:
        out["nodes"] = _loads(r.get("nodes"), [])
    return out


def runs(db, name: str | None = None, limit: int = 20) -> list:
    _ensure(db)
    limit = max(1, min(int(limit or 20), 200))
    if name:
        rows = db.query("SELECT * FROM workflow_runs WHERE workflow=? ORDER BY id DESC LIMIT ?",
                        (name, limit))
    else:
        rows = db.query("SELECT * FROM workflow_runs ORDER BY id DESC LIMIT ?", (limit,))
    return [_run_row(r, full=False) for r in rows]


def get_run(db, run_id) -> dict | None:
    _ensure(db)
    r = db.query_one("SELECT * FROM workflow_runs WHERE id=?", (int(run_id),))
    return _run_row(r, full=True) if r else None


# --------------------------------------------------------------------------- #
# Parked waits                                                                 #
# --------------------------------------------------------------------------- #
def park(db, name: str, run_id: int | None, node: str, items: list, wake_at: float,
         live: bool) -> int:
    _ensure(db)
    now = time.time()
    db.executemany("INSERT INTO workflow_waits (workflow, run_id, node, item, wake_at, live, "
                   "status, created) VALUES (?,?,?,?,?,?, 'waiting', ?)",
                   [(name, run_id, node, json.dumps(it, default=str), float(wake_at), int(live), now)
                    for it in items])
    return len(items)


def hold(db, name: str, run_id: int | None, node: str, item: dict) -> int:
    """Park one item at ``node`` until its draft is approved (status ``approval``:
    :func:`due_waits` never picks it up until :func:`release` says go)."""
    _ensure(db)
    cur = db.execute("INSERT INTO workflow_waits (workflow, run_id, node, item, wake_at, live, "
                     "status, created) VALUES (?,?,?,?, 0, 1, 'approval', ?)",
                     (name, run_id, node, json.dumps(item, default=str), time.time()))
    return int(cur.lastrowid)


def release(db, wait_id, go: bool, now: float | None = None) -> None:
    """The draft an item was held for was sent (``go``: continue on the next drip) or
    skipped (the item's remaining steps are cancelled)."""
    _ensure(db)
    if go:
        db.execute("UPDATE workflow_waits SET status='waiting', wake_at=? "
                   "WHERE id=? AND status='approval'", (time.time() if now is None else now,
                                                        int(wait_id)))
    else:
        db.execute("UPDATE workflow_waits SET status='cancelled', resumed=? "
                   "WHERE id=? AND status='approval'", (time.time(), int(wait_id)))


def due_waits(db, now: float) -> list:
    _ensure(db)
    rows = db.query("SELECT * FROM workflow_waits WHERE status='waiting' AND wake_at <= ? "
                    "ORDER BY wake_at, id", (float(now),))
    for r in rows:
        r["item"] = _loads(r["item"], {})
    return rows


def waiting(db, name: str | None = None) -> dict:
    """``{count, next_wake}`` for items still waiting (one workflow or all)."""
    _ensure(db)
    where, params = "status='waiting'", []
    if name:
        where += " AND workflow=?"
        params.append(name)
    r = db.query_one(f"SELECT COUNT(*) AS n, MIN(wake_at) AS nxt FROM workflow_waits WHERE {where}",
                     params) or {}
    return {"count": int(r.get("n") or 0), "next_wake": r.get("nxt")}


def waiting_by_node(db, name: str) -> dict:
    _ensure(db)
    return {r["node"]: r["n"] for r in db.query(
        "SELECT node, COUNT(*) AS n FROM workflow_waits WHERE workflow=? AND status='waiting' "
        "GROUP BY node", (name,))}


def set_wait_status(db, ids: list, status: str) -> None:
    if not ids:
        return
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        db.execute(f"UPDATE workflow_waits SET status=?, resumed=? WHERE id IN "
                   f"({','.join('?' for _ in chunk)})", (status, time.time(), *chunk))
