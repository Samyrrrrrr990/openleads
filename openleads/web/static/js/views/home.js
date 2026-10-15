/* =========================================================================
   Home — "how is outreach going, and what do I do today?"
   KPIs with trends, the send chart, the stage funnel, today's tasks, a
   getting-started checklist, sequences that need attention, and the feed.
   ========================================================================= */
import { columns, hbars, sparkline } from "../charts.js";
import { $, api, esc, fail, fmt, ico, onAct, router, store, toast, ui } from "../core.js";
import { timeline } from "../timeline.js";

let cleanup = null;

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function stat(label, value, meta, spark, href) {
  return `<a class="card stat stat--link" href="${href}"><span class="stat__label">${esc(label)}</span>
    <span class="stat__value">${value}</span><span class="stat__meta">${meta}</span>${spark || ""}</a>`;
}

function taskRow(t) {
  const icon = { call: "phone", email: "mail", linkedin: "linkedin", todo: "task" }[t.kind] || "task";
  const overdue = t.due && t.due * 1000 < new Date().setHours(0, 0, 0, 0);
  return `<div class="list-row">
    <button class="btn btn--icon btn--xs" data-act="done" data-id="${t.id}" title="Mark done">${ico("check", "ico--sm")}</button>
    <span class="faint">${ico(icon, "ico--sm")}</span>
    <div style="min-width:0;flex:1"><div class="ellipsis">${esc(t.title)}</div>
      <div class="hint">${t.contact ? `<a class="link" href="#/people/${encodeURIComponent(t.contact)}">${esc(t.contact_name || t.contact)}</a> · ` : ""}<span style="${overdue ? "color:var(--bad)" : ""}">${esc(fmt.due(t.due))}</span></div></div></div>`;
}

async function render(root) {
  const [h, tt, seq] = await Promise.all([api.get("/api/home"), api.get("/api/tasks", { bucket: "open" }),
    api.get("/api/sequences").catch(() => ({ sequences: [] }))]);
  const e = h.emails, s = h.series;
  const due = (tt.tasks || []).filter((t) => t.due && t.due * 1000 < new Date().setHours(24, 0, 0, 0)).slice(0, 7);
  const todo = (h.checklist || []).filter((c) => !c.done);
  const name = (store.state?.identity?.sender_name || "").split(" ")[0];
  const last7 = (arr) => arr.slice(-14).map((p) => p.count);
  const funnel = (h.funnel || []).filter((f) => f.count).map((f) => ({
    label: f.label, value: f.count, href: `#/people?stage=${f.key}` }));
  const seqs = (seq.sequences || []).filter((q) => q.status === "active").slice(0, 5);
  root.innerHTML = `<section class="page">
    <div class="home-hello">
      <div><h1>${greeting()}${name ? ", " + esc(name) : ""}</h1>
        <p class="head__sub">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} ·
          ${h.tasks.today + h.tasks.overdue ? `<a class="link" href="#/tasks">${fmt.plural(h.tasks.today + h.tasks.overdue, "task")} due</a>` : "no tasks due"} ·
          ${h.sequences.due_now ? `${fmt.plural(h.sequences.due_now, "sequence step")} ready to run` : `${fmt.plural(h.sequences.active, "active sequence")}`}</p></div>
      <div class="head__actions"><a class="btn" href="#/sequences">${ico("sequence")} Sequences</a>
        <a class="btn btn--accent" href="#/prospect">${ico("radar")} Find people</a></div>
    </div>
    <div class="grid grid-4">
      ${stat("Contacts", fmt.num(h.contacts.total), `+${fmt.num(h.contacts.new_7d)} this week · ${fmt.num(h.contacts.safe)} safe`, sparkline(last7(s.added)), "#/people")}
      ${stat("Emails sent", fmt.num(e.sent_7d), `last 7 days · ${fmt.num(e.warmup.remaining)} left today`, sparkline(last7(s.sent)), "#/analytics")}
      ${stat("Reply rate", fmt.pct(e.reply_rate), `${fmt.num(e.replied)} replied of ${fmt.num(e.contacted)} contacted`, sparkline(last7(s.replied)), "#/people?stage=replied")}
      ${stat("Open pipeline", fmt.moneyCompact(h.deals.open_value), `${fmt.moneyCompact(h.deals.weighted)} weighted · ${fmt.num(h.deals.open_count)} deals`, "", "#/deals")}
    </div>
    <div class="grid grid-main-side mt-lg">
      <div class="stack stack--lg">
        <div class="card"><div class="card__head"><h3>Emails sent per day</h3><span class="faint">last 30 days</span>
          <div class="actions"><a class="btn btn--sm btn--ghost" href="#/analytics">${ico("chart")} Analytics</a></div></div>
          <div class="card__body" id="home-sent"></div></div>
        <div class="grid grid-2">
          <div class="card"><div class="card__head"><h3>Contacts by stage</h3></div><div class="card__body">${hbars(funnel)}</div></div>
          <div class="card"><div class="card__head"><h3>Active sequences</h3><div class="actions"><a class="btn btn--sm btn--ghost" href="#/sequences">All</a></div></div>
            <div class="card__body" style="padding-top:4px;padding-bottom:4px">${seqs.length ? seqs.map((q) => `
              <a class="list-row" href="#/sequences/${q.id}" style="display:flex"><span class="tl-icon tl-icon--info">${ico("sequence")}</span>
                <div style="min-width:0;flex:1"><div class="t-strong ellipsis">${esc(q.name)}</div>
                <div class="hint">${fmt.num(q.stats.active)} active · ${fmt.pct(q.stats.reply_rate)} replies${q.stats.open_tasks ? ` · ${fmt.plural(q.stats.open_tasks, "task")}` : ""}</div></div>
                ${q.stats.due_now ? `<span class="badge badge--accent">${q.stats.due_now} due</span>` : ""}</a>`).join("")
              : ui.empty("sequence", "No active sequences", "Turn a list into a multi-step campaign.", `<a class="btn btn--sm" href="#/sequences">${ico("plus")} New sequence</a>`)}</div></div>
        </div>
        <div class="card"><div class="card__head"><h3>Recent activity</h3><div class="actions"><a class="btn btn--sm btn--ghost" href="#/activity">See all</a></div></div>
          <div class="card__body">${timeline(h.activity.slice(0, 10), { showRef: true })}</div></div>
      </div>
      <div class="stack stack--lg">
        ${todo.length ? `<div class="card"><div class="card__head"><h3>Get set up</h3><span class="faint">${(h.checklist.length - todo.length)}/${h.checklist.length}</span></div>
          <div class="card__body checklist">${h.checklist.map((c) => `<a class="checklist__item ${c.done ? "is-done" : ""}" href="#/${c.route}">
            <span class="checklist__tick">${ico("check", "ico--sm")}</span><span class="lbl">${esc(c.label)}</span></a>`).join("")}</div></div>` : ""}
        <div class="card"><div class="card__head"><h3>Due today</h3><span class="faint">${fmt.num(h.tasks.overdue)} overdue</span>
          <div class="actions"><a class="btn btn--sm btn--ghost" href="#/tasks">All tasks</a></div></div>
          <div class="card__body" id="home-tasks" style="padding-top:4px;padding-bottom:4px">${due.length ? due.map(taskRow).join("")
            : `<p class="muted" style="padding:12px 0">You're clear for today.</p>`}</div></div>
        <div class="card card--pad stack"><div class="row"><h3>Sending today</h3><span class="spacer"></span><a class="link" href="#/settings/sending">Policy</a></div>
          <div class="row"><span class="hero-num" style="font-size:32px">${fmt.num(e.warmup.sent_today)}</span><span class="muted">of ${fmt.num(e.warmup.allowance)} allowed (warmup day ${e.warmup.day})</span></div>
          <div class="progress"><span style="width:${Math.min(100, 100 * e.warmup.sent_today / Math.max(1, e.warmup.allowance))}%"></span></div></div>
        <div class="card card--pad stack"><div class="row"><h3>Your data</h3><span class="spacer"></span><a class="link" href="#/health">Data health</a></div>
          <div class="kv"><dt>Companies</dt><dd><a class="link" href="#/companies">${fmt.num(h.companies.total)}</a></dd>
          <dt>Lists</dt><dd><a class="link" href="#/lists">${fmt.num(h.lists.total)}</a></dd>
          <dt>ICP fit A/B</dt><dd>${fmt.num((h.grades.A || 0) + (h.grades.B || 0))} contacts</dd></div></div>
      </div>
    </div></section>`;
  cleanup = columns($("#home-sent", root), s.sent, { unit: "sent", height: 170, empty: "No emails sent yet — start a sequence to see your sends here." });
}

router.register("home", {
  title: "Home",
  async mount(root) {
    root.innerHTML = `<div class="page">${ui.skeleton(8)}</div>`;
    await render(root);
    onAct(root, {
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
