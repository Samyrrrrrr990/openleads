/**
 * Every change to a workflow graph is a command, the way Studio edits a site
 * (studio/core/commands): applying one returns the new graph and the commands that
 * undo it, and each command can say in words what it did ("Undo Move Send").
 */
import type { Supersedes } from "~/lib/history";

import type { GEdge, GNode, Graph } from "./model";

type Meta = Partial<Pick<Graph, "name" | "description" | "active" | "live">>;

export type WfCommand =
  | { type: "ADD_NODE"; node: GNode; edges?: GEdge[] }
  | { type: "REMOVE_NODE"; id: string }
  | { type: "RESTORE_NODE"; node: GNode; index: number; edges: { edge: GEdge; index: number }[] }
  | { type: "MOVE_NODE"; id: string; to: { x: number; y: number } }
  | { type: "UPDATE_NODE"; id: string; patch: Partial<Omit<GNode, "id">> }
  | { type: "CONNECT"; edge: GEdge; index?: number }
  | { type: "DISCONNECT"; edge: GEdge }
  | { type: "SET_META"; patch: Meta }
  | { type: "REPLACE"; graph: Graph };

const same = (a: GEdge, b: GEdge) => a.from === b.from && a.from_port === b.from_port && a.to === b.to;

/** Applies one command. Unknown targets leave the graph alone with no inverse. */
export function applyOne(g: Graph, c: WfCommand): { graph: Graph; inverse: WfCommand[] } {
  switch (c.type) {
    case "ADD_NODE": {
      if (g.nodes.some((n) => n.id === c.node.id)) return { graph: g, inverse: [] };
      const edges = (c.edges ?? []).filter((e) => !g.edges.some((x) => same(x, e)));
      return { graph: { ...g, nodes: [...g.nodes, c.node], edges: [...g.edges, ...edges] }, inverse: [{ type: "REMOVE_NODE", id: c.node.id }] };
    }
    case "REMOVE_NODE": {
      const index = g.nodes.findIndex((n) => n.id === c.id);
      if (index < 0) return { graph: g, inverse: [] };
      const edges = g.edges.map((edge, i) => ({ edge, index: i })).filter(({ edge }) => edge.from === c.id || edge.to === c.id);
      return {
        graph: { ...g, nodes: g.nodes.filter((n) => n.id !== c.id), edges: g.edges.filter((e) => e.from !== c.id && e.to !== c.id) },
        inverse: [{ type: "RESTORE_NODE", node: g.nodes[index]!, index, edges }],
      };
    }
    case "RESTORE_NODE": {
      if (g.nodes.some((n) => n.id === c.node.id)) return { graph: g, inverse: [] };
      const nodes = [...g.nodes];
      nodes.splice(Math.min(c.index, nodes.length), 0, c.node);
      const edges = [...g.edges];
      for (const { edge, index } of [...c.edges].sort((a, b) => a.index - b.index)) edges.splice(Math.min(index, edges.length), 0, edge);
      return { graph: { ...g, nodes, edges }, inverse: [{ type: "REMOVE_NODE", id: c.node.id }] };
    }
    case "MOVE_NODE": {
      const n = g.nodes.find((x) => x.id === c.id);
      if (!n) return { graph: g, inverse: [] };
      return {
        graph: { ...g, nodes: g.nodes.map((x) => (x.id === c.id ? { ...x, position: { ...c.to } } : x)) },
        inverse: [{ type: "MOVE_NODE", id: c.id, to: { ...n.position } }],
      };
    }
    case "UPDATE_NODE": {
      const n = g.nodes.find((x) => x.id === c.id);
      if (!n) return { graph: g, inverse: [] };
      const old: Record<string, unknown> = {};
      for (const k of Object.keys(c.patch)) old[k] = (n as unknown as Record<string, unknown>)[k];
      return {
        graph: { ...g, nodes: g.nodes.map((x) => (x.id === c.id ? { ...x, ...c.patch } : x)) },
        inverse: [{ type: "UPDATE_NODE", id: c.id, patch: old as Partial<GNode> }],
      };
    }
    case "CONNECT": {
      const ok = g.nodes.some((n) => n.id === c.edge.from) && g.nodes.some((n) => n.id === c.edge.to);
      if (!ok || c.edge.from === c.edge.to || g.edges.some((e) => same(e, c.edge))) return { graph: g, inverse: [] };
      const edges = [...g.edges];
      edges.splice(c.index ?? edges.length, 0, c.edge);
      return { graph: { ...g, edges }, inverse: [{ type: "DISCONNECT", edge: c.edge }] };
    }
    case "DISCONNECT": {
      const index = g.edges.findIndex((e) => same(e, c.edge));
      if (index < 0) return { graph: g, inverse: [] };
      return { graph: { ...g, edges: g.edges.filter((_, i) => i !== index) }, inverse: [{ type: "CONNECT", edge: c.edge, index }] };
    }
    case "SET_META": {
      const old: Meta = {};
      for (const k of Object.keys(c.patch) as (keyof Meta)[]) (old as Record<string, unknown>)[k] = g[k];
      return { graph: { ...g, ...c.patch }, inverse: [{ type: "SET_META", patch: old }] };
    }
    case "REPLACE":
      return { graph: c.graph, inverse: [{ type: "REPLACE", graph: g }] };
  }
}

/** Applies a batch in order. Inverses come back newest first, ready to undo. */
export function applyAll(g: Graph, commands: WfCommand[]): { graph: Graph; inverses: WfCommand[] } {
  let graph = g;
  const inverses: WfCommand[] = [];
  for (const c of commands) {
    const r = applyOne(graph, c);
    graph = r.graph;
    inverses.unshift(...r.inverse);
  }
  return { graph, inverses };
}

/** For merged typing runs and drags: a later command that covers an earlier one. */
export const supersedes: Supersedes<WfCommand> = (a, b) => {
  if (a.type === "MOVE_NODE" && b.type === "MOVE_NODE") return a.id === b.id;
  if (a.type === "UPDATE_NODE" && b.type === "UPDATE_NODE") {
    if (a.id !== b.id) return false;
    const later = new Set(Object.keys(b.patch));
    return Object.keys(a.patch).every((k) => later.has(k));
  }
  if (a.type === "SET_META" && b.type === "SET_META") {
    const later = new Set(Object.keys(b.patch));
    return Object.keys(a.patch).every((k) => later.has(k));
  }
  return false;
};

/** "Move Send", "Change Find leads": what the undo and redo buttons say. */
export function describe(c: WfCommand, g: Graph | null, label: (type: string) => string): string {
  const nodeLabel = (id: string) => {
    const n = g?.nodes.find((x) => x.id === id);
    return n ? n.name || label(n.type) : "step";
  };
  switch (c.type) {
    case "ADD_NODE":
      return `Add ${c.node.name || label(c.node.type)}`;
    case "REMOVE_NODE":
      return `Delete ${nodeLabel(c.id)}`;
    case "RESTORE_NODE":
      return `Restore ${c.node.name || label(c.node.type)}`;
    case "MOVE_NODE":
      return `Move ${nodeLabel(c.id)}`;
    case "UPDATE_NODE":
      return `Change ${nodeLabel(c.id)}`;
    case "CONNECT":
      return "Connect steps";
    case "DISCONNECT":
      return "Disconnect steps";
    case "SET_META":
      if ("name" in c.patch) return "Rename";
      if ("live" in c.patch) return c.patch.live ? "Turn on sending without asking" : "Turn off sending without asking";
      if ("active" in c.patch) return c.patch.active ? "Turn on" : "Turn off";
      return "Change details";
    case "REPLACE":
      return "Use the described workflow";
  }
}
