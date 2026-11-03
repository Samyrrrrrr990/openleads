"""
Recipes as graphs, and back.

Every saved recipe (``openleads recipe add …``) shows up in Workflows as the graph
that does exactly what the recipe does:

    Schedule → Find leads → Split by tier ─safe→ Write email → Send
                   │                     └risky→ Filter (confidence ≥ 55) → Write email
                   └────────→ Export

The recipe itself stays where it was (the ``campaigns`` table) and the scheduler
keeps running it through :func:`openleads.automate.recipes.run`, so nothing about
an existing recipe changes. Editing that graph in the dashboard writes back to the
recipe as long as the graph still *is* a recipe; add any other node and it becomes
a full workflow (see :mod:`.store`).

Both directions are pure.
"""
from __future__ import annotations

from openleads.automate.workflow import graph as gmod

RISKY_FLOOR = 55     # recipes.run: risky leads need this calibrated confidence to be drafted


def recipe_schedule(spec: dict) -> str:
    if spec.get("schedule"):
        return str(spec["schedule"])
    hour = int(spec.get("send_hour", 9) or 0)
    minute = int(spec.get("send_minute", 0) or 0)
    return f"daily {hour:02d}:{minute:02d}"


def recipe_to_graph(spec: dict) -> dict:
    """The graph equivalent of a recipe spec (normalized by ``recipes.normalize_spec``)."""
    from openleads.automate.recipes import normalize_spec
    s = normalize_spec(spec)
    nodes = [
        {"id": "trigger", "type": "trigger.schedule", "params": {"schedule": recipe_schedule(s)},
         "position": {"x": 40, "y": 180}},
        {"id": "find", "type": "find",
         "params": {"query": s["query"], "count": s["count"], "verified_only": s["verified_only"]},
         "position": {"x": 300, "y": 180}},
        {"id": "split", "type": "split_tier", "params": {}, "position": {"x": 560, "y": 180}},
        {"id": "write", "type": "write", "params": {"pitch": s["context"]},
         "position": {"x": 1080, "y": 60}},
    ]
    edges = [
        {"from": "trigger", "from_port": "out", "to": "find"},
        {"from": "find", "from_port": "out", "to": "split"},
        {"from": "split", "from_port": "safe", "to": "write"},
    ]
    if not s["verified_only"]:
        nodes.append({"id": "risky", "type": "filter",
                      "params": {"match": "all", "conditions": [
                          {"field": "confidence_pct", "op": "gte", "value": str(RISKY_FLOOR)}]},
                      "position": {"x": 820, "y": 180}})
        edges += [{"from": "split", "from_port": "risky", "to": "risky"},
                  {"from": "risky", "from_port": "true", "to": "write"}]
    if s["send"]:
        nodes.append({"id": "send", "type": "send",
                      "params": {"campaign": "", "respect_window": True,
                                 "followups": s["sequence"]},
                      "position": {"x": 1340, "y": 60}})
        edges.append({"from": "write", "from_port": "out", "to": "send"})
    if s["export"]:
        nodes.append({"id": "export", "type": "export",
                      "params": {"sink": s["export"]["sink"], "target": s["export"]["target"]},
                      "position": {"x": 560, "y": 340}})
        edges.append({"from": "find", "from_port": "out", "to": "export"})
    g = {"name": spec.get("name") or "", "description": "", "active": s["enabled"],
         "live": s["send"], "nodes": nodes, "edges": edges, "kind": "recipe",
         "recipe": spec.get("name") or ""}
    for k in ("created_at", "last_run_at"):
        if spec.get(k):
            g[k] = spec[k]
    return gmod.normalize(g)


def _shape(g: dict) -> tuple:
    """Structure + params with ids and positions left out (for equality)."""
    g = gmod.normalize(g)
    by_id = {n["id"]: n for n in g["nodes"]}

    def sig(n):
        return (n["type"], tuple(sorted((k, repr(v)) for k, v in n["params"].items())),
                n.get("on_error", "stop"), bool(n.get("disabled")))
    nodes = sorted(sig(n) for n in g["nodes"])
    edges = sorted((sig(by_id[e["from"]]), e["from_port"], sig(by_id[e["to"]]))
                   for e in g["edges"] if e["from"] in by_id and e["to"] in by_id)
    return (nodes, edges, bool(g["active"]), bool(g["live"]))


def graph_to_recipe(graph: dict) -> dict | None:
    """The recipe spec a graph is equivalent to, or None if it does more than a recipe can."""
    g = gmod.normalize(graph)
    by_type: dict = {}
    for n in g["nodes"]:
        by_type.setdefault(n["type"], []).append(n)
    if any(len(v) > 1 for v in by_type.values()):
        return None
    if not {"trigger.schedule", "find", "split_tier", "write"} <= set(by_type):
        return None
    find = by_type["find"][0]["params"]
    if any(find.get(k) for k in ("location", "industry", "title", "seniority")):
        return None
    send = by_type.get("send", [None])[0]
    export = by_type.get("export", [None])[0]
    spec = {
        "query": find.get("query", ""), "count": find.get("count", 25),
        "verified_only": bool(find.get("verified_only", True)),
        "context": by_type["write"][0]["params"].get("pitch", ""),
        "send": bool(send), "sequence": bool(send and send["params"].get("followups")),
        "enabled": bool(g["active"]),
        "schedule": by_type["trigger.schedule"][0]["params"].get("schedule", ""),
        "export": ({"sink": export["params"].get("sink", "csv"),
                    "target": export["params"].get("target", "")} if export else None),
    }
    if by_type["write"][0]["params"].get("template"):
        return None
    if send and (send["params"].get("campaign") or not send["params"].get("respect_window", True)):
        return None
    if _shape(recipe_to_graph({**spec, "name": g["name"]})) != _shape(g):
        return None
    return spec
