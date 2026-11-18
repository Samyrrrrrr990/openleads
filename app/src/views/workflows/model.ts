// The workflow graph as the API speaks it (openleads/automate/workflow/graph.py).

export interface Param {
  key: string;
  label: string;
  kind: string;
  default: unknown;
  help?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  required?: boolean;
}

export interface NodeType {
  type: string;
  label: string;
  group: string;
  icon: string;
  doc: string;
  params: Param[];
  inputs: string[];
  outputs: string[];
  port_labels: Record<string, string>;
  trigger?: boolean;
  effect?: string;
}

export interface Field {
  key: string;
  label: string;
  kind: string;
  options?: { value: string; label: string }[];
}

export interface Catalog {
  nodes: NodeType[];
  groups: string[];
  fields: Field[];
  ops: { value: string; label: string }[];
  options: { list: string[]; sequence: string[]; template: string[]; stage: { value: string; label: string }[] };
}

export interface GNode {
  id: string;
  type: string;
  params: Record<string, unknown>;
  position: { x: number; y: number };
  name?: string;
  on_error?: "stop" | "continue";
  disabled?: boolean;
}

export interface GEdge {
  from: string;
  from_port: string;
  to: string;
}

export interface Graph {
  name: string;
  description: string;
  active: boolean;
  live: boolean;
  nodes: GNode[];
  edges: GEdge[];
  kind?: string;
  [k: string]: unknown;
}

export interface Problem {
  level: "error" | "warning";
  message: string;
  node?: string;
  edge?: number;
}

export interface Template {
  key: string;
  title?: string;
  name?: string;
  description?: string;
  graph: { nodes: GNode[]; edges: GEdge[]; description: string };
}

/** Per-node state while a run streams in. */
export interface NodeRun {
  status: "running" | "ok" | "error" | "partial" | "skipped" | string;
  in?: number;
  out?: Record<string, number>;
  ms?: number;
  error?: string;
  notes?: string[];
  /** Found or written so far, while the step runs. */
  progress?: number;
}

export const W = 216;
export const H = 72;

export function inPort(n: GNode) {
  return { x: n.position.x, y: n.position.y + H / 2 };
}

export function outPort(n: GNode, t: NodeType | undefined, port: string) {
  const outs = t?.outputs ?? ["out"];
  const i = Math.max(0, outs.indexOf(port));
  return { x: n.position.x + W, y: n.position.y + (H * (i + 1)) / (outs.length + 1) };
}

/** A smooth left-to-right curve, the way n8n draws a connection. */
export function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function title(name: string): string {
  const text = name.replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function nextId(nodes: GNode[]): string {
  let n = nodes.length + 1;
  const ids = new Set(nodes.map((x) => x.id));
  while (ids.has(`n${n}`)) n++;
  return `n${n}`;
}

/** One line under a node's name: its most telling setting. */
export function summary(n: GNode): string {
  const p = n.params || {};
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  switch (n.type) {
    case "trigger.schedule":
      return s(p.schedule);
    case "trigger.new_leads":
      return s(p.query) || s(p.schedule);
    case "find":
      return p.query ? `${s(p.count) || 20} × ${s(p.query)}` : "Who to find?";
    case "contacts":
      return p.list ? `List ${s(p.list)}` : p.tag ? `Tagged ${s(p.tag)}` : p.stage ? `Stage ${s(p.stage)}` : "From People";
    case "filter": {
      const c = Array.isArray(p.conditions) ? p.conditions.length : 0;
      return `${c} ${c === 1 ? "condition" : "conditions"}`;
    }
    case "limit":
      return `At most ${s(p.max)}`;
    case "wait":
      return Number(p.days) ? `${s(p.days)} days` : `${s(p.hours)} hours`;
    case "write":
      return p.template ? `Template ${s(p.template)}` : "Written for each lead";
    case "send":
      return p.approve === "never" ? "Sends inside the cap" : "Waits for approval";
    case "add_to_list":
      return s(p.list) ? `→ ${s(p.list)}` : "Which list?";
    case "enroll":
      return s(p.sequence) || "Which sequence?";
    case "tag":
      return s(p.tags);
    case "set_stage":
      return s(p.stage);
    case "create_task":
      return s(p.title);
    case "export":
      return s(p.sink).toUpperCase();
    case "notify":
      return s(p.channel);
    default:
      return "";
  }
}

/** One row of the step list: a node, how deep it sits under a branch, and the branch it hangs off. */
export interface StepRow {
  node: GNode;
  depth: number;
  /** The port of the step above that leads here, when that step splits ("safe", "true"…). */
  via?: string;
  /** The step that leads here. */
  from?: string;
  /** Reached again from another branch: shown as a pointer, not a second copy. */
  again?: boolean;
  /** Not reachable from a trigger. */
  loose?: boolean;
}

/**
 * The graph as a list you read top to bottom, the way a run walks it: from each
 * trigger along its wires, ports in order, branches indented under the step that
 * splits. Steps nothing leads to come last, marked loose.
 */
export function stepRows(g: Pick<Graph, "nodes" | "edges">, types: Map<string, NodeType>): StepRow[] {
  const rows: StepRow[] = [];
  const seen = new Set<string>();
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const outs = (n: GNode) => types.get(n.type)?.outputs ?? ["out"];
  const walk = (n: GNode, depth: number, via?: string, from?: string) => {
    if (seen.has(n.id)) {
      rows.push({ node: n, depth, via, from, again: true });
      return;
    }
    seen.add(n.id);
    rows.push({ node: n, depth, via, from });
    const ports = outs(n);
    const split = ports.length > 1;
    for (const port of ports) {
      const next = g.edges.filter((e) => e.from === n.id && e.from_port === port).map((e) => byId.get(e.to)).filter((x): x is GNode => !!x);
      // One wire out of a plain step continues at the same depth; branches indent.
      const fan = split || next.length > 1;
      for (const m of next) walk(m, fan ? depth + 1 : depth, split ? port : undefined, n.id);
    }
  };
  const triggers = g.nodes.filter((n) => types.get(n.type)?.trigger || n.type.startsWith("trigger."));
  const roots = triggers.length ? triggers : g.nodes.filter((n) => !g.edges.some((e) => e.to === n.id)).slice(0, 1);
  for (const r of roots) walk(r, 0);
  for (const n of g.nodes) if (!seen.has(n.id)) {
    seen.add(n.id);
    rows.push({ node: n, depth: 0, loose: true });
  }
  return rows;
}

/** Where a new step lands on the canvas: right of `after`, clear of other steps. */
export function placeAfter(nodes: GNode[], after?: GNode): { x: number; y: number } {
  let p = after ? { x: after.position.x + W + 64, y: after.position.y } : { x: 80, y: 200 };
  while (nodes.some((n) => Math.abs(n.position.x - p.x) < W / 2 && Math.abs(n.position.y - p.y) < H)) p = { x: p.x, y: p.y + H + 40 };
  return { x: Math.round(p.x), y: Math.round(p.y) };
}
