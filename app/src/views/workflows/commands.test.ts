import { describe as group, expect, it } from "vitest";

import { canRedo, canUndo, emptyHistory, pushHistory, stepBack, stepForward, undoLabel } from "~/lib/history";

import { applyAll, describe, supersedes, type WfCommand } from "./commands";
import { type Graph, type NodeType, stepRows } from "./model";

const base = (): Graph => ({
  name: "w",
  description: "",
  active: false,
  live: false,
  nodes: [
    { id: "n1", type: "trigger.manual", params: {}, position: { x: 0, y: 0 } },
    { id: "n2", type: "find", params: { query: "dentists" }, position: { x: 300, y: 0 } },
    { id: "n3", type: "send", params: {}, position: { x: 600, y: 0 } },
  ],
  edges: [
    { from: "n1", from_port: "out", to: "n2" },
    { from: "n2", from_port: "out", to: "n3" },
  ],
});

/** Apply, then apply the inverses: the graph must come back exactly. */
function roundTrip(cmds: WfCommand[]) {
  const g = base();
  const { graph, inverses } = applyAll(g, cmds);
  expect(graph).not.toEqual(g);
  expect(applyAll(graph, inverses).graph).toEqual(g);
  return graph;
}

group("workflow commands", () => {
  it("adds a step with its wire, and undoes it", () => {
    const g = roundTrip([{ type: "ADD_NODE", node: { id: "n4", type: "tag", params: {}, position: { x: 900, y: 0 } }, edges: [{ from: "n3", from_port: "out", to: "n4" }] }]);
    expect(g.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(g.edges).toHaveLength(3);
  });

  it("deletes a step with its wires and restores both in place", () => {
    const g = roundTrip([{ type: "REMOVE_NODE", id: "n2" }]);
    expect(g.nodes.map((n) => n.id)).toEqual(["n1", "n3"]);
    expect(g.edges).toEqual([]);
  });

  it("moves, changes settings, renames, connects and disconnects reversibly", () => {
    roundTrip([{ type: "MOVE_NODE", id: "n2", to: { x: 10, y: 20 } }]);
    roundTrip([{ type: "UPDATE_NODE", id: "n2", patch: { params: { query: "roofers" }, name: "Roofers" } }]);
    roundTrip([{ type: "SET_META", patch: { name: "x", live: true } }]);
    roundTrip([{ type: "CONNECT", edge: { from: "n1", from_port: "out", to: "n3" } }]);
    roundTrip([{ type: "DISCONNECT", edge: { from: "n1", from_port: "out", to: "n2" } }]);
  });

  it("swaps in a described graph as one step", () => {
    const next = { ...base(), nodes: [base().nodes[0]!], edges: [] };
    roundTrip([{ type: "REPLACE", graph: next }]);
  });

  it("ignores commands aimed at steps that aren't there", () => {
    const g = base();
    const r = applyAll(g, [{ type: "REMOVE_NODE", id: "nope" }, { type: "CONNECT", edge: { from: "n2", from_port: "out", to: "n2" } }]);
    expect(r.graph).toBe(g);
    expect(r.inverses).toEqual([]);
  });

  it("names what it did", () => {
    const label = (t: string) => ({ find: "Find leads", send: "Send" })[t] ?? t;
    expect(describe({ type: "MOVE_NODE", id: "n3", to: { x: 0, y: 0 } }, base(), label)).toBe("Move Send");
    expect(describe({ type: "REMOVE_NODE", id: "n2" }, base(), label)).toBe("Delete Find leads");
  });
});

group("history (from Studio)", () => {
  it("undoes and redoes a batch as one step", () => {
    let g = base();
    let h = emptyHistory<WfCommand>();
    const cmds: WfCommand[] = [{ type: "REMOVE_NODE", id: "n3" }, { type: "SET_META", patch: { name: "y" } }];
    const r = applyAll(g, cmds);
    g = r.graph;
    h = pushHistory(h, cmds, r.inverses, { label: "Two things" });
    expect(undoLabel(h)).toBe("Two things");
    const back = stepBack(h)!;
    g = applyAll(g, back.entry.inverses).graph;
    h = back.history;
    expect(g).toEqual(base());
    expect(canUndo(h)).toBe(false);
    const fwd = stepForward(h)!;
    expect(applyAll(g, fwd.entry.commands).graph.name).toBe("y");
    expect(canRedo(fwd.history)).toBe(false);
  });

  it("merges a burst of edits to one field into a single undo", () => {
    let g = base();
    let h = emptyHistory<WfCommand>();
    for (const [i, q] of ["r", "ro", "roof"].entries()) {
      const c: WfCommand[] = [{ type: "UPDATE_NODE", id: "n2", patch: { params: { query: q } } }];
      const r = applyAll(g, c);
      g = r.graph;
      h = pushHistory(h, c, r.inverses, { label: "Change", coalesceKey: "edit:n2:params", now: 1000 + i * 100, supersedes });
    }
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]!.commands).toHaveLength(1);
    const back = stepBack(h)!;
    expect(applyAll(g, back.entry.inverses).graph).toEqual(base());
  });

  it("starts a new step after a pause", () => {
    let h = emptyHistory<WfCommand>();
    const c: WfCommand = { type: "MOVE_NODE", id: "n2", to: { x: 1, y: 1 } };
    h = pushHistory(h, [c], [c], { label: "Move", coalesceKey: "m", now: 0, supersedes });
    h = pushHistory(h, [c], [c], { label: "Move", coalesceKey: "m", now: 5000, supersedes });
    expect(h.entries).toHaveLength(2);
  });
});

group("step rows", () => {
  const types = new Map<string, NodeType>(
    (
      [
        ["trigger.manual", ["out"], true],
        ["find", ["out"], false],
        ["split_tier", ["safe", "risky"], false],
        ["send", ["out"], false],
        ["tag", ["out"], false],
      ] as const
    ).map(([type, outputs, trigger]) => [type, { type, label: type, group: "", icon: "", doc: "", params: [], inputs: ["in"], outputs: [...outputs], port_labels: {}, trigger }]),
  );

  it("reads a straight line top to bottom", () => {
    expect(stepRows(base(), types).map((r) => [r.node.id, r.depth])).toEqual([
      ["n1", 0],
      ["n2", 0],
      ["n3", 0],
    ]);
  });

  it("indents branches under the step that splits, and marks loose steps", () => {
    const g = base();
    g.nodes.push({ id: "s", type: "split_tier", params: {}, position: { x: 0, y: 0 } }, { id: "t", type: "tag", params: {}, position: { x: 0, y: 0 } }, { id: "z", type: "tag", params: {}, position: { x: 0, y: 0 } });
    g.edges = [
      { from: "n1", from_port: "out", to: "s" },
      { from: "s", from_port: "safe", to: "n3" },
      { from: "s", from_port: "risky", to: "t" },
    ];
    const rows = stepRows(g, types);
    expect(rows.map((r) => [r.node.id, r.depth, r.via ?? "", r.loose ?? false])).toEqual([
      ["n1", 0, "", false],
      ["s", 0, "", false],
      ["n3", 1, "safe", false],
      ["t", 1, "risky", false],
      ["n2", 0, "", true],
      ["z", 0, "", true],
    ]);
  });
});
