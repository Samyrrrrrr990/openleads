/* Doctor — the `openleads doctor` checks, in plain language. Nothing here sends mail. */
import { api, esc, ico, onAct, router, store, ui } from "../core.js";

function render(root, d) {
  if (!d) { root.innerHTML = `<section class="page"><div class="head"><h1>Doctor</h1></div><div class="card">${ui.skeleton(5)}</div></section>`; return; }
  const groups = {};
  (d.checks || []).forEach((c) => { (groups[c.group] ||= []).push(c); });
  const s = d.summary || {};
  const pf = d.preflight || {};
  const tone = { ok: "good", warn: "warn", bad: "bad" };
  root.innerHTML = `<section class="page">
    <div class="head"><div><div class="head__title"><h1>Doctor</h1></div>
      <p class="head__sub">What works, what to fix — in plain language. Nothing here sends mail.</p></div>
      <div class="head__actions"><button class="btn" data-act="recheck">${ico("refresh")} Re-check</button></div></div>
    <div class="grid grid-4">
      <div class="card stat"><span class="stat__label">${ico("check", "ico--sm")} Passing</span><span class="stat__value">${s.ok || 0}</span></div>
      <div class="card stat"><span class="stat__label">${ico("flag", "ico--sm")} Warnings</span><span class="stat__value">${s.warn || 0}</span></div>
      <div class="card stat"><span class="stat__label">${ico("x", "ico--sm")} Issues</span><span class="stat__value">${s.bad || 0}</span></div>
      <div class="card stat"><span class="stat__label">${ico("shield", "ico--sm")} Sending domain</span><span class="stat__value">${esc(pf.grade || "?")}<small>${esc(pf.domain || "no mailbox")}</small></span></div>
    </div>
    ${(pf.fixes || []).length ? `<div class="banner banner--warn mt-lg">${ico("shield")}<div><b>To land in the inbox:</b><ul class="reasons" style="margin-top:4px">${pf.fixes.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div></div>` : ""}
    <div class="grid grid-2 mt-lg">${Object.entries(groups).map(([g, items]) => `
      <div class="card"><div class="card__head"><h3>${esc(g)}</h3></div><div class="card__body" style="padding-top:4px;padding-bottom:4px">
        ${items.map((c) => `<div class="list-row"><span class="badge badge--${tone[c.status] || ""} badge--sm">${esc(c.status)}</span>
          <div style="min-width:0"><div class="t-strong">${esc(c.label)}</div><div class="hint">${esc(c.detail || "")}</div></div></div>`).join("")}
      </div></div>`).join("")}</div></section>`;
}

router.register("doctor", {
  title: "Doctor",
  async mount(root) {
    const load = async () => { render(root, null); try { store.doctor = await api.get("/api/doctor"); } catch (_) { /* */ } render(root, store.doctor); };
    onAct(root, { recheck: load });
    if (store.doctor) render(root, store.doctor); else await load();
  },
});
