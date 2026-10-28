/* =========================================================================
   Data health — what's wrong with the data and one click to fix or review
   it: unverified and guessed emails, bounces, missing titles, phones and
   LinkedIn, untouched contacts, unprofiled companies, and duplicate people
   (review each group, pick the record to keep, merge).
   ========================================================================= */
import { api, confirmDialog, esc, fail, fmt, ico, onAct, router, toast, ui } from "../core.js";

let ROOT = null;
const H = { health: null, groups: [], keep: {} };

const peopleHref = (filter) => {
  const p = {};
  for (const [k, v] of Object.entries(filter || {})) p[k === "list_id" ? "list" : k] = Array.isArray(v) ? v.join(",") : String(v);
  return router.href("people", "", p);
};

function score(h) {
  // A simple 0-100: share of contacts with a verified email, minus duplicates and bounces.
  if (!h.total) return 100;
  const c = Object.fromEntries(h.checks.map((x) => [x.key, x.count]));
  const bad = (c.unverified || 0) * 0.6 + (c.bounced || 0) * 1.5 + h.duplicates.contacts * 1 + (c.guessed || 0) * 0.3;
  return Math.max(0, Math.min(100, Math.round(100 - (100 * bad) / h.total)));
}

function ring(v) {
  const r = 34, c = 2 * Math.PI * r, tone = v >= 80 ? "good" : v >= 55 ? "warn" : "bad";
  return `<svg class="ring" viewBox="0 0 84 84" width="84" height="84" role="img" aria-label="Health score ${v} of 100">
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--panel-3)" stroke-width="8"/>
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--${tone})" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 42 42)"/>
    <text x="42" y="47" text-anchor="middle" font-size="20" font-weight="700" fill="var(--text)">${v}</text></svg>`;
}

function groupHtml(g, i) {
  const keep = H.keep[i] || g[0].email;
  return `<div class="dup-group card" data-group="${i}">
    <div class="dup-group__head"><b>${esc(ui.name(g[0]) || g[0].name)}</b><span class="faint">${esc(g[0].organization || g[0].domain)}, ${g.length} records</span>
      <span class="spacer"></span><button class="btn btn--sm btn--primary" data-act="merge" data-i="${i}">${ico("merge")} Merge into selected</button></div>
    ${g.map((r) => `<label class="dup-row ${r.email === keep ? "is-keep" : ""}">
      <input type="radio" name="keep-${i}" value="${esc(r.email)}" ${r.email === keep ? "checked" : ""} data-keep="${i}"/>
      <div class="dup-row__main"><div class="row" style="gap:6px">${ui.mark(r.evidence, r.tier)}<span>${esc(r.email)}</span></div>
        <div class="hint">${esc(r.title || "No title")}, score ${fmt.num(r.score || 0)}, added ${esc(fmt.rel(r.created))}</div></div>
      ${ui.stage(r.stage)}
      ${r.email === keep ? `<span class="badge badge--good">Keep</span>` : `<span class="badge">Merge in</span>`}
    </label>`).join("")}</div>`;
}

function render() {
  const h = H.health;
  const s = score(h);
  const safe = h.total - (h.checks.find((c) => c.key === "unverified")?.count || 0);
  ROOT.innerHTML = `<section class="page">
    <div class="head"><div><div class="head__title"><h1>Data health</h1></div>
      <p class="head__sub">Fix these before you send. Each check opens the people it applies to.</p></div></div>
    <div class="grid grid-main-side">
      <div class="stack">
        <div class="card"><div class="card__head"><h3>Checks</h3><span class="faint">${fmt.plural(h.total, "contact")}</span></div>
          <div class="card__body" style="padding-top:2px;padding-bottom:2px">${h.checks.map((c) => `
            <a class="health-row" href="${peopleHref(c.filter)}">
              <span class="health-row__dot health-row__dot--${c.count ? c.tone : "good"}"></span>
              <span class="health-row__label">${esc(c.label)}</span>
              <span class="health-row__bar"><span class="progress"><span style="width:${Math.min(100, c.pct)}%;background:var(--${c.count ? (c.tone === "info" ? "faint" : c.tone) : "good"})"></span></span></span>
              <span class="health-row__n">${fmt.num(c.count)}</span><span class="health-row__pct faint">${fmt.pct(c.pct)}</span>
              ${ico("chevron", "ico--sm faint")}</a>`).join("")}</div></div>
        <div class="card"><div class="card__head"><h3>Duplicate people</h3>
          <span class="faint">${H.groups.length ? `${fmt.plural(H.groups.length, "group")}, ${fmt.plural(h.duplicates.contacts, "extra record")}` : "none found"}</span>
          ${H.groups.length > 1 ? `<div class="actions"><button class="btn btn--sm" data-act="merge-all">${ico("merge")} Merge all into the best record</button></div>` : ""}</div>
          <div class="card__body">${H.groups.length
            ? `<p class="hint mb">Same name at the same company under different addresses. Merging keeps the selected record and moves tags, lists, notes, tasks, deals, sequences and history onto it; blank fields are filled from the others.</p>
               <div class="stack">${H.groups.map(groupHtml).join("")}</div>`
            : ui.empty("check", "No duplicates", "Nobody appears twice at the same company.")}</div></div>
      </div>
      <div class="stack">
        <div class="card card--pad"><div class="row" style="gap:16px">${ring(s)}
          <div><div class="t-strong" style="font-size:15px">Health score</div>
            <div class="hint">${s >= 80 ? "In good shape." : s >= 55 ? "Worth a cleanup before your next send." : "Clean up before sending — bounces hurt your domain."}</div></div></div></div>
        <div class="card card--pad stack">
          <div class="kv-row"><span>${ico("shield", "ico--sm")} Verified safe</span><b>${fmt.num(safe)}</b></div>
          <div class="kv-row"><span>${ico("x", "ico--sm")} Suppressed addresses</span><b>${fmt.num(h.suppressed)}</b></div>
          <div class="kv-row"><span>${ico("building", "ico--sm")} Companies not profiled</span><b>${fmt.num(h.unprofiled_companies)}</b></div>
          ${h.unprofiled_companies ? `<button class="btn btn--sm" data-act="profile">${ico("spark")} Profile up to 25 companies</button>` : ""}
        </div>
        <div class="card card--pad stack"><h3>Fix it faster</h3>
          <a class="link" href="#/enrich">${ico("shield", "ico--sm")} Verify emails in bulk</a>
          <a class="link" href="#/enrich/import">${ico("upload", "ico--sm")} Import and merge a CSV</a>
          <a class="link" href="#/settings/scoring">${ico("star", "ico--sm")} Tune ICP scoring</a></div>
      </div>
    </div></section>`;
}

async function load() {
  const [h, d] = await Promise.all([api.get("/api/health"), api.get("/api/duplicates", { limit: 50 })]);
  H.health = h; H.groups = d.groups || []; H.keep = {};
}

router.register("health", {
  title: "Data health",
  async mount(root) {
    ROOT = root;
    root.innerHTML = `<div class="page">${ui.skeleton(8)}</div>`;
    await load(); render();
    root.addEventListener("change", (e) => {
      const r = e.target.closest("[data-keep]"); if (!r) return;
      const i = +r.dataset.keep; H.keep[i] = r.value;
      const el = root.querySelector(`[data-group="${i}"]`);
      el.outerHTML = groupHtml(H.groups[i], i);
    });
    onAct(root, {
      merge: async (el) => {
        const i = +el.dataset.i, g = H.groups[i], keep = H.keep[i] || g[0].email;
        try {
          const r = await api.post("/api/duplicates/merge", { primary: keep, others: g.map((x) => x.email).filter((e) => e !== keep) });
          toast(`Merged ${fmt.plural(r.merged.length, "record")} into ${r.primary}`);
          await load(); render();
        } catch (err) { fail(err); }
      },
      "merge-all": async () => {
        if (!(await confirmDialog(`Merge all ${H.groups.length} groups, keeping the best record in each (safest email, strongest evidence, highest score)?`, { ok: "Merge all" }))) return;
        const r = await api.post("/api/duplicates/merge", { all: true });
        toast(`Merged ${fmt.plural(r.merged, "record")} across ${fmt.plural(r.groups, "group")}`);
        await load(); render();
      },
      profile: async (el) => {
        el.disabled = true; let ok = 0;
        toast("Reading company websites…", "info");
        try { await api.stream("/api/companies/enrich", { limit: 25 }, (ev) => { if (ev.type === "company" && ev.ok) ok++; }); toast(`Profiled ${ok} companies`); }
        catch (err) { fail(err); }
        await load(); render();
      },
    });
  },
});
