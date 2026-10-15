/* =========================================================================
   ICP scoring — a Settings tab (#/settings/scoring). Describe the customer
   you're after as points (seniority, department, industry, size, tech
   stack, title keywords, location, reachability); every contact gets a
   0-100 fit score and an A-D grade. The side panel previews what a change
   would do before you save it.
   ========================================================================= */
import { hbars } from "../charts.js";
import { $, api, confirmDialog, debounce, esc, fail, fmt, ico, store, toast, ui } from "../core.js";
import { registerSettingsTab } from "./settings.js";

const M = { model: null, saved: null, def: null, dist: {}, preview: null, industries: [], dirty: false };
let HOST = null;
const GRADE_HINT = { A: "75+", B: "55-74", C: "35-54", D: "under 35" };
const clone = (x) => JSON.parse(JSON.stringify(x));

function num(path, value, label = "") {
  return `<input class="input input--sm pts" type="number" min="-100" max="100" step="1" data-path="${esc(path)}" value="${Number(value) || 0}" ${label ? `aria-label="${esc(label)}"` : ""}/>`;
}

function fixedGrid(title, hint, key, options) {
  const map = M.model[key] || {};
  return `<div class="card"><div class="card__head"><div><h3>${title}</h3><p class="hint" style="margin-top:2px">${hint}</p></div></div>
    <div class="card__body pts-grid">${options.map((o) => `<label class="pts-cell ${map[o.key] ? "is-set" : ""}"><span>${esc(o.label)}</span>${num(`${key}.${o.key}`, map[o.key], o.label)}</label>`).join("")}</div></div>`;
}

function freeMap(title, hint, key, placeholder, datalist) {
  const map = M.model[key] || {};
  const rows = Object.entries(map);
  return `<div class="card"><div class="card__head"><div><h3>${title}</h3><p class="hint" style="margin-top:2px">${hint}</p></div></div>
    <div class="card__body stack">
      ${rows.length ? `<div class="pts-grid">${rows.map(([k, v]) => `<div class="pts-cell is-set"><span class="ellipsis" title="${esc(k)}">${esc(k)}</span>${num(`${key}.${k}`, v, k)}
        <button type="button" class="btn btn--xs btn--ghost btn--icon" data-del="${esc(key)}" data-k="${esc(k)}" title="Remove">${ico("x", "ico--sm")}</button></div>`).join("")}</div>` : ""}
      <div class="row" style="gap:6px"><input class="input input--sm" data-new="${key}" list="dl-${key}" placeholder="${esc(placeholder)}" style="max-width:260px"/>
        <datalist id="dl-${key}">${(datalist || []).map((v) => `<option value="${esc(v)}">`).join("")}</datalist>
        <button type="button" class="btn btn--sm" data-add="${key}">${ico("plus")} Add</button></div></div></div>`;
}

function ruleList(title, hint, key, field, placeholder) {
  const rows = M.model[key] || [];
  return `<div class="card"><div class="card__head"><div><h3>${title}</h3><p class="hint" style="margin-top:2px">${hint}</p></div></div>
    <div class="card__body stack">
      ${rows.length ? `<div class="pts-grid">${rows.map((r, i) => `<div class="pts-cell is-set"><span class="ellipsis">“${esc(r[field])}”</span>${num(`${key}.${i}.points`, r.points, r[field])}
        <button type="button" class="btn btn--xs btn--ghost btn--icon" data-del="${esc(key)}" data-i="${i}" title="Remove">${ico("x", "ico--sm")}</button></div>`).join("")}</div>` : ""}
      <div class="row" style="gap:6px"><input class="input input--sm" data-new="${key}" placeholder="${esc(placeholder)}" style="max-width:260px"/>
        <button type="button" class="btn btn--sm" data-add="${key}">${ico("plus")} Add</button></div></div></div>`;
}

function reach() {
  const m = M.model;
  const cell = (path, label, v) => `<label class="pts-cell ${v ? "is-set" : ""}"><span>${label}</span>${num(path, v, label)}</label>`;
  return `<div class="card"><div class="card__head"><div><h3>Reachability</h3><p class="hint" style="margin-top:2px">Points for being able to actually reach them.</p></div></div>
    <div class="card__body pts-grid">
      ${cell("email.safe", "Email verified safe", m.email.safe)}${cell("email.risky", "Email risky", m.email.risky)}
      ${cell("evidence.found", "Email found published", m.evidence.found)}${cell("evidence.pattern", "Email from company pattern", m.evidence.pattern)}
      ${cell("evidence.guessed", "Email guessed", m.evidence.guessed)}
      ${cell("has_phone", "Has a phone", m.has_phone)}${cell("has_linkedin", "Has LinkedIn", m.has_linkedin)}</div></div>`;
}

function sidePanel() {
  const p = M.preview;
  const dist = p ? p.distribution : M.dist;
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
  return `<div class="card" style="position:sticky;top:16px">
    <div class="card__head"><h3>${M.dirty ? "If you save" : "Your contacts"}</h3>${M.dirty && p ? `<span class="badge badge--warn">${fmt.plural(p.changed, "grade change")}</span>` : ""}</div>
    <div class="card__body stack">
      ${hbars(["A", "B", "C", "D"].map((g) => ({ label: `${g} · ${GRADE_HINT[g]}`, title: `Grade ${g}${M.dirty ? ` — now ${fmt.num(M.dist[g] || 0)}` : ""}`, value: dist[g] || 0 })), { max: total })}
      ${p && p.top.length ? `<div><div class="hint mb-sm">Best matches${M.dirty ? " under this model" : ""}</div>
        ${p.top.map((r) => `<a class="list-row" href="#/people/${encodeURIComponent(r.email)}" style="display:flex;padding:7px 0">${ui.grade(r.score)}
          <div style="min-width:0;flex:1"><div class="ellipsis t-strong">${esc(r.name || r.email)}</div><div class="hint ellipsis">${esc([r.title, r.organization].filter(Boolean).join(" · "))}</div></div>
          <span class="num faint">${r.score}</span></a>`).join("")}</div>` : ""}
      <div class="row" style="gap:6px"><button class="btn btn--ghost btn--sm" data-act-s="reset">Reset to default</button><span class="spacer"></span>
        ${M.dirty ? `<button class="btn btn--sm" data-act-s="discard">Discard</button>` : ""}
        <button class="btn btn--primary btn--sm" data-act-s="save" ${M.dirty ? "" : "disabled"}>${ico("check")} Save & rescore</button></div>
    </div></div>`;
}

function draw() {
  if (!HOST || !HOST.isConnected) return;
  const meta = store.meta || {};
  HOST.innerHTML = `<p class="muted mb">Describe the customer you want. Every contact gets a 0-100 fit score from these points (capped at 100) and a grade: <b>A</b> 75+, <b>B</b> 55+, <b>C</b> 35+, <b>D</b> below. Filter and sort People by it, and use it in workflows.</p>
    <div class="grid grid-main-side">
      <div class="stack">
        ${fixedGrid("Seniority", "Points by how senior their title is.", "seniority", meta.seniorities || [])}
        ${fixedGrid("Department", "Points for the teams you sell to.", "departments", meta.departments || [])}
        ${freeMap("Industry", "Matched against the contact's or company's industry.", "industries", "Dental, Software, Fintech…", M.industries)}
        ${fixedGrid("Company size", "Points by headcount band.", "company_sizes", (meta.company_sizes || []).map((k) => ({ key: k, label: k })))}
        ${freeMap("Tech stack", "Points when their website runs a technology.", "technologies", "HubSpot, Shopify, Stripe…", meta.technologies)}
        ${ruleList("Title keywords", "Points when the title contains a word.", "titles", "keyword", "revenue, growth, clinic…")}
        ${ruleList("Location", "Points when city, state or country contains this.", "locations", "match", "Texas, London, Germany…")}
        ${reach()}
      </div>
      <div id="score-side" style="align-self:stretch">${sidePanel()}</div>
    </div>`;
}

const drawSide = () => { const s = $("#score-side", HOST); if (s) s.innerHTML = sidePanel(); };

const refreshPreview = debounce(async () => {
  try { M.preview = await api.post("/api/scoring/preview", { model: M.model }); drawSide(); } catch (err) { fail(err); }
}, 300);

function setPath(path, value) {
  const parts = path.split(".");
  let o = M.model;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = /^\d+$/.test(parts[i]) ? +parts[i] : parts[i];
    o[k] ??= {}; o = o[k];
  }
  const last = parts[parts.length - 1];
  const v = Math.max(-100, Math.min(100, Math.round(Number(value) || 0)));
  if (typeof o === "object" && !Array.isArray(o) && v === 0 && !["has_phone", "has_linkedin", "points"].includes(last)
    && parts[0] !== "email" && parts[0] !== "evidence") delete o[last];
  else o[last] = v;
}

function changed() { M.dirty = JSON.stringify(M.model) !== JSON.stringify(M.saved); refreshPreview(); drawSide(); }

function addFrom(key) {
  const inp = HOST.querySelector(`[data-new="${key}"]`);
  const v = inp.value.trim(); if (!v) return;
  if (key === "titles") M.model.titles.push({ keyword: v, points: 10 });
  else if (key === "locations") M.model.locations.push({ match: v, points: 10 });
  else M.model[key][v] = M.model[key][v] || 10;
  draw(); changed();
  HOST.querySelector(`[data-new="${key}"]`)?.focus();
}

function bind(host) {
  host.addEventListener("input", (e) => {
    const t = e.target; if (!t.dataset.path) return;
    setPath(t.dataset.path, t.value);
    t.closest(".pts-cell")?.classList.toggle("is-set", Number(t.value) !== 0);
    changed();
  });
  host.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset.new) { e.preventDefault(); addFrom(e.target.dataset.new); } });
  host.addEventListener("click", async (e) => {
    const add = e.target.closest("[data-add]"); if (add) { addFrom(add.dataset.add); return; }
    const del = e.target.closest("[data-del]");
    if (del) {
      const key = del.dataset.del;
      if (del.dataset.i !== undefined) M.model[key].splice(+del.dataset.i, 1); else delete M.model[key][del.dataset.k];
      draw(); changed(); return;
    }
    const a = e.target.closest("[data-act-s]"); if (!a) return;
    const act = a.dataset.actS;
    try {
      if (act === "save") {
        const r = await api.post("/api/scoring/save", { model: M.model });
        M.model = r.model; M.saved = clone(r.model); M.dist = r.distribution; M.dirty = false;
        toast(`Saved — ${fmt.plural(r.rescored, "contact")} rescored`); draw(); refreshPreview();
      } else if (act === "discard") { M.model = clone(M.saved); M.dirty = false; draw(); refreshPreview(); }
      else if (act === "reset" && await confirmDialog("Replace your ICP with the default (seniority and reachability only)? Nothing changes until you save.", { ok: "Reset" })) {
        M.model = clone(M.def); draw(); changed();
      }
    } catch (err) { fail(err); }
  });
}

registerSettingsTab("scoring", "ICP scoring", async (host) => {
  HOST = host;
  host.innerHTML = ui.skeleton(8);
  try {
    const [s, f] = await Promise.all([api.get("/api/scoring"), api.post("/api/people/facets", {}).catch(() => ({}))]);
    M.model = s.model; M.saved = clone(s.model); M.def = s.default; M.dist = s.distribution; M.dirty = false;
    M.industries = (f.industry || []).map((x) => x.value).filter(Boolean);
    bind(host); draw(); refreshPreview();
  } catch (err) { host.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
});
