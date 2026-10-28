/* =========================================================================
   Analytics — the funnel, computed locally from the CRM and the send log.
   Charts are single-series (no legend box needed; the card title names the
   series), with hover tooltips on every mark.
   ========================================================================= */
import { columns, hbars } from "../charts.js";
import { $, api, esc, fmt, ico, router, store, ui } from "../core.js";

let cleanups = [];
const DIMS = [["seniority", "Seniority"], ["department", "Department"], ["industry", "Industry"],
  ["company_size", "Company size"], ["source", "Source"]];
let DIM = "seniority";

function dimLabel(dim, v) {
  if (!v) return "(unknown)";
  if (dim === "seniority") return store.label("seniorities", v);
  if (dim === "department") return store.label("departments", v);
  return dim === "company_size" ? `${v} employees` : v;
}

function whoReplies(rb) {
  const rows = (rb && rb[DIM]) || [];
  if (!rows.length) return `<p class="muted">No one has been contacted yet — reply rates show up here after your first sends.</p>`;
  return hbars(rows.map((r) => ({
    label: `${dimLabel(DIM, r.value)} (${fmt.num(r.contacted)})`, value: r.rate,
    title: `${dimLabel(DIM, r.value)}: ${fmt.num(r.replied)} of ${fmt.num(r.contacted)} replied`,
    href: r.value ? `#/people?${DIM}=${encodeURIComponent(r.value)}&contacted=ever` : "",
  })), { max: 100, valueFmt: (v) => fmt.pct(v) });
}

function tile(label, value, sub = "", icon = "") {
  return `<div class="card stat"><span class="stat__label">${icon ? ico(icon, "ico--sm") : ""}${esc(label)}</span>
    <span class="stat__value">${value}</span>${sub ? `<span class="stat__meta">${sub}</span>` : ""}</div>`;
}

router.register("analytics", {
  title: "Analytics",
  async mount(root) {
    root.innerHTML = `<div class="page">${ui.skeleton(8)}</div>`;
    const [a, h, s, rb] = await Promise.all([api.get("/api/analytics"), api.get("/api/home"),
      api.get("/api/sequences").catch(() => ({ sequences: [] })), api.get("/api/analytics/replies").catch(() => ({}))]);
    const e = h.emails;
    const tierItems = Object.entries(a.by_tier || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({
      label: k === "safe" ? "Safe" : k === "risky" ? "Risky" : k === "bad" ? "Bad" : "Unverified", value: v,
      href: `#/people?tier=${encodeURIComponent(k === "?" ? "(none)" : k)}` }));
    const srcItems = Object.entries(a.by_source || {}).sort((x, y) => y[1] - x[1]).slice(0, 10)
      .map(([k, v]) => ({ label: k, value: v, href: `#/people?source=${encodeURIComponent(k)}` }));
    const funnel = (h.funnel || []).filter((f) => f.count).map((f) => ({ label: f.label, value: f.count,
      href: `#/people?stage=${f.key}` }));
    const grades = Object.entries(h.grades || {}).map(([g, v]) => ({ label: `Grade ${g}`, value: v,
      href: `#/people?fit_min=${{ A: 75, B: 55, C: 35, D: 0 }[g]}&sort=fit` }));
    const seqs = s.sequences || [];
    root.innerHTML = `<section class="page">
      <div class="head"><div><div class="head__title"><h1>Analytics</h1></div>
        <p class="head__sub">Click a bar to see the people behind it.</p></div></div>
      <div class="grid grid-4">
        ${tile("Contacts", fmt.num(a.total_leads), `${fmt.num(a.deliverable)} deliverable`, "users")}
        ${tile("Emails sent", fmt.num(e.sent_30d), `last 30 days, ${fmt.num(e.sent_today)} today`, "send")}
        ${tile("Reply rate", fmt.pct(e.reply_rate), `${fmt.num(e.replied)} of ${fmt.num(e.contacted)} contacted`, "reply")}
        ${tile("Bounce rate", fmt.pct(e.bounce_rate), `${fmt.num(e.bounced)} bounced`, "x")}
      </div>
      <div class="grid grid-3 mt-lg">
        <div class="card"><div class="card__head"><h3>Emails sent per day</h3><span class="faint">30 days</span></div><div class="card__body" id="ch-sent"></div></div>
        <div class="card"><div class="card__head"><h3>Replies per day</h3><span class="faint">30 days</span></div><div class="card__body" id="ch-replied"></div></div>
        <div class="card"><div class="card__head"><h3>Contacts added per day</h3><span class="faint">30 days</span></div><div class="card__body" id="ch-added"></div></div>
      </div>
      <div class="grid grid-2 mt-lg">
        <div class="card"><div class="card__head"><h3>Contacts by stage</h3></div><div class="card__body">${hbars(funnel)}</div></div>
        <div class="card"><div class="card__head"><h3>ICP fit</h3></div><div class="card__body">${hbars(grades)}</div></div>
        <div class="card"><div class="card__head"><h3>Email status</h3></div><div class="card__body">${hbars(tierItems)}</div></div>
        <div class="card"><div class="card__head"><h3>Where contacts came from</h3></div><div class="card__body">${hbars(srcItems)}</div></div>
      </div>
      <div class="card mt-lg"><div class="card__head"><div><h3>Who replies</h3>
          <p class="hint" style="margin-top:2px">Reply rate among people you've contacted. Spend more time on the personas that answer.</p></div>
          <div class="actions"><div class="seg" role="tablist">${DIMS.map(([k, l]) =>
            `<button type="button" class="${k === DIM ? "is-on" : ""}" data-dim="${k}">${l}</button>`).join("")}</div></div></div>
        <div class="card__body" id="who-replies">${whoReplies(rb)}</div></div>
      <div class="card mt-lg"><div class="card__head"><h3>Sequences</h3><div class="actions"><a class="btn btn--sm" href="#/sequences">${ico("sequence")} All sequences</a></div></div>
        ${seqs.length ? `<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Sequence</th><th>Status</th>
          <th class="col-num">Enrolled</th><th class="col-num">Contacted</th><th class="col-num">Sent</th><th class="col-num">Replied</th><th class="col-num">Reply rate</th><th class="col-num">Bounce rate</th></tr></thead><tbody>
          ${seqs.map((q) => `<tr class="is-click" data-href="#/sequences/${q.id}"><td class="t-strong">${esc(q.name)}</td>
            <td>${q.status === "active" ? '<span class="badge badge--good">Active</span>' : `<span class="badge">${esc(q.status)}</span>`}</td>
            <td class="col-num">${fmt.num(q.stats.enrolled)}</td><td class="col-num">${fmt.num(q.stats.contacted)}</td>
            <td class="col-num">${fmt.num(q.stats.sent)}</td><td class="col-num">${fmt.num(q.stats.replied)}</td>
            <td class="col-num">${fmt.pct(q.stats.reply_rate)}</td><td class="col-num">${fmt.pct(q.stats.bounce_rate)}</td></tr>`).join("")}
          </tbody></table></div>` : `<div class="card__body">${ui.empty("sequence", "No sequences yet", "Sequence stats show up here once you start one.")}</div>`}
      </div></section>`;
    cleanups = [
      columns($("#ch-sent", root), h.series.sent, { unit: "sent", empty: "No emails sent in the last 30 days" }),
      columns($("#ch-replied", root), h.series.replied, { unit: "replies", empty: "No replies yet" }),
      columns($("#ch-added", root), h.series.added, { unit: "added", empty: "No contacts added yet" }),
    ];
    root.addEventListener("click", (ev) => {
      const tr = ev.target.closest("tr[data-href]"); if (tr) location.hash = tr.dataset.href;
      const d = ev.target.closest("[data-dim]");
      if (d) {
        DIM = d.dataset.dim;
        root.querySelectorAll("[data-dim]").forEach((b) => b.classList.toggle("is-on", b === d));
        $("#who-replies", root).innerHTML = whoReplies(rb);
      }
    });
  },
  unmount() { cleanups.forEach((c) => c && c()); cleanups = []; },
});
