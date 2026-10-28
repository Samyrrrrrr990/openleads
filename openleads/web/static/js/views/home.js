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

function summary(h) {
  const due = h.tasks.today + h.tasks.overdue;
  const bits = [];
  bits.push(due ? `<a class="link" href="#/tasks">${fmt.plural(due, "task")} due</a>${h.tasks.overdue ? `, ${fmt.num(h.tasks.overdue)} overdue` : ""}` : "Nothing due today");
  bits.push(h.sequences.due_now ? `${fmt.plural(h.sequences.due_now, "sequence step")} ready to run`
    : h.sequences.active ? `${fmt.plural(h.sequences.active, "sequence")} running` : "no sequences running");
  return bits.join(". ") + ".";
}

async function render(root) {
  const [h, tt, seq] = await Promise.all([api.get("/api/home"), api.get("/api/tasks", { bucket: "open" }),
    api.get("/api/sequences").catch(() => ({ sequences: [] }))]);
  const e = h.emails, s = h.series;
  const due = (tt.tasks || []).filter((t) => t.due && t.due * 1000 < new Date().setHours(24, 0, 0, 0)).slice(0, 6);
  const todo = (h.checklist || []).filter((c) => !c.done);
  const funnel = (h.funnel || []).filter((f) => f.count).map((f) => ({
    label: f.label, value: f.count, href: `#/people?stage=${f.key}` }));
  const seqs = (seq.sequences || []).filter((q) => q.status === "active").slice(0, 5);
  const rec = h.recommended && h.recommended.total ? h.recommended : null;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const tasksBlock = due.length ? `<div>${due.map(taskRow).join("")}</div>`
    : `<p class="muted">Nothing due today. <a class="link" href="#/tasks">See upcoming tasks</a></p>`;
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
      <div><h1>${esc(today)}</h1><p class="head__sub">${summary(h)}</p></div>
      <div class="head__actions"><a class="btn btn--primary" href="#/prospect">${ico("radar")} Find people</a></div>
    </div>
    <div class="figures">
      ${figure("Contacts", fmt.num(h.contacts.total), `${fmt.num(h.contacts.new_7d)} new this week`, "#/people")}
      ${figure("Emails sent", fmt.num(e.sent_7d), `last 7 days, ${fmt.num(e.warmup.remaining)} left today`, "#/analytics")}
      ${figure("Reply rate", fmt.pct(e.reply_rate), `${fmt.num(e.replied)} of ${fmt.num(e.contacted)} contacted`, "#/people?stage=replied")}
      ${figure("Open pipeline", fmt.moneyCompact(h.deals.open_value), `${fmt.moneyCompact(h.deals.weighted)} weighted`, "#/deals")}
    </div>
    <div class="home-cols">
      <div>${sec("Today", h.tasks.overdue ? `<span style="color:var(--bad)">${fmt.num(h.tasks.overdue)} overdue</span>` : "",
        `<a class="btn btn--sm btn--ghost" href="#/tasks">All tasks</a>`, tasksBlock)}
        ${setup ? `<div style="margin-top:36px">${setup}</div>` : ""}</div>
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
          el.closest(".list-row").remove();
          toast("Task done");
          document.dispatchEvent(new Event("ol:refresh-badges"));
        } catch (e) { fail(e); }
      },
    });
  },
  unmount() { cleanup && cleanup(); cleanup = null; },
});
