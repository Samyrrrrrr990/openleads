/* =========================================================================
   Home — "how is outreach going, and what do I do today?"
   KPIs with trends, the send chart, the stage funnel, today's tasks, a
   getting-started checklist, sequences that need attention, and the feed.
   ========================================================================= */
import { enroll } from "../actions.js";
import { columns, hbars } from "../charts.js";
import { $, api, esc, fail, fmt, ico, onAct, router, toast, ui } from "../core.js";
import { timeline } from "../timeline.js";

let cleanup = null;
let lastHome = null;     // /api/home, for the summary line after a Today action

function figure(label, value, meta, href) {
  return `<a class="figure" href="${href}"><span class="figure__label">${esc(label)}</span>
    <span class="figure__value num">${value}</span><span class="figure__meta">${meta}</span></a>`;
}

function taskRow(t) {
  const icon = { call: "phone", email: "mail", linkedin: "linkedin", todo: "task" }[t.kind] || "task";
  const overdue = t.due && t.due * 1000 < new Date().setHours(0, 0, 0, 0);
  return `<div class="list-row">
    <button class="task-check" data-act="done" data-id="${t.id}" title="Mark done" aria-label="Mark done">${ico("check")}</button>
    <div style="min-width:0;flex:1"><div class="ellipsis">${esc(t.title)}</div>
      <div class="hint">${t.contact ? `<a class="link" href="#/people/${encodeURIComponent(t.contact)}">${esc(t.contact_name || t.contact)}</a>, ` : ""}<span style="${overdue ? "color:var(--bad)" : ""}">${esc(fmt.due(t.due))}</span></div></div>
    <span class="faint" title="${esc(t.kind || "to-do")}">${ico(icon, "ico--sm")}</span></div>`;
}

function sec(title, meta, actions, body) {
  return `<section class="sec"><div class="sec__head"><h2>${esc(title)}</h2>${meta ? `<span class="sec__meta">${meta}</span>` : ""}
    ${actions ? `<div class="actions">${actions}</div>` : ""}</div>${body}</section>`;
}

/* ---------------------------------------------------------------- Today */
const code = (m) => esc(m).replace(/`([^`]+)`/g, "<code>$1</code>");

function headsUp(items) {
  if (!items.length) return "";
  const kind = { bad: "banner--bad", warn: "banner--warn", info: "" };
  const icon = { bad: "flag", warn: "flag", info: "spark" };
  return `<div class="today-notes">${items.map((h) => {
    // The terminal tells you to run `openleads setup`; here the fix is one click away.
    const setup = /openleads setup/.test(h.message);
    const text = setup ? h.message.split(/\.\s/)[0] + "." : h.message;
    const link = setup ? ` <a href="#/settings">Connect in Settings</a>` : "";
    return `<div class="banner ${kind[h.level] || ""}">${ico(icon[h.level] || "spark")}<div>${code(text)}${link}</div></div>`;
  }).join("")}</div>`;
}

function replyRow(r) {
  return `<div class="list-row today-row" data-email="${esc(r.email)}">
    <div style="min-width:0;flex:1">
      <div class="ellipsis"><a class="link t-strong" href="#/people/${encodeURIComponent(r.email)}">${esc(r.name || r.email)}</a>${r.organization ? `<span class="hint">, ${esc(r.organization)}</span>` : ""}${r.likely_no ? ` <span class="badge badge--sm" title="Your model thinks this is a polite no. It stays here until you mark it done.">Looks like a no</span>` : ""}</div>
      <div class="today-snippet">${esc(r.snippet || r.subject || "")}</div>
      ${r.suggestion ? `<div class="today-suggest"><span class="hint">Suggested answer</span> ${esc(r.suggestion)}</div>` : ""}
      <div class="hint">${esc(fmt.rel(r.received))}</div></div>
    <div class="actions"><button class="btn btn--sm" data-act="reply-done" data-email="${esc(r.email)}">${ico("check")} Done</button>
      <button class="btn btn--sm btn--ghost" data-act="reply-snooze" data-email="${esc(r.email)}" title="Hide until tomorrow 9:00">Snooze</button></div></div>`;
}

function draftRow(d) {
  // The first real line, not the "Hi Rachel," greeting.
  const lines = (d.body || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines.find((l) => !/^(hi|hey|hello|dear)\b.{0,40},$/i.test(l)) || lines[0] || "";
  const q = d.quality == null ? "" : `<span class="badge ${d.quality >= 80 ? "badge--good" : "badge--warn"}" title="Draft quality">${fmt.num(d.quality)}</span>`;
  return `<div class="list-row today-row" data-draft="${d.id}">
    <div style="min-width:0;flex:1">
      <div class="ellipsis"><span class="t-strong">${esc(d.subject)}</span> <span class="hint">to</span> <a class="link" href="#/people/${encodeURIComponent(d.email)}">${esc(d.email)}</a></div>
      <div class="today-snippet ellipsis">${esc(first)}</div></div>
    ${q}
    <div class="actions" data-slot="actions">
      <button class="btn btn--sm btn--primary" data-act="draft-ask" data-id="${d.id}">${ico("send")} Approve</button>
      <button class="btn btn--sm" data-act="draft-edit" data-id="${d.id}">Edit</button>
      <button class="btn btn--sm btn--ghost" data-act="draft-skip" data-id="${d.id}">Skip</button></div></div>`;
}

function todayBlock(b) {
  const due = [...b.tasks.overdue, ...b.tasks.today];
  const replies = b.replies.length ? b.replies.map(replyRow).join("")
    : `<p class="muted">No replies waiting on you.</p>`;
  const tasks = due.length ? due.slice(0, 8).map(taskRow).join("")
    : `<p class="muted">Nothing due today. <a class="link" href="#/tasks">See upcoming tasks</a></p>`;
  const more = b.counts.drafts - b.drafts.length;
  const approvals = b.drafts.length ? sec("Emails to approve", `${fmt.num(b.counts.drafts)} waiting`, "",
    `<div>${b.drafts.map(draftRow).join("")}</div>${more > 0 ? `<p class="hint">and ${fmt.num(more)} more</p>` : ""}
     <p class="hint">First emails from sequences and scheduled workflows wait here for a yes. Approving sends now.</p>`) : "";
  return `${headsUp(b.heads_up)}
    ${approvals ? `<div style="margin-bottom:36px">${approvals}</div>` : ""}
    <div class="home-cols">
      ${sec("Replies", b.counts.replies ? `${fmt.num(b.counts.replies)} waiting` : "", "", `<div>${replies}</div>`)}
      ${sec("Due today", b.tasks.overdue.length ? `<span style="color:var(--bad)">${fmt.num(b.tasks.overdue.length)} overdue</span>` : "",
        `<a class="btn btn--sm btn--ghost" href="#/tasks">All tasks</a>`, `<div>${tasks}</div>`)}
    </div>`;
}

// The model's read of the morning arrives after the page: it can take a while.
function loadLine(root) {
  api.get("/api/today/line").then((r) => {
    const el = $("#home-line", root);
    if (el && r && r.line) { el.textContent = r.line; el.hidden = false; }
  }).catch(() => {});
}

async function refreshToday(root) {
  const b = await api.get("/api/today");
  const host = $("#home-today", root);
  if (host) host.innerHTML = todayBlock(b);
  const sub = $("#home-sub", root);
  if (sub) sub.innerHTML = summary(b, lastHome);
  document.dispatchEvent(new Event("ol:refresh-badges"));
}

function summary(b, h) {
  const n = b.counts;
  const bits = [];
  if (n.replies) bits.push(fmt.plural(n.replies, "reply", "replies") + " waiting");
  if (n.drafts) bits.push(fmt.plural(n.drafts, "email") + " to approve");
  if (n.tasks) bits.push(`<a class="link" href="#/tasks">${fmt.plural(n.tasks, "task")} due</a>`);
  if (!bits.length) bits.push("Nothing needs you right now");
  if (!h) return bits.join(", ") + ".";
  const seqs = h.sequences.due_now ? `${fmt.plural(h.sequences.due_now, "sequence step")} ready to run`
    : h.sequences.active ? `${fmt.plural(h.sequences.active, "sequence")} running` : "";
  return bits.join(", ") + "." + (seqs ? ` ${seqs[0].toUpperCase()}${seqs.slice(1)}.` : "");
}

async function render(root) {
  const [h, b, seq] = await Promise.all([api.get("/api/home"), api.get("/api/today"),
    api.get("/api/sequences").catch(() => ({ sequences: [] }))]);
  const e = h.emails, s = h.series;
  lastHome = h;
  const todo = (h.checklist || []).filter((c) => !c.done);
  const funnel = (h.funnel || []).filter((f) => f.count).map((f) => ({
    label: f.label, value: f.count, href: `#/people?stage=${f.key}` }));
  const seqs = (seq.sequences || []).filter((q) => q.status === "active").slice(0, 5);
  const rec = h.recommended && h.recommended.total ? h.recommended : null;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const recBlock = rec ? `<div class="rec-list">${rec.rows.map((r) => `
      <a class="rec" href="#/people/${encodeURIComponent(r.email)}">
        <div style="min-width:0;flex:1"><div class="t-strong ellipsis">${esc(ui.name(r) || r.email)}</div>
          <div class="hint ellipsis">${esc([r.title, r.organization].filter(Boolean).join(", "))}</div></div>${ui.grade(r.fit_score)}</a>`).join("")}</div>`
    : `<p class="muted">Verified, strong-fit people you haven't contacted show up here. <a class="link" href="#/settings/scoring">Describe your ideal customer</a></p>`;
  const setup = todo.length ? sec("Get set up", `${h.checklist.length - todo.length} of ${h.checklist.length} done`, "",
    `<div class="checklist">${h.checklist.map((c) => `<a class="checklist__item ${c.done ? "is-done" : ""}" href="#/${c.route}">
      <span class="checklist__tick">${ico("check")}</span><span class="lbl">${esc(c.label)}</span></a>`).join("")}</div>`) : "";

  root.innerHTML = `<div class="page">
    <div class="home-hello">
      <div><h1>${esc(today)}</h1><p class="head__sub" id="home-sub">${summary(b, h)}</p>
        <p class="home-line" id="home-line" hidden></p></div>
      <div class="head__actions"><a class="btn btn--primary" href="#/prospect">${ico("radar")} Find people</a></div>
    </div>
    <div id="home-today" class="home-today">${todayBlock(b)}</div>
    <div class="figures">
      ${figure("Contacts", fmt.num(h.contacts.total), `${fmt.num(h.contacts.new_7d)} new this week`, "#/people")}
      ${figure("Emails sent", fmt.num(e.sent_7d), `last 7 days, ${fmt.num(e.warmup.remaining)} left today`, "#/analytics")}
      ${figure("Reply rate", fmt.pct(e.reply_rate), `${fmt.num(e.replied)} of ${fmt.num(e.contacted)} contacted`, "#/people?stage=replied")}
      ${figure("Open pipeline", fmt.moneyCompact(h.deals.open_value), `${fmt.moneyCompact(h.deals.weighted)} weighted`, "#/deals")}
    </div>
    <div class="home-cols">
      <div>${setup || sec("New leads", b.new_leads.count ? `${fmt.num(b.new_leads.count)} since you last looked` : "", "",
        b.new_leads.items.length ? `<div>${b.new_leads.items.slice(0, 6).map((x) => `<a class="list-row" href="#/people/${encodeURIComponent(x.email)}">
          <div style="min-width:0;flex:1"><div class="t-strong ellipsis">${esc(x.name || x.email)}</div><div class="hint ellipsis">${esc([x.title, x.organization].filter(Boolean).join(", "))}</div></div></a>`).join("")}</div>`
          : `<p class="muted">No new leads since you last looked. <a class="link" href="#/workflows">Schedule a search</a></p>`)}</div>
      ${sec("Best leads to contact", rec ? fmt.plural(rec.total, "person", "people") : "",
        rec ? `<button class="btn btn--sm" data-act="rec-enroll">${ico("sequence")} Add to a sequence</button>
          <a class="btn btn--sm btn--ghost" href="#/people?fit_min=55&tier=safe&contacted=never&stage=new&sort=fit">See all</a>` : "", recBlock)}
    </div>
    <div class="home-cols" style="margin-top:40px">
      ${sec("Emails sent", "last 30 days", `<a class="btn btn--sm btn--ghost" href="#/analytics">Analytics</a>`, `<div id="home-sent"></div>`)}
      ${sec("Contacts by stage", "", `<a class="btn btn--sm btn--ghost" href="#/people">People</a>`,
        funnel.length ? hbars(funnel) : `<p class="muted">No contacts yet.</p>`)}
    </div>
    <div class="home-cols" style="margin-top:40px">
      ${sec("Sequences running", "", `<a class="btn btn--sm btn--ghost" href="#/sequences">All sequences</a>`,
        seqs.length ? `<div>${seqs.map((q) => `
          <a class="list-row" href="#/sequences/${q.id}"><div style="min-width:0;flex:1"><div class="t-strong ellipsis">${esc(q.name)}</div>
            <div class="hint">${fmt.num(q.stats.active)} active, ${fmt.pct(q.stats.reply_rate)} replied${q.stats.open_tasks ? `, ${fmt.plural(q.stats.open_tasks, "task")}` : ""}</div></div>
            ${q.stats.due_now ? `<span class="hint" style="color:var(--text)">${fmt.num(q.stats.due_now)} due</span>` : ""}</a>`).join("")}</div>`
          : `<p class="muted">No sequences running. <a class="link" href="#/sequences">Create a sequence</a></p>`)}
      ${sec("Recent activity", "", `<a class="btn btn--sm btn--ghost" href="#/activity">All activity</a>`,
        timeline(h.activity.slice(0, 8), { showRef: true }))}
    </div>
    <p class="hint" style="margin-top:40px">Sending today: ${fmt.num(e.warmup.sent_today)} of ${fmt.num(e.warmup.allowance)} allowed (warmup day ${e.warmup.day}).
      <a class="link" href="#/settings/sending">Sending policy</a>. ${fmt.num(h.companies.total)} companies, ${fmt.num(h.lists.total)} lists.
      <a class="link" href="#/health">Data health</a></p>
  </div>`;
  loadLine(root);
  cleanup = columns($("#home-sent", root), s.sent, { unit: "sent", height: 150, empty: "No emails sent yet. Start a sequence to see your sends here." });
}

router.register("home", {
  title: "Home",
  async mount(root) {
    root.innerHTML = `<div class="page">${ui.skeleton(8)}</div>`;
    await render(root);
    onAct(root, {
      "rec-enroll": async () => {
        const h = await api.get("/api/home");
        await enroll({ all: true, filters: h.recommended.filters, total: h.recommended.total });
      },
      done: async (el) => {
        try {
          await api.post("/api/tasks/complete", { id: el.dataset.id });
          toast("Task done");
          await refreshToday(root);
        } catch (e) { fail(e); }
      },
      "reply-done": async (el) => {
        try { await api.post("/api/replies/done", { email: el.dataset.email }); toast("Marked handled"); await refreshToday(root); }
        catch (e) { fail(e); }
      },
      "reply-snooze": async (el) => {
        try {
          await api.post("/api/today/snooze", { kind: "reply", ref: el.dataset.email, until: "tomorrow" });
          toast("Snoozed until tomorrow 9:00"); await refreshToday(root);
        } catch (e) { fail(e); }
      },
      "draft-ask": (el) => {
        // Sending is real and can't be undone: confirm in the row, not with window.confirm.
        const row = el.closest(".today-row"), slot = $("[data-slot=actions]", row);
        slot.dataset.was = slot.innerHTML;
        slot.innerHTML = `<span class="hint">Send it now?</span>
          <button class="btn btn--sm btn--primary" data-act="draft-send" data-id="${el.dataset.id}">Send</button>
          <button class="btn btn--sm btn--ghost" data-act="draft-cancel">Cancel</button>`;
      },
      "draft-cancel": (el) => {
        const slot = el.closest("[data-slot=actions]");
        slot.innerHTML = slot.dataset.was || "";
      },
      "draft-send": async (el) => {
        // The editor (if open) sits after the row, not inside it.
        const ed = $(`.today-editor[data-for="${el.dataset.id}"]`, root);
        const edits = ed ? { subject: $("[name=subject]", ed).value, body: $("[name=body]", ed).value } : {};
        el.disabled = true;
        try {
          const r = await api.post("/api/drafts/approve", { id: Number(el.dataset.id), ...edits });
          if (r.status === "sent") toast("Sent");
          else toast(r.detail || `Not sent (${r.status})`, r.status === "skipped" ? "ok" : "err");
          await refreshToday(root);
        } catch (e) { el.disabled = false; fail(e); }
      },
      "draft-edit": async (el) => {
        const row = el.closest(".today-row");
        if ($(`.today-editor[data-for="${el.dataset.id}"]`, root)) return;
        const b = await api.get("/api/today");
        const d = b.drafts.find((x) => String(x.id) === el.dataset.id);
        if (!d) return refreshToday(root);
        row.insertAdjacentHTML("afterend", `<div class="today-editor" data-for="${d.id}">
          <input class="input" name="subject" value="${esc(d.subject)}" aria-label="Subject">
          <textarea class="textarea" name="body" rows="9" aria-label="Body">${esc(d.body)}</textarea>
          <div class="actions"><button class="btn btn--sm btn--primary" data-act="draft-send-edited" data-id="${d.id}">${ico("send")} Send edited email</button>
            <button class="btn btn--sm btn--ghost" data-act="draft-close-editor">Cancel</button></div></div>`);
      },
      "draft-send-edited": async (el) => {
        const ed = el.closest(".today-editor");
        el.disabled = true;
        try {
          const r = await api.post("/api/drafts/approve", { id: Number(el.dataset.id),
            subject: $("[name=subject]", ed).value, body: $("[name=body]", ed).value });
          toast(r.status === "sent" ? "Sent" : (r.detail || `Not sent (${r.status})`), r.status === "error" ? "err" : "ok");
          await refreshToday(root);
        } catch (e) { el.disabled = false; fail(e); }
      },
      "draft-close-editor": (el) => el.closest(".today-editor").remove(),
      "draft-skip": async (el) => {
        try { await api.post("/api/drafts/skip", { id: Number(el.dataset.id) }); toast("Skipped"); await refreshToday(root); }
        catch (e) { fail(e); }
      },
    });
  },
  unmount() { cleanup && cleanup(); cleanup = null; },
});
