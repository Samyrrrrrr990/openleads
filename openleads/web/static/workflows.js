/* =========================================================================
   OpenLeads local console: Workflows.
   A recipe drawn as an n8n-style node canvas. Each node edits one part of the
   recipe spec; a test run streams /api/recipes/run and lights the nodes up.
   Loaded after app.js and reuses its helpers ($, esc, ico, S, VIEWS, ...).
   ========================================================================= */
"use strict";

const WF_SINKS = ["csv", "json", "ndjson", "sheets", "webhook", "notion", "airtable"];
const WF_TARGET_HINT = {
  csv: "File path, optional (defaults to ~/.openleads/exports)",
  json: "File path, optional", ndjson: "File path, optional",
  sheets: "File path for the Sheets-ready CSV, optional",
  webhook: "Webhook URL (n8n, Zapier, Make)",
  notion: "Uses notion_token and notion_database_id from Connect",
  airtable: "Uses your Airtable settings from Connect",
};
const WF_SCHEDULES = ["weekdays 09:00", "daily 08:30", "every 2h", "mon,wed,fri 14:00", "0 9 * * 1-5"];

// Stage space is 1000 x 400; nodes are 160 x 72.
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

S.wf = { list: [], cur: null, sel: "find", isNew: false, dirty: false, running: false };

function wfBlank() {
  return { name: "", query: "", count: 25, schedule: "weekdays 09:00", enabled: true,
    verified_only: true, context: "", send: false, sequence: false, export: null };
}

async function wfLoad() {
  try { S.wf.list = (await getJSON("/api/recipes")).recipes || []; } catch (_) { S.wf.list = []; }
  if (S.wf.cur && !S.wf.isNew) {
    const fresh = S.wf.list.find((r) => r.name === S.wf.cur.name);
    S.wf.cur = fresh ? { ...fresh } : null;
  }
  if (!S.wf.cur) {
    if (S.wf.list.length) { S.wf.cur = { ...S.wf.list[0] }; S.wf.isNew = false; }
    else { S.wf.cur = wfBlank(); S.wf.isNew = true; }
  }
}

/* ---------- what each node says about the current spec ---------- */
function wfOff(id, r) {
  if (id === "send") return !r.send;
  if (id === "export") return !r.export;
  if (id === "review") return !r.verified_only;
  if (id === "trigger") return !r.enabled;
  return false;
}
function wfSummary(id, r) {
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

function wfEdgePath(a, b) {
  const A = WF_NODES.find((n) => n.id === a), B = WF_NODES.find((n) => n.id === b);
  const x1 = A.x + WF_W, y1 = A.y + WF_H / 2, x2 = B.x, y2 = B.y + WF_H / 2;
  const dx = Math.max(36, (x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function wfCanvas(r) {
  const edges = WF_EDGES.map(([a, b]) => {
    const off = wfOff(b, r) || wfOff(a, r);
    return `<path data-wf-edge="${a}>${b}" class="${off ? "is-off" : ""}" d="${wfEdgePath(a, b)}"/>`;
  }).join("");
  const nodes = WF_NODES.map((n) => `
    <button type="button" class="wfn${S.wf.sel === n.id ? " is-sel" : ""}${wfOff(n.id, r) ? " is-off" : ""}"
      data-wf-action="select" data-node="${n.id}" style="left:${n.x / 10}%;top:${n.y / 4}%">
      <span class="wfn__ico wfn__ico--${n.id}">${ico(n.icon)}</span>
      <span class="wfn__txt"><b>${n.title}</b><small data-wf-sum="${n.id}">${esc(wfSummary(n.id, r))}</small></span>
      <span class="wfn__badge" data-wf-badge="${n.id}"></span>
    </button>`).join("");
  return `
    <div class="wf__stage" id="wf-stage">
      <svg class="wf__edges" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">${edges}</svg>
      <span class="wf__branch" style="left:58.7%;top:37%">safe</span>
      <span class="wf__branch wf__branch--risky" style="left:58.7%;top:63%">risky</span>
      ${nodes}
    </div>`;
}

/* ---------- inspector: the settings for the selected node ---------- */
function wfInspector(r) {
  const id = S.wf.sel;
  const n = WF_NODES.find((x) => x.id === id);
  const toggle = (k, label, on) => `<label class="toggle"><input type="checkbox" data-wf="${k}" ${on ? "checked" : ""}/>
    <span class="toggle__track"></span><span class="toggle__label">${label}</span></label>`;
  let body = "";
  if (id === "trigger") {
    body = `
      <div class="field"><label>When it runs</label>
        <select class="select" data-wf="mode"><option value="schedule" ${r.enabled ? "selected" : ""}>On a schedule</option>
        <option value="manual" ${r.enabled ? "" : "selected"}>Manual only</option></select></div>
      <div class="field" ${r.enabled ? "" : "hidden"} data-wf-when>
        <label>Schedule</label><input class="input input--mono" data-wf="schedule" value="${esc(r.schedule || "")}" placeholder="weekdays 09:00"/>
        <span class="hint">Plain English or cron. Your machine runs it once <span class="mono">openleads schedule on</span> is installed.</span>
        <div class="wf__chips">${WF_SCHEDULES.map((s) => `<button type="button" class="chip" data-wf-action="sched" data-v="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      </div>`;
  } else if (id === "find") {
    body = `
      <div class="field"><label>Audience</label><input class="input" data-wf="query" value="${esc(r.query)}" placeholder="marketing agencies in Miami"/>
        <span class="hint">Describe who you want. The engine picks the sources.</span></div>
      <div class="field"><label>How many leads per run</label><input class="input input--mono" type="number" min="1" max="1000" data-wf="count" value="${r.count}"/></div>`;
  } else if (id === "verify") {
    body = `
      <p class="wf__note">Every address gets seven checks and a tier: safe, risky, or bad. Bad is always dropped.</p>
      ${toggle("include_risky", "Also email risky leads", !r.verified_only)}
      <span class="hint">Off by default. Risky leads are held in Review instead.</span>`;
  } else if (id === "write") {
    body = `
      <div class="field"><label>What you are offering</label><textarea class="input" rows="4" data-wf="context" placeholder="our local SEO service for dental clinics">${esc(r.context)}</textarea>
        <span class="hint">One line is enough. Drafts are plain text and spam-checked.</span></div>`;
  } else if (id === "send") {
    body = `
      ${toggle("send", "Send emails on scheduled runs", r.send)}
      ${toggle("sequence", "Start the follow-up sequence", r.sequence)}
      <p class="wf__note">Sends stay inside your warmup cap and skip suppressed addresses. A test run never sends.</p>`;
  } else if (id === "review") {
    body = `<p class="wf__note">${r.verified_only
      ? "Risky leads stop here. They are saved to your CRM and never emailed automatically."
      : "Off, because Verify sends risky leads too. Turn that off to hold them here."}</p>`;
  } else if (id === "export") {
    const sink = r.export ? r.export.sink : "";
    body = `
      <div class="field"><label>Send leads to</label><select class="select" data-wf="sink">
        <option value="">Nowhere (CRM only)</option>${WF_SINKS.map((s) => `<option ${s === sink ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="field" ${sink ? "" : "hidden"} data-wf-target><label>Target</label>
        <input class="input input--mono" data-wf="target" value="${esc(r.export ? r.export.target : "")}" placeholder="${esc(WF_TARGET_HINT[sink] || "")}"/>
        <span class="hint" data-wf-target-hint>${esc(WF_TARGET_HINT[sink] || "")}</span></div>`;
  }
  return `<div class="wf__insp-head"><span class="wfn__ico wfn__ico--${id}">${ico(n.icon)}</span><div><b>${n.title}</b><small>Node settings</small></div></div>
    <div class="wf__insp-body">${body}</div>`;
}

function viewWorkflows() {
  const r = S.wf.cur || wfBlank();
  const list = S.wf.list.map((x) => `
    <button type="button" class="wf__item${!S.wf.isNew && S.wf.cur && x.name === S.wf.cur.name ? " is-on" : ""}" data-wf-action="open" data-name="${esc(x.name)}">
      <span class="wf__dot${x.enabled ? " is-live" : ""}"></span>
      <span><b>${esc(x.name)}</b><small>${esc(x.enabled ? (x.when || x.schedule || "scheduled") : "manual")}</small></span>
    </button>`).join("");
  return `
  <section class="page page--wide wf">
    <div class="page-head"><div class="eyebrow">automate</div><h1>Workflows</h1>
      <p>A workflow is a recipe drawn as nodes. Click a node to edit it, then test it. Scheduled runs use the
         same engine as <span class="mono">openleads recipe run</span>.</p></div>
    <div class="wf__shell">
      <aside class="wf__list">
        <button type="button" class="btn btn--primary btn--sm" data-wf-action="new">${ico("plus")} New workflow</button>
        <div class="wf__items">${list || '<p class="muted wf__empty">No workflows yet.</p>'}
          ${S.wf.isNew ? `<div class="wf__item is-on is-draft"><span class="wf__dot"></span><span><b>${esc(r.name || "Untitled")}</b><small>not saved</small></span></div>` : ""}</div>
      </aside>
      <div class="wf__board card">
        <div class="wf__bar">
          ${S.wf.isNew
            ? `<input class="input input--mono wf__name" data-wf="name" value="${esc(r.name)}" placeholder="workflow-name" aria-label="Workflow name"/>`
            : `<span class="wf__title mono">${ico("flow")}${esc(r.name)}</span>`}
          <span class="wf__status" id="wf-status"><i></i><span>${S.wf.dirty ? "Unsaved changes" : "Ready"}</span></span>
          <div class="row" style="gap:8px;margin-left:auto">
            ${S.wf.isNew ? "" : `<button type="button" class="btn btn--ghost btn--sm" data-wf-action="delete">${ico("x")} Delete</button>`}
            <button type="button" class="btn btn--sm" data-wf-action="test" ${S.wf.running ? "disabled" : ""}>${ico("play")} Test run</button>
            <button type="button" class="btn btn--primary btn--sm" data-wf-action="save">${ico("check")} Save</button>
          </div>
        </div>
        ${wfCanvas(r)}
        <ol class="wf__log" id="wf-log"><li class="muted">Test runs are dry runs: they find, verify, and write, but never send.</li></ol>
      </div>
      <aside class="wf__insp card" id="wf-insp">${wfInspector(r)}</aside>
    </div>
  </section>`;
}

/* ---------- editing ---------- */
function wfRefreshNodes() {
  const r = S.wf.cur;
  WF_NODES.forEach((n) => {
    const el = $(`[data-node="${n.id}"]`);
    if (!el) return;
    el.classList.toggle("is-off", wfOff(n.id, r));
    const sum = $(`[data-wf-sum="${n.id}"]`);
    if (sum) sum.textContent = wfSummary(n.id, r);
  });
  WF_EDGES.forEach(([a, b]) => {
    const p = $(`[data-wf-edge="${a}>${b}"]`);
    if (p) p.classList.toggle("is-off", wfOff(a, r) || wfOff(b, r));
  });
  const st = $("#wf-status span");
  if (st && !S.wf.running) st.textContent = S.wf.dirty ? "Unsaved changes" : "Ready";
}

function wfSet(field, el) {
  const r = S.wf.cur;
  const v = el.type === "checkbox" ? el.checked : el.value;
  if (field === "mode") {
    r.enabled = v === "schedule";
    const w = $("[data-wf-when]"); if (w) w.hidden = !r.enabled;
  } else if (field === "count") r.count = Math.max(1, Math.min(parseInt(v, 10) || 25, 1000));
  else if (field === "include_risky") r.verified_only = !v;
  else if (field === "sink") {
    r.export = v ? { sink: v, target: r.export ? r.export.target : "" } : null;
    const t = $("[data-wf-target]"); if (t) t.hidden = !v;
    const h = $("[data-wf-target-hint]"); if (h) h.textContent = WF_TARGET_HINT[v] || "";
  } else if (field === "target") { if (r.export) r.export.target = v; }
  else r[field] = v;
  if (field === "name") { const d = $(".wf__item.is-draft b"); if (d) d.textContent = v || "Untitled"; }
  S.wf.dirty = true;
  wfRefreshNodes();
}

async function wfSave() {
  const r = S.wf.cur;
  if (!r.name || !/^[\w.-]+$/.test(r.name)) { toast("Name the workflow with letters, numbers, dashes or dots.", "err"); return false; }
  if (!r.query) { S.wf.sel = "find"; setRoute("workflows"); toast("Find leads needs an audience.", "err"); return false; }
  const body = { ...r, schedule: r.enabled ? (r.schedule || "").trim() : "" };
  const res = await postJSON("/api/recipes/save", body);
  if (!res.ok) { toast(res.error || "Save failed", "err"); return false; }
  toast(`Saved '${r.name}'.`);
  S.wf.isNew = false; S.wf.dirty = false;
  S.wf.cur = { ...res.recipe, name: r.name };
  await wfLoad();
  setRoute("workflows");
  return true;
}

/* ---------- test run: stream events onto the canvas ---------- */
function wfNode(id, state, badge) {
  const el = $(`[data-node="${id}"]`);
  if (!el) return;
  el.classList.toggle("is-running", state === "running");
  el.classList.toggle("is-done", state === "done");
  if (badge !== undefined) { const b = $(`[data-wf-badge="${id}"]`); if (b) b.textContent = badge; }
}
function wfEdge(a, b, state) {
  const p = $(`[data-wf-edge="${a}>${b}"]`);
  if (!p) return;
  p.classList.toggle("is-live", state === "live");
  p.classList.toggle("is-done", state === "done");
}
function wfLog(msg, kind = "") {
  const log = $("#wf-log");
  if (!log) return;
  const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const li = document.createElement("li");
  li.className = kind;
  li.innerHTML = `<time>${t}</time><span>${msg}</span>`;
  log.appendChild(li);
  log.scrollTop = log.scrollHeight;
}

async function wfTest() {
  if (S.wf.running) return;
  if (S.wf.isNew || S.wf.dirty) { if (!(await wfSave())) return; }
  const r = S.wf.cur;
  S.wf.running = true;
  const stage = $("#wf-stage");
  const log = $("#wf-log"); if (log) log.innerHTML = "";
  stage && stage.classList.add("is-running");
  const st = $("#wf-status span"); if (st) st.textContent = "Running";
  $("#wf-status")?.setAttribute("data-state", "running");
  $('[data-wf-action="test"]')?.setAttribute("disabled", "");

  let leads = 0, safe = 0, risky = 0, phase = "";
  wfNode("trigger", "done", "manual"); wfEdge("trigger", "find", "done");
  wfNode("find", "running", "0 leads");
  wfLog(`<b>Trigger</b> test run started for “${esc(r.query)}”`);
  try {
    await stream("/api/recipes/run", { name: r.name, live: false }, (ev) => {
      if (ev.type === "lead") {
        leads++;
        const tier = ev.lead && ev.lead.tier;
        if (tier === "safe") safe++; else if (tier === "risky") risky++;
        wfNode("find", "running", `${leads} leads`);
      } else if (ev.type === "phase") {
        const m = String(ev.message || "");
        wfLog(`<b>${esc(phase === "" ? "Find leads" : "Engine")}</b> ${esc(m)}`);
        if (/writing/i.test(m)) {
          phase = "write";
          wfNode("find", "done", `${leads} leads`); wfEdge("find", "verify", "done");
          wfNode("verify", "done", `${safe} safe`);
          wfEdge("verify", "write", "live"); wfNode("write", "running", "writing");
          if (r.verified_only) { wfEdge("verify", "review", "done"); wfNode("review", "done", `${risky} held`); }
        } else if (/send/i.test(m)) {
          phase = "send";
          wfEdge("verify", "write", "done"); wfNode("write", "done");
          wfEdge("write", "send", "live"); wfNode("send", "running", "preview");
        } else if (/export/i.test(m)) {
          wfEdge("review", "export", "done"); wfNode("export", "done", m.replace(/^exported\s*/i, "").split(" ")[0] + " rows");
        } else if (!phase) phase = "find";
      } else if (ev.type === "done") {
        wfNode("find", "done", `${ev.found ?? leads} leads`); wfEdge("find", "verify", "done");
        wfNode("verify", "done", `${safe} safe`);
        if (r.verified_only) { wfEdge("verify", "review", "done"); wfNode("review", "done", `${risky} held`); }
        wfEdge("verify", "write", "done"); wfNode("write", "done", `${ev.drafted ?? 0} drafts`);
        if (r.send) { wfEdge("write", "send", "done"); wfNode("send", "done", `${ev.drafted ?? 0} previewed`); }
        if (ev.export) { wfEdge("review", "export", "done"); wfNode("export", "done", `${ev.export.count ?? 0} rows`); }
        wfLog(`<b>Done</b> found ${ev.found ?? leads}, drafted ${ev.drafted ?? 0}, sent 0 (test run)`, "ok");
        const s2 = $("#wf-status span"); if (s2) s2.textContent = "Succeeded";
        $("#wf-status")?.setAttribute("data-state", "done");
      } else if (ev.type === "error") {
        wfLog(`<b>Error</b> ${esc(ev.message)}`, "err");
        const s2 = $("#wf-status span"); if (s2) s2.textContent = "Failed";
        $("#wf-status")?.setAttribute("data-state", "err");
        $$(".wfn.is-running").forEach((n) => n.classList.remove("is-running"));
      }
    });
  } catch (e) {
    wfLog(`<b>Error</b> ${esc(e.message)}`, "err");
  } finally {
    S.wf.running = false;
    stage && stage.classList.remove("is-running");
    $$(".wfn.is-running").forEach((n) => n.classList.remove("is-running"));
    $$(".wf__edges path.is-live").forEach((p) => p.classList.remove("is-live"));
    $('[data-wf-action="test"]')?.removeAttribute("disabled");
  }
}

/* ---------- wiring ---------- */
VIEWS.workflows = viewWorkflows;

document.addEventListener("click", async (e) => {
  const a = e.target.closest("[data-wf-action]");
  if (!a) return;
  const act = a.dataset.wfAction;
  if (act === "select") {
    S.wf.sel = a.dataset.node;
    $$(".wfn").forEach((n) => n.classList.toggle("is-sel", n === a));
    $("#wf-insp").innerHTML = wfInspector(S.wf.cur);
  } else if (act === "sched") {
    const inp = $('[data-wf="schedule"]');
    if (inp) { inp.value = a.dataset.v; wfSet("schedule", inp); }
  } else if (act === "new") {
    S.wf.cur = wfBlank(); S.wf.isNew = true; S.wf.dirty = true; S.wf.sel = "find";
    setRoute("workflows");
    setTimeout(() => $('[data-wf="name"]')?.focus(), 30);
  } else if (act === "open") {
    const r = S.wf.list.find((x) => x.name === a.dataset.name);
    if (r) { S.wf.cur = { ...r }; S.wf.isNew = false; S.wf.dirty = false; setRoute("workflows"); }
  } else if (act === "save") { e.preventDefault(); wfSave(); }
  else if (act === "test") { e.preventDefault(); wfTest(); }
  else if (act === "delete") {
    const name = S.wf.cur && S.wf.cur.name;
    if (!name) return;
    if (a.dataset.armed !== "1") {   // two-step delete, no blocking dialog
      a.dataset.armed = "1"; a.lastChild.textContent = " Click again to delete";
      setTimeout(() => { if (a.isConnected) { a.dataset.armed = ""; a.lastChild.textContent = " Delete"; } }, 3000);
      return;
    }
    await postJSON("/api/recipes/delete", { name });
    toast(`Deleted '${name}'.`);
    S.wf.cur = null; await wfLoad(); setRoute("workflows");
  }
});

document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-wf]");
  if (el && S.wf.cur) wfSet(el.dataset.wf, el);
});
document.addEventListener("change", (e) => {
  const el = e.target.closest("select[data-wf], input[type=checkbox][data-wf]");
  if (el && S.wf.cur) wfSet(el.dataset.wf, el);
});
