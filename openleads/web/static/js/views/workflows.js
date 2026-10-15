/* =========================================================================
   Workflows — a recipe drawn as an n8n-style node canvas. Each node edits one
   part of the recipe spec; a test run streams /api/recipes/run and lights the
   nodes up. Test runs are dry runs: they find, verify and write, never send.
   ========================================================================= */
import { $, $$, api, esc, fail, ico, router, toast } from "../core.js";

const WF_SINKS = ["csv", "json", "ndjson", "sheets", "webhook", "notion", "airtable"];
const WF_TARGET_HINT = {
  csv: "File path, optional (defaults to ~/.openleads/exports)",
  json: "File path, optional", ndjson: "File path, optional",
  sheets: "File path for the Sheets-ready CSV, optional",
  webhook: "Webhook URL (n8n, Zapier, Make)",
  notion: "Uses notion_token and notion_database_id from Settings",
  airtable: "Uses your Airtable settings from Settings",
};
const WF_SCHEDULES = ["weekdays 09:00", "daily 08:30", "every 2h", "mon,wed,fri 14:00", "0 9 * * 1-5"];
const WF_W = 160, WF_H = 72;
const WF_NODES = [
  { id: "trigger", x: 14, y: 164, icon: "clock", title: "Trigger" },
  { id: "find", x: 200, y: 164, icon: "find", title: "Find leads" },
  { id: "verify", x: 386, y: 164, icon: "shield", title: "Verify" },
  { id: "write", x: 628, y: 64, icon: "compose", title: "Write" },
  { id: "send", x: 826, y: 64, icon: "send", title: "Send" },
  { id: "review", x: 628, y: 264, icon: "hand", title: "Review" },
  { id: "export", x: 826, y: 264, icon: "table", title: "Export" },
];
const WF_EDGES = [["trigger", "find"], ["find", "verify"], ["verify", "write"], ["write", "send"],
  ["verify", "review"], ["review", "export"]];

const W = { list: [], cur: null, sel: "find", isNew: false, dirty: false, running: false };
let ROOT = null;

const blank = () => ({ name: "", query: "", count: 25, schedule: "weekdays 09:00", enabled: true,
  verified_only: true, context: "", send: false, sequence: false, export: null });

async function load() {
  try { W.list = (await api.get("/api/recipes")).recipes || []; } catch (_) { W.list = []; }
  if (W.cur && !W.isNew) {
    const fresh = W.list.find((r) => r.name === W.cur.name);
    W.cur = fresh ? { ...fresh } : null;
  }
  if (!W.cur) {
    if (W.list.length) { W.cur = { ...W.list[0] }; W.isNew = false; }
    else { W.cur = blank(); W.isNew = true; }
  }
}

function off(id, r) {
  if (id === "send") return !r.send;
  if (id === "export") return !r.export;
  if (id === "review") return !r.verified_only;
  if (id === "trigger") return !r.enabled;
  return false;
}
function summary(id, r) {
  switch (id) {
    case "trigger": return r.enabled ? (r.schedule || r.when || "daily 09:00") : "Manual only";
    case "find": return r.query ? `${r.query} · ${r.count}` : "Set an audience";
    case "verify": return r.verified_only ? "Safe only" : "Safe and risky";
    case "write": return r.context ? r.context : "Default pitch";
    case "send": return r.send ? (r.sequence ? "On, with follow-ups" : "On, warmup capped") : "Off";
    case "review": return r.verified_only ? "Risky leads held" : "Off";
    case "export": return r.export ? r.export.sink : "Off";
  }
  return "";
}
function edgePath(a, b) {
  const A = WF_NODES.find((n) => n.id === a), B = WF_NODES.find((n) => n.id === b);
  const x1 = A.x + WF_W, y1 = A.y + WF_H / 2, x2 = B.x, y2 = B.y + WF_H / 2;
  const dx = Math.max(36, (x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function canvas(r) {
  const edges = WF_EDGES.map(([a, b]) =>
    `<path data-wf-edge="${a}>${b}" class="${off(b, r) || off(a, r) ? "is-off" : ""}" d="${edgePath(a, b)}"/>`).join("");
  const nodes = WF_NODES.map((n) => `
    <button type="button" class="wfn${W.sel === n.id ? " is-sel" : ""}${off(n.id, r) ? " is-off" : ""}"
      data-act="select" data-node="${n.id}" style="left:${n.x / 10}%;top:${n.y / 4}%">
      <span class="wfn__ico wfn__ico--${n.id}">${ico(n.icon)}</span>
      <span class="wfn__txt"><b>${n.title}</b><small data-wf-sum="${n.id}">${esc(summary(n.id, r))}</small></span>
      <span class="wfn__badge" data-wf-badge="${n.id}"></span>
    </button>`).join("");
  return `<div class="wf__stage" id="wf-stage">
      <svg class="wf__edges" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">${edges}</svg>
      <span class="wf__branch" style="left:58.7%;top:37%">safe</span>
      <span class="wf__branch wf__branch--risky" style="left:58.7%;top:63%">risky</span>
      ${nodes}</div>`;
}

function inspector(r) {
  const id = W.sel, n = WF_NODES.find((x) => x.id === id);
  const tog = (k, label, on) => `<label class="switch"><input type="checkbox" data-wf="${k}" ${on ? "checked" : ""}/>
    <span class="switch__track"></span><span class="switch__label">${label}</span></label>`;
  let body = "";
  if (id === "trigger") {
    body = `<div class="field"><label>When it runs</label>
        <select class="select" data-wf="mode"><option value="schedule" ${r.enabled ? "selected" : ""}>On a schedule</option>
        <option value="manual" ${r.enabled ? "" : "selected"}>Manual only</option></select></div>
      <div class="field" ${r.enabled ? "" : "hidden"} data-wf-when>
        <label>Schedule</label><input class="input input--mono" data-wf="schedule" value="${esc(r.schedule || "")}" placeholder="weekdays 09:00"/>
        <span class="hint">Plain English or cron. Runs once <code>openleads schedule on</code> is installed.</span>
        <div class="wf__chips">${WF_SCHEDULES.map((s) => `<button type="button" class="chip chip--toggle" data-act="sched" data-v="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      </div>`;
  } else if (id === "find") {
    body = `<div class="field"><label>Audience</label><input class="input" data-wf="query" value="${esc(r.query)}" placeholder="marketing agencies in Miami"/>
        <span class="hint">Describe who you want. The engine picks the sources.</span></div>
      <div class="field"><label>Leads per run</label><input class="input input--mono" type="number" min="1" max="1000" data-wf="count" value="${r.count}"/></div>`;
  } else if (id === "verify") {
    body = `<p class="wf__note">Every address gets seven checks and a tier: safe, risky, or bad. Bad is always dropped.</p>
      ${tog("include_risky", "Also email risky leads", !r.verified_only)}
      <span class="hint">Off by default. Risky leads are held in Review instead.</span>`;
  } else if (id === "write") {
    body = `<div class="field"><label>What you are offering</label><textarea class="textarea" rows="4" data-wf="context" placeholder="our local SEO service for dental clinics">${esc(r.context)}</textarea>
        <span class="hint">One line is enough. Drafts are plain text and spam-checked.</span></div>`;
  } else if (id === "send") {
    body = `${tog("send", "Send emails on scheduled runs", r.send)}${tog("sequence", "Start the follow-up sequence", r.sequence)}
      <p class="wf__note">Sends stay inside your warmup cap and skip suppressed addresses. A test run never sends.</p>`;
  } else if (id === "review") {
    body = `<p class="wf__note">${r.verified_only
      ? "Risky leads stop here. They are saved to People and never emailed automatically."
      : "Off, because Verify sends risky leads too. Turn that off to hold them here."}</p>`;
  } else if (id === "export") {
    const sink = r.export ? r.export.sink : "";
    body = `<div class="field"><label>Send leads to</label><select class="select" data-wf="sink">
        <option value="">Nowhere (People only)</option>${WF_SINKS.map((s) => `<option ${s === sink ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="field" ${sink ? "" : "hidden"} data-wf-target><label>Target</label>
        <input class="input input--mono" data-wf="target" value="${esc(r.export ? r.export.target : "")}" placeholder="${esc(WF_TARGET_HINT[sink] || "")}"/>
        <span class="hint" data-wf-target-hint>${esc(WF_TARGET_HINT[sink] || "")}</span></div>`;
  }
  return `<div class="wf__insp-head"><span class="wfn__ico wfn__ico--${id}">${ico(n.icon)}</span><div><b>${n.title}</b><small>Node settings</small></div></div>
    <div class="wf__insp-body">${body}</div>`;
}

function render() {
  const r = W.cur || blank();
  const list = W.list.map((x) => `
    <button type="button" class="wf__item${!W.isNew && W.cur && x.name === W.cur.name ? " is-on" : ""}" data-act="open" data-name="${esc(x.name)}">
      <span class="wf__dot${x.enabled ? " is-live" : ""}"></span>
      <span><b>${esc(x.name)}</b><small>${esc(x.enabled ? (x.when || x.schedule || "scheduled") : "manual")}</small></span>
    </button>`).join("");
  ROOT.innerHTML = `
  <section class="page">
    <div class="head"><div><div class="head__title"><h1>Workflows</h1></div>
      <p class="head__sub">A workflow is a recipe drawn as nodes. Click a node to edit it, then test it. Scheduled runs use the same engine as <code>openleads recipe run</code>.</p></div></div>
    <div class="wf__shell">
      <aside class="wf__list">
        <button type="button" class="btn btn--primary btn--sm" data-act="new">${ico("plus")} New workflow</button>
        <div class="wf__items">${list || '<p class="muted wf__empty">No workflows yet.</p>'}
          ${W.isNew ? `<div class="wf__item is-on is-draft"><span class="wf__dot"></span><span><b>${esc(r.name || "Untitled")}</b><small>not saved</small></span></div>` : ""}</div>
      </aside>
      <div class="wf__board card">
        <div class="wf__bar">
          ${W.isNew ? `<input class="input input--mono wf__name" data-wf="name" value="${esc(r.name)}" placeholder="workflow-name" aria-label="Workflow name"/>`
            : `<span class="wf__title">${ico("flow")}${esc(r.name)}</span>`}
          <span class="wf__status" id="wf-status"><i></i><span>${W.dirty ? "Unsaved changes" : "Ready"}</span></span>
          <div class="row" style="margin-left:auto">
            ${W.isNew ? "" : `<button type="button" class="btn btn--ghost btn--sm btn--danger" data-act="delete">${ico("trash")} <span>Delete</span></button>`}
            <button type="button" class="btn btn--sm" data-act="test" ${W.running ? "disabled" : ""}>${ico("play")} Test run</button>
            <button type="button" class="btn btn--primary btn--sm" data-act="save">${ico("check")} Save</button>
          </div>
        </div>
        ${canvas(r)}
        <ol class="wf__log" id="wf-log"><li class="muted">Test runs are dry runs: they find, verify, and write, but never send.</li></ol>
      </div>
      <aside class="wf__insp card" id="wf-insp">${inspector(r)}</aside>
    </div>
  </section>`;
}

function refreshNodes() {
  const r = W.cur;
  WF_NODES.forEach((n) => {
    const el = $(`[data-node="${n.id}"]`, ROOT);
    if (!el) return;
    el.classList.toggle("is-off", off(n.id, r));
    const s = $(`[data-wf-sum="${n.id}"]`, ROOT); if (s) s.textContent = summary(n.id, r);
  });
  WF_EDGES.forEach(([a, b]) => $(`[data-wf-edge="${a}>${b}"]`, ROOT)?.classList.toggle("is-off", off(a, r) || off(b, r)));
  const st = $("#wf-status span", ROOT);
  if (st && !W.running) st.textContent = W.dirty ? "Unsaved changes" : "Ready";
}

function set(field, el) {
  const r = W.cur;
  const v = el.type === "checkbox" ? el.checked : el.value;
  if (field === "mode") { r.enabled = v === "schedule"; const w = $("[data-wf-when]", ROOT); if (w) w.hidden = !r.enabled; }
  else if (field === "count") r.count = Math.max(1, Math.min(parseInt(v, 10) || 25, 1000));
  else if (field === "include_risky") r.verified_only = !v;
  else if (field === "sink") {
    r.export = v ? { sink: v, target: r.export ? r.export.target : "" } : null;
    const t = $("[data-wf-target]", ROOT); if (t) t.hidden = !v;
    const h = $("[data-wf-target-hint]", ROOT); if (h) h.textContent = WF_TARGET_HINT[v] || "";
  } else if (field === "target") { if (r.export) r.export.target = v; }
  else r[field] = v;
  if (field === "name") { const d = $(".wf__item.is-draft b", ROOT); if (d) d.textContent = v || "Untitled"; }
  W.dirty = true;
  refreshNodes();
}

async function save() {
  const r = W.cur;
  if (!r.name || !/^[\w.-]+$/.test(r.name)) { toast("Name the workflow with letters, numbers, dashes or dots.", "err"); return false; }
  if (!r.query) { W.sel = "find"; render(); toast("Find leads needs an audience.", "err"); return false; }
  try {
    const res = await api.post("/api/recipes/save", { ...r, schedule: r.enabled ? (r.schedule || "").trim() : "" });
    toast(`Saved '${r.name}'.`);
    W.isNew = false; W.dirty = false; W.cur = { ...res.recipe, name: r.name };
    await load(); render();
    return true;
  } catch (e) { fail(e); return false; }
}

function node(id, state, badge) {
  const el = $(`[data-node="${id}"]`, ROOT); if (!el) return;
  el.classList.toggle("is-running", state === "running");
  el.classList.toggle("is-done", state === "done");
  if (badge !== undefined) { const b = $(`[data-wf-badge="${id}"]`, ROOT); if (b) b.textContent = badge; }
}
function edge(a, b, state) {
  const p = $(`[data-wf-edge="${a}>${b}"]`, ROOT); if (!p) return;
  p.classList.toggle("is-live", state === "live"); p.classList.toggle("is-done", state === "done");
}
function log(msg, kind = "") {
  const el = $("#wf-log", ROOT); if (!el) return;
  const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const li = document.createElement("li"); li.className = kind;
  li.innerHTML = `<time>${t}</time><span>${msg}</span>`;
  el.appendChild(li); el.scrollTop = el.scrollHeight;
}
function status(text, state) {
  const s = $("#wf-status span", ROOT); if (s) s.textContent = text;
  $("#wf-status", ROOT)?.setAttribute("data-state", state);
}

async function test() {
  if (W.running) return;
  if (W.isNew || W.dirty) { if (!(await save())) return; }
  const r = W.cur;
  W.running = true;
  const logEl = $("#wf-log", ROOT); if (logEl) logEl.innerHTML = "";
  status("Running", "running");
  $('[data-act="test"]', ROOT)?.setAttribute("disabled", "");
  let leads = 0, safe = 0, risky = 0, phase = "";
  node("trigger", "done", "manual"); edge("trigger", "find", "done"); node("find", "running", "0 leads");
  log(`<b>Trigger</b> test run started for “${esc(r.query)}”`);
  try {
    await api.stream("/api/recipes/run", { name: r.name, live: false }, (ev) => {
      if (ev.type === "lead") {
        leads++; const t = ev.lead && ev.lead.tier;
        if (t === "safe") safe++; else if (t === "risky") risky++;
        node("find", "running", `${leads} leads`);
      } else if (ev.type === "phase") {
        const m = String(ev.message || "");
        log(`<b>${esc(phase === "" ? "Find leads" : "Engine")}</b> ${esc(m)}`);
        if (/writing/i.test(m)) {
          phase = "write"; node("find", "done", `${leads} leads`); edge("find", "verify", "done");
          node("verify", "done", `${safe} safe`); edge("verify", "write", "live"); node("write", "running", "writing");
          if (r.verified_only) { edge("verify", "review", "done"); node("review", "done", `${risky} held`); }
        } else if (/send/i.test(m)) {
          phase = "send"; edge("verify", "write", "done"); node("write", "done");
          edge("write", "send", "live"); node("send", "running", "preview");
        } else if (/export/i.test(m)) {
          edge("review", "export", "done"); node("export", "done", m.replace(/^exported\s*/i, "").split(" ")[0] + " rows");
        } else if (!phase) phase = "find";
      } else if (ev.type === "done") {
        node("find", "done", `${ev.found ?? leads} leads`); edge("find", "verify", "done");
        node("verify", "done", `${safe} safe`);
        if (r.verified_only) { edge("verify", "review", "done"); node("review", "done", `${risky} held`); }
        edge("verify", "write", "done"); node("write", "done", `${ev.drafted ?? 0} drafts`);
        if (r.send) { edge("write", "send", "done"); node("send", "done", `${ev.drafted ?? 0} previewed`); }
        if (ev.export) { edge("review", "export", "done"); node("export", "done", `${ev.export.count ?? 0} rows`); }
        log(`<b>Done</b> found ${ev.found ?? leads}, drafted ${ev.drafted ?? 0}, sent 0 (test run)`, "ok");
        status("Succeeded", "done");
      } else if (ev.type === "error") {
        log(`<b>Error</b> ${esc(ev.message)}`, "err"); status("Failed", "err");
      }
    });
  } catch (e) { log(`<b>Error</b> ${esc(e.message)}`, "err"); }
  finally {
    W.running = false;
    $$(".wfn.is-running", ROOT).forEach((n) => n.classList.remove("is-running"));
    $$(".wf__edges path.is-live", ROOT).forEach((p) => p.classList.remove("is-live"));
    $('[data-act="test"]', ROOT)?.removeAttribute("disabled");
  }
}

async function onClick(e) {
  const a = e.target.closest("[data-act]");
  if (!a || !ROOT.contains(a)) return;
  const act = a.dataset.act;
  if (act === "select") {
    W.sel = a.dataset.node;
    $$(".wfn", ROOT).forEach((n) => n.classList.toggle("is-sel", n === a));
    $("#wf-insp", ROOT).innerHTML = inspector(W.cur);
  } else if (act === "sched") {
    const inp = $('[data-wf="schedule"]', ROOT);
    if (inp) { inp.value = a.dataset.v; set("schedule", inp); }
  } else if (act === "new") {
    W.cur = blank(); W.isNew = true; W.dirty = true; W.sel = "find"; render();
    setTimeout(() => $('[data-wf="name"]', ROOT)?.focus(), 30);
  } else if (act === "open") {
    const r = W.list.find((x) => x.name === a.dataset.name);
    if (r) { W.cur = { ...r }; W.isNew = false; W.dirty = false; render(); }
  } else if (act === "save") save();
  else if (act === "test") test();
  else if (act === "delete") {
    const name = W.cur && W.cur.name; if (!name) return;
    if (a.dataset.armed !== "1") {
      a.dataset.armed = "1"; a.querySelector("span").textContent = "Click again to delete";
      setTimeout(() => { if (a.isConnected) { a.dataset.armed = ""; a.querySelector("span").textContent = "Delete"; } }, 3000);
      return;
    }
    await api.post("/api/recipes/delete", { name });
    toast(`Deleted '${name}'.`);
    W.cur = null; await load(); render();
  }
}

router.register("workflows", {
  title: "Workflows",
  async mount(root) {
    ROOT = root;
    const sel = W.sel; await load(); W.sel = sel;
    render();
    root.addEventListener("click", onClick);
    root.addEventListener("input", (e) => { const el = e.target.closest("[data-wf]"); if (el && W.cur) set(el.dataset.wf, el); });
    root.addEventListener("change", (e) => {
      const el = e.target.closest("select[data-wf], input[type=checkbox][data-wf]");
      if (el && W.cur) set(el.dataset.wf, el);
    });
  },
});
