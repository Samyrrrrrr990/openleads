/* =========================================================================
   Tasks — the call, email, LinkedIn and to-do queue. Sequence steps that need
   a human land here; finishing one moves that contact to their next step.
   Open tasks are grouped Overdue / Today / Upcoming / No date. "Start queue"
   works them one at a time with the contact's details beside each.
   ========================================================================= */
import { writeEmails } from "../actions.js";
import { $, api, confirmDialog, drawer, esc, fail, fmt, ico, menu, modal, onAct, router, store, toast, ui } from "../core.js";

const KIND_ICON = { call: "phone", email: "mail", linkedin: "linkedin", todo: "task" };
const SECTIONS = [["overdue", "Overdue"], ["today", "Today"], ["upcoming", "Upcoming"], ["nodate", "No date"]];
const T = { tab: "open", kind: "", q: "", tasks: [], counts: {} };
let ROOT = null;

function dayStart(offset = 0) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d.getTime() / 1000; }

function sectionOf(t) {
  if (!t.due) return "nodate";
  if (t.due < dayStart(0)) return "overdue";
  if (t.due < dayStart(1)) return "today";
  return "upcoming";
}

function quick(t) {
  if (t.status !== "open") return "";
  if (t.kind === "call" && t.contact_phone) {
    return `<a class="btn btn--xs" href="tel:${esc(t.contact_phone)}" title="Call">${ico("phone", "ico--sm")} ${esc(fmt.phone(t.contact_phone))}</a>`;
  }
  if (t.kind === "linkedin" && t.contact_linkedin) {
    return `<a class="btn btn--xs" href="${esc(t.contact_linkedin)}" target="_blank" rel="noopener noreferrer">${ico("linkedin", "ico--sm")} Open profile</a>`;
  }
  if (t.kind === "email" && t.contact) return `<button class="btn btn--xs" data-act="write" data-email="${esc(t.contact)}">${ico("compose", "ico--sm")} Write</button>`;
  return "";
}

function row(t) {
  const done = t.status !== "open";
  const sec = done ? "" : sectionOf(t);
  return `<div class="task-row ${done ? "is-done" : ""}" data-task="${t.id}">
    <button class="task-check" data-act="${done ? "reopen" : "done"}" data-id="${t.id}" title="${done ? "Reopen" : "Mark done"}" aria-label="${done ? "Reopen" : "Mark done"}">${ico("check", "ico--sm")}</button>
    <span class="task-kind task-kind--${esc(t.kind)}" title="${esc(store.label("task_kinds", t.kind))}">${ico(KIND_ICON[t.kind] || "task", "ico--sm")}</span>
    <div class="task-main">
      <div class="task-title">${esc(t.title)}${t.priority === "high" ? ` <span class="badge badge--sm badge--bad">High</span>` : ""}${t.status === "skipped" ? ` <span class="badge badge--sm">Skipped</span>` : ""}</div>
      <div class="hint ellipsis">${t.contact ? `<a class="link" href="#/people/${encodeURIComponent(t.contact)}">${esc(t.contact_name || t.contact)}</a>${t.contact_org ? ` · ${esc(t.contact_org)}` : ""}` : ""}
        ${t.sequence_name ? `${t.contact ? " · " : ""}<a class="link" href="#/sequences/${t.sequence_id}">${ico("sequence", "ico--sm")} ${esc(t.sequence_name)} · step ${(t.step ?? 0) + 1}</a>` : ""}
        ${t.note ? `${t.contact || t.sequence_name ? " · " : ""}<span class="faint">${esc(t.note)}</span>` : ""}</div>
    </div>
    <div class="task-quick">${quick(t)}</div>
    <span class="task-due ${sec === "overdue" ? "is-late" : ""}">${done ? `Done ${esc(fmt.rel(t.completed))}` : esc(fmt.due(t.due))}</span>
    <button class="btn btn--xs btn--ghost btn--icon" data-act="more" data-id="${t.id}" title="More">${ico("more")}</button>
  </div>`;
}

function visible() {
  const q = T.q.trim().toLowerCase();
  return T.tasks.filter((t) => (!T.kind || t.kind === T.kind)
    && (!q || [t.title, t.contact, t.contact_name, t.contact_org, t.note, t.sequence_name].some((v) => String(v || "").toLowerCase().includes(q))));
}

function listHtml() {
  const rows = visible();
  if (!rows.length) {
    return T.tab === "done"
      ? ui.empty("check", "Nothing completed yet", "Finished and skipped tasks show up here.")
      : ui.empty("task", T.q || T.kind ? "No tasks match" : "You're all caught up",
        T.q || T.kind ? "Try another filter." : "Calls, emails and LinkedIn steps from your sequences land here when they're due. You can also add your own.",
        `<button class="btn btn--primary" data-act="new">${ico("plus")} New task</button>`);
  }
  if (T.tab === "done") return `<div class="card task-list">${rows.map(row).join("")}</div>`;
  return SECTIONS.map(([key, label]) => {
    const items = rows.filter((t) => sectionOf(t) === key);
    if (!items.length) return "";
    return `<div class="task-section"><div class="task-section__head"><h3>${label}</h3><span class="faint">${items.length}</span></div>
      <div class="card task-list">${items.map(row).join("")}</div></div>`;
  }).join("");
}

function render() {
  const c = T.counts;
  const due = (c.overdue || 0) + (c.today || 0);
  ROOT.innerHTML = `<section class="page">
    <div class="head"><div><div class="head__title"><h1>Tasks</h1></div>
      <p class="head__sub">Calls, emails and LinkedIn touches — from your sequences and your own follow-ups. Finishing a sequence task moves that person to their next step.</p></div>
      <div class="head__actions">
        ${due ? `<button class="btn" data-act="queue">${ico("play")} Start queue <span class="faint">${due}</span></button>` : ""}
        <button class="btn btn--primary" data-act="new">${ico("plus")} New task</button></div></div>
    <div class="grid grid-4 mb">${[["Overdue", c.overdue, "flag", "bad"], ["Due today", c.today, "clock", ""], ["Upcoming", c.upcoming, "calendar", ""], ["Done today", c.done_today, "check", "good"]].map(([l, v, i, tone]) =>
      `<div class="card stat"><div class="stat__label">${ico(i, "ico--sm")} ${l}</div><div class="stat__value" ${tone && v ? `style="color:var(--${tone})"` : ""}>${fmt.num(v || 0)}</div></div>`).join("")}</div>
    <div class="toolbar toolbar--bare mb">
      <div class="seg" role="tablist">${[["open", `To do <span class="faint">${fmt.num(c.open || 0)}</span>`], ["done", "Completed"]].map(([k, l]) =>
        `<button type="button" class="${T.tab === k ? "is-on" : ""}" data-act="tab" data-k="${k}">${l}</button>`).join("")}</div>
      <div class="seg">${[["", "All"], ...(store.meta?.task_kinds || []).map((k) => [k.key, k.label])].map(([k, l]) =>
        `<button type="button" class="${T.kind === k ? "is-on" : ""}" data-act="kind" data-k="${k}">${k ? ico(KIND_ICON[k], "ico--sm") : ""} ${esc(l)}</button>`).join("")}</div>
      <span class="spacer"></span>
      <div class="search-input">${ico("find", "ico--sm")}<input class="input input--sm" id="task-q" placeholder="Filter tasks" value="${esc(T.q)}"/></div>
    </div>
    <div id="task-list">${listHtml()}</div>
  </section>`;
}

async function load() {
  const r = await api.get("/api/tasks", { bucket: T.tab === "done" ? "done" : "open" });
  T.tasks = r.tasks || []; T.counts = r.counts || {};
}

async function reload() {
  await load(); render();
  document.dispatchEvent(new Event("ol:refresh-badges"));
}

export async function editTask(task = null, defaults = {}) {
  const t = task || { kind: "call", priority: "normal", ...defaults };
  const dueVal = t.due ? new Date(t.due * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  let saved = null;
  await modal({
    title: task ? "Edit task" : "New task",
    body: `<div class="field"><label>Type</label><div class="seg">${(store.meta?.task_kinds || []).map((k) =>
        `<label><input type="radio" name="kind" value="${k.key}" ${k.key === t.kind ? "checked" : ""}/> ${ico(KIND_ICON[k.key], "ico--sm")} ${esc(k.label)}</label>`).join("")}</div></div>
      <div class="field"><label>Title</label><input class="input" name="title" value="${esc(t.title || "")}" placeholder="Call about the pilot" autofocus/></div>
      <div class="form-grid">
        <div class="field"><label>Contact email</label><input class="input" name="contact" value="${esc(t.contact || "")}" placeholder="jane@acme.com (optional)"/></div>
        <div class="field"><label>Priority</label><select class="select" name="priority">${["low", "normal", "high"].map((p) =>
          `<option value="${p}" ${p === (t.priority || "normal") ? "selected" : ""}>${p[0].toUpperCase() + p.slice(1)}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label>Due</label><div class="row row--wrap" style="gap:6px">
        <input class="input" type="datetime-local" name="due" value="${dueVal}" style="max-width:230px"/>
        ${[["today", "Today"], ["tomorrow", "Tomorrow"], ["+3d", "In 3 days"], ["+1w", "Next week"]].map(([v, l]) =>
          `<button type="button" class="btn btn--sm" data-due="${v}">${l}</button>`).join("")}
        <button type="button" class="btn btn--sm btn--ghost" data-due="">No date</button></div><input type="hidden" name="due_word"/></div>
      <div class="field"><label>Note</label><textarea class="textarea" name="note" rows="3" placeholder="What to cover">${esc(t.note || "")}</textarea></div>`,
    actions: [{ label: "Cancel", value: null }, { label: task ? "Save" : "Create task", kind: "primary", submit: true }],
    onMount: (f) => {
      f.addEventListener("click", (e) => {
        const b = e.target.closest("[data-due]"); if (!b) return;
        f.due_word.value = b.dataset.due || "none"; f.due.value = "";
        f.querySelectorAll("[data-due]").forEach((x) => x.classList.toggle("is-on", x === b));
      });
      f.due.addEventListener("input", () => { f.due_word.value = ""; f.querySelectorAll("[data-due]").forEach((x) => x.classList.remove("is-on")); });
    },
    onSubmit: async (f) => {
      const word = f.due_word.value;
      const due = word === "none" ? "" : word || (f.due.value ? new Date(f.due.value).getTime() / 1000 : (task ? t.due || "" : ""));
      const body = { title: f.title.value, kind: f.kind.value, contact: f.contact.value.trim(), priority: f.priority.value, note: f.note.value, due };
      if (task) body.id = task.id;
      saved = (await api.post("/api/tasks/save", body)).task;
      toast(task ? "Task saved" : "Task created");
      return true;
    },
  });
  if (saved) document.dispatchEvent(new Event("ol:refresh-badges"));
  return saved;
}

async function act(path, id, msg) {
  await api.post(path, { id });
  if (msg) toast(msg);
}

function moreMenu(el) {
  const t = T.tasks.find((x) => String(x.id) === el.dataset.id);
  if (!t) return;
  const open = t.status === "open";
  menu(el, [
    ...(open ? [{ header: "Snooze" }, { label: "Tomorrow", value: "s:tomorrow", icon: "clock" }, { label: "In 3 days", value: "s:+3d", icon: "clock" },
      { label: "Next week", value: "s:+1w", icon: "calendar" }, { sep: true }] : []),
    { label: "Edit", value: "edit", icon: "edit" },
    ...(t.contact ? [{ label: "Open contact", value: "contact", icon: "user" }] : []),
    ...(open ? [{ label: "Skip", value: "skip", icon: "arrow" }] : [{ label: "Reopen", value: "reopen", icon: "refresh" }]),
    { sep: true }, { label: "Delete", value: "delete", icon: "trash", danger: true },
  ], async (v) => {
    try {
      if (v.startsWith("s:")) { await api.post("/api/tasks/save", { id: t.id, due: v.slice(2) }); toast("Snoozed"); }
      else if (v === "edit") { if (!(await editTask(t))) return; }
      else if (v === "contact") { router.go("people", t.contact); return; }
      else if (v === "skip") await act("/api/tasks/skip", t.id, "Skipped");
      else if (v === "reopen") await act("/api/tasks/reopen", t.id, "Reopened");
      else if (v === "delete") {
        if (!(await confirmDialog(`Delete '${t.title}'?${t.sequence_id ? " The contact moves on to the next sequence step." : ""}`, { ok: "Delete", danger: true }))) return;
        await act("/api/tasks/delete", t.id, "Deleted");
      }
      await reload();
    } catch (err) { fail(err); }
  }, { align: "right" });
}

async function writeTo(email) {
  const d = await api.get("/api/people/get", { email });
  writeEmails([d.contact]);
}

/* ------------------------------------------------------------- queue */
async function startQueue() {
  const r = await api.get("/api/tasks", { bucket: "open" });
  const queue = (r.tasks || []).filter((t) => t.due && t.due < dayStart(1) && (!T.kind || t.kind === T.kind));
  if (!queue.length) { toast("Nothing due right now"); return; }
  let i = 0, done = 0;
  const d = drawer({ onClose: () => { document.removeEventListener("keydown", keys); reload(); } });
  d.el.classList.add("drawer--wide");

  async function show() {
    if (i >= queue.length) {
      d.el.innerHTML = `<div class="drawer__body"><div class="empty" style="padding-top:80px"><div class="empty__icon">${ico("check")}</div>
        <h3>Queue cleared</h3><p>${fmt.plural(done, "task")} done this round.</p>
        <div class="row mt" style="justify-content:center"><button class="btn btn--primary" data-q="close">Back to tasks</button></div></div></div>`;
      return;
    }
    const t = queue[i];
    d.el.innerHTML = `<div class="drawer__head"><div class="row" style="flex:1;gap:10px"><b>Task ${i + 1} of ${queue.length}</b>
        <div class="progress" style="flex:1;max-width:220px"><span style="width:${Math.round((i / queue.length) * 100)}%"></span></div></div>
        <button class="btn btn--ghost btn--icon btn--sm" data-q="close" title="Close (Esc)">${ico("x")}</button></div>
      <div class="drawer__body" id="q-body">${ui.skeleton(4)}</div>
      <div class="drawer__foot"><button class="btn" data-q="skip">Skip <kbd>S</kbd></button>
        <button class="btn" data-q="snooze">Snooze a day <kbd>Z</kbd></button><span class="spacer"></span>
        <button class="btn btn--primary" data-q="done">${ico("check")} Complete &amp; next <kbd>↵</kbd></button></div>`;
    let p = null;
    if (t.contact) { try { p = await api.get("/api/people/get", { email: t.contact }); } catch (_) { p = null; } }
    if (d.closed || queue[i] !== t) return;
    const c = p?.contact;
    $("#q-body", d.el).innerHTML = `<div class="stack">
      <div class="row" style="gap:10px"><span class="task-kind task-kind--${esc(t.kind)}" style="width:34px;height:34px">${ico(KIND_ICON[t.kind] || "task")}</span>
        <div><h2 style="margin:0">${esc(t.title)}</h2><div class="hint">${esc(fmt.due(t.due))}${t.sequence_name ? ` · ${esc(t.sequence_name)} step ${(t.step ?? 0) + 1}` : ""}</div></div></div>
      ${t.note ? `<div class="callout">${esc(t.note)}</div>` : ""}
      ${c ? `<div class="card card--pad stack">
        <div class="row" style="gap:12px">${ui.avatar(ui.name(c), c.email, "avatar--lg")}<div style="min-width:0">
          <div class="t-strong" style="font-size:15px">${esc(ui.name(c) || c.email)}</div>
          <div class="muted">${esc([c.title, c.organization].filter(Boolean).join(" at "))}</div></div>
          <span class="spacer"></span>${ui.stage(c.stage)}</div>
        <div class="row row--wrap" style="gap:6px">
          ${c.phone ? `<a class="btn btn--sm ${t.kind === "call" ? "btn--primary" : ""}" href="tel:${esc(c.phone)}">${ico("phone")} ${esc(fmt.phone(c.phone))}</a>${ui.copy(c.phone, "Copy phone")}` : ""}
          <button class="btn btn--sm ${t.kind === "email" ? "btn--primary" : ""}" data-q="write">${ico("mail")} ${esc(c.email)}</button>
          ${c.linkedin_url ? `<a class="btn btn--sm ${t.kind === "linkedin" ? "btn--primary" : ""}" href="${esc(c.linkedin_url)}" target="_blank" rel="noopener noreferrer">${ico("linkedin")} LinkedIn</a>` : ""}
          <a class="btn btn--sm btn--ghost" href="#/people/${encodeURIComponent(c.email)}" data-q="close">${ico("external")} Full record</a></div>
        ${p.notes?.length ? `<div><div class="hint mb-sm">Latest note</div><div class="callout">${esc(p.notes[0].body)}</div></div>` : ""}
        <div class="field"><label>Add a note</label><textarea class="textarea" rows="3" id="q-note" placeholder="What happened on the call?"></textarea></div>
      </div>` : `<p class="muted">No contact on this task.</p>`}
    </div>`;
  }

  async function step(kind) {
    const t = queue[i];
    try {
      const note = $("#q-note", d.el)?.value.trim();
      if (note && t.contact) await api.post("/api/notes/add", { ref_type: "contact", ref: t.contact, body: note });
      if (kind === "done") { await api.post("/api/tasks/complete", { id: t.id }); done++; }
      else if (kind === "skip") await api.post("/api/tasks/skip", { id: t.id });
      else if (kind === "snooze") await api.post("/api/tasks/save", { id: t.id, due: "tomorrow" });
      i++; show();
    } catch (err) { fail(err); }
  }

  function keys(e) {
    if (d.closed || e.target.closest("textarea, input")) return;
    if (e.key === "Enter") { e.preventDefault(); step("done"); }
    else if (e.key === "s" || e.key === "S") step("skip");
    else if (e.key === "z" || e.key === "Z") step("snooze");
  }
  document.addEventListener("keydown", keys);
  d.el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-q]"); if (!b) return;
    const q = b.dataset.q;
    if (q === "close") { d.close(); return; }
    if (q === "write") { const t = queue[i]; d.close(); writeTo(t.contact).catch(fail); return; }
    step(q);
  });
  show();
}

router.register("tasks", {
  title: "Tasks",
  async mount(root, ctx) {
    ROOT = root;
    T.tab = ctx.params.tab === "done" ? "done" : "open";
    T.kind = ctx.params.kind || "";
    root.innerHTML = `<div class="page">${ui.skeleton(8)}</div>`;
    await load(); render();
    onAct(root, {
      new: async () => { if (await editTask()) await reload(); },
      queue: () => startQueue().catch(fail),
      tab: async (el) => { T.tab = el.dataset.k; await load(); render(); },
      kind: (el) => { T.kind = el.dataset.k; render(); },
      done: async (el) => {
        const r = el.closest(".task-row"); r.classList.add("is-leaving");
        await act("/api/tasks/complete", el.dataset.id, "Task done");
        setTimeout(reload, 180);
      },
      reopen: async (el) => { await act("/api/tasks/reopen", el.dataset.id, "Reopened"); await reload(); },
      more: (el) => moreMenu(el),
      write: (el) => writeTo(el.dataset.email),
    });
    root.addEventListener("input", (e) => {
      if (e.target.id !== "task-q") return;
      T.q = e.target.value; $("#task-list", root).innerHTML = listHtml();
    });
  },
});
