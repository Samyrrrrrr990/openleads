/* =========================================================================
   Companies — every company you have contacts at, enriched from its website:
   industry, size, location, phone, socials and the technologies it runs.
   Filter by any of them (e.g. "dental practices on WordPress without
   Zocdoc"), act in bulk, and open the company record in a drawer.
   ========================================================================= */
import { addToList } from "../actions.js";
import { $, api, confirmDialog, debounce, drawer, esc, fail, fmt, ico, menu, modal, onAct, router, store, toast, ui } from "../core.js";
import * as F from "../filters.js";
import { timeline } from "../timeline.js";

const CFG = [
  { key: "stage", label: "Account stage", icon: "flag", labels: (k) => store.label("account_stages", k) },
  { key: "industry", label: "Industry", icon: "layers" },
  { key: "company_size", label: "Company size", icon: "users",
    order: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+", ""] },
  { key: "technologies", label: "Technologies", icon: "code" },
  { key: "country", label: "Country", icon: "globe" },
  { key: "min_people", label: "People in your CRM", icon: "users", type: "select",
    options: [["", "Any"], ["1", "At least 1"], ["2", "2 or more"], ["5", "5 or more"]] },
  { key: "has_phone", label: "Phone", icon: "phone", type: "bool", option: "Has a main phone line" },
];

const S = { filters: {}, q: "", sort: "people", direction: "desc", page: 1, rows: [], total: 0, pages: 1,
  facets: null, selected: new Set(), open: F.openSet("co-facets") };
const FSTATE = { get filters() { return S.filters; }, set filters(v) { S.filters = v; }, open: S.open, cfg: CFG, prefKey: "co-facets" };
let ROOT = null, handle = null;

const query = () => ({ ...S.filters, q: S.q });

async function load({ facets = true } = {}) {
  try {
    const res = await api.post("/api/companies/search", { filters: query(), sort: S.sort, direction: S.direction,
      page: S.page, per_page: 50, facets });
    Object.assign(S, { rows: res.rows, total: res.total, pages: res.pages });
    if (res.facets) S.facets = res.facets;
  } catch (e) { fail(e); }
  const h = router.href("companies", router.parse().id, F.toParams(CFG, S.filters, { q: S.q, sort: S.sort !== "people" ? S.sort : "" }));
  if (location.hash !== h) history.replaceState(null, "", h);
  lastKey = paramKey(router.parse().params);
  renderTable(); if (facets) renderFilters();
}

function shell() {
  ROOT.innerHTML = `<div class="page--flush" style="height:100%">
    <div style="padding:18px 22px 14px;border-bottom:1px solid var(--line);background:var(--panel)">
      <div class="head" style="margin:0"><div><div class="head__title"><h1>Companies</h1><span class="badge" id="co-total">…</span></div>
        <p class="head__sub">Accounts rolled up from your contacts and enriched from their websites — tech stack, socials, phone, size.</p></div>
        <div class="head__actions">
          <button class="btn" data-act="enrich-all">${ico("spark")} Profile new companies</button>
          <button class="btn btn--primary" data-act="add">${ico("plus")} Add company</button></div></div></div>
    <div class="data" style="flex:1;min-height:0">
      <aside class="filters" id="co-filters"></aside>
      <div class="data__main">
        <div class="toolbar"><div class="search-input">${ico("find")}<input class="input" id="co-q" placeholder="Search companies, domains, industries…" value="${esc(S.q)}"/></div></div>
        <div id="co-chips"></div><div id="co-bulk"></div>
        <div class="data__table" id="co-table">${ui.skeleton(10)}</div>
        <div id="co-pager"></div>
      </div></div></div>`;
}

function renderFilters() {
  const el = $("#co-filters", ROOT); if (!el) return;
  el.innerHTML = F.render(CFG, S.filters, S.facets, S.open);
  const chips = F.chips(CFG, S.filters);
  $("#co-chips", ROOT).innerHTML = chips ? `<div class="active-filters">${chips}</div>` : "";
}

function renderTable() {
  const tbl = $("#co-table", ROOT); if (!tbl) return;
  $("#co-total", ROOT).textContent = fmt.num(S.total);
  if (!S.rows.length) {
    tbl.innerHTML = F.activeCount(S.filters, CFG) || S.q ? ui.empty("filter", "No companies match", "Loosen a filter.", `<button class="btn" data-act="clear">Clear filters</button>`)
      : ui.empty("building", "No companies yet", "Companies appear automatically for everyone you find or import.", `<a class="btn btn--accent" href="#/prospect">${ico("radar")} Find people</a>`);
    $("#co-bulk", ROOT).innerHTML = ""; $("#co-pager", ROOT).innerHTML = ""; return;
  }
  const th = (label, sort) => sort ? `<th class="is-sortable ${S.sort === sort ? "is-sorted" : ""}" data-sort="${sort}">${label}<span class="sort">${S.sort === sort ? (S.direction === "asc" ? "▲" : "▼") : "↕"}</span></th>` : `<th>${label}</th>`;
  tbl.innerHTML = `<table class="tbl"><thead><tr><th class="col-check"><input type="checkbox" data-selpage ${S.rows.every((r) => S.selected.has(r.domain)) ? "checked" : ""}/></th>
    ${th("Company", "name")}${th("Industry", "industry")}${th("Size", "size")}<th>Location</th>${th("People", "people")}<th>Tech stack</th>${th("Stage", "stage")}<th>Phone</th></tr></thead>
    <tbody>${S.rows.map((r) => `<tr class="is-click ${S.selected.has(r.domain) ? "is-selected" : ""}" data-domain="${esc(r.domain)}">
      <td class="col-check"><input type="checkbox" data-sel="${esc(r.domain)}" ${S.selected.has(r.domain) ? "checked" : ""}/></td>
      <td><div class="cell-person">${ui.companyAvatar(r.name || r.domain)}<div><span class="name">${esc(r.name || r.domain)}</span><span class="sub">${esc(r.domain)}</span></div></div></td>
      <td class="t-sub">${esc(r.industry || "—")}</td><td class="t-sub nowrap">${esc(r.company_size || "—")}</td>
      <td class="t-sub nowrap">${esc([r.city, r.state || r.country].filter(Boolean).join(", ") || "—")}</td>
      <td class="nowrap"><a class="link" href="#/people?domain=${encodeURIComponent(r.domain)}" data-stop>${fmt.num(r.people)}</a> <span class="faint">· ${fmt.num(r.safe)} safe</span></td>
      <td><div class="tags tags--nowrap" style="max-width:250px" title="${esc(r.technologies.join(", "))}">${r.technologies.slice(0, 2).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}${r.technologies.length > 2 ? `<span class="tag">+${r.technologies.length - 2}</span>` : ""}${!r.technologies.length && !r.profiled ? '<span class="faint">not profiled</span>' : ""}</div></td>
      <td><span class="badge">${esc(store.label("account_stages", r.stage || "prospect"))}</span></td>
      <td class="t-sub nowrap">${r.phone ? esc(fmt.phone(r.phone)) : "—"}</td></tr>`).join("")}</tbody></table>`;
  const n = S.selected.size;
  $("#co-bulk", ROOT).innerHTML = n ? `<div class="bulkbar"><span class="bulkbar__count">${fmt.num(n)} selected</span><span class="spacer"></span>
    <button class="btn" data-act="b-people">${ico("users")} Show people</button>
    <button class="btn" data-act="b-list">${ico("list")} Add to list</button>
    <button class="btn" data-act="b-stage">${ico("flag")} Stage</button>
    <button class="btn" data-act="b-profile">${ico("spark")} Profile websites</button>
    <button class="btn" data-act="b-delete">${ico("trash")}</button>
    <button class="btn" data-act="b-clear">${ico("x")}</button></div>` : "";
  $("#co-pager", ROOT).innerHTML = `<div class="pager"><span>${fmt.num(S.total)} companies</span><span class="spacer"></span>
    <button class="btn btn--sm btn--icon" data-act="prev" ${S.page <= 1 ? "disabled" : ""}>${ico("chevron-left")}</button><span>${S.page} / ${S.pages}</span>
    <button class="btn btn--sm btn--icon" data-act="next" ${S.page >= S.pages ? "disabled" : ""}>${ico("chevron")}</button></div>`;
}

async function profile(domains) {
  toast(`Profiling ${fmt.plural(domains.length, "company", "companies")}…`, "info");
  let ok = 0, failed = 0;
  await api.stream("/api/companies/enrich", { domains }, (ev) => {
    if (ev.type === "company") ev.ok ? ok++ : failed++;
  });
  toast(`Profiled ${ok}${failed ? ` · ${failed} unreachable` : ""}`, failed && !ok ? "err" : "ok");
  load();
}

/* --------------------------------------------------------------- drawer */
export function openCompany(domain, { onClose, onChange } = {}) {
  const d = drawer({ onClose });
  let data = null, tab = "overview";
  const changed = () => onChange && onChange();
  async function loadOne() {
    try { data = await api.get("/api/companies/get", { domain }); } catch (e) { d.el.innerHTML = `<div class="drawer__body">${ui.empty("building", "Company not found", esc(e.message))}</div>`; return; }
    render();
  }
  function render() {
    const a = data.account;
    const socials = [["linkedin_url", "linkedin", "LinkedIn"], ["twitter_url", "globe", "X"], ["facebook_url", "globe", "Facebook"], ["instagram_url", "globe", "Instagram"]]
      .filter(([k]) => a[k]).map(([k, i, l]) => `<a class="btn btn--xs" href="${esc(a[k])}" target="_blank" rel="noopener noreferrer">${ico(i, "ico--sm")} ${l}</a>`).join("");
    const body = tab === "overview" ? `
      ${a.description ? `<p class="muted" style="font-size:14px">${esc(a.description)}</p>` : `<div class="banner">${ico("spark")}<div>Not profiled yet. <a data-a="profile" href="#">Read their website</a> for industry, phone, socials and tech stack.</div></div>`}
      <div class="grid grid-2 mt">
        <div class="card card--pad"><dl class="kv"><dt>Website</dt><dd><a class="link" href="${esc(a.website || "https://" + a.domain)}" target="_blank" rel="noopener noreferrer">${esc(a.domain)}</a></dd>
          <dt>Industry</dt><dd>${esc(a.industry || "—")}</dd><dt>Size</dt><dd>${esc(a.company_size ? a.company_size + " employees" : a.employees || "—")}</dd>
          <dt>Founded</dt><dd>${esc(a.founded || "—")}</dd><dt>Main line</dt><dd>${a.phone ? `<a class="link" href="tel:${esc(a.phone)}">${esc(fmt.phone(a.phone))}</a>` : "—"}</dd>
          <dt>Location</dt><dd>${esc([a.city, a.state, a.country].filter(Boolean).join(", ") || "—")}</dd>
          <dt>Profiled</dt><dd>${a.profiled ? esc(fmt.rel(a.profiled)) : "never"}</dd></dl>
          ${socials ? `<div class="row row--wrap mt">${socials}</div>` : ""}</div>
        <div class="card card--pad stack"><div class="row"><h3>Tech stack</h3><span class="spacer"></span><span class="faint">${a.technologies.length}</span></div>
          ${a.technologies.length ? `<div class="tags">${a.technologies.map((t) => `<a class="tag" href="#/companies?technologies=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div>`
            : '<span class="hint">Nothing detected yet.</span>'}</div></div>
      <div class="card mt"><div class="card__head"><h3>People</h3><span class="faint">${data.people.length}</span>
        <div class="actions"><a class="btn btn--xs" href="#/people?domain=${encodeURIComponent(a.domain)}">Open in People</a></div></div>
        ${data.people.length ? data.people.slice(0, 12).map((p) => `<a class="list-row" style="display:flex;padding:9px 16px" href="#/people/${encodeURIComponent(p.email)}">
          ${ui.avatar(ui.name(p) || p.email, p.email, "avatar--sm")}<div style="flex:1;min-width:0"><div class="t-strong ellipsis">${esc(ui.name(p) || p.email)}</div>
          <div class="hint ellipsis">${esc(p.title || "")}</div></div>${ui.tierDot(p.tier)}${ui.stage(p.stage)}</a>`).join("") : '<div class="card__body"><p class="muted">No contacts here yet.</p></div>'}</div>`
      : tab === "activity" ? `<div class="composer"><textarea class="textarea" data-note placeholder="Add a note about this account…"></textarea>
          <div class="composer__foot"><span class="spacer"></span><button class="btn btn--sm btn--primary" data-a="note">${ico("note")} Save note</button></div></div>
          <div class="mt-lg">${timeline(data.timeline, { showRef: true })}</div>`
        : `<div class="row"><span class="spacer"></span><button class="btn btn--sm btn--primary" data-a="deal">${ico("plus")} New deal</button></div>
          <div class="mt">${data.deals.length ? data.deals.map((x) => `<div class="list-row"><span class="tl-icon tl-icon--good">${ico("deal")}</span>
          <div style="flex:1"><b>${esc(x.name)}</b><div class="hint">${esc(store.label("deal_stages", x.stage))}</div></div><b class="num">${esc(fmt.money(x.amount, x.currency))}</b></div>`).join("") : '<p class="muted">No deals.</p>'}</div>`;
    d.el.innerHTML = `<div class="drawer__head"><div class="drawer__top">${ui.companyAvatar(a.name || a.domain, "avatar--lg")}
        <div class="drawer__title"><h2>${esc(a.name || a.domain)}</h2><div class="sub">${esc(a.domain)}${a.industry ? " · " + esc(a.industry) : ""}</div>
          <div class="row row--wrap mt" style="gap:6px">${a.company_size ? `<span class="badge badge--outline">${esc(a.company_size)} employees</span>` : ""}
          ${a.city ? `<span class="badge badge--outline">${ico("pin", "ico--sm")}${esc([a.city, a.country].filter(Boolean).join(", "))}</span>` : ""}
          <span class="badge badge--outline">${ico("users", "ico--sm")}${fmt.num(a.people)} in CRM</span></div></div>
        <button class="btn btn--ghost btn--icon" data-x>${ico("x")}</button></div>
      <div class="drawer__actions">
        <select class="select select--sm" data-stage style="width:auto">${(store.meta?.account_stages || []).map((s) => `<option value="${s.key}" ${s.key === (a.stage || "prospect") ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select>
        <a class="btn btn--sm" href="${esc(a.website || "https://" + a.domain)}" target="_blank" rel="noopener noreferrer">${ico("external")} Website</a>
        <button class="btn btn--sm" data-a="profile">${ico("refresh")} ${a.profiled ? "Refresh profile" : "Profile website"}</button>
        <button class="btn btn--sm" data-a="list">${ico("list")} List</button>
        <button class="btn btn--sm" data-a="deal">${ico("deal")} Deal</button>
        <a class="btn btn--sm" href="#/prospect?q=${encodeURIComponent("emails at " + a.domain)}">${ico("radar")} Find more people</a></div>
      <div class="tabs">${[["overview", "Overview"], ["activity", "Activity", data.timeline.length], ["deals", "Deals", data.deals.length]].map(([k, l, n]) =>
        `<button type="button" class="${tab === k ? "is-on" : ""}" data-tab="${k}">${l}${n ? ` <span class="cnt">${n}</span>` : ""}</button>`).join("")}</div></div>
      <div class="drawer__body">${body}</div>`;
  }
  d.el.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-x]")) return d.close();
    const tb = t.closest("[data-tab]"); if (tb) { tab = tb.dataset.tab; render(); return; }
    const a = t.closest("[data-a]")?.dataset.a;
    if (!a) return;
    e.preventDefault();
    try {
      if (a === "profile") {
        const res = await api.post("/api/companies/profile", { domain, refresh: true });
        toast(`Found ${fmt.plural(res.company.technologies.length, "technology", "technologies")}`); await loadOne(); changed();
      } else if (a === "list") { await addToList(t.closest("[data-a]"), { domains: [domain], emails: [] }, { kind: "companies" }); }
      else if (a === "note") {
        const body = $("[data-note]", d.el).value.trim();
        if (body) { await api.post("/api/notes/add", { ref_type: "company", ref: domain, body }); toast("Note added"); await loadOne(); }
      } else if (a === "deal") {
        await modal({ title: `New deal with ${data.account.name || domain}`, body: `<div class="form-grid">
          <div class="field span-2"><label>Name</label><input class="input" name="name" value="${esc(data.account.name || domain)} — " autofocus/></div>
          <div class="field"><label>Amount</label><input class="input" name="amount" placeholder="12,000"/></div>
          <div class="field"><label>Primary contact</label><select class="select" name="contact"><option value="">—</option>${data.people.map((p) =>
            `<option value="${esc(p.email)}">${esc(ui.name(p) || p.email)}</option>`).join("")}</select></div></div>`,
        actions: [{ label: "Cancel", value: null }, { label: "Create deal", kind: "primary", submit: true }],
        onSubmit: async (f) => { await api.post("/api/deals/save", { name: f.name.value, amount: f.amount.value, account: domain, contact: f.contact.value }); toast("Deal created"); tab = "deals"; await loadOne(); return true; } });
      }
    } catch (err) { fail(err); }
  });
  d.el.addEventListener("change", async (e) => {
    if (!e.target.matches("[data-stage]")) return;
    try { await api.post("/api/companies/update", { domain, fields: { stage: e.target.value } }); toast("Stage updated"); changed(); await loadOne(); } catch (err) { fail(err); }
  });
  d.el.innerHTML = `<div class="drawer__body">${ui.skeleton(8)}</div>`;
  loadOne();
  return { domain, close: d.close, get closed() { return d.closed; } };
}

function syncDrawer(ctx) {
  if (ctx.id) {
    if (handle && handle.domain === ctx.id && !handle.closed) return;
    handle?.close();
    const domain = ctx.id;
    const mine = openCompany(domain, {
      onClose: () => {
        if (handle === mine) handle = null;
        const p = router.parse();      // leave the URL alone if another company replaced this one
        if (p.name === "companies" && p.id === domain) history.replaceState(null, "", router.href("companies", "", p.params));
      },
      onChange: () => load({ facets: false }) });
    handle = mine;
  } else if (handle) { handle.close(); handle = null; }
}

router.register("companies", {
  title: "Companies",
  async mount(root, ctx) {
    ROOT = root;
    S.filters = F.fromParams(CFG, ctx.params); S.q = ctx.params.q || ""; S.sort = ctx.params.sort || "people";
    S.selected = new Set(); S.page = 1; lastKey = paramKey(ctx.params);
    shell(); renderFilters();
    F.bind($("#co-filters", root), FSTATE, () => { S.page = 1; load(); }, renderFilters);
    const typed = debounce(() => { S.page = 1; load(); }, 300);
    $("#co-q", root).addEventListener("input", (e) => { S.q = e.target.value.trim(); typed(); });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.sel !== undefined) { t.checked ? S.selected.add(t.dataset.sel) : S.selected.delete(t.dataset.sel); renderTable(); }
      if (t.dataset.selpage !== undefined) { S.rows.forEach((r) => t.checked ? S.selected.add(r.domain) : S.selected.delete(r.domain)); renderTable(); }
    });
    root.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-fremove]");
      if (rm) { const c = CFG.find((x) => x.key === rm.dataset.fremove); S.filters[c.key] = c.type === "select" ? "" : c.type === "bool" ? false : []; load(); return; }
      const th = e.target.closest("th[data-sort]");
      if (th) { const k = th.dataset.sort; S.direction = S.sort === k && S.direction === "desc" ? "asc" : k === "name" ? "asc" : "desc"; S.sort = k; load({ facets: false }); return; }
      const tr = e.target.closest("tr[data-domain]");
      if (tr && !e.target.closest("input, button, a, [data-stop]")) router.go("companies", tr.dataset.domain, router.parse().params);
    });
    const sel = () => Array.from(S.selected);
    onAct(root, {
      clear: () => { F.clearAll(FSTATE); S.q = ""; $("#co-q", root).value = ""; load(); },
      prev: () => { S.page--; load({ facets: false }); }, next: () => { S.page++; load({ facets: false }); },
      "b-clear": () => { S.selected.clear(); renderTable(); },
      "b-people": () => router.go("people", "", { domain: sel().join(",") }),
      "b-list": (el) => addToList(el, { domains: sel(), emails: [] }, { kind: "companies" }),
      "b-profile": () => profile(sel()),
      "b-stage": (el) => menu(el, (store.meta?.account_stages || []).map((s) => ({ label: s.label, value: s.key })), async (v) => {
        const r = await api.post("/api/companies/bulk", { domains: sel(), action: "stage", value: v });
        toast(`${r.count} updated`); load();
      }),
      "b-delete": async () => {
        if (!(await confirmDialog(`Remove ${fmt.plural(S.selected.size, "company", "companies")}? Their contacts stay in People.`, { ok: "Remove", danger: true }))) return;
        await api.post("/api/companies/bulk", { domains: sel(), action: "delete" }); S.selected.clear(); load();
      },
      "enrich-all": async () => {
        toast("Reading websites for companies that haven't been profiled…", "info");
        let ok = 0;
        await api.stream("/api/companies/enrich", { limit: 25 }, (ev) => { if (ev.type === "company" && ev.ok) ok++; });
        toast(`Profiled ${ok} companies`); load();
      },
      add: async () => {
        await modal({ title: "Add a company", body: `<div class="field"><label>Domain</label><input class="input" name="domain" placeholder="acme.com" autofocus/></div>
          <div class="field"><label>Name</label><input class="input" name="name" placeholder="Acme"/></div>
          <label class="check"><input type="checkbox" name="profile" checked/> Read their website for tech stack, socials and phone</label>`,
        actions: [{ label: "Cancel", value: null }, { label: "Add company", kind: "primary", submit: true }],
        onSubmit: async (f) => {
          const r = await api.post("/api/companies/create", { domain: f.domain.value, name: f.name.value });
          if (f.profile.checked) { try { await api.post("/api/companies/profile", { domain: r.company.domain }); } catch (_) { /* offline */ } }
          toast("Company added"); load(); router.go("companies", r.company.domain); return true;
        } });
      },
    });
    await load();
    syncDrawer(ctx);
  },
  update(ctx) {
    const key = paramKey(ctx.params);
    if (key !== lastKey) {
      lastKey = key;
      S.filters = F.fromParams(CFG, ctx.params); S.q = ctx.params.q || ""; S.page = 1;
      $("#co-q", ROOT).value = S.q;
      load();
    }
    syncDrawer(ctx);
  },
  unmount() { handle?.close(); handle = null; },
});

let lastKey = "";
function paramKey(params) {
  return JSON.stringify(Object.entries(params).filter(([k]) => k !== "page").sort());
}
