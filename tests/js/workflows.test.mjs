// The workflow editor: pure graph helpers (flowgraph.js) and the view's save /
// duplicate / test-run flow against a tiny DOM and API boundary.
// Run with: node --experimental-vm-modules --test tests/js/*.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import * as fg from "../../openleads/web/static/js/flowgraph.js";

const viewSource = await readFile(new URL("../../openleads/web/static/js/views/workflows.js", import.meta.url), "utf8");
const graphSource = await readFile(new URL("../../openleads/web/static/js/flowgraph.js", import.meta.url), "utf8");
const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));

const TYPES = {
  "trigger.manual": { type: "trigger.manual", label: "Manual", group: "Triggers", icon: "hand", doc: "", params: [], inputs: [], outputs: ["out"], trigger: true },
  find: { type: "find", label: "Find leads", group: "Leads", icon: "find", doc: "", inputs: ["in"], outputs: ["out"],
    params: [{ key: "query", label: "Audience", kind: "text", default: "" }, { key: "count", label: "Leads", kind: "number", default: 25 }] },
  filter: { type: "filter", label: "Filter (if)", group: "Logic", icon: "filter", doc: "", inputs: ["in"], outputs: ["true", "false"], params: [] },
  tag: { type: "tag", label: "Tag", group: "Workspace", icon: "tag", doc: "", inputs: ["in"], outputs: ["out"],
    params: [{ key: "tags", label: "Tags", kind: "text", default: "" }] },
};

const wf = (name = "wf-a") => ({
  name, description: "Example", active: true, live: false, kind: "workflow",
  created_at: "2026-01-01T00:00:00", updated_at: "2026-01-02T00:00:00", last_run_at: "2026-01-02T08:30:00",
  nodes: [
    { id: "t", type: "trigger.manual", params: {}, position: { x: 0, y: 0 }, on_error: "stop" },
    { id: "f", type: "find", params: { query: "fictional businesses in Testville", count: 12 }, position: { x: 260, y: 0 }, on_error: "stop" },
    { id: "g", type: "tag", params: { tags: "hot" }, position: { x: 520, y: 0 }, on_error: "stop" },
  ],
  edges: [{ from: "t", from_port: "out", to: "f" }, { from: "f", from_port: "out", to: "g" }],
});

/* ------------------------------------------------------------ flowgraph */
test("connect refuses loops, trigger inputs, missing ports and duplicates", () => {
  const g = clone(wf());
  assert.equal(fg.connect(g, TYPES, "g", "out", "f"), "That would make a loop.");
  assert.equal(fg.connect(g, TYPES, "f", "out", "t"), "Triggers start a workflow; they have no input.");
  assert.equal(fg.connect(g, TYPES, "f", "nope", "g"), "That output doesn't exist.");
  assert.equal(fg.connect(g, TYPES, "f", "out", "g"), "Already connected.");
  assert.equal(fg.connect(g, TYPES, "f", "out", "f"), "A node can't connect to itself.");
  const n = fg.addNode(g, TYPES.filter, { x: 100.4, y: 50 });
  assert.equal(n.id, "n4");
  assert.equal(fg.connect(g, TYPES, "f", "out", n.id), "");
  assert.equal(g.edges.length, 3);
});

test("remove and duplicate nodes keep edges consistent", () => {
  const g = clone(wf());
  const ids = fg.duplicateNodes(g, ["f", "g"]);
  assert.equal(ids.length, 2);
  assert.deepEqual(g.edges.at(-1), { from: ids[0], from_port: "out", to: ids[1] });   // internal edge copied
  assert.equal(g.nodes.find((n) => n.id === ids[0]).position.x, 300);
  fg.removeNodes(g, ["f"]);
  assert.ok(g.edges.every((e) => e.from !== "f" && e.to !== "f"));
  assert.deepEqual(fg.topoOrder(clone(wf())), ["t", "f", "g"]);
});

test("ports, paths and fit-to-view are geometric and stable", () => {
  const n = { position: { x: 10, y: 20 } };
  assert.equal(fg.nodeHeight(TYPES.filter), Math.max(64, 26 + 2 * fg.PORT_GAP));
  assert.deepEqual(fg.portPos(n, TYPES.find, "in"), { x: 10, y: 52 });
  const t = fg.portPos(n, TYPES.filter, "out", "true"), f = fg.portPos(n, TYPES.filter, "out", "false");
  assert.equal(t.x, 10 + fg.NODE_W);
  assert.equal(f.y - t.y, fg.PORT_GAP);
  assert.match(fg.edgePath({ x: 0, y: 0 }, { x: 100, y: 0 }), /^M0 0 C50 0, 50 0, 100 0$/);
  const v = fg.fitView(clone(wf()), TYPES, 1000, 500);
  assert.ok(v.k >= 0.6 && v.k <= 1.1);
  const z = fg.zoomAt({ x: 0, y: 0, k: 1 }, 2, 100, 100);
  assert.deepEqual(z, { k: 2, x: -100, y: -100 });
});

test("history undoes and redoes snapshots", () => {
  const h = new fg.History();
  h.push({ v: 1 }); h.push({ v: 1 });          // identical snapshots collapse
  assert.equal(h.past.length, 1);
  assert.deepEqual(h.undo({ v: 2 }), { v: 1 });
  assert.deepEqual(h.redo({ v: 1 }), { v: 2 });
  assert.equal(h.canRedo, false);
});

test("copy names and duplicated workflows", () => {
  assert.equal(fg.copyName("a", ["a", "a-copy", "a-copy-2"]), "a-copy-3");
  assert.equal(fg.copyName("", []), "workflow-copy");
  const original = wf();
  const copy = fg.duplicateWorkflow(original, ["wf-a"]);
  assert.equal(copy.name, "wf-a-copy");
  for (const k of ["created_at", "updated_at", "last_run_at", "kind"]) assert.equal(k in copy, false);
  copy.nodes[1].params.query = "changed";
  assert.equal(original.nodes[1].params.query, "fictional businesses in Testville");
});

/* ----------------------------------------------------------------- view */
function stub() {
  return { innerHTML: "", style: {}, hidden: false, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, querySelector: () => null, appendChild() {}, focus() {} };
}

async function view(saved = [wf()]) {
  const store = new Map(saved.map((w) => [w.name, clone(w)]));
  const requests = [], errors = [], listeners = {};
  let registration, html = "", ids = new Map(), saveError = false, pendingSave, pendingRun, mod;
  const root = {
    contains: () => true, isConnected: true,
    addEventListener: (name, handler) => { listeners[name] = handler; },
    removeEventListener() {},
    querySelector: (sel) => (sel.startsWith("#") ? ids.get(sel) || null : null),
    set innerHTML(value) {
      html = value; ids = new Map();
      for (const m of value.matchAll(/\bid="([^"]+)"/g)) ids.set(`#${m[1]}`, stub());
    },
    get innerHTML() { return html; },
  };
  const api = {
    async get(path, params) {
      requests.push({ method: "GET", path, params: clone(params || {}) });
      if (path === "/api/workflows/catalog") {
        return { nodes: Object.values(TYPES), groups: ["Triggers", "Leads", "Logic", "Workspace"], fields: [], ops: [], options: {} };
      }
      if (path === "/api/workflows") return { workflows: [...store.values()].map((w) => ({ name: w.name, active: w.active, when: "manual", kind: "workflow" })) };
      if (path === "/api/workflows/get") return { workflow: clone(store.get(params.name)), problems: [], waiting: {} };
      if (path === "/api/workflows/runs") return { runs: [] };
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path, body) {
      requests.push({ method: "POST", path, body: clone(body) });
      if (path === "/api/workflows/validate") return { problems: [] };
      assert.equal(path, "/api/workflows/save");
      if (pendingSave) await pendingSave;
      if (saveError) throw new Error("Fake save failure");
      store.set(body.workflow.name, clone(body.workflow));
      return { ok: true, workflow: { ...clone(body.workflow), kind: "workflow" }, problems: [] };
    },
    async stream(path, body) {
      requests.push({ method: "STREAM", path, body: clone(body) });
      assert.equal(path, "/api/workflows/run");
      if (pendingRun) await pendingRun;
    },
  };
  const core = {
    $: (selector, parent) => parent.querySelector(selector), $$: () => [], api,
    esc: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    fail: (error) => errors.push(error.message), ico: () => "", toast() {}, menu() {},
    ui: { mark: () => "", empty: () => "" },
    router: { register(name, hooks) { assert.equal(name, "workflows"); registration = hooks; } },
  };
  const context = vm.createContext({ setTimeout: (fn) => fn(), clearTimeout() {} });
  const coreModule = new vm.SyntheticModule(Object.keys(core), function () {
    for (const [key, value] of Object.entries(core)) this.setExport(key, value);
  }, { context });
  const graphModule = new vm.SourceTextModule(graphSource, { context });
  await graphModule.link(() => { throw new Error("flowgraph has no imports"); });
  mod = new vm.SourceTextModule(viewSource, { context });
  await mod.link((specifier) => {
    if (specifier === "../core.js") return coreModule;
    assert.equal(specifier, "../flowgraph.js");
    return graphModule;
  });
  await mod.evaluate();
  await registration.mount(root, { id: "" });
  await settle();
  return {
    root, store, requests, errors, state: mod.namespace._state,
    writes: () => requests.filter((r) => r.method !== "GET" && r.path !== "/api/workflows/validate"),
    failSave: () => { saveError = true; },
    allowSave: () => { saveError = false; },
    holdSave: () => { let resolve; pendingSave = new Promise((r) => { resolve = r; }); return () => { pendingSave = null; resolve(); }; },
    holdRun: () => { let resolve; pendingRun = new Promise((r) => { resolve = r; }); return () => { pendingRun = null; resolve(); }; },
    async click(act, data = {}) {
      await listeners.click({ target: { closest: () => ({ dataset: { act, ...data } }) } });
      await settle();
    },
    name() { return html.match(/data-wf="name" value="([^"]*)"/)?.[1]; },
  };
}

test("Duplicate opens the current edits as an unsaved deep copy without requests", async () => {
  const v = await view();
  assert.match(v.root.innerHTML, /data-act="delete"/);
  v.state.cur.nodes[1].params.query = "fictional businesses in New Testville";
  const before = v.requests.length;
  await v.click("duplicate");
  assert.equal(v.requests.length, before);
  assert.equal(v.name(), "wf-a-copy");
  assert.match(v.root.innerHTML, /not saved/);
  assert.match(v.root.innerHTML, /Unsaved changes/);
  assert.doesNotMatch(v.root.innerHTML, /data-act="delete"/);
  v.state.cur.nodes[2].params.tags = "copy-only";
  assert.deepEqual(v.store.get("wf-a"), wf());
  await v.click("save");
  const [req] = v.writes();
  assert.equal(req.path, "/api/workflows/save");
  assert.equal(req.body.create, true);
  assert.equal(req.body.workflow.name, "wf-a-copy");
  assert.equal(req.body.workflow.nodes[1].params.query, "fictional businesses in New Testville");
  assert.equal(req.body.workflow.nodes[2].params.tags, "copy-only");
  for (const k of ["created_at", "updated_at", "last_run_at", "kind"]) assert.equal(k in req.body.workflow, false);
  assert.deepEqual(v.store.get("wf-a"), wf());
  assert.equal(v.state.isNew, false);
  assert.equal(v.state.dirty, false);
});

test("Copy names avoid collisions and repeated duplicates stay independent", async () => {
  const originals = [wf(), wf("wf-a-copy"), wf("wf-a-copy-2")];
  const v = await view(originals);
  await v.click("open", { name: "wf-a" });
  await v.click("duplicate");
  assert.equal(v.name(), "wf-a-copy-3");
  await v.click("duplicate");
  assert.equal(v.name(), "wf-a-copy-3-copy");
  assert.equal(v.writes().length, 0);
  for (const o of originals) assert.deepEqual(v.store.get(o.name), o);
});

test("An untitled workflow can be copied without saving or running", async () => {
  const v = await view([]);
  assert.equal(v.state.isNew, true);
  await v.click("duplicate");
  assert.equal(v.name(), "workflow-copy");
  await v.click("duplicate");
  assert.equal(v.name(), "workflow-copy-copy");
  assert.equal(v.writes().length, 0);
});

test("Failed saves keep the copy editable and never run it; retry saves only the copy", async () => {
  const v = await view();
  await v.click("duplicate");
  v.failSave();
  await v.click("save");
  assert.equal(v.name(), "wf-a-copy");
  assert.equal(v.state.isNew, true);
  assert.deepEqual(v.errors, ["Fake save failure"]);
  await v.click("test");
  assert.equal(v.requests.some((r) => r.method === "STREAM"), false);
  v.allowSave();
  await v.click("save");
  assert.equal(v.store.size, 2);
  assert.deepEqual(v.store.get("wf-a"), wf());
  assert.equal(v.requests.some((r) => r.method === "STREAM"), false);
});

test("Test run saves the copy first and test-runs that name only", async () => {
  const v = await view();
  await v.click("duplicate");
  await v.click("test");
  assert.deepEqual(v.writes().map((r) => [r.method, r.path, r.body.workflow?.name || r.body.name]), [
    ["POST", "/api/workflows/save", "wf-a-copy"],
    ["STREAM", "/api/workflows/run", "wf-a-copy"],
  ]);
  assert.equal(v.writes().at(-1).body.mode, "test");
  assert.deepEqual(v.store.get("wf-a"), wf());
});

test("Nothing can replace the draft while a save or run is pending", async () => {
  const v = await view();
  await v.click("duplicate");
  const finishSave = v.holdSave();
  const saving = v.click("save");
  await settle();
  assert.match(v.root.querySelector("#wf-bar").innerHTML, /data-act="duplicate" disabled/);
  assert.match(v.root.querySelector("#wf-bar").innerHTML, /data-act="save" disabled/);
  await v.click("save");
  await v.click("test");
  await v.click("duplicate");
  assert.equal(v.writes().length, 1);
  assert.equal(v.name(), "wf-a-copy");
  finishSave(); await saving; await settle();
  assert.equal(v.state.saving, false);
  const finishRun = v.holdRun();
  const running = v.click("test");
  await settle();
  assert.equal(v.state.running, true);
  await v.click("duplicate");
  assert.equal(v.state.isNew, false);
  assert.equal(v.state.cur.name, "wf-a-copy");
  finishRun(); await running; await settle();
  assert.equal(v.state.running, false);
  await v.click("duplicate");
  assert.equal(v.name(), "wf-a-copy-copy");
});
