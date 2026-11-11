"""
``openleads "<request>"``: show the plan, run it on a yes, answer in plain words.

:func:`route` decides whether ``argv`` is a command, a typo of one, or a request.
Requests go to :func:`cmd_ask`, which prints the :class:`openleads.ask.Plan`,
asks before anything that sends, schedules or changes the workspace (or says
how to re-run with ``--yes`` when there's no terminal to ask on), runs it, and
prints :func:`openleads.ask.answer`.
"""
from __future__ import annotations

import difflib
import json
import sys

from openleads import ask, ui

FLAGS = {"--live", "-y", "--yes", "--json"}


def route(argv: list, known: set) -> str:
    """``"command"``, ``"typo:<match>"`` or ``"ask"`` for this argv."""
    first = argv[0]
    if first in known or first.startswith("-"):
        return "command"
    if " " not in first:          # `openleads fnd "x"` is a typo, not a request
        match = difflib.get_close_matches(first, sorted(known), n=1, cutoff=0.75)
        if match:
            return f"typo:{match[0]}"
    return "ask"


def _interactive() -> bool:
    try:
        return sys.stdin.isatty() and sys.stdout.isatty()
    except (AttributeError, ValueError):
        return False


def _yes(prompt: str) -> bool:
    try:
        reply = input(prompt).strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return False
    return reply in ("", "y", "yes")


def _sequence_names() -> list:
    from openleads.db import DB
    db = DB()
    try:
        return ask._sequence_names(db)
    finally:
        db.close()


def cmd_ask(argv: list) -> int:
    live = "--live" in argv
    yes = "-y" in argv or "--yes" in argv
    as_json = "--json" in argv
    text = " ".join(a for a in argv if a not in FLAGS).strip()
    from openleads import ai
    if not as_json and ai.resolve() is not None and _interactive():
        print(ui.c("Reading your request...", ui.FAINT), flush=True)
    plan = ask.make_plan(text, live=live, sequence_names=_sequence_names(), use_model=True)

    if plan.kind == "find" and not as_json:
        from openleads import cli
        args = cli.build_parser().parse_args(["find", *text.split()])
        return cli.cmd_find(args)

    if not as_json:
        print(ui.c("Plan", ui.BOLD) + (ui.c(f"  (read by {plan.by})", ui.FAINT)
                                      if plan.by != "rules" else ""))
        for i, step in enumerate(plan.steps, 1):
            print(f"  {i}. {step}")
    if plan.kind == "unsupported":
        if as_json:
            print(json.dumps({"plan": plan.to_dict(), "result": None}, default=str))
        return 2
    if plan.confirm and not yes:
        if not _interactive():
            if as_json:
                print(json.dumps({"plan": plan.to_dict(), "result": None}, default=str))
            else:
                print("\nRe-run with --yes to run it." + ("" if live else
                      " Add --live to send instead of queueing for approval."
                      if plan.graph and not plan.schedule else ""))
            return 0
        if not _yes("\nRun it? [Y/n] "):
            print("Nothing ran.")
            return 0

    result = ask.run_plan(plan, live=live)
    if as_json:
        print(json.dumps({"plan": plan.to_dict(), "result": result}, default=str))
        return 0 if result.get("ok") else 1
    print("\n" + ask.answer(result))
    if result.get("ok") and plan.kind == "workflow" and not plan.schedule and _interactive():
        try:
            key = input("[s]ave as a workflow, or Enter to finish: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            key = ""
        if key.startswith("s"):
            saved = ask.save_plan(plan, plan.graph["name"])
            print(f"Saved as workflow {saved['name']}. Run it again with: "
                  f"openleads workflow run {saved['name']}")
    return 0 if result.get("ok") else 1
