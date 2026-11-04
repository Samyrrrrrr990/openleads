"""
Workflows in the scheduler's drip cycle.

``openleads drip`` (what the on-device agent runs every 15 minutes) calls
:func:`tick`, which:

1. **wakes parked items** — rows in ``workflow_waits`` whose time has come
   continue from their Wait (or held Send) node, one run per node;
2. **fires due triggers** of every *active* workflow — a Schedule or New leads
   trigger whose schedule has a moment since it last fired, and Reply received on
   every cycle (it ends quietly when nobody replied).

A dry drip (no ``--live``) test-runs due workflows and leaves waits untouched; a
live drip runs them for real, and Send sends only if the workflow is live.
Recipes are not touched here: the scheduler runs them as it always has.
"""
from __future__ import annotations

from datetime import datetime

from openleads.automate import history
from openleads.automate import schedule as schedmod
from openleads.automate.workflow import executor, store
from openleads.automate.workflow.runtime import RUN, TEST

SCHEDULED = ("trigger.schedule", "trigger.new_leads")


def due_triggers(g: dict, state: dict, now: datetime) -> list:
    """Ids of ``g``'s triggers that should fire at ``now`` (pure)."""
    out = []
    created = schedmod.parse_ts(state.get("activated_at")) or schedmod.parse_ts(g.get("created_at"))
    for n in g["nodes"]:
        if n.get("disabled"):
            continue
        if n["type"] in SCHEDULED:
            try:
                sched = schedmod.parse(n["params"].get("schedule") or "")
            except schedmod.ScheduleError:
                continue
            last = schedmod.parse_ts(state.get(f"fired:{n['id']}"))
            if schedmod.is_due(sched, now, last, created=None if last else created):
                out.append(n["id"])
        elif n["type"] == "trigger.reply":
            out.append(n["id"])
    return out


def resume_waits(db, now: datetime, cache=None, services=None, on_progress=None,
                 dry_run: bool = False) -> dict:
    """Continue every parked item that is due. Returns ``{due, resumed, runs, failed}``."""
    rows = store.due_waits(db, now.timestamp())
    out = {"due": len(rows), "resumed": 0, "runs": 0, "failed": 0, "held": 0}
    if dry_run or not rows:
        return out
    groups: dict = {}
    for r in rows:
        groups.setdefault((r["workflow"], r["node"], bool(r["live"])), []).append(r)
    for (name, node, live), group in groups.items():
        g = store.get(db, name)
        ids = [r["id"] for r in group]
        if not g or node not in {n["id"] for n in g["nodes"]}:
            store.set_wait_status(db, ids, "cancelled")
            continue
        if not g["active"]:
            out["held"] += len(ids)          # paused workflows hold their waiting items
            continue
        # Claim the rows first: a crash mid-run must not send the same step twice.
        store.set_wait_status(db, ids, "resumed")
        (on_progress or (lambda *_: None))("workflow", f"{name}: resuming {len(ids)} at {node}")
        try:
            res = executor.run(g, db=db, cache=cache, mode=RUN, live=live,
                               resume={"node": node, "items": [r["item"] for r in group]},
                               services=services, now=now, trigger_label=f"resume:{node}")
        except Exception as e:  # noqa: BLE001 — one broken workflow never stops the tick
            out["failed"] += 1
            history.record("workflow", name, False, 0, error=f"{type(e).__name__}: {e}")
            history.notify(f"OpenLeads workflow '{name}' failed", str(e))
            continue
        out["runs"] += 1
        out["resumed"] += len(ids)
        if res["status"] == "error":
            out["failed"] += 1
            history.notify(f"OpenLeads workflow '{name}' failed", res["error"])
    return out


def tick(db, cache=None, dry_run: bool = True, now: datetime | None = None, on_progress=None,
         services=None) -> dict:
    """One drip cycle for workflows. Returns counts for the drip summary."""
    now = now or datetime.now()
    on_progress = on_progress or (lambda *_: None)
    summary = {"run": 0, "failed": 0, "sent": 0, "waits": {}}
    summary["waits"] = resume_waits(db, now, cache=cache, services=services,
                                    on_progress=on_progress, dry_run=dry_run)
    summary["failed"] += summary["waits"]["failed"]
    store._ensure(db)
    for row in db.query("SELECT name FROM workflows WHERE active = 1 ORDER BY name"):
        g = store.get(db, row["name"])
        if not g:
            continue
        state = store.get_state(db, g["name"])
        fire = due_triggers(g, state, now)
        if not fire:
            continue
        on_progress("workflow", g["name"])
        try:
            res = executor.run(g, db=db, cache=cache, mode=TEST if dry_run else RUN,
                               live=g["live"] and not dry_run, triggers=fire, services=services,
                               now=now, trigger_label="schedule")
        except Exception as e:  # noqa: BLE001
            res = {"status": "error", "error": f"{type(e).__name__}: {e}", "summary": {}}
            history.record("workflow", g["name"], False, 0, error=res["error"])
        if not dry_run:
            stamp = now.isoformat(timespec="seconds")
            store.update_state(db, g["name"], {f"fired:{t}": stamp for t in fire})
        if res["status"] == "empty":
            continue
        summary["run"] += 1
        summary["sent"] += int((res.get("summary") or {}).get("sent", 0))
        if res["status"] == "error":
            summary["failed"] += 1
            history.notify(f"OpenLeads workflow '{g['name']}' failed", res["error"])
    return summary
