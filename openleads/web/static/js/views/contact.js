/* =========================================================================
   The contact record — a drawer over People (and anywhere else that links a
   person). Email evidence and why, fit score and its reasons, editable
   details, tags, lists, sequences, the company, and tabs for the timeline,
   tasks, deals and notes.
   ========================================================================= */
import { addToList, enroll } from "../actions.js";
import { $, api, confirmDialog, drawer, esc, fail, fmt, ico, menu, modal, router, store, toast, ui } from "../core.js";
import { timeline } from "../timeline.js";

const EDIT = [["first_name", "First name"], ["last_name", "Last name"], ["title", "Title"],
  ["organization", "Company"], ["phone", "Phone"], ["linkedin_url", "LinkedIn URL"], ["city", "City"],
  ["state", "State / region"], ["country", "Country"], ["owner", "Owner"]];

/** "VP of Sales" at a dental practice in Austin → "vps of sales at dental companies in Austin". */
export function lookalikeQuery(c) {
  const title = (c.title || "").split(/[,|·(&]/)[0].trim();
  const topRole = ["owner", "founder", "c_suite", "partner"].includes(c.seniority) || c.department === "executive";
  const role = c.seniority && c.department && !topRole
    ? `${store.label("seniorities", c.seniority)} of ${store.label("departments", c.department)}`
    : title || (c.seniority ? store.label("seniorities", c.seniority) : "") || "founders";
  const where = c.city || c.state || c.country || "";
  const industry = (c.industry || "").trim();
  return `${role}${industry ? ` at ${industry.toLowerCase()} companies` : ""}${where ? ` in ${where}` : ""}`.trim();
}

export function openContact(email, { onClose, onChange } = {}) {
  const d = drawer({ onClose });
  const h = { email, close: d.close, get closed() { return d.closed; } };
  let data = null, tab = "overview", editing = false, why = null;
  const changed = () => { onChange && onChange(); document.dispatchEvent(new Event("ol:refresh-badges")); };

  async function load() {
    try { data = await api.get("/api/people/get", { email }); }
    catch (e) { d.el.innerHTML = `<div class="drawer__body">${ui.empty("user", "Contact not found", esc(e.message))}</div>`; return; }
    render();
  }

  function head() {
    const c = data.contact, name = ui.name(c);
    const stages = store.meta?.contact_stages || [];
    return `<div class="drawer__head"><div class="drawer__top">
        ${name ? ui.avatar(name, c.email, "avatar--lg") : ui.companyAvatar(c.organization, "avatar--lg")}
        <div class="drawer__title"><h2>${esc(name || c.organization || c.email)}</h2>
          <div class="sub">${esc(c.title || "")}${c.title && c.organization ? " · " : ""}${c.domain
            ? `<a class="link" href="#/companies/${encodeURIComponent(c.domain)}">${esc(c.organization || c.domain)}</a>` : esc(c.organization || "")}</div>
          <div class="row row--wrap mt" style="gap:6px">
            ${c.seniority ? `<span class="badge badge--outline">${esc(store.label("seniorities", c.seniority))}</span>` : ""}
            ${c.department ? `<span class="badge badge--outline">${esc(store.label("departments", c.department))}</span>` : ""}
            ${c.city || c.country ? `<span class="badge badge--outline">${ico("pin", "ico--sm")}${esc([c.city, c.state || c.country].filter(Boolean).join(", "))}</span>` : ""}
            ${ui.grade(c.fit_score)}</div></div>
        <button class="btn btn--ghost btn--icon" data-x title="Close (Esc)">${ico("x")}</button></div>
      <div class="drawer__actions">
        <select class="select select--sm" data-stage style="width:auto" aria-label="Stage">${stages.map((s) =>
          `<option value="${s.key}" ${s.key === (c.stage || "new") ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select>
        <a class="btn btn--sm" href="mailto:${esc(c.email)}">${ico("mail")} Email</a>
        ${c.phone ? `<a class="btn btn--sm" href="tel:${esc(c.phone)}">${ico("phone")} Call</a>` : ""}
        ${c.linkedin_url ? `<a class="btn btn--sm" href="${esc(c.linkedin_url)}" target="_blank" rel="noopener noreferrer">${ico("linkedin")} LinkedIn</a>` : ""}
        <button class="btn btn--sm" data-a="seq">${ico("sequence")} Sequence</button>
        <button class="btn btn--sm" data-a="list">${ico("list")} List</button>
        <button class="btn btn--sm" data-a="task">${ico("task")} Task</button>
        <button class="btn btn--sm" data-a="deal">${ico("deal")} Deal</button>
        <button class="btn btn--sm btn--icon" data-a="more" title="More">${ico("more")}</button></div>
      <div class="tabs">${[["overview", "Overview"], ["activity", "Activity", data.timeline.length], ["tasks", "Tasks", data.tasks.filter((t) => t.status === "open").length],
        ["deals", "Deals", data.deals.length], ["notes", "Notes", data.notes.length]].map(([k, l, n]) =>
        `<button type="button" class="${tab === k ? "is-on" : ""}" data-tab="${k}">${l}${n ? ` <span class="cnt">${n}</span>` : ""}</button>`).join("")}</div></div>`;
  }

  function overview() {
    const c = data.contact, acc = data.account;
    const conf = c.confidence_pct ? `${c.confidence_pct}% likely to deliver` : "";
    const enr = data.enrollments || [];
    return `${data.suppressed ? `<div class="banner banner--bad mb">${ico("flag")}<div>Suppressed (${esc(data.suppressed)}). OpenLeads will never email this address.</div></div>` : ""}
      <div class="email-card">
        <div class="email-card__addr">${ui.tierDot(c.tier)}${esc(c.email)}${ui.copy(c.email)}</div>
        <div class="row row--wrap">${ui.tier(c.tier)}${ui.evidence(c.evidence)}${conf ? `<span class="hint">${esc(conf)}</span>` : ""}</div>
        ${data.reasons.length ? `<ul class="reasons">${data.reasons.slice(0, 6).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="grid grid-2 mt">
        <div class="card card--pad stack--sm stack">
          <div class="row"><h3>ICP fit</h3><span class="spacer"></span><button class="btn btn--xs btn--ghost" data-a="why">Why?</button></div>
          <div class="row">${ui.grade(c.fit_score)}<span class="hero-num" style="font-size:28px">${c.fit_score || 0}</span><span class="muted">/ 100</span></div>
          ${why ? `<ul class="reasons">${why.reasons.map((r) => `<li>${esc(r.reason)} <b>${r.points > 0 ? "+" : ""}${r.points}</b></li>`).join("") || "<li>No points from your model yet.</li>"}</ul>` : `<span class="hint">From your <a class="link" href="#/settings/scoring">ICP model</a>.</span>`}
        </div>
        <div class="card card--pad stack--sm stack">
          <div class="row"><h3>Sequences</h3><span class="spacer"></span><button class="btn btn--xs btn--ghost" data-a="seq">${ico("plus", "ico--sm")} Add</button></div>
          ${enr.length ? enr.map((e) => `<div class="row"><a class="link ellipsis" href="#/sequences/${e.sequence_id}">${esc(e.sequence_name)}</a><span class="spacer"></span>
            <span class="badge ${e.status === "active" ? "badge--info" : e.status === "replied" ? "badge--good" : ""}">${esc(e.status)}${e.status === "active" || e.status === "paused" ? ` · step ${e.step + 1}` : ""}</span></div>`).join("")
            : `<span class="hint">Not in any sequence.</span>`}
        </div>
      </div>
      <div class="card mt">
        <div class="card__head"><h3>Details</h3><div class="actions">${editing
          ? `<button class="btn btn--xs" data-a="cancel-edit">Cancel</button><button class="btn btn--xs btn--primary" data-a="save-edit">Save</button>`
          : `<button class="btn btn--xs btn--ghost" data-a="edit">${ico("edit", "ico--sm")} Edit</button>`}</div></div>
        <div class="card__body">${editing ? `<form class="form-grid" data-editform>${EDIT.map(([k, l]) =>
          `<div class="field"><label>${l}</label><input class="input input--sm" name="${k}" value="${esc(c[k] || "")}"/></div>`).join("")}
          <div class="field"><label>Seniority</label><select class="select select--sm" name="seniority"><option value="">—</option>${(store.meta?.seniorities || []).map((s) =>
            `<option value="${s.key}" ${s.key === c.seniority ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>
          <div class="field"><label>Department</label><select class="select select--sm" name="department"><option value="">—</option>${(store.meta?.departments || []).map((s) =>
            `<option value="${s.key}" ${s.key === c.department ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div></form>`
          : `<dl class="kv">
            <dt>Phone</dt><dd>${c.phone ? `<a class="link" href="tel:${esc(c.phone)}">${esc(fmt.phone(c.phone))}</a>` : "—"}</dd>
            <dt>LinkedIn</dt><dd>${c.linkedin_url ? `<a class="link" href="${esc(c.linkedin_url)}" target="_blank" rel="noopener noreferrer">${esc(c.linkedin_url.replace(/^https?:\/\/(www\.)?/, ""))}</a>` : "—"}</dd>
            <dt>Location</dt><dd>${esc([c.city, c.state, c.country].filter(Boolean).join(", ") || "—")}</dd>
            <dt>Owner</dt><dd>${esc(c.owner || "—")}</dd>
            <dt>Source</dt><dd>${esc(c.source || "—")}</dd>
            <dt>Added</dt><dd>${esc(fmt.date(c.created))}</dd>
            <dt>Last contacted</dt><dd>${c.last_contacted ? esc(fmt.rel(c.last_contacted)) : "Never"}</dd></dl>`}</div>
      </div>
      <div class="card mt"><div class="card__head"><h3>Tags & lists</h3></div><div class="card__body stack">
        <div class="tags">${(c.tags || []).map((t) => `<span class="tag">#${esc(t)}<button type="button" data-untag="${esc(t)}" title="Remove">${ico("x", "ico--sm")}</button></span>`).join("")}
          <input class="input input--sm" data-addtag placeholder="Add a tag, then Enter" style="width:180px;height:22px"/></div>
        <div class="tags">${(c.lists || []).map((l) => `<span class="tag"><i class="color-dot c-${esc(l.color || "gray")}"></i><a href="#/people?list=${l.id}">${esc(l.name)}</a>
          <button type="button" data-unlist="${l.id}" title="Remove from list">${ico("x", "ico--sm")}</button></span>`).join("") || '<span class="hint">In no lists.</span>'}</div>
      </div></div>
      ${acc ? `<div class="card mt"><div class="card__head">${ui.companyAvatar(acc.name || acc.domain)}<div style="min-width:0"><h3 class="ellipsis">${esc(acc.name || acc.domain)}</h3>
          <div class="hint">${esc([acc.industry, acc.company_size && acc.company_size + " employees", acc.city].filter(Boolean).join(" · "))}</div></div>
          <div class="actions"><a class="btn btn--xs" href="#/companies/${encodeURIComponent(acc.domain)}">Open ${ico("arrow", "ico--sm")}</a></div></div>
        <div class="card__body stack">${acc.description ? `<p class="muted">${esc(acc.description)}</p>` : ""}
          <dl class="kv"><dt>Website</dt><dd><a class="link" href="${esc(acc.website || "https://" + acc.domain)}" target="_blank" rel="noopener noreferrer">${esc(acc.domain)}</a></dd>
          <dt>People here</dt><dd><a class="link" href="#/people?domain=${encodeURIComponent(acc.domain)}">${fmt.num(acc.people)}</a></dd>
          ${acc.phone ? `<dt>Main line</dt><dd>${esc(fmt.phone(acc.phone))}</dd>` : ""}</dl>
          ${acc.technologies.length ? `<div class="tags">${acc.technologies.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}</div></div>` : ""}`;
  }

  function activityTab() {
    return `<div class="composer"><textarea class="textarea" data-note placeholder="Add a note — what you learned, what's next…"></textarea>
      <div class="composer__foot"><span class="hint">Notes show on the timeline.</span><span class="spacer"></span>
        <button class="btn btn--sm btn--primary" data-a="note">${ico("note")} Save note</button></div></div>
      <div class="mt-lg">${timeline(data.timeline)}</div>`;
  }

  function tasksTab() {
    const kinds = store.meta?.task_kinds || [];
    return `<form class="row row--wrap" data-taskform style="gap:8px">
        <input class="input" name="title" placeholder="Call to follow up on the proposal" style="flex:1;min-width:220px" required/>
        <select class="select" name="kind" style="width:auto">${kinds.map((k) => `<option value="${k.key}">${esc(k.label)}</option>`).join("")}</select>
        <select class="select" name="due" style="width:auto"><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="+3d">In 3 days</option><option value="+1w">Next week</option><option value="">No date</option></select>
        <button class="btn btn--primary" type="submit">${ico("plus")} Add</button></form>
      <div class="mt">${data.tasks.length ? data.tasks.map((t) => `<div class="list-row">
        <button class="btn btn--icon btn--xs ${t.status === "done" ? "btn--primary" : ""}" data-taskdone="${t.id}" ${t.status !== "open" ? "disabled" : ""} title="Done">${ico("check", "ico--sm")}</button>
        <div style="flex:1;min-width:0"><div class="${t.status !== "open" ? "faint" : ""}">${esc(t.title)}</div><div class="hint">${esc(t.kind)} · ${esc(t.status === "open" ? fmt.due(t.due) : t.status)}${t.sequence_name ? ` · ${esc(t.sequence_name)}` : ""}</div></div></div>`).join("")
        : '<p class="muted">No tasks for this contact.</p>'}</div>`;
  }

  function dealsTab() {
    return `<div class="row"><span class="spacer"></span><button class="btn btn--sm btn--primary" data-a="deal">${ico("plus")} New deal</button></div>
      <div class="mt">${data.deals.length ? data.deals.map((x) => `<a class="list-row" href="#/deals/${x.id}" style="display:flex">
        <span class="tl-icon tl-icon--good">${ico("deal")}</span><div style="flex:1;min-width:0"><div class="t-strong">${esc(x.name)}</div>
        <div class="hint">${esc(store.label("deal_stages", x.stage))}${x.close_date ? ` · closes ${esc(x.close_date)}` : ""}</div></div>
        <b class="num">${esc(fmt.money(x.amount, x.currency))}</b></a>`).join("") : '<p class="muted">No deals yet.</p>'}</div>`;
  }

  function notesTab() {
    return data.notes.length ? data.notes.map((n) => `<div class="card card--pad mb">
      <div class="row"><span class="hint">${esc(fmt.datetime(n.created))}</span>${n.pinned ? '<span class="badge badge--accent badge--sm">Pinned</span>' : ""}<span class="spacer"></span>
        <button class="btn btn--xs btn--ghost" data-pin="${n.id}" data-on="${n.pinned ? 0 : 1}">${n.pinned ? "Unpin" : "Pin"}</button>
        <button class="btn btn--xs btn--ghost btn--danger" data-delnote="${n.id}">${ico("trash", "ico--sm")}</button></div>
      <p style="white-space:pre-wrap;margin-top:6px">${esc(n.body)}</p></div>`).join("") : '<p class="muted">No notes yet. Add one from the Activity tab.</p>';
  }

  function render() {
    const body = { overview, activity: activityTab, tasks: tasksTab, deals: dealsTab, notes: notesTab }[tab]();
    const scroll = $(".drawer__body", d.el)?.scrollTop || 0;
    d.el.innerHTML = head() + `<div class="drawer__body">${body}</div>`;
    $(".drawer__body", d.el).scrollTop = scroll;
  }

  async function act(fn, msg) {
    try { await fn(); if (msg) toast(msg); await load(); changed(); } catch (e) { fail(e); }
  }

  d.el.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-x]")) return d.close();
    const tb = t.closest("[data-tab]"); if (tb) { tab = tb.dataset.tab; editing = false; render(); return; }
    const sel = { emails: [email] };
    const a = t.closest("[data-a]")?.dataset.a;
    if (a === "seq") { if (await enroll(sel)) { await load(); changed(); } }
    else if (a === "list") { if (await addToList(t.closest("[data-a]"), sel)) { await load(); changed(); } }
    else if (a === "task") { tab = "tasks"; render(); $("[data-taskform] input", d.el)?.focus(); }
    else if (a === "deal") newDeal();
    else if (a === "why") { try { why = await api.post("/api/scoring/explain", { email }); render(); } catch (err) { fail(err); } }
    else if (a === "edit") { editing = true; render(); }
    else if (a === "cancel-edit") { editing = false; render(); }
    else if (a === "save-edit") {
      const f = $("[data-editform]", d.el);
      const fields = Object.fromEntries(Array.from(f.elements).filter((x) => x.name).map((x) => [x.name, x.value]));
      editing = false; act(() => api.post("/api/people/update", { email, fields }), "Saved");
    } else if (a === "note") {
      const body = $("[data-note]", d.el).value.trim();
      if (body) act(() => api.post("/api/notes/add", { ref_type: "contact", ref: email, body }), "Note added");
    } else if (a === "more") moreMenu(t.closest("[data-a]"));
    const un = t.closest("[data-untag]");
    if (un) act(() => api.post("/api/people/bulk", { emails: [email], action: "untag", value: un.dataset.untag }));
    const ul = t.closest("[data-unlist]");
    if (ul) act(() => api.post("/api/lists/remove", { id: ul.dataset.unlist, refs: [email] }), "Removed from list");
    const td = t.closest("[data-taskdone]");
    if (td) act(() => api.post("/api/tasks/complete", { id: td.dataset.taskdone }), "Task done");
    const pin = t.closest("[data-pin]");
    if (pin) act(() => api.post("/api/notes/update", { id: pin.dataset.pin, pinned: pin.dataset.on === "1" }));
    const dn = t.closest("[data-delnote]");
    if (dn && await confirmDialog("Delete this note?", { ok: "Delete", danger: true })) act(() => api.post("/api/notes/delete", { id: dn.dataset.delnote }));
  });
  d.el.addEventListener("change", (e) => {
    if (e.target.matches("[data-stage]")) act(() => api.post("/api/people/update", { email, fields: { stage: e.target.value } }),
      `Stage: ${store.label("contact_stages", e.target.value)}`);
  });
  d.el.addEventListener("keydown", (e) => {
    if (e.target.matches("[data-addtag]") && e.key === "Enter" && e.target.value.trim()) {
      e.preventDefault();
      const v = e.target.value.trim();
      act(() => api.post("/api/people/bulk", { emails: [email], action: "tag", value: v }), "Tagged");
    }
    if (e.target.matches("[data-note]") && e.key === "Enter" && (e.metaKey || e.ctrlKey)) $('[data-a="note"]', d.el)?.click();
  });
  d.el.addEventListener("submit", (e) => {
    if (!e.target.matches("[data-taskform]")) return;
    e.preventDefault();
    const f = e.target;
    act(() => api.post("/api/tasks/save", { title: f.title.value, kind: f.kind.value, due: f.due.value || null, contact: email }), "Task added");
  });

  function moreMenu(anchor) {
    menu(anchor, [{ label: "Copy email", value: "copy", icon: "copy" },
      { label: "Find similar people in your CRM", value: "similar", icon: "find" },
      { label: "Find new lookalikes on the web", value: "lookalike", icon: "radar" },
      { sep: true },
      { label: "Mark do not contact", value: "dnc", icon: "flag", danger: true },
      { label: "Delete contact", value: "delete", icon: "trash", danger: true }], async (v) => {
      if (v === "copy") { navigator.clipboard?.writeText(email); toast("Copied"); }
      if (v === "similar") {
        const c = data.contact;
        d.close();
        location.hash = `#/people?seniority=${c.seniority || ""}&department=${c.department || ""}&industry=${encodeURIComponent(c.industry || "")}`;
      }
      if (v === "lookalike") { d.close(); router.go("prospect", "", { q: lookalikeQuery(data.contact) }); }
      if (v === "dnc" && await confirmDialog(`${email} will be suppressed and never emailed.`, { title: "Do not contact?", ok: "Suppress", danger: true })) {
        act(() => api.post("/api/people/bulk", { emails: [email], action: "do_not_contact" }), "Suppressed");
      }
      if (v === "delete" && await confirmDialog(`Delete ${email}? Suppression and the send log are kept.`, { title: "Delete contact?", ok: "Delete", danger: true })) {
        try { await api.post("/api/people/bulk", { emails: [email], action: "delete" }); toast("Deleted"); changed(); d.close(); } catch (err) { fail(err); }
      }
    }, { align: "right" });
  }

  async function newDeal() {
    const c = data.contact;
    await modal({ title: "New deal", body: `<div class="form-grid">
        <div class="field span-2"><label>Name</label><input class="input" name="name" value="${esc((c.organization || c.domain || "New deal") + " — ")}" autofocus/></div>
        <div class="field"><label>Amount</label><input class="input" name="amount" placeholder="12,000"/></div>
        <div class="field"><label>Stage</label><select class="select" name="stage">${(store.meta?.deal_stages || []).map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join("")}</select></div>
        <div class="field"><label>Close date</label><input class="input" type="date" name="close_date"/></div></div>`,
      actions: [{ label: "Cancel", value: null }, { label: "Create deal", kind: "primary", submit: true }],
      onSubmit: async (f) => {
        await api.post("/api/deals/save", { name: f.name.value, amount: f.amount.value, stage: f.stage.value,
          close_date: f.close_date.value, contact: email });
        toast("Deal created"); tab = "deals"; await load(); changed(); return true;
      } });
  }

  d.el.innerHTML = `<div class="drawer__body">${ui.skeleton(8)}</div>`;
  load();
  return h;
}
