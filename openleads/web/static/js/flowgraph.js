/* =========================================================================
   Workflow graph helpers for the editor: pure functions over the same JSON
   the server stores ({name, nodes: [{id, type, params, position}], edges:
   [{from, from_port, to}]}). No DOM here, so node's test runner covers it.
   ========================================================================= */

export const NODE_W = 208;
export const PORT_GAP = 24;

export const clone = (v) => JSON.parse(JSON.stringify(v));

/** Height of a node card: taller when it has several output ports. */
export function nodeHeight(type) {
  const outs = (type && type.outputs ? type.outputs.length : 1);
  return Math.max(64, 26 + outs * PORT_GAP);
}

/** World coordinates of a port. kind is "in" or "out"; port names an output. */
export function portPos(node, type, kind, port = "out") {
  const h = nodeHeight(type);
  const { x, y } = node.position;
  if (kind === "in") return { x, y: y + h / 2 };
  const outs = (type && type.outputs) || ["out"];
  const i = Math.max(0, outs.indexOf(port));
  const top = h / 2 - ((outs.length - 1) * PORT_GAP) / 2;
  return { x: x + NODE_W, y: y + top + i * PORT_GAP };
}

/** A smooth left-to-right bezier between two points (SVG path data). */
export function edgePath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M${a.x} ${a.y} C${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function newId(graph, prefix = "n") {
  const taken = new Set(graph.nodes.map((n) => n.id));
  let i = graph.nodes.length + 1;
  while (taken.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

/** Default params for a catalog node type. */
export function defaults(type) {
  const out = {};
  for (const p of (type && type.params) || []) out[p.key] = clone(p.default ?? "");
  return out;
}

export function addNode(graph, type, position) {
  const node = { id: newId(graph), type: type.type, params: defaults(type),
    position: { x: Math.round(position.x), y: Math.round(position.y) } };
  graph.nodes.push(node);
  return node;
}

/** Remove nodes (by id) and every edge touching them. */
export function removeNodes(graph, ids) {
  const gone = new Set(ids);
  graph.nodes = graph.nodes.filter((n) => !gone.has(n.id));
  graph.edges = graph.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));
}

/** Copy nodes (and the edges between them) offset down-right; returns the new ids. */
export function duplicateNodes(graph, ids, offset = 40) {
  const map = {};
  const picked = graph.nodes.filter((n) => ids.includes(n.id));
  for (const n of picked) {
    const copy = clone(n);
    copy.id = newId(graph);
    copy.position = { x: n.position.x + offset, y: n.position.y + offset };
    map[n.id] = copy.id;
    graph.nodes.push(copy);
  }
  for (const e of graph.edges.slice()) {
    if (map[e.from] && map[e.to]) graph.edges.push({ from: map[e.from], from_port: e.from_port, to: map[e.to] });
  }
  return Object.values(map);
}

/** True if adding from→to would close a loop. */
export function wouldCycle(graph, from, to) {
  if (from === to) return true;
  const adj = {};
  for (const e of graph.edges) (adj[e.from] = adj[e.from] || []).push(e.to);
  const seen = new Set();
  const todo = [to];
  while (todo.length) {
    const v = todo.pop();
    if (v === from) return true;
    if (seen.has(v)) continue;
    seen.add(v);
    for (const w of adj[v] || []) todo.push(w);
  }
  return false;
}

/** Why from→to can't be drawn ("" if it can). types maps type key → catalog entry. */
export function connectProblem(graph, types, from, port, to) {
  const a = graph.nodes.find((n) => n.id === from);
  const b = graph.nodes.find((n) => n.id === to);
  if (!a || !b) return "That node no longer exists.";
  if (from === to) return "A node can't connect to itself.";
  const tb = types[b.type];
  if (tb && !(tb.inputs || []).length) return "Triggers start a workflow; they have no input.";
  const ta = types[a.type];
  if (ta && !(ta.outputs || []).includes(port)) return "That output doesn't exist.";
  if (graph.edges.some((e) => e.from === from && e.from_port === port && e.to === to)) return "Already connected.";
  if (wouldCycle(graph, from, to)) return "That would make a loop.";
  return "";
}

export function connect(graph, types, from, port, to) {
  const why = connectProblem(graph, types, from, port, to);
  if (why) return why;
  graph.edges.push({ from, from_port: port, to });
  return "";
}

export function disconnect(graph, index) {
  graph.edges.splice(index, 1);
}

/** Node ids upstream first; ties broken left to right, then top to bottom. */
export function topoOrder(graph) {
  const pos = Object.fromEntries(graph.nodes.map((n, i) => [n.id, [n.position.x, n.position.y, i]]));
  const cmp = (a, b) => pos[a][0] - pos[b][0] || pos[a][1] - pos[b][1] || pos[a][2] - pos[b][2];
  const indeg = Object.fromEntries(graph.nodes.map((n) => [n.id, 0]));
  const adj = Object.fromEntries(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    if (e.to in indeg && e.from in adj) { indeg[e.to]++; adj[e.from].push(e.to); }
  }
  const ready = Object.keys(indeg).filter((v) => !indeg[v]).sort(cmp);
  const out = [];
  while (ready.length) {
    const v = ready.shift();
    out.push(v);
    for (const w of adj[v]) if (--indeg[w] === 0) ready.push(w);
    ready.sort(cmp);
  }
  for (const n of graph.nodes) if (!out.includes(n.id)) out.push(n.id);   // cycles: still list them
  return out;
}

/** Bounding box of the nodes, for fit-to-view. */
export function bounds(graph, types) {
  if (!graph.nodes.length) return { x: 0, y: 0, w: NODE_W, h: 64 };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of graph.nodes) {
    x1 = Math.min(x1, n.position.x); y1 = Math.min(y1, n.position.y);
    x2 = Math.max(x2, n.position.x + NODE_W); y2 = Math.max(y2, n.position.y + nodeHeight(types[n.type]));
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** The view {x, y, k} that fits the graph into a w×h viewport. */
export function fitView(graph, types, w, h, pad = 48) {
  const b = bounds(graph, types);
  // Never shrink below a readable size; a wider graph starts at its left edge instead.
  const k = Math.max(0.6, Math.min(1.1, (w - pad * 2) / b.w, (h - pad * 2) / b.h));
  const x = b.w * k > w - pad * 2 ? pad - b.x * k : (w - b.w * k) / 2 - b.x * k;
  const y = b.h * k > h - pad * 2 ? pad - b.y * k : (h - b.h * k) / 2 - b.y * k;
  return { k, x, y };
}

/** Zoom by factor around the screen point (px, py), clamped. */
export function zoomAt(view, factor, px, py, min = 0.3, max = 2) {
  const k = Math.max(min, Math.min(max, view.k * factor));
  const f = k / view.k;
  return { k, x: px - (px - view.x) * f, y: py - (py - view.y) * f };
}

/** Where a new node goes: right of `after` (if given) or at the view centre. */
export function placeFor(graph, types, view, w, h, after) {
  if (after) {
    const ys = graph.nodes.filter((n) => Math.abs(n.position.x - (after.position.x + 260)) < 60).map((n) => n.position.y);
    let y = after.position.y;
    while (ys.some((v) => Math.abs(v - y) < 80)) y += 100;
    return { x: after.position.x + 260, y };
  }
  return { x: Math.round(((w / 2) - view.x) / view.k - NODE_W / 2), y: Math.round(((h / 2) - view.y) / view.k - 32) };
}

/** "name-copy", then "name-copy-2", … avoiding names already taken. */
export function copyName(name, taken) {
  const base = `${name || "workflow"}-copy`;
  let out = base;
  for (let n = 2; taken.includes(out); n++) out = `${base}-${n}`;
  return out;
}

/** A deep copy of a workflow to open as an unsaved draft. */
export function duplicateWorkflow(wf, taken) {
  const copy = clone(wf);
  copy.name = copyName(wf.name, taken);
  for (const k of ["created_at", "updated_at", "last_run_at", "kind", "recipe", "when"]) delete copy[k];
  return copy;
}

/** Undo/redo over whole-graph snapshots. */
export class History {
  constructor(limit = 100) { this.limit = limit; this.past = []; this.future = []; }
  push(snapshot) {
    const s = JSON.stringify(snapshot);
    if (this.past[this.past.length - 1] === s) return;
    this.past.push(s);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(this.past.pop());
  }
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(this.future.pop());
  }
  clear() { this.past = []; this.future = []; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

/** A one-line description of a node's settings for its card. */
export function summarize(node, type, fieldLabels = {}) {
  const p = node.params || {};
  switch (node.type) {
    case "trigger.manual": return "Run by hand";
    case "trigger.schedule": return p.schedule || "Set a schedule";
    case "trigger.new_leads": return p.query ? `${p.query}, ${p.schedule}` : "Set what to watch";
    case "trigger.reply": return "When someone replies";
    case "find": return p.query ? `${p.query}, ${p.count}` : "Set an audience";
    case "contacts": return [p.stage || "any stage", p.tag && `tag ${p.tag}`, p.list && `list ${p.list}`].filter(Boolean).join(", ");
    case "enrich": return p.source === "csv" ? (p.path || "Choose a CSV") : p.source === "list" ? (p.list || "Choose a list") : "Incoming items";
    case "lookup_company": return `Up to ${p.max} companies`;
    case "verify": return "Re-check each address";
    case "filter": {
      const c = (p.conditions || []).filter((x) => x.field);
      if (!c.length) return "Everything passes";
      const first = `${fieldLabels[c[0].field] || c[0].field} ${String(c[0].op || "").replace("_", " ")} ${c[0].value ?? ""}`.trim();
      return c.length > 1 ? `${first} +${c.length - 1}` : first;
    }
    case "split_tier": return "Safe, risky, bad";
    case "dedupe": return p.skip_contacted ? (p.within_days ? `Not emailed in ${p.within_days} days` : "Never emailed") : "Duplicates only";
    case "limit": return `Keep ${p.max}${p.sort_by ? ", best first" : ""}`;
    case "write": return p.template ? `Template ${p.template}` : (p.pitch || "Default pitch");
    case "wait": return `${p.days || 0} days${p.hours ? ` ${p.hours} h` : ""}${p.business_hours ? ", business hours" : ""}`;
    case "send": return p.respect_window ? "Inside business hours" : "Any time";
    case "add_to_list": return p.list || "Choose a list";
    case "enroll": return p.sequence || "Choose a sequence";
    case "set_stage": return p.stage || "Choose a stage";
    case "create_task": return p.title || "Task title";
    case "tag": return p.tags ? `${p.remove ? "Remove " : ""}${p.tags}` : "Choose tags";
    case "export": return p.sink ? `${p.sink}${p.target ? `, ${p.target}` : ""}` : "Choose where";
    case "notify": return p.channel === "both" ? "Desktop and webhook" : p.channel === "webhook" ? "Webhook" : "Desktop";
  }
  return type ? type.label : node.type;
}
