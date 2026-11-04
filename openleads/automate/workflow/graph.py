"""
The workflow graph: nodes ``{id, type, params, position}`` and edges
``{from, from_port, to}``. Pure functions only — normalize, validate, sort.

    {
      "name": "miami-agencies",
      "description": "",
      "active": true,          # scheduled triggers fire (once `schedule on` is installed)
      "live": false,           # Send really sends on scheduled runs
      "nodes": [{"id": "n1", "type": "trigger.schedule",
                 "params": {"schedule": "weekdays 09:00"},
                 "position": {"x": 40, "y": 120}, "on_error": "stop"}, …],
      "edges": [{"from": "n1", "from_port": "out", "to": "n2"}, …]
    }

:func:`validate` returns a list of problems (``level`` is ``error`` or ``warning``);
a graph with errors can't be saved or run. It checks names, node types and their
typed parameters, dangling or misdirected edges, cycles, and *item types*: every
node is told what flows into it (nothing, leads, or drafted leads) so, for example,
a Send that no Write email feeds is caught when you save, not when it runs.
"""
from __future__ import annotations

import copy
import re

from openleads.automate.workflow import nodes as nodemod

NAME_RE = re.compile(r"^[\w.-]{1,64}$")
ON_ERROR = ("stop", "continue")
MAX_NODES = 200


class GraphError(ValueError):
    """A workflow that can't be saved or run; ``problems`` lists why."""

    def __init__(self, problems: list):
        self.problems = problems
        errors = [p["message"] for p in problems if p.get("level") == "error"]
        super().__init__("; ".join(errors) or "invalid workflow")


# --------------------------------------------------------------------------- #
# Normalize                                                                    #
# --------------------------------------------------------------------------- #
def _coerce(param: nodemod.Param, value):
    """Best-effort typing of one parameter value (validate reports what's still wrong)."""
    if value is None:
        return copy.deepcopy(param.default)
    k = param.kind
    if k == "bool":
        if isinstance(value, str):
            return value.strip().lower() in ("1", "true", "yes", "on")
        return bool(value)
    if k == "number":
        try:
            n = float(value)
        except (TypeError, ValueError):
            return value
        return int(n) if n == int(n) else n
    if k == "conditions":
        if not isinstance(value, list):
            return value
        return [{"field": str(c.get("field") or ""), "op": str(c.get("op") or "is"),
                 "value": c.get("value", "") if not isinstance(c.get("value"), (dict, list))
                 else ""} for c in value if isinstance(c, dict)]
    if isinstance(value, str):
        return value.strip() if k not in ("textarea",) else value
    return value


def normalize(graph: dict) -> dict:
    """A clean copy: known keys only, defaults filled, params typed, ids as strings."""
    g = dict(graph or {})
    out = {
        "name": str(g.get("name") or "").strip(),
        "description": str(g.get("description") or "").strip()[:500],
        "active": bool(g.get("active", False)),
        "live": bool(g.get("live", False)),
        "nodes": [], "edges": [],
    }
    for keep in ("created_at", "updated_at", "last_run_at", "kind", "recipe", "version"):
        if g.get(keep) not in (None, ""):
            out[keep] = g[keep]
    for i, n in enumerate(g.get("nodes") or []):
        if not isinstance(n, dict):
            continue
        t = nodemod.get_type(str(n.get("type") or ""))
        params = dict(n.get("params") or {}) if isinstance(n.get("params"), dict) else {}
        if t:
            typed = t.defaults()
            for p in t.params:
                if p.key in params:
                    typed[p.key] = _coerce(p, params[p.key])
            params = typed
        pos = n.get("position") if isinstance(n.get("position"), dict) else {}
        node = {
            "id": str(n.get("id") or f"n{i + 1}"),
            "type": str(n.get("type") or ""),
            "params": params,
            "position": {"x": _int(pos.get("x"), 40 + 220 * i), "y": _int(pos.get("y"), 120)},
        }
        if n.get("name"):
            node["name"] = str(n["name"]).strip()[:60]
        node["on_error"] = n.get("on_error") if n.get("on_error") in ON_ERROR else "stop"
        if n.get("disabled"):
            node["disabled"] = True
        out["nodes"].append(node)
    for e in g.get("edges") or []:
        if not isinstance(e, dict):
            continue
        out["edges"].append({"from": str(e.get("from") or ""),
                             "from_port": str(e.get("from_port") or "out"),
                             "to": str(e.get("to") or "")})
    return out


def _int(v, default: int) -> int:
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------- #
# Validate                                                                     #
# --------------------------------------------------------------------------- #
def _problem(level: str, message: str, node: str = "", edge: int | None = None) -> dict:
    p = {"level": level, "message": message}
    if node:
        p["node"] = node
    if edge is not None:
        p["edge"] = edge
    return p


def _label(n: dict) -> str:
    t = nodemod.get_type(n.get("type", ""))
    return n.get("name") or (t.label if t else n.get("type", "?"))


def check_param(param: nodemod.Param, value) -> str:
    """'' if ``value`` is acceptable for ``param``, else a short reason."""
    k = param.kind
    empty = value in (None, "", [])
    if param.required and empty:
        return f"{param.label} is required"
    if empty:
        return ""
    if k == "bool" and not isinstance(value, bool):
        return f"{param.label} must be yes or no"
    if k == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return f"{param.label} must be a number"
        if param.min is not None and value < param.min:
            return f"{param.label} must be at least {param.min:g}"
        if param.max is not None and value > param.max:
            return f"{param.label} must be at most {param.max:g}"
    if k == "select" and param.options:
        allowed = [o[0] if isinstance(o, tuple) else o for o in param.options]
        if value not in allowed:
            return f"{param.label} must be one of {', '.join(str(a) for a in allowed if a)}"
    if k == "stage":
        from openleads.workspace.stages import CONTACT_STAGE_KEYS
        if value not in CONTACT_STAGE_KEYS:
            return f"{param.label}: unknown stage '{value}'"
    if k == "schedule":
        from openleads.automate import schedule as schedmod
        try:
            schedmod.parse(str(value))
        except schedmod.ScheduleError as e:
            return f"{param.label}: {e}"
    if k == "conditions":
        if not isinstance(value, list):
            return f"{param.label} must be a list"
        for c in value:
            if c.get("field") not in nodemod.FIELD_KEYS:
                return f"unknown field '{c.get('field')}'"
            if c.get("op") not in nodemod.OP_KEYS:
                return f"unknown comparison '{c.get('op')}'"
    if k in ("text", "textarea", "list", "sequence", "template") and not isinstance(value, str):
        return f"{param.label} must be text"
    if k == "text" and isinstance(value, str) and len(value) > 2000:
        return f"{param.label} is too long"
    return ""


def validate(graph: dict, check_name: bool = True) -> list:
    """Every problem with ``graph`` (already normalized or not)."""
    g = normalize(graph)
    out: list = []
    if check_name and not NAME_RE.match(g["name"]):
        out.append(_problem("error", "name the workflow with letters, numbers, dashes or dots"))
    if len(g["nodes"]) > MAX_NODES:
        out.append(_problem("error", f"a workflow can have at most {MAX_NODES} nodes"))
    ids: dict = {}
    for n in g["nodes"]:
        if n["id"] in ids:
            out.append(_problem("error", f"two nodes share the id '{n['id']}'", n["id"]))
        ids[n["id"]] = n
        t = nodemod.get_type(n["type"])
        if not t:
            out.append(_problem("error", f"unknown node type '{n['type']}'", n["id"]))
            continue
        for p in t.params:
            why = check_param(p, n["params"].get(p.key))
            if why:
                out.append(_problem("error", f"{_label(n)}: {why}", n["id"]))
        if n["type"] == "enrich":
            src = n["params"].get("source")
            if src == "csv" and not n["params"].get("path"):
                out.append(_problem("error", f"{_label(n)}: choose a CSV file", n["id"]))
            if src == "list" and not n["params"].get("list"):
                out.append(_problem("error", f"{_label(n)}: choose a list", n["id"]))
    seen_edges = set()
    for i, e in enumerate(g["edges"]):
        a, b = ids.get(e["from"]), ids.get(e["to"])
        if not a or not b:
            out.append(_problem("error", "an edge points at a node that doesn't exist", edge=i))
            continue
        ta, tb = nodemod.get_type(a["type"]), nodemod.get_type(b["type"])
        if ta and e["from_port"] not in ta.outputs:
            out.append(_problem("error", f"{_label(a)} has no '{e['from_port']}' output",
                                a["id"], i))
        if tb and not tb.inputs:
            out.append(_problem("error", f"{_label(b)} is a trigger and can't have inputs",
                                b["id"], i))
        if e["from"] == e["to"]:
            out.append(_problem("error", f"{_label(a)} can't connect to itself", a["id"], i))
        key = (e["from"], e["from_port"], e["to"])
        if key in seen_edges:
            out.append(_problem("error", "the same connection is drawn twice", a["id"], i))
        seen_edges.add(key)
    triggers = [n for n in g["nodes"] if (nodemod.get_type(n["type"]) or _NT).trigger]
    if not triggers:
        out.append(_problem("error", "add a trigger (Manual, Schedule, New leads or Reply received)"))
    if not [p for p in out if p["level"] == "error"]:
        cycle = find_cycle(g)
        if cycle:
            out.append(_problem("error", "the workflow loops back on itself; remove a connection "
                                         "to break the cycle", cycle[0]))
        else:
            out.extend(_type_problems(g))
    incoming = {e["to"] for e in g["edges"]}
    for n in g["nodes"]:
        t = nodemod.get_type(n["type"])
        if t and not t.trigger and n["id"] not in incoming:
            out.append(_problem("warning", f"{_label(n)} isn't connected, so it never runs",
                                n["id"]))
    return out


class _NoType:
    trigger = False


_NT = _NoType()


def errors(graph: dict, check_name: bool = True) -> list:
    return [p for p in validate(graph, check_name) if p["level"] == "error"]


def ensure_valid(graph: dict, check_name: bool = True) -> dict:
    """The normalized graph, or :class:`GraphError` listing what's wrong."""
    problems = validate(graph, check_name)
    if any(p["level"] == "error" for p in problems):
        raise GraphError(problems)
    return normalize(graph)


# --------------------------------------------------------------------------- #
# Order, cycles, item types                                                    #
# --------------------------------------------------------------------------- #
def _adjacency(g: dict) -> dict:
    adj: dict = {n["id"]: [] for n in g["nodes"]}
    for e in g["edges"]:
        if e["from"] in adj and e["to"] in adj:
            adj[e["from"]].append(e["to"])
    return adj


def find_cycle(graph: dict) -> list:
    """Node ids along one cycle, or [] if the graph is acyclic."""
    adj = _adjacency(graph)
    state: dict = {}
    stack: list = []

    def visit(v) -> list:
        state[v] = 1
        stack.append(v)
        for w in adj.get(v, []):
            if state.get(w) == 1:
                return stack[stack.index(w):]
            if not state.get(w):
                found = visit(w)
                if found:
                    return found
        stack.pop()
        state[v] = 2
        return []

    for v in adj:
        if not state.get(v):
            found = visit(v)
            if found:
                return found
    return []


def topo_order(graph: dict) -> list:
    """Node ids in run order: upstream first, ties broken left-to-right, top-to-bottom."""
    g = graph
    pos = {n["id"]: (n.get("position", {}).get("x", 0), n.get("position", {}).get("y", 0), i)
           for i, n in enumerate(g["nodes"])}
    indeg = {n["id"]: 0 for n in g["nodes"]}
    adj = _adjacency(g)
    for v, ws in adj.items():
        for w in ws:
            indeg[w] += 1
    ready = sorted([v for v, d in indeg.items() if d == 0], key=lambda v: pos[v])
    order = []
    while ready:
        v = ready.pop(0)
        order.append(v)
        for w in adj[v]:
            indeg[w] -= 1
            if indeg[w] == 0:
                ready.append(w)
        ready.sort(key=lambda v: pos[v])
    if len(order) != len(indeg):
        raise GraphError([_problem("error", "the workflow has a cycle")])
    return order


def downstream(graph: dict, start: str) -> set:
    """``start`` and every node reachable from it."""
    adj = _adjacency(graph)
    seen, todo = set(), [start]
    while todo:
        v = todo.pop()
        if v in seen:
            continue
        seen.add(v)
        todo.extend(adj.get(v, []))
    return seen


_RANK = {"none": 0, "leads": 1, "drafted": 2}


def item_kinds(graph: dict) -> dict:
    """What flows out of each node: ``none``, ``leads`` or ``drafted``.

    A node fed by several branches gets the *weakest* kind among them, so a Send
    reached by one drafted and one undrafted branch is still flagged.
    """
    by_id = {n["id"]: n for n in graph["nodes"]}
    inputs: dict = {n["id"]: [] for n in graph["nodes"]}
    for e in graph["edges"]:
        if e["to"] in inputs:
            inputs[e["to"]].append(e["from"])
    kinds: dict = {}
    for v in topo_order(graph):
        t = nodemod.get_type(by_id[v]["type"])
        incoming = [kinds[u] for u in inputs[v] if u in kinds]
        weakest = min(incoming, key=lambda k: _RANK[k]) if incoming else "none"
        if t is None:
            kinds[v] = weakest
        elif t.produces == "same":
            kinds[v] = weakest
        else:
            kinds[v] = t.produces
    return kinds


def _type_problems(g: dict) -> list:
    out = []
    kinds = item_kinds(g)
    by_id = {n["id"]: n for n in g["nodes"]}
    for e_i, e in enumerate(g["edges"]):
        src, dst = by_id[e["from"]], by_id[e["to"]]
        t = nodemod.get_type(dst["type"])
        k = kinds.get(src["id"], "none")
        if t.accepts == "leads" and k == "none":
            out.append(_problem("error", f"{_label(dst)} needs leads: put a Find leads, Load "
                                         f"contacts or Enrich node before it", dst["id"], e_i))
        elif t.accepts == "drafted" and k != "drafted":
            out.append(_problem("error", f"{_label(dst)} needs drafts: put a Write email node "
                                         f"before it", dst["id"], e_i))
    return out


def new_id(graph: dict) -> str:
    taken = {n["id"] for n in graph.get("nodes") or []}
    i = len(taken) + 1
    while f"n{i}" in taken:
        i += 1
    return f"n{i}"
