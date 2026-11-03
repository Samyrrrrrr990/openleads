"""
``openleads workflow`` — the node-graph workflows from the terminal.

    openleads workflow list
    openleads workflow show NAME [--json]
    openleads workflow run NAME [--live] [--json]
    openleads workflow export NAME > wf.json
    openleads workflow import wf.json [--name NEW] [--replace]
    openleads workflow templates
    openleads workflow new NAME --from TEMPLATE
    openleads workflow activate|pause NAME
    openleads workflow runs [NAME]
    openleads workflow rm NAME

``run`` is a test run (dry: nothing sent, exported or written) unless ``--live``,
which runs it for real and lets Send send.
"""
from __future__ import annotations

import argparse
import json
import sys

from openleads import ui
from openleads.db import DB

EXAMPLES = """examples:
  openleads workflow templates
  openleads workflow new miami --from local-business-outreach
  openleads workflow show miami
  openleads workflow run miami                  # test run: nothing is sent
  openleads workflow run miami --live           # real run: sends inside your cap
  openleads workflow export miami > miami.json
  openleads workflow import miami.json --name miami-2
  openleads workflow activate miami             # its schedule fires on the drip"""


def _out(msg: str = "") -> None:
    print(msg)


def _err(msg: str) -> int:
    print(f"[!] {msg}", file=sys.stderr)
    return 2


def _node_line(n: dict, by_id: dict, edges: list) -> str:
    from openleads.automate.workflow import nodes as nodemod
    t = nodemod.get_type(n["type"])
    label = n.get("name") or (t.label if t else n["type"])
    params = ", ".join(f"{k}={v}" for k, v in n["params"].items()
                       if v not in ("", None, [], False) and k != "conditions")
    if n["type"] == "filter":
        conds = [nodemod.describe_condition(c) for c in n["params"].get("conditions") or []]
        params = f" {n['params'].get('match', 'all')} of: " + "; ".join(conds)
    outs = []
    for e in edges:
        if e["from"] == n["id"]:
            dst = by_id.get(e["to"])
            dt = nodemod.get_type(dst["type"]) if dst else None
            name = (dst.get("name") or (dt.label if dt else e["to"])) if dst else e["to"]
            outs.append(name if e["from_port"] == "out" else f"{e['from_port']}: {name}")
    arrow = ("  → " + ", ".join(outs)) if outs else ""
    return f"  {n['id']:<10} {label:<20} {ui.c(params[:70], ui.FAINT)}{arrow}"


def _print_run(res: dict) -> None:
    from openleads.automate.workflow import nodes as nodemod
    for r in res["nodes"]:
        if r["status"] == "skipped":
            continue
        t = nodemod.get_type(r["type"])
        mark = {"ok": ui.c("✓", ui.GREEN), "error": ui.c("✗", ui.RED)}.get(r["status"], "·")
        outs = " ".join(f"{p} {n}" if p != "out" else str(n) for p, n in r["out"].items())
        line = f"  {mark} {(t.label if t else r['type']):<20} in {r['in']:<4} out {outs:<18} {r['ms']}ms"
        print(line)
        for note in r.get("notes") or []:
            print(ui.c(f"      {note}", ui.FAINT))
        if r.get("error"):
            print(ui.c(f"      {r['error']}", ui.RED))
    s = res["summary"]
    print(ui.rule())
    print(f"  {res['status']} in {res['seconds']}s · found {s['found']} · drafted {s['drafted']}"
          f" · sent {s['sent']} · previewed {s['previewed']} · exported {s['exported']}"
          + (f" · waiting {s['waiting']}" if s.get("waiting") else ""))


def cmd_workflow(args) -> int:
    from openleads.automate.workflow import executor, graph, store, templates
    from openleads.automate.workflow.runtime import RUN, TEST
    action = (args.action or "list").lower()
    db = DB()
    try:
        if action in ("list", "ls"):
            rows = [store.describe(g) for g in store.list_all(db)]
            if args.json:
                print(json.dumps(rows, indent=2))
                return 0
            if not rows:
                _out("  no workflows yet: openleads workflow templates, then "
                     "openleads workflow new NAME --from TEMPLATE")
                return 0
            for r in rows:
                state = "active" if r["active"] else "paused"
                kind = " (recipe)" if r["kind"] == "recipe" else ""
                live = " live" if r["live"] else ""
                _out(f"  {r['name']:<24} {state + live:<12} {r['nodes']:>2} nodes  {r['when']}{kind}")
            return 0
        if action == "templates":
            rows = templates.list_templates()
            if args.json:
                print(json.dumps(rows, indent=2))
                return 0
            for t in rows:
                _out(f"  {t['key']:<26} {t['title']}")
                _out(ui.c(f"  {'':<26} {t['description']}", ui.FAINT))
            _out(ui.c("\n  openleads workflow new NAME --from TEMPLATE", ui.FAINT))
            return 0
        if action == "runs":
            rows = store.runs(db, args.name or None, args.limit)
            if args.json:
                print(json.dumps(rows, indent=2, default=str))
                return 0
            if not rows:
                _out("  no workflow runs yet")
                return 0
            from datetime import datetime
            for r in rows:
                mark = ui.c("✓", ui.GREEN) if r["status"] in ("ok", "partial") else ui.c("✗", ui.RED)
                at = datetime.fromtimestamp(r["started"]).strftime("%Y-%m-%d %H:%M")
                s = r["summary"]
                _out(f"  {mark} #{r['id']:<5} {at}  {r['workflow']:<20} {r['mode']:<5}"
                     f"{' live' if r['live'] else '     '} {r['seconds']:>6}s  found {s.get('found', 0)}"
                     f" · sent {s.get('sent', 0)} · previewed {s.get('previewed', 0)}"
                     + (f"  {r['error']}" if r.get("error") else ""))
            return 0
        if action == "import":
            path = args.name
            if not path:
                return _err("usage: openleads workflow import FILE [--name NEW] [--replace]")
            try:
                text = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
                doc = json.loads(text)
            except (OSError, ValueError) as e:
                return _err(f"can't read {path}: {e}")
            try:
                g = store.import_doc(db, doc, name=args.as_name, replace=args.replace)
            except graph.GraphError as e:
                for p in e.problems:
                    print(f"  {p['level']}: {p['message']}", file=sys.stderr)
                return 2
            except ValueError as e:
                return _err(f"{e} (use --name NEW or --replace)")
            _out(ui.c(f"  ✓ imported '{g['name']}' ({len(g['nodes'])} nodes, paused)", ui.GREY))
            return 0
        if action == "new":
            name = args.name
            if not name or not args.template:
                return _err("usage: openleads workflow new NAME --from TEMPLATE "
                            "(see openleads workflow templates)")
            try:
                g = store.save(db, templates.instantiate(args.template, name=name), create=True)
            except ValueError as e:
                return _err(str(e))
            _out(ui.c(f"  ✓ created '{g['name']}' from {args.template} (paused). Edit it in "
                      "the dashboard, test it with `openleads workflow run "
                      f"{g['name']}`, then `openleads workflow activate {g['name']}`.", ui.GREY))
            return 0

        if not args.name:
            return _err(f"usage: openleads workflow {action} NAME")
        g = store.get(db, args.name)
        if not g:
            return _err(f"no workflow named '{args.name}' (see openleads workflow list)")
        if action == "show":
            if args.json:
                print(json.dumps(g, indent=2))
                return 0
            state = "active" if g["active"] else "paused"
            _out(ui.c(f"  {g['name']}", ui.WHITE, ui.BOLD) + ui.c(
                f"  {state}{', live' if g['live'] else ''}"
                f"{', recipe' if g.get('kind') == 'recipe' else ''}", ui.FAINT))
            if g.get("description"):
                _out(ui.c(f"  {g['description']}", ui.GREY))
            by_id = {n["id"]: n for n in g["nodes"]}
            for v in graph.topo_order(g):
                _out(_node_line(by_id[v], by_id, g["edges"]))
            for p in graph.validate(g):
                _out(ui.c(f"  {p['level']}: {p['message']}",
                          ui.RED if p["level"] == "error" else ui.FAINT))
            if g.get("kind") == "workflow":
                w = store.waiting(db, g["name"])
                if w["count"]:
                    _out(ui.c(f"  {w['count']} items waiting", ui.FAINT))
            return 0
        if action == "export":
            print(json.dumps(store.export(db, g["name"]), indent=2))
            return 0
        if action in ("activate", "pause", "on", "off"):
            on = action in ("activate", "on")
            try:
                store.set_flags(db, g["name"], active=on)
            except graph.GraphError as e:
                return _err(str(e))
            _out(ui.c(f"  ✓ {g['name']} is {'active' if on else 'paused'}", ui.GREY))
            if on:
                _out(ui.c("  scheduled triggers fire on the drip: run `openleads schedule on` "
                          "once to arm this device", ui.FAINT))
            return 0
        if action in ("rm", "remove", "delete"):
            ok = store.delete(db, g["name"])
            _out(("  ✓ removed " if ok else "  ✗ no such workflow: ") + g["name"])
            return 0 if ok else 1
        if action == "run":
            live = bool(args.live)
            mode = RUN if live else TEST
            if not args.json:
                _out(ui.c(f"  running '{g['name']}': {'LIVE' if live else 'test run (nothing is sent)'}",
                          ui.WHITE, ui.BOLD))

            def emit(ev):
                if args.json or args.quiet:
                    return
                if ev.get("type") == "phase":
                    print(ui.c(f"  ◆ {ev.get('message')}", ui.FAINT), file=sys.stderr)
            try:
                res = executor.run(g, db=db, mode=mode, live=live, emit=emit,
                                   trigger_label="cli")
            except graph.GraphError as e:
                return _err(str(e))
            if args.json:
                print(json.dumps(res, indent=2, default=str))
            else:
                _print_run(res)
            return 0 if res["status"] in ("ok", "partial", "empty") else 1
        return _err(f"unknown workflow action: {action}")
    finally:
        db.close()


def register(sub) -> None:
    wf = sub.add_parser("workflow", help="node-graph automations: list, run, import, templates",
                        description="Workflows: triggers, lead sources, logic, outreach and "
                                    "exports joined into a graph (edit them in `openleads web`).",
                        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=EXAMPLES,
                        aliases=["workflows", "wf"])
    wf.add_argument("action", nargs="?", default="list",
                    help="list · show · run · export · import · templates · new · activate · "
                         "pause · runs · rm")
    wf.add_argument("name", nargs="?", help="workflow name (a file path for import)")
    wf.add_argument("--from", dest="template", metavar="TEMPLATE", help="for new: the template")
    wf.add_argument("--name", dest="as_name", metavar="NEW", help="for import: save under this name")
    wf.add_argument("--replace", action="store_true", help="for import: overwrite a workflow")
    wf.add_argument("--live", action="store_true",
                    help="for run: a real run where Send really sends (default: test run)")
    wf.add_argument("--json", action="store_true", help="machine-readable output")
    wf.add_argument("-q", "--quiet", action="store_true", help="for run: no progress lines")
    wf.add_argument("-n", "--limit", type=int, default=20, help="for runs: how many")
    wf.set_defaults(func=cmd_workflow)
