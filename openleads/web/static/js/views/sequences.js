/* =========================================================================
   Sequences — multi-step, multi-channel outreach that runs itself.
   Index: every sequence with its numbers. Editor (#/sequences/<id>): the step
   timeline with inline editing and A/B variants, a live preview against a real
   contact, the people in it, settings, and "run now" (dry run or live).
   ========================================================================= */
import { $, api, confirmDialog, esc, fail, fmt, ico, menu, modal, onAct, promptDialog, router, store, toast, ui } from "../core.js";
import { showSkipped } from "../actions.js";

const TYPE_ICON = { auto_email: "mail", manual_email: "edit", call: "phone", linkedin: "linkedin", task: "task" };
const typeLabel = (k) => store.label("step_types", k);
let ROOT = null;

/* ================================================================ index */
async function renderIndex() {
  const seqs = (await api.get("/api/sequences")).sequences || [];
  ROOT.innerHTML = `<section class="page">
    <div class="head"><div><div class="head__title"><h1>Sequences</h1></div>
      <p class="head__sub">Multi-step outreach that runs itself: emails send on schedule inside your warmup cap, calls and LinkedIn steps become tasks, and anyone who replies, bounces or unsubscribes leaves automatically.</p></div>
      <div class="head__actions"><button class="btn btn--primary" data-act="new">${ico("plus")} New sequence</button></div></div>
    ${seqs.length ? `<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>
      <th>Sequence</th><th>Status</th><th class="col-num">Active</th><th class="col-num">Contacted</th><th class="col-num">Replied</th>
      <th class="col-num">Reply rate</th><th class="col-num">Bounced</th><th class="col-num">Due now</th><th class="col-num">Tasks</th></tr></thead><tbody>
      ${seqs.map((q) => `<tr class="is-click" data-open="${q.id}">
        <td><div class="t-strong">${esc(q.name)}</div><div class="row" style="gap:3px;margin-top:3px">${q.steps.map((s) =>
          `<span class="step__type step__type--${s.type}" style="width:20px;height:20px;border-radius:5px" title="${esc(typeLabel(s.type))}">${ico(TYPE_ICON[s.type], "ico--sm")}</span>`).join("")}
          <span class="hint" style="margin-left:4px">${fmt.plural(q.steps.length, "step")} · ${q.steps.reduce((a, s) => a + s.delay_days, 0)} days</span></div></td>
        <td>${ui.switch("status", q.status === "active", q.status === "active" ? "Active" : q.status === "archived" ? "Archived" : "Paused", `data-toggle="${q.id}"`)}</td>
        <td class="col-num">${fmt.num(q.stats.active)}</td><td class="col-num">${fmt.num(q.stats.contacted)}</td>
        <td class="col-num">${fmt.num(q.stats.replied)}</td><td class="col-num">${fmt.pct(q.stats.reply_rate)}</td>
        <td class="col-num">${fmt.num(q.stats.bounced)}</td>
        <td class="col-num">${q.stats.due_now ? `<span class="badge badge--accent">${q.stats.due_now}</span>` : "0"}</td>
        <td class="col-num">${fmt.num(q.stats.open_tasks)}</td></tr>`).join("")}</tbody></table></div></div>`
      : `<div class="card">${ui.empty("sequence", "No sequences yet",
        "Start from a proven 5-step, two-week cadence — intro, bump, call, LinkedIn, breakup — and make it yours.",
        `<button class="btn btn--primary" data-act="new">${ico("plus")} New sequence</button>`)}</div>`}
    <div class="grid grid-3 mt-lg">${[["mail", "Automatic emails", "Personalized with {{variables}}, A/B variants and threaded follow-ups. They send inside business hours and your daily warmup cap."],
      ["task", "Manual steps", "Calls, LinkedIn touches and hand-written emails become tasks; the contact waits until the task is done."],
      ["reply", "Stops on reply", "With IMAP connected, a reply, bounce or unsubscribe ends the sequence for that person automatically."]].map(([i, t, d]) =>
      `<div class="card card--pad"><div class="row">${ico(i)}<h3>${t}</h3></div><p class="muted mt">${d}</p></div>`).join("")}</div></section>`;
}

async function newSequence() {
  await modal({
    title: "New sequence", body: `<div class="field"><label>Name</label><input class="input" name="name" placeholder="Austin dentists — Q4" autofocus/></div>
      <div class="field"><label>Start from</label><select class="select" name="start"><option value="starter">5-step starter (email, bump, call, LinkedIn, breakup)</option><option value="blank">Blank</option></select></div>
      <div class="field"><label>Pitch for this sequence (optional)</label><textarea class="textarea" name="context" rows="3" placeholder="We help clinics fill last-minute cancellations with a waitlist that texts patients."></textarea>
        <span class="hint">Fills {{sender_context}} and guides AI-written steps. Defaults to your pitch in Settings.</span></div>`,
    actions: [{ label: "Cancel", value: null }, { label: "Create", kind: "primary", submit: true }],
    onSubmit: async (f) => {
      const r = await api.post("/api/sequences/save", { name: f.name.value, starter: f.start.value === "starter",
        steps: f.start.value === "blank" ? [] : undefined, settings: { context: f.context.value } });
      router.go("sequences", r.sequence.id); return true;
    },
  });
}

/* =============================================================== editor */
const E = { seq: null, stats: null, enr: [], steps: [], editing: -1, dirty: false, tab: "steps", filter: "active",
  preview: { step: 0, email: "" }, selected: new Set() };

async function loadSeq(id) {
  const r = await api.get("/api/sequences/get", { id });
  E.seq = r.sequence; E.stats = r.stats; E.enr = r.enrollments;
  E.steps = JSON.parse(JSON.stringify(r.sequence.steps)); E.dirty = false;
}

function dayOf(i) { return E.steps.slice(0, i + 1).reduce((a, s) => a + (Number(s.delay_days) || 0), 0); }

function stepView(s, i) {
  const st = E.stats.steps[i] || {};
  const isEmail = s.type === "auto_email" || s.type === "manual_email";
  const v = (s.variants || [])[0] || {};
  const preview = isEmail ? (s.ai && !s.variants?.length ? "<i>AI-written for each person from your pitch</i>"
    : `<b>${esc(s.thread && i > 0 ? "re: (same thread)" : v.subject || "(no subject)")}</b>\n${esc((v.body || "").slice(0, 260))}`) : esc(s.note || `${typeLabel(s.type)} task`);
  const editing = E.editing === i;
  return `<div class="step">
    <div class="step__rail"><span class="step__num">${i + 1}</span><span class="step__line"></span></div>
    <div><div class="step__wait"><span class="delay-chip">${ico("clock", "ico--sm")} ${i === 0 ? (s.delay_days ? `Wait ${s.delay_days} day${s.delay_days > 1 ? "s" : ""} after enrolling` : "Right after enrolling") : `Wait ${s.delay_days} day${s.delay_days === 1 ? "" : "s"}`}</span>
      <span>Day ${dayOf(i)}</span></div>
    <div class="step__card ${editing ? "is-editing" : ""}">
      <div class="step__head"><span class="step__type step__type--${s.type}">${ico(TYPE_ICON[s.type])}</span>
        <div style="min-width:0;flex:1"><b>${esc(typeLabel(s.type))}</b>${(s.variants || []).length > 1 ? ` <span class="badge badge--violet badge--sm">A/B · ${s.variants.length} variants</span>` : ""}${s.ai ? ' <span class="badge badge--accent badge--sm">AI</span>' : ""}
          <div class="hint">${s.type === "auto_email" ? `${fmt.num(st.sent || 0)} sent` : `${fmt.num(st.tasks_done || 0)} done`} · ${fmt.num(st.waiting || 0)} waiting here</div></div>
        <button class="btn btn--xs btn--ghost btn--icon" data-step-up="${i}" ${i === 0 ? "disabled" : ""} title="Move up">${ico("up")}</button>
        <button class="btn btn--xs btn--ghost btn--icon" data-step-down="${i}" ${i === E.steps.length - 1 ? "disabled" : ""} title="Move down">${ico("chevron-down")}</button>
        <button class="btn btn--xs ${editing ? "btn--primary" : ""}" data-step-edit="${i}">${editing ? "Done" : "Edit"}</button>
        <button class="btn btn--xs btn--ghost btn--icon" data-step-del="${i}" title="Delete step">${ico("trash")}</button></div>
      ${editing ? stepEditor(s, i) : `<div class="step__preview">${preview}</div>`}
      ${!editing && (st.variants || []).length > 1 ? `<div class="step__preview" style="padding-top:0">${st.variants.map((x, k) =>
        `<span class="badge badge--outline">${String.fromCharCode(65 + k)}: ${x.sent} sent · ${fmt.pct(x.reply_rate)} replied</span>`).join(" ")}</div>` : ""}
    </div></div></div>`;
}

function varChips(i, k) {
  return `<div class="var-chips">${(store.meta?.template_variables || []).slice(0, 13).map((v) =>
    `<button type="button" data-insert="{{${v.key}}}" data-i="${i}" data-k="${k}" title="${esc(v.label)} — e.g. ${esc(v.example)}">{{${v.key}}}</button>`).join("")}</div>`;
}

function stepEditor(s, i) {
  const isEmail = s.type === "auto_email" || s.type === "manual_email";
  const variants = s.variants && s.variants.length ? s.variants : [{ subject: "", body: "" }];
  return `<div class="step__edit">
    <div class="form-grid">
      <div class="field"><label>Step type</label><select class="select select--sm" data-sf="type" data-i="${i}">${(store.meta?.step_types || []).map((t) =>
        `<option value="${t.key}" ${t.key === s.type ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></div>
      <div class="field"><label>${i === 0 ? "Days after enrolling" : "Days after previous step"}</label><input class="input input--sm" type="number" min="0" max="365" data-sf="delay_days" data-i="${i}" value="${s.delay_days}"/></div>
    </div>
    ${isEmail ? `<div class="row row--wrap" style="gap:14px">
        ${i > 0 ? ui.switch("thread", s.thread, "Reply in the same thread", `data-sf="thread" data-i="${i}"`) : ""}
        ${ui.switch("ai", s.ai, "AI-write it for each person", `data-sf="ai" data-i="${i}"`)}</div>
      ${s.ai ? `<p class="hint">Leave the variants empty to have each email written from the contact's details and this sequence's pitch (free LLM if configured, otherwise the built-in writer).</p>` : ""}
      ${variants.map((v, k) => `<div class="card card--pad stack" style="background:var(--panel)">
        <div class="row"><b>${variants.length > 1 ? `Variant ${String.fromCharCode(65 + k)}` : "Email"}</b><span class="spacer"></span>
          ${variants.length > 1 ? `<button class="btn btn--xs btn--ghost" data-var-del="${i}:${k}">${ico("trash", "ico--sm")} Remove</button>` : ""}</div>
        ${s.thread && i > 0 ? `<span class="hint">Subject: “re:” plus the first email's subject, so it lands in the same thread.</span>`
          : `<input class="input input--sm" data-vf="subject" data-i="${i}" data-k="${k}" value="${esc(v.subject)}" placeholder="Subject — e.g. quick question about {{company}}"/>`}
        <textarea class="textarea" rows="7" data-vf="body" data-i="${i}" data-k="${k}" placeholder="Hi {{first_name|there}},&#10;&#10;…">${esc(v.body)}</textarea>
        ${varChips(i, k)}</div>`).join("")}
      <div class="row"><button class="btn btn--sm" data-var-add="${i}">${ico("plus")} Add A/B variant</button>
        <span class="hint">Each contact gets one variant; results show per variant.</span></div>`
    : `<div class="field"><label>Task for you</label><textarea class="textarea" rows="3" data-sf="note" data-i="${i}" placeholder="Call {{first_name}} — reference the emails">${esc(s.note || "")}</textarea>
        <span class="hint">Becomes a task on the due date; {{variables}} work here too. The contact moves on when you complete it.</span></div>
      <div class="field" style="max-width:200px"><label>Priority</label><select class="select select--sm" data-sf="priority" data-i="${i}">${["low", "normal", "high"].map((p) =>
        `<option ${p === (s.priority || "normal") ? "selected" : ""}>${p}</option>`).join("")}</select></div>`}
  </div>`;
}

function stepsTab() {
  const enrolled = E.enr.filter((e) => ["active", "paused"].includes(e.status)).slice(0, 50);
  return `<div class="grid grid-main-side">
    <div>
      ${E.dirty ? `<div class="banner banner--warn mb">${ico("edit")}<div style="flex:1">Unsaved changes to the steps.</div>
        <button class="btn btn--sm" data-act="discard">Discard</button><button class="btn btn--sm btn--primary" data-act="save-steps">${ico("check")} Save steps</button></div>` : ""}
      <div class="steps">${E.steps.map(stepView).join("") || ui.empty("sequence", "No steps yet", "Add the first step below.")}</div>
      <div class="row" style="padding-left:56px"><button class="btn" data-act="add-step">${ico("plus")} Add step</button>
        ${E.dirty ? `<button class="btn btn--primary" data-act="save-steps">${ico("check")} Save steps</button>` : ""}</div>
    </div>
    <div class="card" style="position:sticky;top:16px">
      <div class="card__head"><h3>Preview</h3></div>
      <div class="card__body stack">
        <div class="row"><select class="select select--sm" data-prev-step>${E.steps.map((s, i) =>
          `<option value="${i}" ${i === E.preview.step ? "selected" : ""}>Step ${i + 1} · ${esc(typeLabel(s.type))}</option>`).join("")}</select></div>
        <select class="select select--sm" data-prev-email><option value="">Sample contact (Jane at Acme)</option>${enrolled.map((e) =>
          `<option value="${esc(e.email)}" ${e.email === E.preview.email ? "selected" : ""}>${esc(e.name || e.email)}</option>`).join("")}</select>
        <div id="seq-preview">${ui.skeleton(3)}</div>
      </div></div></div>`;
}

function contactsTab() {
  const counts = {};
  E.enr.forEach((e) => { counts[e.status] = (counts[e.status] || 0) + 1; });
  const rows = E.enr.filter((e) => E.filter === "all" || e.status === E.filter);
  const n = E.selected.size;
  return `<div class="row mb">
      <div class="seg">${["active", "paused", "finished", "replied", "bounced", "removed", "all"].map((k) =>
        `<button type="button" class="${E.filter === k ? "is-on" : ""}" data-filter="${k}">${k[0].toUpperCase() + k.slice(1)}${k !== "all" && counts[k] ? ` <span class="faint">${counts[k]}</span>` : ""}</button>`).join("")}</div>
      <span class="spacer"></span><button class="btn btn--primary btn--sm" data-act="add-contacts">${ico("user-plus")} Add contacts</button></div>
    ${n ? `<div class="bulkbar" style="border-radius:10px 10px 0 0"><span class="bulkbar__count">${n} selected</span><span class="spacer"></span>
      <button class="btn" data-bulk="paused">${ico("pause")} Pause</button><button class="btn" data-bulk="active">${ico("play")} Resume</button>
      <button class="btn" data-bulk="remove">${ico("x")} Remove</button></div>` : ""}
    <div class="card"><div class="table-wrap">${rows.length ? `<table class="tbl tbl--compact"><thead><tr><th class="col-check"></th><th>Contact</th><th>Status</th><th>Step</th><th>Next</th><th>Enrolled</th></tr></thead><tbody>
      ${rows.map((e) => `<tr><td class="col-check"><input type="checkbox" data-esel="${esc(e.email)}" ${E.selected.has(e.email) ? "checked" : ""}/></td>
        <td><a class="link" style="color:inherit" href="#/people/${encodeURIComponent(e.email)}"><b>${esc(e.name || e.email)}</b></a><div class="t-sub">${esc(e.organization || e.email)}</div></td>
        <td><span class="badge ${{ active: "badge--info", replied: "badge--good", bounced: "badge--bad", paused: "badge--warn" }[e.status] || ""}">${esc(e.status)}</span>${e.last_error ? `<div class="t-sub" style="color:var(--bad)" title="${esc(e.last_error)}">${esc(e.last_error.slice(0, 40))}</div>` : ""}</td>
        <td>${Math.min(e.step + 1, E.steps.length)} / ${E.steps.length}${e.task_id ? ' <span class="badge badge--warn badge--sm">waiting on task</span>' : ""}</td>
        <td class="t-sub">${e.status === "active" && e.next_due ? esc(fmt.due(e.next_due)) : "—"}</td>
        <td class="t-sub">${esc(fmt.date(e.enrolled))}</td></tr>`).join("")}</tbody></table>`
      : ui.empty("users", "No one here", E.filter === "active" ? "Add contacts from People, a list, or a search." : "")}</div></div>`;
}

function settingsTab() {
  const st = E.seq.settings;
  return `<form class="card" data-settings style="max-width:760px"><div class="card__body stack--lg stack">
    <div class="field"><label>Pitch for this sequence</label><textarea class="textarea" name="context" rows="4" placeholder="Defaults to your pitch in Settings">${esc(st.context || "")}</textarea>
      <span class="hint">Fills <code>{{sender_context}}</code> and guides AI-written steps.</span></div>
    ${ui.switch("send_window", st.send_window, "Send automatic emails only in business hours (weekdays 8–11 and 13–16)")}
    ${ui.switch("skip_weekends", st.skip_weekends, "Skip weekends when scheduling steps")}
    ${ui.switch("one_active", st.one_active, "Skip people already active in another sequence")}
    ${ui.switch("allow_risky", st.allow_risky, "Allow contacts whose email isn't verified safe")}
    ${ui.switch("mark_unresponsive", st.mark_unresponsive, "Mark contacts 'Unresponsive' when they finish without replying")}
    <div class="field" style="max-width:260px"><label>Daily limit for this sequence</label><input class="input" type="number" min="0" name="daily_limit" value="${st.daily_limit || 0}"/>
      <span class="hint">0 = only your mailbox's warmup cap applies.</span></div>
    <div class="row"><span class="spacer"></span><button class="btn btn--primary" type="submit">${ico("check")} Save settings</button></div></div></form>`;
}

function renderEditor() {
  const q = E.seq, s = E.stats.summary;
  ROOT.innerHTML = `<section class="page">
    <div class="crumbs"><a href="#/sequences">Sequences</a>${ico("chevron", "ico--sm")}<span>${esc(q.name)}</span></div>
    <div class="head"><div><div class="head__title"><h1>${esc(q.name)}</h1><button class="btn btn--xs btn--ghost btn--icon" data-act="rename" title="Rename">${ico("edit")}</button>
        ${q.status === "active" ? '<span class="badge badge--good"><span class="dot"></span>Active</span>' : `<span class="badge">${esc(q.status)}</span>`}</div>
      <p class="head__sub">${fmt.plural(E.steps.length, "step")} over ${dayOf(E.steps.length - 1)} days · ${esc(q.settings.context ? "custom pitch" : "pitch from Settings")}</p></div>
      <div class="head__actions">
        ${ui.switch("active", q.status === "active", q.status === "active" ? "Active" : "Paused", 'data-status')}
        <button class="btn" data-act="add-contacts">${ico("user-plus")} Add contacts</button>
        <button class="btn" data-act="run">${ico("play")} Run now</button>
        <button class="btn btn--icon" data-act="more">${ico("more")}</button></div></div>
    <div class="grid grid-4 mb">${[["Active", s.active, "users"], ["Contacted", s.contacted, "send"], ["Replied", `${fmt.num(s.replied)} <small>${fmt.pct(s.reply_rate)}</small>`, "reply"],
      ["Due now", `${fmt.num(s.due_now)}${s.open_tasks ? ` <small>${fmt.plural(s.open_tasks, "open task")}</small>` : ""}`, "clock"]].map(([l, v, i]) =>
      `<div class="card stat"><span class="stat__label">${ico(i, "ico--sm")} ${l}</span><span class="stat__value">${typeof v === "number" ? fmt.num(v) : v}</span></div>`).join("")}</div>
    <div class="tabs" style="border-bottom:1px solid var(--line);margin-bottom:16px">${[["steps", "Steps", E.steps.length], ["contacts", "Contacts", s.enrolled], ["settings", "Settings"]].map(([k, l, n]) =>
      `<button type="button" class="${E.tab === k ? "is-on" : ""}" data-tab="${k}">${l}${n ? ` <span class="cnt">${n}</span>` : ""}</button>`).join("")}</div>
    <div id="seq-tab">${{ steps: stepsTab, contacts: contactsTab, settings: settingsTab }[E.tab]()}</div></section>`;
  if (E.tab === "steps") refreshPreview();
}

const refreshPreview = (() => {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const el = $("#seq-preview", ROOT); if (!el || !E.steps.length) return;
      if (E.dirty) { el.innerHTML = '<p class="hint">Save the steps to preview your changes.</p>'; return; }
      try {
        const r = await api.post("/api/sequences/preview", { id: E.seq.id, step: E.preview.step, email: E.preview.email || undefined });
        if (!r.draft) { el.innerHTML = `<div class="banner">${ico(TYPE_ICON[r.type] || "task")}<div><b>${esc(typeLabel(r.type))}</b> — becomes a task: “${esc(r.note || typeLabel(r.type))}”</div></div>`; return; }
        el.innerHTML = `<div class="email-card" style="background:var(--panel)"><div class="hint">To ${esc(r.draft.email)}${r.sample ? " (sample)" : ""}${r.variant ? ` · variant ${String.fromCharCode(65 + r.variant)}` : ""}</div>
          <b>${esc(r.draft.subject)}</b><div style="white-space:pre-wrap;font-size:13px">${esc(r.draft.body)}</div>
          <div class="row row--wrap">${r.draft.lint ? `<span class="badge ${r.draft.lint.ok ? "badge--good" : "badge--warn"}">spam score ${r.draft.lint.score}</span>` : ""}
          ${(r.missing || []).map((m) => `<span class="badge badge--warn" title="Blank for this contact">{{${esc(m)}}} blank</span>`).join("")}</div></div>`;
      } catch (e) { el.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
    }, 200);
  };
})();

async function saveSteps() {
  try {
    const r = await api.post("/api/sequences/save", { id: E.seq.id, steps: E.steps });
    E.seq = r.sequence; E.steps = JSON.parse(JSON.stringify(r.sequence.steps)); E.dirty = false; E.editing = -1;
    toast("Steps saved"); await reloadEditor();
  } catch (e) { fail(e); }
}

async function reloadEditor() { await loadSeq(E.seq.id); renderEditor(); }

async function addContacts() {
  const lists = (await api.get("/api/lists", { kind: "people" })).lists || [];
  let res = null;
  await modal({
    title: `Add contacts to ${E.seq.name}`, body: `
      <div class="field"><label>From a list</label><select class="select" name="list"><option value="">— choose a list —</option>${lists.map((l) =>
        `<option value="${l.id}">${esc(l.name)} (${fmt.num(l.count)})</option>`).join("")}</select></div>
      <div class="field"><label>Or paste emails</label><textarea class="textarea" name="emails" rows="4" placeholder="jane@acme.com, john@beta.io"></textarea>
        <span class="hint">They must already be in People. Tip: select people in <a class="link" href="#/people">People</a> and use “Add to sequence”.</span></div>
      <label class="check"><input type="checkbox" name="force"/> Include contacts whose email isn't verified safe</label>`,
    actions: [{ label: "Cancel", value: null }, { label: "Add", kind: "primary", submit: true }],
    onSubmit: async (f) => {
      const body = { id: E.seq.id, force: f.force.checked };
      if (f.list.value) body.list_id = f.list.value; else body.emails = f.emails.value;
      res = await api.post("/api/sequences/enroll", body); return true;
    },
  });
  if (!res) return;
  toast(`Enrolled ${res.enrolled.length}${res.skipped.length ? ` · ${res.skipped.length} skipped` : ""}`);
  if (res.skipped.length) showSkipped(res.skipped);
  await reloadEditor();
}

async function runNow(anchor) {
  menu(anchor, [{ header: "Run due steps now" },
    { label: "Preview (dry run)", value: false, icon: "eye" },
    { label: "Send for real", value: true, icon: "send", danger: true }], async (live) => {
    const paused = E.seq.status !== "active";
    if (live && !(await confirmDialog(paused
      ? "This sequence is paused. Activate it and send every automatic email that's due now, and create due tasks?"
      : "Send every automatic email that's due in this sequence now, and create due tasks?",
    { title: "Run live?", ok: paused ? "Activate & run" : "Run now", danger: true }))) return;
    let done = null;
    try {
      if (live && paused) await api.post("/api/sequences/status", { id: E.seq.id, status: "active" });
      await api.stream("/api/sequences/run", { id: E.seq.id, live, ignore_window: true }, (ev) => { if (ev.type === "done") done = ev; });
      if (done) {
        toast(`${done.due} due · ${live ? `${done.sent} sent` : `${done.previewed} previewed`} · ${done.tasks} tasks${done.capped ? ` · ${done.capped} over the cap` : ""}`);
        if (!live && done.results.length) {
          modal({ title: "Dry run — what would send", wide: true, body: `<div class="table-wrap" style="max-height:420px;border:1px solid var(--line);border-radius:10px"><table class="tbl tbl--compact"><thead><tr><th>To</th><th>Step</th><th>Subject</th></tr></thead><tbody>
            ${done.results.map((r) => `<tr><td class="t-mono">${esc(r.email)}</td><td>${r.step}${r.variant ? " · " + String.fromCharCode(65 + r.variant) : ""}</td><td>${esc(r.subject)}</td></tr>`).join("")}</tbody></table></div>` });
        }
      }
      await reloadEditor();
      document.dispatchEvent(new Event("ol:refresh-badges"));
    } catch (e) { fail(e); }
  }, { align: "right" });
}

function insertAtCursor(el, text) {
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, s) + text + el.value.slice(e);
  el.selectionStart = el.selectionEnd = s + text.length;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
}

function bindEditor(root) {
  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.vf) {
      const s = E.steps[+t.dataset.i];
      s.variants = s.variants && s.variants.length ? s.variants : [{ subject: "", body: "" }];
      s.variants[+t.dataset.k][t.dataset.vf] = t.value; markDirty();
    } else if (t.dataset.sf && t.type !== "checkbox" && t.tagName !== "SELECT") {
      E.steps[+t.dataset.i][t.dataset.sf] = t.dataset.sf === "delay_days" ? Math.max(0, +t.value || 0) : t.value; markDirty(false);
    }
  });
  root.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.sf && (t.type === "checkbox" || t.tagName === "SELECT")) {
      const s = E.steps[+t.dataset.i];
      s[t.dataset.sf] = t.type === "checkbox" ? t.checked : t.value;
      if (t.dataset.sf === "type" && (s.type === "auto_email" || s.type === "manual_email") && !s.variants) s.variants = [{ subject: "", body: "" }];
      markDirty(true);
    } else if (t.matches("[data-status]")) {
      try { await api.post("/api/sequences/status", { id: E.seq.id, status: t.checked ? "active" : "paused" }); toast(t.checked ? "Sequence active" : "Sequence paused"); await reloadEditor(); }
      catch (err) { t.checked = !t.checked; fail(err); }
    } else if (t.matches("[data-prev-step]")) { E.preview.step = +t.value; refreshPreview(); }
    else if (t.matches("[data-prev-email]")) { E.preview.email = t.value; refreshPreview(); }
    else if (t.dataset.esel) { t.checked ? E.selected.add(t.dataset.esel) : E.selected.delete(t.dataset.esel); rerenderTab(); }
  });
  root.addEventListener("submit", async (e) => {
    if (!e.target.matches("[data-settings]")) return;
    e.preventDefault();
    const f = e.target;
    const settings = { context: f.context.value, daily_limit: +f.daily_limit.value || 0 };
    ["send_window", "skip_weekends", "one_active", "allow_risky", "mark_unresponsive"].forEach((k) => { settings[k] = f[k].checked; });
    try { await api.post("/api/sequences/save", { id: E.seq.id, settings }); toast("Settings saved"); await reloadEditor(); } catch (err) { fail(err); }
  });
  root.addEventListener("click", async (e) => {
    const t = e.target;
    const g = (a) => t.closest(`[${a}]`);
    if (g("data-tab")) { E.tab = g("data-tab").dataset.tab; renderEditor(); return; }
    if (g("data-filter")) { E.filter = g("data-filter").dataset.filter; E.selected.clear(); rerenderTab(); return; }
    if (g("data-step-edit")) { const i = +g("data-step-edit").dataset.stepEdit; E.editing = E.editing === i ? -1 : i; rerenderTab(); return; }
    if (g("data-step-up") || g("data-step-down")) {
      const up = !!g("data-step-up"); const i = +(g("data-step-up") || g("data-step-down")).dataset[up ? "stepUp" : "stepDown"];
      const j = up ? i - 1 : i + 1; [E.steps[i], E.steps[j]] = [E.steps[j], E.steps[i]]; E.editing = -1; markDirty(true); return;
    }
    if (g("data-step-del")) {
      const i = +g("data-step-del").dataset.stepDel;
      if (await confirmDialog(`Delete step ${i + 1}? People waiting on it move to the next step.`, { ok: "Delete", danger: true })) { E.steps.splice(i, 1); E.editing = -1; markDirty(true); }
      return;
    }
    if (g("data-var-add")) { const s = E.steps[+g("data-var-add").dataset.varAdd]; s.variants = [...(s.variants?.length ? s.variants : [{ subject: "", body: "" }]), { subject: s.variants?.[0]?.subject || "", body: "" }]; markDirty(true); return; }
    if (g("data-var-del")) { const [i, k] = g("data-var-del").dataset.varDel.split(":").map(Number); E.steps[i].variants.splice(k, 1); markDirty(true); return; }
    if (g("data-insert")) {
      const b = g("data-insert");
      const field = $(`[data-vf="body"][data-i="${b.dataset.i}"][data-k="${b.dataset.k}"]`, root);
      if (field) insertAtCursor(field, b.dataset.insert); return;
    }
    if (g("data-bulk")) {
      const what = g("data-bulk").dataset.bulk, emails = Array.from(E.selected);
      try {
        if (what === "remove") await api.post("/api/sequences/unenroll", { id: E.seq.id, emails });
        else await api.post("/api/sequences/pause", { id: E.seq.id, emails, status: what });
        E.selected.clear(); toast("Updated"); await reloadEditor();
      } catch (err) { fail(err); }
    }
  });
  onAct(root, {
    "save-steps": saveSteps,
    discard: async () => { await reloadEditor(); },
    "add-step": (el) => menu(el, (store.meta?.step_types || []).map((t) => ({ label: t.label, value: t.key, icon: TYPE_ICON[t.key] })), (type) => {
      const email = type === "auto_email" || type === "manual_email";
      E.steps.push({ type, delay_days: E.steps.length ? 3 : 0, thread: email && E.steps.length > 0, ai: false,
        variants: email ? [{ subject: "", body: "Hi {{first_name|there}},\n\n\n\n{{sender_name}}" }] : undefined, note: "", priority: "normal" });
      E.editing = E.steps.length - 1; markDirty(true);
    }),
    "add-contacts": addContacts,
    run: (el) => runNow(el),
    rename: async () => {
      const name = await promptDialog({ title: "Rename sequence", label: "Name", value: E.seq.name });
      if (name) { try { await api.post("/api/sequences/save", { id: E.seq.id, name }); await reloadEditor(); } catch (err) { fail(err); } }
    },
    more: (el) => menu(el, [{ label: "Archive", value: "archive", icon: "layers" }, { sep: true }, { label: "Delete sequence", value: "delete", icon: "trash", danger: true }], async (v) => {
      if (v === "archive") { await api.post("/api/sequences/status", { id: E.seq.id, status: "archived" }); toast("Archived"); router.go("sequences"); }
      if (v === "delete" && await confirmDialog(`Delete '${E.seq.name}'? Everyone in it is removed and its open tasks are deleted. The send log stays.`, { ok: "Delete", danger: true })) {
        await api.post("/api/sequences/delete", { id: E.seq.id }); toast("Deleted"); router.go("sequences");
      }
    }, { align: "right" }),
  });
}

function markDirty(rerender = true) {
  E.dirty = true;
  if (rerender) rerenderTab();
  else if (!$(".banner--warn", ROOT)) rerenderTab(true);
}
function rerenderTab(keepFocus = false) {
  const el = $("#seq-tab", ROOT); if (!el) return;
  const active = keepFocus ? document.activeElement : null;
  const sel = active && { vf: active.dataset.vf, sf: active.dataset.sf, i: active.dataset.i, k: active.dataset.k,
    start: active.selectionStart, end: active.selectionEnd };
  el.innerHTML = { steps: stepsTab, contacts: contactsTab, settings: settingsTab }[E.tab]();
  if (sel && (sel.vf || sel.sf)) {
    const q = sel.vf ? `[data-vf="${sel.vf}"][data-i="${sel.i}"][data-k="${sel.k}"]` : `[data-sf="${sel.sf}"][data-i="${sel.i}"]`;
    const again = $(q, el);
    if (again) { again.focus(); try { again.setSelectionRange(sel.start, sel.end); } catch (_) { /* number input */ } }
  }
  if (E.tab === "steps") refreshPreview();
}

router.register("sequences", {
  title: "Sequences",
  async mount(root, ctx) {
    ROOT = root;
    root.innerHTML = `<div class="page">${ui.skeleton(6)}</div>`;
    if (ctx.id) {
      Object.assign(E, { tab: "steps", editing: -1, filter: "active", preview: { step: 0, email: "" }, selected: new Set() });
      await loadSeq(ctx.id); renderEditor(); bindEditor(root);
    } else {
      await renderIndex();
      onAct(root, { new: newSequence });
      root.addEventListener("click", (e) => {
        const tr = e.target.closest("tr[data-open]");
        if (tr && !e.target.closest("label, input")) router.go("sequences", tr.dataset.open);
      });
      root.addEventListener("change", async (e) => {
        const t = e.target.closest("[data-toggle]");
        if (!t) return;
        try { await api.post("/api/sequences/status", { id: t.dataset.toggle, status: t.checked ? "active" : "paused" }); toast(t.checked ? "Activated" : "Paused"); await renderIndex(); }
        catch (err) { t.checked = !t.checked; fail(err); }
      });
    }
  },
});
