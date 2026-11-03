"""
Workflows — n8n-style automation graphs for OpenLeads.

A workflow is a graph of nodes (triggers, lead sources, logic, outreach, workspace
actions, exports) joined by edges; lead dicts flow along the edges as items.

* :mod:`.graph`     — the model: normalize, validate (cycles, ports, item types), order.
* :mod:`.nodes`     — the node catalog: typed params, ports, run functions, docs.
* :mod:`.executor`  — runs a graph: per-node results, streamed events, run log, waits.
* :mod:`.runner`    — the drip-cycle hook: due triggers and parked waits.
* :mod:`.store`     — SQLite persistence, run history, import/export, the recipe bridge.
* :mod:`.convert`   — every recipe as its equivalent graph (and back).
* :mod:`.templates` — ready-made workflows.
"""
from __future__ import annotations

from openleads.automate.workflow.graph import GraphError, normalize, validate
from openleads.automate.workflow.nodes import catalog
from openleads.automate.workflow.runtime import RUN, TEST

__all__ = ["GraphError", "normalize", "validate", "catalog", "RUN", "TEST"]
