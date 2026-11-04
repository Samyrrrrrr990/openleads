/* =========================================================================
   Workflows — an n8n-style node editor. Nodes come from the server's catalog
   (/api/workflows/catalog); a workflow is {name, nodes, edges}. Drag nodes,
   drag from an output port to another node to connect, edit settings in the
   inspector, then Test run: the executor streams NDJSON node events and the
   canvas lights up with item counts. Test runs never send or export.
   On narrow screens the graph is shown as a read-only list, in run order.
   ========================================================================= */
import { $, $$, api, esc, fail, ico, menu, router, toast, ui } from "../core.js";
import {
  History, NODE_W, PORT_GAP, addNode, clone, connect, connectProblem, disconnect,
  duplicateNodes, duplicateWorkflow, edgePath, fitView, midpoint, nodeHeight, placeFor,
  portPos, removeNodes, summarize, topoOrder, wouldCycle, zoomAt,
} from "../flowgraph.js";

const SCHEDULES = ["weekdays 09:00", "daily 08:30", "every 2h", "mon,wed,fri 14:00", "0 9 * * 1-5"];
const W = {
  list: [], catalog: null, types: {}, fields: [], fieldLabels: {}, ops: [], options: {},
  cur: null, isNew: false, dirty: false, saving: false, running: false,
  sel: null, view: { x: 40, y: 40, k: 1 }, hist: new History(), editKey: "",
  problems: [], waiting: {}, runs: [], runNodes: {}, runEdges: {}, runId: null,
  tab: "log", palette: false, paletteQuery: "", pending: null, space: false, status: "",
};
let ROOT = null;
let validateTimer = 0;
const listeners = [];

const typeOf = (n) => W.types[n.type] || { label: n.type, icon: "bolt", inputs: ["in"], outputs: ["out"], params: [] };
const nodeById = (id) => W.cur && W.cur.nodes.find((n) => n.id === id);
const labelOf = (n) => n.name || typeOf(n).label;
const q = (id) => `.wfn[data-node="${String(id).replace(/["\\]/g, "\\$&")}"]`;
const nodeEl = (id) => (ROOT && ROOT.querySelector ? ROOT.querySelector(q(id)) : null);
const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ""));

function blank() {
  return { name: "", description: "", active: false, live: false,
    nodes: [{ id: "n1", type: "trigger.schedule", params: { schedule: "weekdays 09:00" }, position: { x: 40, y: 160 } },
      { id: "n2", type: "find", params: { query: "", count: 25, verified_only: true, location: "", industry: "", title: "", seniority: "" },
        position: { x: 320, y: 160 } }],
    edges: [{ from: "n1", from_port: "out", to: "n2" }] };
}

/* ------------------------------------------------------------------ data */
async function loadCatalog() {
  if (W.catalog) return;
  const c = await api.get("/api/workflows/catalog");
  W.catalog = c;
  W.types = Object.fromEntries((c.nodes || []).map((t) => [t.type, t]));
  W.fields = c.fields || [];
  W.fieldLabels = Object.fromEntries(W.fields.map((f) => [f.key, f.label]));
  W.ops = c.ops || [];
  W.options = c.options || {};
}
async function loadList() {
  try { W.list = (await api.get("/api/workflows")).workflows || []; } catch (_) { W.list = []; }
}
async function loadRuns() {
  if (!W.cur || W.isNew || !W.cur.name) { W.runs = []; return; }
  try { W.runs = (await api.get("/api/workflows/runs", { name: W.cur.name, limit: 15 })).runs || []; }
  catch (_) { W.runs = []; }
}
async function open(name) {
  const res = await api.get("/api/workflows/get", { name });
  W.cur = res.workflow; W.problems = res.problems || []; W.waiting = res.waiting || {};
  W.isNew = false; W.dirty = false; W.sel = null; W.hist.clear(); W.editKey = "";
  W.runNodes = {}; W.runEdges = {}; W.runId = null; W.status = "";
  await loadRuns();
  fitLater();
}
function startDraft(graph) {
  W.cur = graph; W.isNew = true; W.dirty = true; W.sel = null; W.hist.clear(); W.editKey = "";
  W.problems = []; W.waiting = {}; W.runs = []; W.runNodes = {}; W.runEdges = {}; W.runId = null; W.status = "";
  fitLater();
}

/* ------------------------------------------------------------- rendering */
function statusText() {
  if (W.running) return ["Running", "running"];
  if (W.status === "ok") return ["Succeeded", "done"];
  if (W.status === "error") return ["Failed", "err"];
  if (W.saving) return ["Saving", "running"];
  return [W.dirty ? "Unsaved changes" : "Ready", ""];
}

function listHtml() {
  const items = W.list.map((x) => `
    <button type="button" class="wf__item${!W.isNew && W.cur && x.name === W.cur.name ? " is-on" : ""}" data-act="open" data-name="${esc(x.name)}">
      <span class="wf__dot${x.active ? " is-live" : ""}"></span>
      <span><b>${esc(x.name)}</b><small>${esc(x.active ? x.when : "paused")}${x.kind === "recipe" ? ", recipe" : ""}</small></span>
    </button>`).join("");
  const draft = W.isNew ? `<div class="wf__item is-on is-draft"><span class="wf__dot"></span><span><b data-draft-name>${esc(W.cur.name || "Untitled")}</b><small>not saved</small></span></div>` : "";
  return `${items || (W.isNew ? "" : '<p class="muted wf__empty">No workflows yet.</p>')}${draft}`;
}

function barHtml() {
  const r = W.cur;
  const busy = W.running || W.saving;
  const [st, state] = statusText();
  return `
    ${W.isNew ? `<input class="input input--mono wf__name" data-wf="name" value="${esc(r.name)}" placeholder="workflow-name" aria-label="Workflow name"/>`
      : `<span class="wf__title">${ico("flow")}<span>${esc(r.name)}</span></span>`}
    <span class="wf__status" id="wf-status" data-state="${state}"><i></i><span>${st}</span></span>
    <div class="wf__tools">
      <button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="undo" title="Undo (⌘Z)" aria-label="Undo" ${W.hist.canUndo ? "" : "disabled"}>${ico("chevron-left")}</button>
      <button type="button" class="btn btn--ghost btn--icon btn--sm wf__redo" data-act="redo" title="Redo (⌘⇧Z)" aria-label="Redo" ${W.hist.canRedo ? "" : "disabled"}>${ico("chevron-left")}</button>
      <label class="switch wf__active" title="Active workflows run on their triggers"><input type="checkbox" data-wf="active" ${r.active ? "checked" : ""}/><span class="switch__track"></span><span class="switch__label">${r.active ? "Active" : "Paused"}</span></label>
      ${W.isNew ? "" : `<button type="button" class="btn btn--ghost btn--icon btn--sm btn--danger wf__edit" data-act="delete" title="Delete workflow" aria-label="Delete workflow">${ico("trash")}<span></span></button>`}
      <button type="button" class="btn btn--sm wf__edit" data-act="duplicate" ${busy ? "disabled" : ""}>${ico("copy")} Duplicate</button>
      <button type="button" class="btn btn--ghost btn--icon btn--sm wf__edit" data-act="more" title="Export or import" aria-label="More">${ico("more")}</button>
      <button type="button" class="btn btn--sm" data-act="test" ${busy ? "disabled" : ""}>${ico("play")} Test run</button>
      <button type="button" class="btn btn--primary btn--sm wf__edit" data-act="save" ${W.saving ? "disabled" : ""}>${ico("check")} Save</button>
    </div>`;
}

function portsHtml(n, t) {
  const outs = t.outputs || [];
  const h = nodeHeight(t);
  const top = h / 2 - ((outs.length - 1) * PORT_GAP) / 2;
  const res = W.runNodes[n.id];
  const named = outs.length > 1;
  return outs.map((p, i) => {
    const count = res && res.out && res.out[p] !== undefined ? res.out[p] : null;
    const lbl = (t.port_labels && t.port_labels[p]) || p;
    return `<span class="wfn__out${named ? " wfn__out--named" : ""} wfn__out--${esc(p)}" data-port-out="${esc(p)}" style="top:${top + i * PORT_GAP}px" title="Drag to connect${named ? ` (${esc(lbl)})` : ""}">
      ${named ? `<i>${esc(lbl)}${count !== null ? ` <em>${count}</em>` : ""}</i>` : ""}</span>`;
  }).join("");
}

function badgeText(n) {
  const r = W.runNodes[n.id];
  if (!r) return "";
  if (r.status === "running") return r.count !== undefined ? `${r.count}` : "…";
  if (r.status === "skipped") return "";
  const outs = Object.values(r.out || {});
  const total = outs.reduce((a, b) => a + b, 0);
  if (r.status === "error") return "error";
  if (typeOf(n).trigger) return `${total}`;
  return `${r.in ?? 0} → ${total}`;
}

function nodeHtml(n) {
  const t = typeOf(n);
  const h = nodeHeight(t);
  const probs = W.problems.filter((p) => p.node === n.id);
  const err = probs.find((p) => p.level === "error");
  const r = W.runNodes[n.id];
  const cls = ["wfn", t.trigger ? "is-trigger" : "", W.sel && W.sel.kind === "node" && W.sel.id === n.id ? "is-sel" : "",
    err ? "has-error" : probs.length ? "has-warn" : "", n.disabled ? "is-off" : "",
    r ? ({ running: "is-running", ok: "is-done", error: "is-err", disabled: "is-done" }[r.status] || "") : ""].filter(Boolean).join(" ");
  const sum = summarize(n, t, W.fieldLabels);
  const wait = W.waiting[n.id];
  return `<div class="${cls}" data-node="${esc(n.id)}" role="button" tabindex="0" aria-label="${esc(`${labelOf(n)}: ${sum}`)}"
      style="left:${n.position.x}px;top:${n.position.y}px;height:${h}px;width:${NODE_W}px">
    ${(t.inputs || []).length ? '<span class="wfn__in" data-port-in aria-hidden="true"></span>' : ""}
    <span class="wfn__ico wfn__ico--${esc(t.group || "").toLowerCase()}">${ico(t.icon || "bolt")}</span>
    <span class="wfn__txt"><b>${esc(labelOf(n))}</b><small data-sum>${esc(sum)}</small></span>
    <span class="wfn__badge" data-badge>${esc(badgeText(n))}</span>
    ${err ? `<span class="wfn__flag" title="${esc(err.message)}">!</span>` : ""}
    ${wait ? `<span class="wfn__wait">${wait} waiting</span>` : ""}
    ${portsHtml(n, t)}
  </div>`;
}

function edgeEnds(e) {
  const a = nodeById(e.from), b = nodeById(e.to);
  if (!a || !b) return null;
  return [portPos(a, typeOf(a), "out", e.from_port), portPos(b, typeOf(b), "in")];
}

function edgesHtml() {
  return W.cur.edges.map((e, i) => {
    const ends = edgeEnds(e);
    if (!ends) return "";
    const d = edgePath(ends[0], ends[1]);
    const run = W.runEdges[`${e.from}|${e.from_port}|${e.to}`];
    const sel = W.sel && W.sel.kind === "edge" && W.sel.index === i;
    const state = run ? (run.live ? "is-live" : run.count ? "is-done" : "is-empty") : "";
    const m = midpoint(ends[0], ends[1]);
    return `<g data-e="${i}"><path class="wf-edge ${state}${sel ? " is-sel" : ""}" d="${d}"/>
      <path class="wf-hit" data-act="edge" data-i="${i}" d="${d}"/>
      ${run && run.count !== undefined ? `<text class="wf-count" x="${m.x}" y="${m.y - 6}" text-anchor="middle">${run.count}</text>` : ""}</g>`;
  }).join("");
}

function paletteHtml() {
  if (!W.palette) return "";
  const q = W.paletteQuery.trim().toLowerCase();
  const groups = (W.catalog.groups || []).map((g) => {
    const items = (W.catalog.nodes || []).filter((t) => t.group === g
      && (!q || `${t.label} ${t.doc} ${t.type}`.toLowerCase().includes(q)));
    if (!items.length) return "";
    return `<div class="wf__pal-group"><h4>${esc(g)}</h4>${items.map((t) => `
      <button type="button" class="wf__pal-item" data-act="add-node" data-type="${esc(t.type)}" draggable="true" title="${esc(t.doc)}">
        <span class="wfn__ico">${ico(t.icon)}</span><span><b>${esc(t.label)}</b><small>${esc(t.doc.split(". ")[0].replace(/\*/g, ""))}</small></span></button>`).join("")}</div>`;
  }).join("");
  return `<div class="wf__palette" role="dialog" aria-label="Add a node">
    <div class="wf__pal-head"><input class="input input--sm" data-wf="palette" value="${esc(W.paletteQuery)}" placeholder="Search nodes" aria-label="Search nodes"/>
      <button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="palette-close" aria-label="Close">${ico("x")}</button></div>
    <div class="wf__pal-list">${groups || '<p class="muted wf__note">No node matches.</p>'}</div></div>`;
}

function canvasHtml() {
  return `<div class="wf__canvas${W.space ? " is-pan" : ""}" id="wf-canvas" role="group" aria-label="Workflow canvas. Tab moves between nodes; arrow keys move the selected node.">
      <div class="wf__world" id="wf-world">
        <svg class="wf__edges" id="wf-edges" width="1" height="1" aria-hidden="true">${edgesHtml()}<path class="wf-edge is-draft" id="wf-temp" d=""/></svg>
        <div id="wf-nodes">${topoOrder(W.cur).map((id) => nodeHtml(nodeById(id))).join("")}</div>
      </div>
      <div class="wf__overlay wf__overlay--tl">
        <button type="button" class="btn btn--sm wf__edit" data-act="palette" aria-expanded="${W.palette}">${ico("plus")} Add node</button>
      </div>
      <div class="wf__overlay wf__overlay--br">
        <button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="zoom-out" aria-label="Zoom out">${ico("minus")}</button>
        <span class="wf__zoom" id="wf-zoom">${Math.round(W.view.k * 100)}%</span>
        <button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="zoom-in" aria-label="Zoom in">${ico("plus")}</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="fit">Fit</button>
      </div>
      <p class="wf__hint">Drag from a port to connect. Space-drag or scroll to pan, ⌘-scroll to zoom.</p>
      ${paletteHtml()}
    </div>`;
}

function vlistHtml() {
  return `<ol class="wf__vlist" aria-label="Workflow steps in run order">${topoOrder(W.cur).map((id) => {
    const n = nodeById(id), t = typeOf(n);
    const outs = W.cur.edges.filter((e) => e.from === id).map((e) => {
      const b = nodeById(e.to);
      return `<li>${e.from_port !== "out" ? `<span class="wf__port">${esc(e.from_port)}</span> ` : ""}${ico("arrow")} ${esc(b ? labelOf(b) : e.to)}</li>`;
    }).join("");
    const badge = badgeText(n);
    return `<li class="wf__vstep"><span class="wfn__ico">${ico(t.icon || "bolt")}</span>
      <div><b>${esc(labelOf(n))}</b>${badge ? ` <span class="wf__vbadge">${esc(badge)}</span>` : ""}<small>${esc(summarize(n, t, W.fieldLabels))}</small>
      ${outs ? `<ul>${outs}</ul>` : ""}</div></li>`;
  }).join("")}</ol>`;
}

/* -------------------------------------------------------------- inspector */
function fieldHtml(n, p) {
  const v = n.params[p.key];
  const id = `wfp-${n.id}-${p.key}`;
  const hint = p.help ? `<span class="hint">${esc(p.help)}</span>` : "";
  const label = `<label for="${id}">${esc(p.label)}</label>`;
  const opts = (list, cur, blankLabel) => (blankLabel !== undefined ? `<option value="">${esc(blankLabel)}</option>` : "")
    + list.map((o) => {
      const val = typeof o === "object" ? o.value : o, lab = typeof o === "object" ? o.label : o;
      return `<option value="${esc(val)}" ${String(val) === String(cur ?? "") ? "selected" : ""}>${esc(lab)}</option>`;
    }).join("");
  switch (p.kind) {
    case "bool":
      return `<label class="switch"><input type="checkbox" id="${id}" data-p="${esc(p.key)}" ${v ? "checked" : ""}/><span class="switch__track"></span><span class="switch__label">${esc(p.label)}</span></label>${hint}`;
    case "number":
      return `<div class="field">${label}<input class="input input--mono" id="${id}" type="number" data-p="${esc(p.key)}" value="${esc(v)}" ${p.min !== undefined ? `min="${p.min}"` : ""} ${p.max !== undefined ? `max="${p.max}"` : ""}/>${hint}</div>`;
    case "textarea":
      return `<div class="field">${label}<textarea class="textarea" id="${id}" rows="3" data-p="${esc(p.key)}" placeholder="${esc(p.placeholder || "")}">${esc(v)}</textarea>${hint}</div>`;
    case "select":
      return `<div class="field">${label}<select class="select" id="${id}" data-p="${esc(p.key)}">${opts(p.options || [], v)}</select>${hint}</div>`;
    case "stage":
      return `<div class="field">${label}<select class="select" id="${id}" data-p="${esc(p.key)}">${opts(W.options.stage || [], v, p.required ? undefined : "Any stage")}</select>${hint}</div>`;
    case "sequence": case "template":
      return `<div class="field">${label}<select class="select" id="${id}" data-p="${esc(p.key)}">${opts(W.options[p.kind] || [], v, p.kind === "template" ? "None: write each email" : "Choose a sequence")}</select>${hint}</div>`;
    case "list":
      return `<div class="field">${label}<input class="input" id="${id}" list="${id}-dl" data-p="${esc(p.key)}" value="${esc(v)}" placeholder="${esc(p.placeholder || "List name")}"/>
        <datalist id="${id}-dl">${(W.options.list || []).map((x) => `<option value="${esc(x)}"></option>`).join("")}</datalist>${hint}</div>`;
    case "schedule":
      return `<div class="field">${label}<input class="input input--mono" id="${id}" data-p="${esc(p.key)}" value="${esc(v)}" placeholder="${esc(p.placeholder || "weekdays 09:00")}"/>
        ${hint || '<span class="hint">Plain English or cron. Fires once the workflow is active and <code>openleads schedule on</code> is installed.</span>'}
        <div class="wf__chips">${SCHEDULES.map((s) => `<button type="button" class="chip chip--toggle" data-act="sched" data-key="${esc(p.key)}" data-v="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`;
    case "conditions":
      return `<div class="field"><label>${esc(p.label)}</label><div class="wf__conds">${(v || []).map((c, i) => condHtml(c, i)).join("")}</div>
        <button type="button" class="btn btn--ghost btn--sm" data-act="cond-add">${ico("plus")} Add condition</button></div>`;
    default:
      return `<div class="field">${label}<input class="input" id="${id}" data-p="${esc(p.key)}" value="${esc(v)}" placeholder="${esc(p.placeholder || "")}"/>${hint}</div>`;
  }
}

function condHtml(c, i) {
  const f = W.fields.find((x) => x.key === c.field) || W.fields[0] || { kind: "text" };
  const unary = ["is_true", "is_false", "empty", "not_empty"].includes(c.op);
  const opsFor = W.ops.filter((o) => f.kind === "number" ? ["gte", "lte", "is", "is_not", "empty", "not_empty"].includes(o.value)
    : f.kind === "bool" ? ["is_true", "is_false"].includes(o.value)
      : !["gte", "lte", "is_true", "is_false"].includes(o.value));
  let value = "";
  if (!unary) {
    value = f.options && ["is", "is_not"].includes(c.op)
      ? `<select class="select select--sm" data-cond="${i}" data-part="value" aria-label="Value">${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(c.value) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`
      : `<input class="input input--sm" data-cond="${i}" data-part="value" value="${esc(c.value)}" placeholder="${f.options ? "comma separated" : "value"}" aria-label="Value"/>`;
  }
  return `<div class="wf__cond">
    <select class="select select--sm" data-cond="${i}" data-part="field" aria-label="Field">${W.fields.map((x) => `<option value="${esc(x.key)}" ${x.key === c.field ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select>
    <select class="select select--sm" data-cond="${i}" data-part="op" aria-label="Comparison">${opsFor.map((o) => `<option value="${esc(o.value)}" ${o.value === c.op ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>
    ${value}<button type="button" class="btn btn--ghost btn--icon btn--sm" data-act="cond-rm" data-i="${i}" aria-label="Remove condition">${ico("x")}</button></div>`;
}

function connectionsHtml(n) {
  const t = typeOf(n);
  const outs = (t.outputs || []).map((p) => {
    const edges = W.cur.edges.map((e, i) => [e, i]).filter(([e]) => e.from === n.id && e.from_port === p);
    const targets = W.cur.nodes.filter((b) => b.id !== n.id && (typeOf(b).inputs || []).length
      && !edges.some(([e]) => e.to === b.id) && !wouldCycle(W.cur, n.id, b.id));
    return `<div class="wf__conn"><span class="wf__port">${esc((t.port_labels && t.port_labels[p]) || p)}</span>
      ${edges.map(([e, i]) => `<span class="wf__link">${ico("arrow")} ${esc(labelOf(nodeById(e.to)) || e.to)}
        <button type="button" class="btn btn--ghost btn--icon btn--xs" data-act="unlink" data-i="${i}" aria-label="Disconnect">${ico("x")}</button></span>`).join("")}
      ${targets.length ? `<select class="select select--sm" data-link="${esc(p)}" aria-label="Connect ${esc(p)} to"><option value="">Connect to…</option>${targets.map((b) => `<option value="${esc(b.id)}">${esc(labelOf(b))}</option>`).join("")}</select>` : ""}</div>`;
  }).join("");
  const ins = W.cur.edges.filter((e) => e.to === n.id).map((e) => {
    const a = nodeById(e.from);
    return `<span class="wf__link">${esc(a ? labelOf(a) : e.from)}${e.from_port !== "out" ? ` (${esc(e.from_port)})` : ""} ${ico("arrow")}</span>`;
  }).join("");
  return `<section class="wf__sec"><h4>Connections</h4>${ins ? `<div class="wf__conn"><span class="wf__port">in</span>${ins}</div>` : ""}${outs || '<p class="muted wf__note">No outputs.</p>'}</section>`;
}

function sampleRow(s) {
  const who = s.name || s.email || s.domain || "item";
  return `<li>${s.tier ? ui.mark(s.evidence, s.tier) : ""}<span class="wf__s-main"><b>${esc(who)}</b>${s.organization ? ` <span class="muted">${esc(s.organization)}</span>` : ""}
    ${s.subject ? `<small>${esc(s.subject)}</small>` : s.email && s.name ? `<small class="mono">${esc(s.email)}</small>` : ""}${s.send ? `<small>${esc(s.send)}</small>` : ""}</span></li>`;
}

function outputHtml(n) {
  const r = W.runNodes[n.id];
  if (!r || r.status === "running") return "";
  const counts = Object.entries(r.out || {}).map(([p, c]) => `${p === "out" ? "out" : esc(p)} ${c}`).join(", ");
  const samples = Object.entries(r.samples || {}).map(([p, list]) => `${Object.keys(r.samples).length > 1 ? `<h5>${esc(p)}</h5>` : ""}<ul class="wf__samples">${list.map(sampleRow).join("")}</ul>`).join("");
  return `<section class="wf__sec"><h4>Last run</h4>
    <p class="wf__note">${r.status === "skipped" ? "Didn't run: nothing reached it." : `${r.status === "error" ? "Failed" : "Ran"} in ${r.ms ?? 0} ms. In ${r.in ?? 0}, ${counts || "out 0"}.`}</p>
    ${r.error ? `<p class="wf__err">${esc(r.error)}</p>` : ""}
    ${(r.notes || []).map((x) => `<p class="wf__note">${esc(x)}</p>`).join("")}${samples}</section>`;
}

function probsHtml(probs) {
  return probs.map((p) => `<p class="${p.level === "error" ? "wf__err" : "wf__warn"}">${esc(p.message)}</p>`).join("");
}

function nodeInspector(n) {
  const t = typeOf(n);
  const probs = W.problems.filter((p) => p.node === n.id);
  return `<div class="wf__insp-head"><span class="wfn__ico">${ico(t.icon || "bolt")}</span><div><b>${esc(labelOf(n))}</b><small>${esc(t.group || "")}${n.name ? `, ${esc(t.label)}` : ""}</small></div>
      <button type="button" class="btn btn--ghost btn--icon btn--sm wf__edit" data-act="dup-node" title="Duplicate node (⌘D)" aria-label="Duplicate node">${ico("copy")}</button>
      <button type="button" class="btn btn--ghost btn--icon btn--sm wf__edit" data-act="rm-node" title="Delete node (Delete)" aria-label="Delete node">${ico("trash")}</button></div>
    <div class="wf__insp-body">
      <p class="wf__doc">${esc(t.doc || "").replace(/\*([^*]+)\*/g, "<i>$1</i>").replace(/`([^`]+)`/g, "<code>$1</code>")}</p>
      <div data-probs>${probsHtml(probs)}</div>
      ${(t.params || []).map((p) => fieldHtml(n, p)).join("")}
      <div class="field"><label for="wfp-${esc(n.id)}-name">Label on the canvas</label><input class="input" id="wfp-${esc(n.id)}-name" data-nodeattr="name" value="${esc(n.name || "")}" placeholder="${esc(t.label)}"/></div>
      ${t.trigger ? "" : `<div class="field"><label for="wfp-${esc(n.id)}-err">If it fails</label><select class="select" id="wfp-${esc(n.id)}-err" data-nodeattr="on_error">
        <option value="stop" ${n.on_error !== "continue" ? "selected" : ""}>Stop the run</option>
        <option value="continue" ${n.on_error === "continue" ? "selected" : ""}>Continue with other branches</option></select></div>`}
      ${connectionsHtml(n)}
      ${outputHtml(n)}
    </div>`;
}

function workflowInspector() {
  const r = W.cur;
  const errs = W.problems.filter((p) => p.level === "error"), warns = W.problems.filter((p) => p.level !== "error");
  const waiting = Object.values(W.waiting).reduce((a, b) => a + b, 0);
  return `<div class="wf__insp-head"><span class="wfn__ico">${ico("flow")}</span><div><b>${esc(r.name || "Untitled")}</b><small>Workflow settings</small></div></div>
    <div class="wf__insp-body">
      ${r.kind === "recipe" ? '<p class="wf__note">This workflow is a recipe. It keeps running as one until you add a step a recipe can\'t do; saving then turns it into a full workflow.</p>' : ""}
      <div class="field"><label for="wf-desc">Description</label><textarea class="textarea" id="wf-desc" rows="2" data-wf="description" placeholder="What this workflow is for">${esc(r.description || "")}</textarea></div>
      <label class="switch"><input type="checkbox" data-wf="live" ${r.live ? "checked" : ""}/><span class="switch__track"></span><span class="switch__label">Send for real on scheduled runs</span></label>
      <span class="hint">Off: Send previews only. On: active runs send inside your warmup cap and business hours. Test runs never send.</span>
      ${waiting ? `<p class="wf__note">${waiting} items are waiting in Wait or Send steps.</p>` : ""}
      ${errs.length || warns.length ? `<section class="wf__sec"><h4>Problems</h4>${W.problems.map((p) => `<button type="button" class="wf__prob ${p.level === "error" ? "is-err" : ""}" ${p.node ? `data-act="select" data-node="${esc(p.node)}"` : ""}>${esc(p.message)}</button>`).join("")}</section>`
        : '<p class="wf__note">No problems found. Click a node to edit it, or Add node to extend the workflow.</p>'}
      <section class="wf__sec"><h4>Keyboard</h4><dl class="wf__keys">
        <dt>A</dt><dd>Add a node</dd><dt>Delete</dt><dd>Delete the selection</dd><dt>⌘D</dt><dd>Duplicate the node</dd>
        <dt>⌘Z, ⌘⇧Z</dt><dd>Undo, redo</dd><dt>⌘S</dt><dd>Save</dd><dt>Arrows</dt><dd>Move the node</dd><dt>Space</dt><dd>Hold and drag to pan</dd></dl></section>
    </div>`;
}

function inspectorHtml() {
  const n = W.sel && W.sel.kind === "node" ? nodeById(W.sel.id) : null;
  return n ? nodeInspector(n) : workflowInspector();
}

function panelHtml() {
  const runs = W.runs.map((r) => {
    const s = r.summary || {};
    const when = new Date(r.started * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const dot = r.status === "ok" ? "is-ok" : r.status === "partial" ? "is-warn" : r.status === "error" ? "is-err" : "";
    return `<li><button type="button" class="wf__run${W.runId === r.id ? " is-on" : ""}" data-act="run-open" data-id="${r.id}">
      <i class="wf__rdot ${dot}"></i><span>${esc(when)}</span><span>${r.mode === "test" ? "Test run" : r.live ? "Live run" : "Run"}</span>
      <span class="muted">found ${s.found || 0}, drafted ${s.drafted || 0}, ${r.live ? `sent ${s.sent || 0}` : `previewed ${s.previewed || 0}`}${s.waiting ? `, ${s.waiting} waiting` : ""}</span>
      <span class="muted wf__rsec">${r.seconds}s</span></button></li>`;
  }).join("");
  return `<div class="wf__tabs" role="tablist">
      <button type="button" role="tab" class="wf__tab${W.tab === "log" ? " is-on" : ""}" aria-selected="${W.tab === "log"}" data-act="tab" data-tab="log">Run log</button>
      <button type="button" role="tab" class="wf__tab${W.tab === "runs" ? " is-on" : ""}" aria-selected="${W.tab === "runs"}" data-act="tab" data-tab="runs">History${W.runs.length ? ` <span class="muted">${W.runs.length}</span>` : ""}</button></div>
    <ol class="wf__log" id="wf-log" ${W.tab === "log" ? "" : "hidden"}><li class="muted">Test runs are dry runs: they find and write, but never send, export or change your workspace.</li></ol>
    <ul class="wf__runs" ${W.tab === "runs" ? "" : "hidden"}>${runs || '<li class="muted wf__note">No runs yet.</li>'}</ul>`;
}

function render() {
  if (!ROOT) return;
  ROOT.innerHTML = `
  <section class="page wf-page">
    <div class="head"><div><div class="head__title"><h1>Workflows</h1></div>
      <p class="head__sub">Triggers, searches, filters, emails and exports joined into one automation. Test runs never send.</p></div>
      <button type="button" class="btn btn--primary" data-act="new">${ico("plus")} New workflow</button></div>
    <div class="wf__list"><div class="wf__items" id="wf-items">${listHtml()}</div></div>
    <div class="wf__shell">
      <div class="wf__board card">
        <div class="wf__bar" id="wf-bar">${barHtml()}</div>
        ${canvasHtml()}
        ${vlistHtml()}
        <div class="wf__panel" id="wf-panel">${panelHtml()}</div>
      </div>
      <aside class="wf__insp card" id="wf-insp">${inspectorHtml()}</aside>
    </div>
  </section>`;
  applyView();
}

/* Partial repaints keep focus inside the inspector while typing. */
function paintBar() { const el = $("#wf-bar", ROOT); if (el) el.innerHTML = barHtml(); }
function paintList() { const el = $("#wf-items", ROOT); if (el) el.innerHTML = listHtml(); }
function paintInspector() { const el = $("#wf-insp", ROOT); if (el) el.innerHTML = inspectorHtml(); }
function paintEdges() {
  const el = $("#wf-edges", ROOT);
  if (el) el.innerHTML = `${edgesHtml()}<path class="wf-edge is-draft" id="wf-temp" d=""/>`;
}
function paintNodes() {
  const el = $("#wf-nodes", ROOT);
  const active = typeof document !== "undefined" && document.activeElement;
  const focused = active && active.closest && active.closest(".wfn") ? active.closest(".wfn").dataset.node : "";
  if (el) el.innerHTML = topoOrder(W.cur).map((id) => nodeHtml(nodeById(id))).join("");
  if (focused) nodeEl(focused)?.focus({ preventScroll: true });
  paintEdges();
  const v = ROOT && ROOT.querySelector(".wf__vlist");
  if (v) v.outerHTML = vlistHtml();
}
function paintNode(id) {
  const n = nodeById(id), el = nodeEl(id);
  if (!n || !el) return;
  const s = el.querySelector("[data-sum]"); if (s) s.textContent = summarize(n, typeOf(n), W.fieldLabels);
  const b = el.querySelector("[data-badge]"); if (b) b.textContent = badgeText(n);
  const t = el.querySelector(".wfn__txt b"); if (t) t.textContent = labelOf(n);
}
function paintPanel() { const el = $("#wf-panel", ROOT); if (el) el.innerHTML = panelHtml(); }
function paintAll() { paintBar(); paintNodes(); paintInspector(); }

function applyView() {
  const world = $("#wf-world", ROOT), canvas = $("#wf-canvas", ROOT);
  if (world && world.style) world.style.transform = `translate(${W.view.x}px, ${W.view.y}px) scale(${W.view.k})`;
  if (canvas && canvas.style) {
    canvas.style.backgroundPosition = `${W.view.x}px ${W.view.y}px`;
    canvas.style.backgroundSize = `${24 * W.view.k}px ${24 * W.view.k}px`;
  }
  const z = $("#wf-zoom", ROOT); if (z) z.textContent = `${Math.round(W.view.k * 100)}%`;
}
function canvasRect() {
  const c = $("#wf-canvas", ROOT);
  return c && c.getBoundingClientRect ? c.getBoundingClientRect() : { left: 0, top: 0, width: 900, height: 520 };
}
function fit() {
  if (!W.cur) return;
  const r = canvasRect();
  if (!r.width) return;
  W.view = fitView(W.cur, W.types, r.width, r.height);
  applyView();
}
function fitLater() { setTimeout(fit, 0); }

/* ------------------------------------------------------------- mutations */
function snapshot() { return { nodes: clone(W.cur.nodes), edges: clone(W.cur.edges) }; }
function commit(before) {
  W.hist.push(before || snapshot());
  touched();
}
function touched() {
  W.dirty = true; W.status = "";
  paintBar();
  revalidate();
}
function revalidate() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(async () => {
    if (!W.cur) return;
    try {
      const res = await api.post("/api/workflows/validate", { workflow: W.cur, check_name: false });
      W.problems = res.problems || [];
      paintNodes();
      if (!W.sel || W.sel.kind !== "node") paintInspector();
      else {
        const box = ROOT && ROOT.querySelector && ROOT.querySelector("#wf-insp [data-probs]");
        if (box) box.innerHTML = probsHtml(W.problems.filter((p) => p.node === W.sel.id));
      }
    } catch (_) { /* offline: keep the old list */ }
  }, 350);
}
function restore(state) {
  if (!state) return;
  W.cur.nodes = state.nodes; W.cur.edges = state.edges;
  if (W.sel && W.sel.kind === "node" && !nodeById(W.sel.id)) W.sel = null;
  if (W.sel && W.sel.kind === "edge") W.sel = null;
  W.editKey = "";
  touched(); paintNodes(); paintInspector();
}
function undo() { restore(W.hist.undo(snapshot())); }
function redo() { restore(W.hist.redo(snapshot())); }

function select(sel, { focus = false } = {}) {
  W.sel = sel; W.editKey = "";
  $$(".wfn.is-sel", ROOT).forEach((el) => el.classList.remove("is-sel"));
  if (sel && sel.kind === "node") {
    const el = nodeEl(sel.id);
    if (el) { el.classList.add("is-sel"); if (focus) el.focus({ preventScroll: true }); }
  }
  paintEdges();
  paintInspector();
}

function addOfType(typeKey, at) {
  const t = W.types[typeKey]; if (!t) return;
  const before = snapshot();
  const r = canvasRect();
  const from = W.pending || (W.sel && W.sel.kind === "node" ? { from: W.sel.id, port: (typeOf(nodeById(W.sel.id)).outputs || [])[0] } : null);
  const after = from && nodeById(from.from);
  const pos = at || placeFor(W.cur, W.types, W.view, r.width, r.height, after && from.port ? after : null);
  const n = addNode(W.cur, t, pos);
  if (from && from.port && (t.inputs || []).length) connect(W.cur, W.types, from.from, from.port, n.id);
  W.pending = null; W.palette = false; W.paletteQuery = "";
  commit(before);
  const pal = ROOT.querySelector && ROOT.querySelector(".wf__palette"); if (pal) pal.remove();
  paintNodes();
  select({ kind: "node", id: n.id }, { focus: true });
}

function deleteSelection() {
  if (!W.sel) return;
  const before = snapshot();
  if (W.sel.kind === "node") removeNodes(W.cur, [W.sel.id]);
  else if (W.sel.kind === "edge") disconnect(W.cur, W.sel.index);
  W.sel = null;
  commit(before); paintNodes(); paintInspector();
}

function duplicateNode() {
  if (!W.sel || W.sel.kind !== "node") return;
  const before = snapshot();
  const [id] = duplicateNodes(W.cur, [W.sel.id]);
  commit(before); paintNodes();
  select({ kind: "node", id }, { focus: true });
}

function setParam(key, el) {
  const n = nodeById(W.sel && W.sel.id); if (!n) return;
  const p = (typeOf(n).params || []).find((x) => x.key === key); if (!p) return;
  if (W.editKey !== `${n.id}.${key}`) { W.hist.push(snapshot()); W.editKey = `${n.id}.${key}`; }
  let v = el.type === "checkbox" ? el.checked : el.value;
  if (p.kind === "number") v = v === "" ? "" : Number(v);
  n.params[key] = v;
  touched(); paintNode(n.id);
  if (n.type === "filter" || p.kind === "select") paintEdges();
}

function setCond(i, part, el) {
  const n = nodeById(W.sel && W.sel.id); if (!n) return;
  const conds = n.params.conditions = n.params.conditions || [];
  if (!conds[i]) return;
  W.hist.push(snapshot());
  conds[i][part] = el.value;
  if (part === "field") {
    const f = W.fields.find((x) => x.key === el.value) || {};
    conds[i].op = f.kind === "number" ? "gte" : f.kind === "bool" ? "is_true" : f.options ? "in" : "contains";
    conds[i].value = "";
  }
  touched(); paintNode(n.id);
  if (part !== "value") paintInspector();
}

function setWorkflow(field, el) {
  const r = W.cur;
  const v = el.type === "checkbox" ? el.checked : el.value;
  if (field === "palette") { W.paletteQuery = v; const list = ROOT.querySelector(".wf__pal-list"); rerenderPalette(list); return; }
  if (field === "active" && !W.isNew && !W.dirty) { setActive(v); return; }
  r[field] = v;
  if (field === "name") { const d = ROOT.querySelector && ROOT.querySelector("[data-draft-name]"); if (d) d.textContent = v || "Untitled"; }
  if (field === "active") { const l = el.closest && el.closest(".switch")?.querySelector(".switch__label"); if (l) l.textContent = v ? "Active" : "Paused"; }
  W.dirty = true; W.status = "";
  const st = $("#wf-status span", ROOT); if (st) st.textContent = statusText()[0];
}

function rerenderPalette(list) {
  if (!list) return;
  const tmp = document.createElement("div");
  W.palette = true; tmp.innerHTML = paletteHtml();
  const fresh = tmp.querySelector(".wf__pal-list");
  if (fresh) list.innerHTML = fresh.innerHTML;
}

async function setActive(on) {
  try {
    const res = await api.post("/api/workflows/flags", { name: W.cur.name, active: !!on });
    if (!res.ok) { toast(res.error || "Couldn't change it.", "err"); W.problems = res.problems || []; paintAll(); return; }
    W.cur.active = res.workflow.active;
    toast(on ? `'${W.cur.name}' is active. Its triggers fire on the scheduler.` : `'${W.cur.name}' is paused.`);
    await loadList(); paintList(); paintBar();
  } catch (e) { fail(e); paintBar(); }
}

/* -------------------------------------------------------------- save/run */
async function save() {
  if (W.saving) return false;
  const r = W.cur;
  if (!r.name || !/^[\w.-]+$/.test(r.name)) {
    toast("Name the workflow with letters, numbers, dashes or dots.", "err");
    ROOT.querySelector && ROOT.querySelector('[data-wf="name"]')?.focus();
    return false;
  }
  W.saving = true; paintBar();
  try {
    const res = await api.post("/api/workflows/save", { workflow: r, create: W.isNew });
    if (!res.ok) {
      W.problems = res.problems || [];
      const first = W.problems.find((p) => p.level === "error");
      toast(first ? first.message : (res.error || "Couldn't save."), "err");
      if (first && first.node && nodeById(first.node)) W.sel = { kind: "node", id: first.node };
      paintNodes(); paintInspector();
      return false;
    }
    toast(`Saved '${r.name}'.`);
    W.isNew = false; W.dirty = false; W.status = "";
    W.cur = res.workflow; W.problems = res.problems || [];
    await loadList();
    render();
    return true;
  } catch (e) { fail(e); return false; }
  finally { W.saving = false; paintBar(); }
}

function log(msg, kind = "") {
  const el = $("#wf-log", ROOT); if (!el || !el.appendChild) return;
  const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const li = document.createElement("li"); li.className = kind;
  li.innerHTML = `<time>${t}</time><span>${msg}</span>`;
  el.appendChild(li); el.scrollTop = el.scrollHeight;
}
const nodeName = (id) => { const n = nodeById(id); return n ? esc(labelOf(n)) : esc(id || "Run"); };

function onRunEvent(ev) {
  if (ev.type === "run") {
    W.runNodes = {}; W.runEdges = {}; W.runId = ev.id; paintNodes();
    log(`<b>Started</b> ${ev.mode === "test" ? "test run, nothing is sent" : ev.live ? "live run" : "run"}`);
  } else if (ev.type === "node") {
    const prev = W.runNodes[ev.id] || {};
    W.runNodes[ev.id] = { ...prev, ...ev };
    const el = nodeEl(ev.id);
    if (el) {
      el.classList.toggle("is-running", ev.status === "running");
      el.classList.toggle("is-done", ev.status === "ok" || ev.status === "disabled");
      el.classList.toggle("is-err", ev.status === "error");
    }
    if (ev.status !== "running") {
      paintNodeRun(ev.id);
      if (ev.status === "error") log(`<b>${nodeName(ev.id)}</b> ${esc(ev.error || "failed")}`, "err");
    } else paintNode(ev.id);
  } else if (ev.type === "progress") {
    W.runNodes[ev.node] = { ...(W.runNodes[ev.node] || {}), status: "running", count: ev.count };
    paintNode(ev.node);
  } else if (ev.type === "edge") {
    const key = `${ev.from}|${ev.from_port}|${ev.to}`;
    W.runEdges[key] = { count: ev.count, live: ev.count > 0 };
    paintEdges();
    setTimeout(() => { if (W.runEdges[key]) { W.runEdges[key].live = false; paintEdges(); } }, 900);
  } else if (ev.type === "phase" || ev.type === "log") {
    log(`<b>${nodeName(ev.node)}</b> ${esc(ev.message)}`);
  } else if (ev.type === "done") {
    const s = ev.summary || {};
    W.status = ev.status === "error" ? "error" : "ok";
    log(`<b>Done</b> ${ev.status === "empty" ? "nothing to do" : `found ${s.found || 0}, drafted ${s.drafted || 0}, ${ev.live ? `sent ${s.sent || 0}` : `previewed ${s.previewed || 0}`}${s.waiting ? `, ${s.waiting} waiting` : ""}`} in ${ev.seconds}s`, ev.status === "error" ? "err" : "ok");
    if (ev.error) log(`<b>Stopped</b> ${esc(ev.error)}`, "err");
  } else if (ev.type === "error") {
    W.status = "error";
    log(`<b>Error</b> ${esc(ev.message)}`, "err");
  }
}

function paintNodeRun(id) {
  const n = nodeById(id); if (!n) return;
  const el = nodeEl(id);
  if (!el) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = nodeHtml(n);
  el.replaceWith(tmp.firstElementChild);
  if (W.sel && W.sel.kind === "node" && W.sel.id === id) paintInspector();
}

async function testRun() {
  if (W.running || W.saving) return;
  if (W.isNew || W.dirty) { if (!(await save())) return; }
  W.running = true; W.status = ""; W.tab = "log";
  paintPanel(); paintBar();
  const logEl = $("#wf-log", ROOT); if (logEl) logEl.innerHTML = "";
  try {
    await api.stream("/api/workflows/run", { name: W.cur.name, mode: "test" }, onRunEvent);
  } catch (e) { log(`<b>Error</b> ${esc(e.message)}`, "err"); W.status = "error"; }
  finally {
    W.running = false;
    $$(".wfn.is-running", ROOT).forEach((el) => el.classList.remove("is-running"));
    for (const k of Object.keys(W.runEdges)) W.runEdges[k].live = false;
    paintEdges();
    await loadRuns();
    paintBar();
    paintRuns();
  }
}

function paintRuns() {
  if (!ROOT || !ROOT.querySelector) return;
  const tmp = typeof document !== "undefined" ? document.createElement("div") : null;
  const list = ROOT.querySelector(".wf__runs"), tab = ROOT.querySelector('[data-tab="runs"]');
  if (!tmp || !list) return;
  tmp.innerHTML = panelHtml();
  list.innerHTML = tmp.querySelector(".wf__runs").innerHTML;
  if (tab) tab.innerHTML = tmp.querySelector('[data-tab="runs"]').innerHTML;
}

async function openRun(id) {
  try {
    const { run } = await api.get("/api/workflows/run", { id });
    W.runId = run.id; W.runNodes = {}; W.runEdges = {};
    for (const r of run.nodes || []) W.runNodes[r.id] = r;
    for (const e of W.cur.edges) {
      const r = W.runNodes[e.from];
      if (r && r.out && r.out[e.from_port] !== undefined && r.status !== "skipped") W.runEdges[`${e.from}|${e.from_port}|${e.to}`] = { count: r.out[e.from_port], live: false };
    }
    W.status = run.status === "error" ? "error" : "ok";
    paintAll(); paintRuns();
  } catch (e) { fail(e); }
}

/* ------------------------------------------------------------- toolbar */
async function newMenu(anchor) {
  let tpls = [];
  try { tpls = (await api.get("/api/workflows/templates")).templates || []; } catch (_) { /* blank only */ }
  menu(anchor, [{ label: "Blank workflow", icon: "plus", value: "" }, { sep: true }, { header: "Start from a template" },
    ...tpls.map((t) => ({ label: t.title, icon: "flow", value: t.key, html: `<span><b>${esc(t.title)}</b><small class="wf__menu-sub">${esc(t.description)}</small></span>` }))],
  (key) => {
    if (W.running || W.saving) return;
    const taken = W.list.map((x) => x.name);
    if (!key) { startDraft(blank()); W.sel = { kind: "node", id: "n2" }; }
    else {
      const t = tpls.find((x) => x.key === key);
      let name = key;
      for (let i = 2; taken.includes(name); i++) name = `${key}-${i}`;
      startDraft({ name, description: t.graph.description || "", active: false, live: false, nodes: t.graph.nodes, edges: t.graph.edges });
    }
    render();
    revalidate();
    setTimeout(() => ROOT.querySelector && ROOT.querySelector('[data-wf="name"]')?.focus(), 30);
  }, { align: "right", width: 320 });
}

function moreMenu(anchor) {
  menu(anchor, [{ label: "Export as JSON", icon: "download", value: "export" }, { label: "Import from JSON", icon: "upload", value: "import" }], async (v) => {
    if (v === "export") {
      if (W.isNew) { toast("Save the workflow first.", "info"); return; }
      const { doc } = await api.get("/api/workflows/export", { name: W.cur.name });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
      a.download = `${W.cur.name}.workflow.json`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } else {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
      inp.addEventListener("change", async () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        try {
          const doc = JSON.parse(await f.text());
          let name = doc.name || "imported";
          for (let i = 2; W.list.some((x) => x.name === name); i++) name = `${doc.name || "imported"}-${i}`;
          const res = await api.post("/api/workflows/import", { doc, name });
          if (!res.ok) { toast(res.error || "That file isn't a valid workflow.", "err"); return; }
          toast(`Imported '${res.workflow.name}' (paused).`);
          await loadList(); await open(res.workflow.name); render();
        } catch (e) { fail(e); }
      });
      inp.click();
    }
  }, { align: "right" });
}

/* -------------------------------------------------------------- events */
async function onClick(e) {
  const a = e.target.closest("[data-act]");
  if (!a || !ROOT.contains(a)) return;
  const act = a.dataset.act;
  if (act === "open") {
    if (W.running || W.saving) return;
    try { await open(a.dataset.name); render(); } catch (err) { fail(err); }
  } else if (act === "new") {
    if (W.running || W.saving) return;
    await newMenu(a);
  } else if (act === "duplicate") {
    if (W.running || W.saving || !W.cur) return;
    startDraft(duplicateWorkflow(W.cur, W.list.map((x) => x.name)));
    render();
    setTimeout(() => ROOT.querySelector && ROOT.querySelector('[data-wf="name"]')?.focus(), 30);
  } else if (act === "save") save();
  else if (act === "test") testRun();
  else if (act === "undo") undo();
  else if (act === "redo") redo();
  else if (act === "more") moreMenu(a);
  else if (act === "delete") {
    const name = W.cur && W.cur.name; if (!name || W.isNew) return;
    if (a.dataset.armed !== "1") {
      a.dataset.armed = "1"; a.classList && a.classList.remove("btn--icon");
      const s = a.querySelector && a.querySelector("span"); if (s) s.textContent = "Click again to delete";
      setTimeout(() => { if (a.isConnected) { a.dataset.armed = ""; a.classList.add("btn--icon"); const s2 = a.querySelector("span"); if (s2) s2.textContent = ""; } }, 3000);
      return;
    }
    try {
      await api.post("/api/workflows/delete", { name });
      toast(`Deleted '${name}'.`);
      await loadList();
      if (W.list.length) await open(W.list[0].name); else startDraft(blank());
      render();
    } catch (err) { fail(err); }
  } else if (act === "select") select({ kind: "node", id: a.dataset.node }, { focus: true });
  else if (act === "edge") { e.stopPropagation(); select({ kind: "edge", index: +a.dataset.i }); }
  else if (act === "palette") { W.palette = !W.palette; W.pending = null; repaintCanvasOverlay(); }
  else if (act === "palette-close") { W.palette = false; W.pending = null; repaintCanvasOverlay(); }
  else if (act === "add-node") addOfType(a.dataset.type);
  else if (act === "zoom-in" || act === "zoom-out") {
    const r = canvasRect();
    W.view = zoomAt(W.view, act === "zoom-in" ? 1.2 : 1 / 1.2, r.width / 2, r.height / 2); applyView();
  } else if (act === "fit") fit();
  else if (act === "sched") {
    const inp = ROOT.querySelector(`[data-p="${String(a.dataset.key).replace(/[^\w-]/g, "")}"]`);
    if (inp) { inp.value = a.dataset.v; setParam(a.dataset.key, inp); }
  } else if (act === "cond-add") {
    const n = nodeById(W.sel && W.sel.id); if (!n) return;
    W.hist.push(snapshot());
    (n.params.conditions = n.params.conditions || []).push({ field: "tier", op: "is", value: "safe" });
    touched(); paintNode(n.id); paintInspector();
  } else if (act === "cond-rm") {
    const n = nodeById(W.sel && W.sel.id); if (!n) return;
    W.hist.push(snapshot());
    n.params.conditions.splice(+a.dataset.i, 1);
    touched(); paintNode(n.id); paintInspector();
  } else if (act === "unlink") {
    const before = snapshot(); disconnect(W.cur, +a.dataset.i); commit(before); paintEdges(); paintInspector();
  } else if (act === "dup-node") duplicateNode();
  else if (act === "rm-node") deleteSelection();
  else if (act === "tab") {
    W.tab = a.dataset.tab;
    const log = $("#wf-log", ROOT), runs = ROOT.querySelector(".wf__runs");
    if (log) log.hidden = W.tab !== "log"; if (runs) runs.hidden = W.tab !== "runs";
    $$(".wf__tab", ROOT).forEach((t) => { t.classList.toggle("is-on", t === a); t.setAttribute("aria-selected", String(t === a)); });
  } else if (act === "run-open") openRun(+a.dataset.id);
}

function repaintCanvasOverlay() {
  const c = $("#wf-canvas", ROOT); if (!c) return;
  c.querySelector(".wf__palette")?.remove();
  const btn = c.querySelector('[data-act="palette"]'); if (btn) btn.setAttribute("aria-expanded", String(W.palette));
  if (W.palette) {
    c.insertAdjacentHTML("beforeend", paletteHtml());
    setTimeout(() => c.querySelector('[data-wf="palette"]')?.focus(), 10);
  }
}

function onInput(e) {
  const el = e.target;
  if (!W.cur) return;
  if (el.dataset.p !== undefined) setParam(el.dataset.p, el);
  else if (el.dataset.cond !== undefined) { if (el.tagName === "INPUT") setCond(+el.dataset.cond, el.dataset.part, el); }
  else if (el.dataset.nodeattr) {
    const n = nodeById(W.sel && W.sel.id); if (!n) return;
    if (W.editKey !== `${n.id}.@${el.dataset.nodeattr}`) { W.hist.push(snapshot()); W.editKey = `${n.id}.@${el.dataset.nodeattr}`; }
    if (el.value) n[el.dataset.nodeattr] = el.value; else delete n[el.dataset.nodeattr];
    touched(); paintNode(n.id);
  } else if (el.dataset.wf && el.type !== "checkbox" && el.tagName !== "SELECT") setWorkflow(el.dataset.wf, el);
}
function onChange(e) {
  const el = e.target;
  if (!W.cur) return;
  if (el.tagName === "SELECT" || el.type === "checkbox") {
    if (el.dataset.p !== undefined) setParam(el.dataset.p, el);
    else if (el.dataset.cond !== undefined) setCond(+el.dataset.cond, el.dataset.part, el);
    else if (el.dataset.nodeattr) { const n = nodeById(W.sel && W.sel.id); if (n) { W.hist.push(snapshot()); n[el.dataset.nodeattr] = el.value; touched(); } }
    else if (el.dataset.link) {
      const n = nodeById(W.sel && W.sel.id); if (!n || !el.value) return;
      const before = snapshot();
      const why = connect(W.cur, W.types, n.id, el.dataset.link, el.value);
      if (why) { toast(why, "err"); return; }
      commit(before); paintEdges(); paintInspector();
    } else if (el.dataset.wf) setWorkflow(el.dataset.wf, el);
  }
}

/* Pointer: drag nodes, draw connections, pan. */
function worldPoint(e) {
  const r = canvasRect();
  return { x: (e.clientX - r.left - W.view.x) / W.view.k, y: (e.clientY - r.top - W.view.y) / W.view.k };
}
let drag = null;
function onPointerDown(e) {
  const canvas = e.target.closest && e.target.closest("#wf-canvas");
  if (!canvas || (e.button !== 0 && e.button !== 1)) return;
  if (e.target.closest(".wf__overlay, .wf__palette")) return;
  const port = e.target.closest("[data-port-out]");
  const nodeEl = e.target.closest(".wfn");
  const onEdge = e.target.closest(".wf-hit");
  if (W.space || e.button === 1 || (!nodeEl && !onEdge)) {
    drag = { kind: "pan", x: e.clientX, y: e.clientY, view: { ...W.view }, moved: false };
    canvas.classList.add("is-panning");
  } else if (port && nodeEl) {
    const n = nodeById(nodeEl.dataset.node);
    drag = { kind: "link", from: n.id, port: port.dataset.portOut, start: portPos(n, typeOf(n), "out", port.dataset.portOut) };
    e.preventDefault();
  } else if (nodeEl) {
    const n = nodeById(nodeEl.dataset.node);
    if (!W.sel || W.sel.id !== n.id) select({ kind: "node", id: n.id });
    drag = { kind: "move", id: n.id, el: nodeEl, x: e.clientX, y: e.clientY, pos: { ...n.position }, before: snapshot(), moved: false };
  } else return;
  canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
}
function onPointerMove(e) {
  if (!drag) return;
  if (drag.kind === "pan") {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    W.view = { ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy }; applyView();
  } else if (drag.kind === "move") {
    const dx = (e.clientX - drag.x) / W.view.k, dy = (e.clientY - drag.y) / W.view.k;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    drag.moved = true;
    const n = nodeById(drag.id);
    n.position = { x: Math.round((drag.pos.x + dx) / 8) * 8, y: Math.round((drag.pos.y + dy) / 8) * 8 };
    drag.el.style.left = `${n.position.x}px`; drag.el.style.top = `${n.position.y}px`;
    drag.el.classList.add("is-drag");
    paintEdges();
  } else if (drag.kind === "link") {
    const p = worldPoint(e);
    const tmp = $("#wf-temp", ROOT); if (tmp) tmp.setAttribute("d", edgePath(drag.start, p));
    $$(".wfn.is-target", ROOT).forEach((x) => x.classList.remove("is-target"));
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const target = over && over.closest && over.closest(".wfn");
    if (target && !connectProblem(W.cur, W.types, drag.from, drag.port, target.dataset.node)) target.classList.add("is-target");
  }
}
function onPointerUp(e) {
  if (!drag) return;
  const d = drag; drag = null;
  const canvas = $("#wf-canvas", ROOT); canvas && canvas.classList.remove("is-panning");
  if (d.kind === "pan" && !d.moved && W.sel) select(null);
  else if (d.kind === "move") {
    d.el.classList.remove("is-drag");
    if (d.moved) { commit(d.before); paintNodes(); }
  } else if (d.kind === "link") {
    const tmp = $("#wf-temp", ROOT); if (tmp) tmp.setAttribute("d", "");
    $$(".wfn.is-target", ROOT).forEach((x) => x.classList.remove("is-target"));
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const target = over && over.closest && over.closest(".wfn");
    if (target && target.dataset.node !== d.from) {
      const before = snapshot();
      const why = connect(W.cur, W.types, d.from, d.port, target.dataset.node);
      if (why) toast(why, "info"); else { commit(before); paintEdges(); paintInspector(); }
    } else if (!target) {
      // Dropped on empty canvas: pick the next node from the palette.
      W.pending = { from: d.from, port: d.port }; W.palette = true; repaintCanvasOverlay();
    }
  }
}
function onWheel(e) {
  if (!e.target.closest || !e.target.closest("#wf-canvas") || e.target.closest(".wf__palette")) return;
  e.preventDefault();
  const r = canvasRect();
  if (e.ctrlKey || e.metaKey) W.view = zoomAt(W.view, Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  else W.view = { ...W.view, x: W.view.x - e.deltaX, y: W.view.y - e.deltaY };
  applyView();
}
function onDragStart(e) {
  const it = e.target.closest && e.target.closest(".wf__pal-item");
  if (it && e.dataTransfer) { e.dataTransfer.setData("text/x-openleads-node", it.dataset.type); e.dataTransfer.effectAllowed = "copy"; }
}
function onDragOver(e) {
  if (e.target.closest && e.target.closest("#wf-canvas") && e.dataTransfer && [...(e.dataTransfer.types || [])].includes("text/x-openleads-node")) e.preventDefault();
}
function onDrop(e) {
  const type = e.dataTransfer && e.dataTransfer.getData("text/x-openleads-node");
  if (!type || !e.target.closest("#wf-canvas")) return;
  e.preventDefault();
  const p = worldPoint(e);
  W.pending = null;
  addOfType(type, { x: Math.round((p.x - NODE_W / 2) / 8) * 8, y: Math.round((p.y - 32) / 8) * 8 });
}
function onFocusIn(e) {
  const n = e.target.closest && e.target.closest(".wfn");
  if (n && (!W.sel || W.sel.id !== n.dataset.node)) select({ kind: "node", id: n.dataset.node });
}

function onKey(e) {
  if (!ROOT || !ROOT.isConnected || !W.cur) return;
  if (document.querySelector(".modal-wrap, .drawer, .menu, .palette")) return;   // dialogs own the keys
  if (window.matchMedia && window.matchMedia("(max-width: 820px)").matches) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key;
  const inText = typing(e.target);
  if (mod && (k === "s" || k === "S")) { e.preventDefault(); save(); return; }
  if (inText) { if (e.key === "Escape" && W.palette) { W.palette = false; repaintCanvasOverlay(); } return; }
  if (mod && (k === "z" || k === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && (k === "y" || k === "Y")) { e.preventDefault(); redo(); return; }
  if (mod && (k === "d" || k === "D")) { e.preventDefault(); duplicateNode(); return; }
  if (mod || e.altKey) return;
  const inCanvas = e.target === document.body || (e.target.closest && e.target.closest("#wf-canvas"));
  if ((k === "Delete" || k === "Backspace") && W.sel) { e.preventDefault(); deleteSelection(); }
  else if (k === " " && inCanvas) { e.preventDefault(); if (!W.space) { W.space = true; $("#wf-canvas", ROOT)?.classList.add("is-pan"); } }
  else if (k === "a" || k === "A") { e.preventDefault(); W.palette = true; W.pending = null; repaintCanvasOverlay(); }
  else if (k === "Escape") { if (W.palette) { W.palette = false; repaintCanvasOverlay(); } else if (W.sel) select(null); }
  else if (k === "Enter" && e.target.closest && e.target.closest(".wfn")) { e.preventDefault(); $("#wf-insp", ROOT)?.querySelector("input, textarea, select")?.focus(); }
  else if (k.startsWith("Arrow") && W.sel && W.sel.kind === "node" && inCanvas) {
    e.preventDefault();
    const n = nodeById(W.sel.id), step = e.shiftKey ? 40 : 8;
    if (W.editKey !== `${n.id}.@pos`) { W.hist.push(snapshot()); W.editKey = `${n.id}.@pos`; }
    n.position = { x: n.position.x + (k === "ArrowRight" ? step : k === "ArrowLeft" ? -step : 0),
      y: n.position.y + (k === "ArrowDown" ? step : k === "ArrowUp" ? -step : 0) };
    const el = nodeEl(n.id);
    if (el) { el.style.left = `${n.position.x}px`; el.style.top = `${n.position.y}px`; }
    touched(); paintEdges();
  } else if ((k === "+" || k === "=") && inCanvas) { const r = canvasRect(); W.view = zoomAt(W.view, 1.2, r.width / 2, r.height / 2); applyView(); }
  else if (k === "-" && inCanvas) { const r = canvasRect(); W.view = zoomAt(W.view, 1 / 1.2, r.width / 2, r.height / 2); applyView(); }
  else if (k === "0" && inCanvas) fit();
}
function onKeyUp(e) {
  if (e.key === " " && W.space) { W.space = false; $("#wf-canvas", ROOT)?.classList.remove("is-pan"); }
}
function onPaletteKey(e) {
  const inp = e.target.closest && e.target.closest('[data-wf="palette"]');
  if (inp && e.key === "Enter") {
    e.preventDefault();
    const first = ROOT.querySelector(".wf__pal-item"); if (first) addOfType(first.dataset.type);
  }
}

function on(target, type, fn, opts) {
  if (!target || !target.addEventListener) return;
  target.addEventListener(type, fn, opts);
  listeners.push([target, type, fn, opts]);
}

router.register("workflows", {
  title: "Workflows",
  async mount(root, ctx) {
    ROOT = root;
    try { await loadCatalog(); } catch (e) { root.innerHTML = `<div class="page">${ui.empty("flow", "Workflows couldn't load", esc(e.message))}</div>`; return; }
    await loadList();
    const want = (ctx && ctx.id) || (W.cur && !W.isNew ? W.cur.name : "");
    if (W.cur && W.isNew) { /* keep the open draft */ }
    else if (want && W.list.some((x) => x.name === want)) await open(want);
    else if (W.list.length) await open(W.list[0].name);
    else startDraft(blank());
    render();
    on(root, "click", onClick);
    on(root, "input", onInput);
    on(root, "change", onChange);
    on(root, "pointerdown", onPointerDown);
    on(root, "pointermove", onPointerMove);
    on(root, "pointerup", onPointerUp);
    on(root, "pointercancel", onPointerUp);
    on(root, "wheel", onWheel, { passive: false });
    on(root, "dragstart", onDragStart);
    on(root, "dragover", onDragOver);
    on(root, "drop", onDrop);
    on(root, "focusin", onFocusIn);
    on(root, "keydown", onPaletteKey);
    if (typeof document !== "undefined") { on(document, "keydown", onKey); on(document, "keyup", onKeyUp); }
    if (typeof window !== "undefined") on(window, "resize", () => applyView());
  },
  unmount() {
    for (const [t, type, fn, opts] of listeners.splice(0)) t.removeEventListener(type, fn, opts);
    ROOT = null; drag = null; W.space = false; W.palette = false;
  },
});

export { W as _state };
