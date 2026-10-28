// Exercise the real view and its event handlers with a tiny DOM/API boundary.
// Run with: node --experimental-vm-modules --test tests/js/*.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../openleads/web/static/js/views/workflows.js", import.meta.url), "utf8");
const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const recipe = (name = "test-city") => ({
  name, query: "fictional businesses in Testville", count: 12, enabled: true,
  schedule: "daily 08:30", context: "Example offer", verified_only: false,
  send: false, sequence: true,
  export: { sink: "webhook", target: "https://example.test/leads", options: { fields: ["name"] } },
  created_at: "2026-01-01T00:00:00", last_run: "2026-01-02", last_run_at: "2026-01-02T08:30:00",
  when: "daily 08:30",
});

async function view(recipes = [recipe()]) {
  const saved = new Map(recipes.map((r) => [r.name, clone(r)]));
  const requests = [], errors = [], listeners = {}, elements = new Map();
  let registration, html = "", saveError = false, pendingSave, pendingRun;
  const root = {
    contains: () => true,
    addEventListener: (name, handler) => { listeners[name] = handler; },
    querySelector: (selector) => elements.get(selector) || null,
    set innerHTML(value) {
      html = value;
      elements.clear();
      for (const match of value.matchAll(/<button\b[^>]*data-act="([^"]+)"[^>]*>/g)) {
        const attrs = new Set(/\bdisabled\b/.test(match[0]) ? ["disabled"] : []);
        elements.set(`[data-act="${match[1]}"]`, {
          setAttribute: (name) => attrs.add(name), removeAttribute: (name) => attrs.delete(name),
          hasAttribute: (name) => attrs.has(name),
        });
      }
      elements.set("#wf-insp", { innerHTML: "" });
      elements.set('[data-wf="name"]', { focus() {} });
    },
    get innerHTML() { return html; },
  };
  const api = {
    async get(path) {
      requests.push({ method: "GET", path });
      assert.equal(path, "/api/recipes");
      return { recipes: [...saved.values()] };
    },
    async post(path, body) {
      requests.push({ method: "POST", path, body: clone(body) });
      assert.equal(path, "/api/recipes/save");
      if (pendingSave) await pendingSave;
      if (saveError) throw new Error("Fake save failure");
      saved.set(body.name, clone(body));
      return { recipe: clone(body) };
    },
    async stream(path, body) {
      requests.push({ method: "STREAM", path, body: clone(body) });
      assert.equal(path, "/api/recipes/run");
      if (pendingRun) await pendingRun;
    },
  };
  const core = {
    $: (selector, parent) => parent.querySelector(selector), $$: () => [], api,
    esc: (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    fail: (error) => errors.push(error.message), ico: () => "", toast() {},
    router: { register(name, hooks) { assert.equal(name, "workflows"); registration = hooks; } },
  };
  const context = vm.createContext({ setTimeout: (fn) => fn() });
  const dependency = new vm.SyntheticModule(Object.keys(core), function () {
    for (const [key, value] of Object.entries(core)) this.setExport(key, value);
  }, { context });
  const module = new vm.SourceTextModule(source, { context });
  await module.link((specifier) => { assert.equal(specifier, "../core.js"); return dependency; });
  await module.evaluate();
  await registration.mount(root);
  return {
    root, saved, requests, errors,
    failSave: () => { saveError = true; },
    allowSave: () => { saveError = false; },
    holdSave: () => { let resolve; pendingSave = new Promise((r) => { resolve = r; }); return resolve; },
    holdRun: () => { let resolve; pendingRun = new Promise((r) => { resolve = r; }); return resolve; },
    async click(act, data = {}) {
      await listeners.click({ target: { closest: () => ({ dataset: { act, ...data } }) } });
      await settle();
    },
    edit(field, value) {
      const el = { dataset: { wf: field }, value, type: typeof value === "boolean" ? "checkbox" : "text", checked: value };
      listeners.input({ target: { closest: () => el } });
    },
    name() { return html.match(/data-wf="name" value="([^"]*)"/)?.[1]; },
  };
}

test("Duplicate opens the current edits as an unsaved deep copy without requests", async () => {
  const v = await view();
  assert.match(v.root.innerHTML, /data-act="delete"[\s\S]*data-act="duplicate"/);
  v.edit("query", "fictional businesses in New Testville");
  v.edit("target", "https://example.test/edited");
  await v.click("duplicate");
  assert.equal(v.name(), "test-city-copy");
  assert.match(v.root.innerHTML, /not saved/);
  assert.match(v.root.innerHTML, /Unsaved changes/);
  assert.doesNotMatch(v.root.innerHTML, /data-act="delete"/);
  assert.deepEqual(v.requests, [{ method: "GET", path: "/api/recipes" }]);
  v.edit("target", "https://example.test/copy");
  assert.deepEqual(v.saved.get("test-city"), recipe());
  await v.click("save");
  const expected = { ...recipe(), name: "test-city-copy", query: "fictional businesses in New Testville" };
  expected.export.target = "https://example.test/copy";
  for (const key of ["created_at", "last_run", "last_run_at", "when"]) delete expected[key];
  assert.deepEqual(v.saved.get("test-city-copy"), expected);
  assert.deepEqual(v.saved.get("test-city"), recipe());
  assert.deepEqual(v.requests.filter((r) => r.method !== "GET"), [
    { method: "POST", path: "/api/recipes/save", body: expected },
  ]);
  // Reopening and editing the copy also leaves its saved nested state untouched.
  await v.click("open", { name: "test-city-copy" });
  v.edit("target", "https://example.test/not-saved");
  assert.deepEqual(v.saved.get("test-city-copy"), expected);
  await v.click("open", { name: "test-city" });
  await v.click("save");
  assert.deepEqual(v.saved.get("test-city"), recipe());
});

test("Copy names avoid collisions and repeated duplicates stay independent", async () => {
  const originals = [recipe(), recipe("test-city-copy"), recipe("test-city-copy-2")];
  const v = await view(originals);
  await v.click("duplicate");
  assert.equal(v.name(), "test-city-copy-3");
  await v.click("save");
  await v.click("open", { name: "test-city" });
  await v.click("duplicate");
  assert.equal(v.name(), "test-city-copy-4");
  await v.click("duplicate");
  assert.equal(v.name(), "test-city-copy-4-copy");
  assert.equal(v.requests.filter((r) => r.method === "POST").length, 1);
  for (const original of originals) assert.deepEqual(v.saved.get(original.name), original);
});

test("An untitled workflow can be copied without saving or running", async () => {
  const v = await view([]);
  await v.click("duplicate");
  assert.equal(v.name(), "workflow-copy");
  await v.click("duplicate");
  assert.equal(v.name(), "workflow-copy-copy");
  assert.equal(v.requests.length, 1);
  assert.equal(v.saved.size, 0);
});

test("Failed saves keep the copy editable and never run it; retry saves only the copy", async () => {
  const v = await view();
  await v.click("duplicate");
  v.edit("target", "https://example.test/retry");
  v.failSave();
  await v.click("save");
  assert.equal(v.name(), "test-city-copy");
  assert.match(v.root.innerHTML, /Unsaved changes/);
  assert.equal(v.saved.size, 1);
  assert.deepEqual(v.errors, ["Fake save failure"]);
  assert.equal(v.root.querySelector('[data-act="duplicate"]').hasAttribute("disabled"), false);
  await v.click("test");
  assert.equal(v.requests.some((r) => r.method === "STREAM"), false);
  assert.deepEqual(v.saved.get("test-city"), recipe());
  v.allowSave();
  await v.click("save");
  assert.equal(v.saved.get("test-city-copy").export.target, "https://example.test/retry");
  assert.equal(v.requests.some((r) => r.method === "STREAM"), false);
});

test("An explicit test run saves the copy first and runs that name only", async () => {
  const v = await view();
  await v.click("duplicate");
  await v.click("test");
  assert.deepEqual(v.requests.filter((r) => r.method !== "GET").map((r) => [r.method, r.path, r.body.name]), [
    ["POST", "/api/recipes/save", "test-city-copy"],
    ["STREAM", "/api/recipes/run", "test-city-copy"],
  ]);
  assert.equal(v.requests.at(-1).body.live, false);
  assert.deepEqual(v.saved.get("test-city"), recipe());
});

test("Duplicate cannot replace a workflow while its save or run is pending", async () => {
  const v = await view();
  await v.click("duplicate");
  const finishSave = v.holdSave();
  await v.click("save");
  assert.equal(v.root.querySelector('[data-act="duplicate"]').hasAttribute("disabled"), true);
  assert.equal(v.root.querySelector('[data-act="save"]').hasAttribute("disabled"), true);
  assert.equal(v.root.querySelector('[data-act="test"]').hasAttribute("disabled"), true);
  // Repeated saves must not leave a second response able to replace a later copy.
  await v.click("save");
  await v.click("test");
  assert.equal(v.requests.filter((r) => r.method !== "GET").length, 1);
  await v.click("duplicate");
  assert.equal(v.name(), "test-city-copy");
  finishSave(); await settle();
  assert.equal(v.root.querySelector('[data-act="duplicate"]').hasAttribute("disabled"), false);
  assert.equal(v.root.querySelector('[data-act="save"]').hasAttribute("disabled"), false);
  assert.equal(v.root.querySelector('[data-act="test"]').hasAttribute("disabled"), false);
  const finishRun = v.holdRun();
  await v.click("test");
  assert.equal(v.root.querySelector('[data-act="duplicate"]').hasAttribute("disabled"), true);
  await v.click("duplicate");
  assert.equal(v.name(), undefined); // Still showing the saved workflow title.
  finishRun(); await settle();
  await v.click("duplicate");
  assert.equal(v.name(), "test-city-copy-copy");
});
