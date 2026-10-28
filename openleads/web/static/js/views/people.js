/* =========================================================================
   People — every contact in your workspace, Apollo-style: a filter sidebar
   with live counts, a sortable table with the columns you choose, a bulk bar
   that can act on "all N matching", saved searches, and a contact record that
   opens in a drawer (#/people/<email>) without losing your place.
   ========================================================================= */
import { addToList, enroll, exportMenu, moreMenu, setStage, writeEmails } from "../actions.js";
import { $, $$, api, debounce, esc, fail, fmt, ico, menu, modal, onAct, promptDialog, router, store, toast, ui } from "../core.js";
import * as F from "../filters.js";
import { openContact } from "./contact.js";

const tierLabel = (k) => ({ safe: "Verified safe", risky: "Risky", bad: "Bad", "(none)": "Unverified" }[k] || k);
const CFG = [
  { key: "stage", label: "Stage", icon: "flag", labels: (k) => store.label("contact_stages", k),
    order: () => (store.meta?.contact_stages || []).map((s) => s.key) },
  { key: "tier", label: "Email status", icon: "shield", labels: tierLabel, blank: "Unverified", order: ["safe", "risky", "", "bad"] },
  { key: "evidence", label: "Email evidence", icon: "eye", labels: (k) => ({ found: "Found", pattern: "Pattern", guessed: "Guessed" }[k] || k) },
  { key: "fit_min", label: "ICP fit", icon: "star", type: "select",
    options: [["", "Any fit"], ["75", "A only"], ["55", "B or better"], ["35", "C or better"]] },
  { key: "seniority", label: "Seniority", icon: "user", labels: (k) => store.label("seniorities", k),
    order: ["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry", "intern", ""] },
  { key: "department", label: "Department", icon: "users", labels: (k) => store.label("departments", k) },
  { key: "title", label: "Job title", icon: "edit", type: "text", placeholder: "growth, marketing", hint: "Any of these words." },
  { key: "domain", label: "Company domain", icon: "building", type: "text", placeholder: "acme.com" },
  { key: "industry", label: "Industry", icon: "layers" },
  { key: "company_size", label: "Company size", icon: "users",
    order: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+", ""] },
  { key: "technologies", label: "Technologies", icon: "code", type: "text", placeholder: "HubSpot, Shopify", hint: "The company's site runs any of these." },
  { key: "location", label: "Location", icon: "pin", type: "text", placeholder: "Austin, TX, Germany" },
  { key: "country", label: "Country", icon: "globe" },
  { key: "tags", label: "Tags", icon: "tag" },
  { key: "list_id", label: "Lists", icon: "list", facetKey: "lists", alias: "list" },
  { key: "sequence", label: "Sequences", icon: "sequence", type: "select",
    options: [["", "Any"], ["any", "In a sequence"], ["none", "Not in a sequence"]] },
  { key: "status", label: "Email activity", icon: "mail", order: ["new", "queued", "sent", "replied", "bounced", "unsubscribed"],
    labels: (k) => ({ new: "Not emailed", queued: "Queued", sent: "Emailed", replied: "Replied", bounced: "Bounced", unsubscribed: "Unsubscribed" }[k] || k) },
  { key: "contacted", label: "Last contacted", icon: "send", type: "select",
    options: [["", "Any time"], ["never", "Never contacted"], ["ever", "Contacted"], ["7d", "In the last 7 days"], ["30d", "In the last 30 days"], ["90d", "In the last 90 days"]] },
  { key: "created_within", label: "Added", icon: "calendar", type: "select",
    options: [["", "Any time"], ["1", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"]] },
  { key: "source", label: "Source", icon: "radar" },
  { key: "has_phone", label: "Phone", icon: "phone", type: "select",
    options: [["", "Any"], ["yes", "Has a phone number"], ["no", "No phone number"]] },
  { key: "has_linkedin", label: "LinkedIn", icon: "linkedin", type: "select",
    options: [["", "Any"], ["yes", "Has a LinkedIn profile"], ["no", "No LinkedIn profile"]] },
];

// Order = left to right. The narrow, decision-making columns (fit, stage) come
// before the wide ones so they stay in view without scrolling.
const COLUMNS = [
  { key: "fit", label: "Fit", sort: "fit", def: true },
  { key: "company", label: "Company", sort: "organization", def: true },
  { key: "email", label: "Email", sort: "email", def: true },
  { key: "stage", label: "Stage", sort: "stage", def: true },
  { key: "last_contacted", label: "Last contacted", sort: "last_contacted", def: true },
  { key: "seniority", label: "Seniority", sort: "seniority", def: false },
  { key: "department", label: "Department", def: false },
  { key: "location", label: "Location", sort: "location", def: true },
  { key: "phone", label: "Phone", def: false },
  { key: "tags", label: "Tags & lists", def: true },
  { key: "sequence", label: "Sequence", def: false },
  { key: "created", label: "Added", sort: "created", def: false },
  { key: "source", label: "Source", def: false },
];

const S = {
  filters: {}, q: "", sort: "updated", direction: "desc", page: 1, perPage: store.pref("people-per-page", 50),
  rows: [], total: 0, pages: 1, facets: null, selected: new Set(), allMatching: false, loading: false,
  open: F.openSet("people-facets"), cols: new Set(store.pref("people-cols", COLUMNS.filter((c) => c.def).map((c) => c.key))),
  saved: [], dense: store.pref("people-dense", false),
};
const FSTATE = { get filters() { return S.filters; }, set filters(v) { S.filters = v; }, open: S.open, cfg: CFG, prefKey: "people-facets" };
let ROOT = null;
let drawerHandle = null;

const query = () => ({ ...S.filters, q: S.q });

function syncUrl() {
  const params = F.toParams(CFG, S.filters, {
    q: S.q || "", sort: S.sort !== "updated" ? S.sort : "", dir: S.direction !== "desc" ? S.direction : "",
    page: S.page > 1 ? S.page : "" });
  const h = router.href("people", router.parse().id, params);
  if (location.hash !== h) history.replaceState(null, "", h);
  lastKey = paramKey(router.parse().params);
}

async function load({ facets = true } = {}) {
  S.loading = true;
  $("#ppl-table", ROOT)?.classList.add("is-loading");
  try {
    const res = await api.post("/api/people/search", { filters: query(), sort: S.sort, direction: S.direction,
      page: S.page, per_page: S.perPage, facets });
    S.rows = res.rows; S.total = res.total; S.pages = res.pages;
    if (res.facets) S.facets = res.facets;
  } catch (e) { fail(e); }
  S.loading = false;
  syncUrl();
  renderTable(); if (facets) renderFilters();
}

/* -------------------------------------------------------------- render */
function shell() {
  ROOT.innerHTML = `<div class="page--flush" style="height:100%">
    <div style="padding:18px 22px 14px;border-bottom:1px solid var(--line);background:var(--panel)">
      <div class="head" style="margin:0">
        <div><div class="head__title"><h1>People</h1><span class="badge" id="ppl-total">…</span></div></div>
        <div class="head__actions">
          <a class="btn" href="#/enrich/import">${ico("upload")} Import</a>
          <button class="btn" data-act="add">${ico("user-plus")} Add contact</button>
          <a class="btn btn--accent" href="#/prospect">${ico("radar")} Find new people</a>
        </div>
      </div>
    </div>
    <div class="data" style="flex:1;min-height:0">
      <aside class="filters" id="ppl-filters"></aside>
      <div class="data__main">
        <div class="toolbar">
          <div class="search-input">${ico("find")}<input class="input" id="ppl-q" placeholder="Search name, email, company, title…" value="${esc(S.q)}"/></div>
          <button class="btn btn--sm" data-act="saved">${ico("bookmark")} Saved searches</button>
          <span class="spacer"></span>
          <button class="btn btn--sm btn--ghost" data-act="dense" title="Row density">${ico("table")}</button>
          <button class="btn btn--sm" data-act="cols">${ico("columns")} Columns</button>
          <button class="btn btn--sm" data-act="export-all">${ico("download")} Export</button>
        </div>
        <div id="ppl-chips"></div>
        <div id="ppl-bulk"></div>
        <div class="data__table" id="ppl-table">${ui.skeleton(10)}</div>
        <div id="ppl-pager"></div>
      </div>
    </div></div>`;
}

function renderFilters() {
  const el = $("#ppl-filters", ROOT);
  if (!el) return;
  const st = el.scrollTop;
  el.innerHTML = F.render(CFG.map((c) => ({ ...c, order: typeof c.order === "function" ? c.order() : c.order })),
    S.filters, S.facets, S.open);
  el.scrollTop = st;
  const chips = F.chips(CFG, S.filters) + (S.q ? `<span class="chip"><b>Search:</b> ${esc(S.q)}<button type="button" data-fremove="q">${ico("x", "ico--sm")}</button></span>` : "");
  $("#ppl-chips", ROOT).innerHTML = chips ? `<div class="active-filters">${chips}</div>` : "";
}

function cell(r, key) {
  switch (key) {
    case "company": return `<td><div class="ellipsis" style="max-width:190px">${r.domain
      ? `<a class="link" style="color:inherit" href="#/companies/${encodeURIComponent(r.domain)}" data-stop>${esc(r.organization || r.domain)}</a>` : esc(r.organization || "—")}</div>
      <div class="t-sub ellipsis" style="max-width:190px">${esc(r.domain || "")}</div></td>`;
    case "email": return `<td><div class="cell-email">${ui.mark(r.evidence, r.tier)}<span class="addr">${esc(r.email)}</span>${ui.copy(r.email)}</div></td>`;
    case "stage": return `<td>${ui.stage(r.stage)}</td>`;
    case "fit": return `<td>${ui.grade(r.fit_score)}</td>`;
    case "seniority": return `<td>${r.seniority ? esc(store.label("seniorities", r.seniority)) : '<span class="faint">—</span>'}</td>`;
    case "department": return `<td>${r.department ? esc(store.label("departments", r.department)) : '<span class="faint">—</span>'}</td>`;
    case "location": return `<td class="t-sub nowrap">${esc([r.city, r.state || r.country].filter(Boolean).join(", ") || "—")}</td>`;
    case "phone": return `<td class="t-sub nowrap">${r.phone ? `<a class="link" href="tel:${esc(r.phone)}" data-stop>${esc(fmt.phone(r.phone))}</a>` : "—"}</td>`;
    case "tags": return `<td><div class="tags" style="max-width:220px">${(r.lists || []).slice(0, 2).map((l) =>
      `<span class="tag"><i class="color-dot c-${esc(l.color || "gray")}"></i>${esc(l.name)}</span>`).join("")}${(r.tags || []).slice(0, 3).map((t) =>
      `<span class="tag">#${esc(t)}</span>`).join("")}</div></td>`;
    case "sequence": return `<td>${r.sequence ? `<a class="badge badge--info" href="#/sequences/${r.sequence.id}" data-stop>${esc(r.sequence.name)} · ${r.sequence.step + 1}</a>` : '<span class="faint">—</span>'}</td>`;
    case "last_contacted": return `<td class="t-sub nowrap">${r.last_contacted ? esc(fmt.rel(r.last_contacted)) : "Never"}</td>`;
    case "created": return `<td class="t-sub nowrap">${esc(fmt.rel(r.created))}</td>`;
    case "source": return `<td class="t-sub">${esc(r.source || "—")}</td>`;
  }
  return "<td></td>";
}

function renderTable() {
  const tbl = $("#ppl-table", ROOT);
  if (!tbl) return;
  tbl.classList.remove("is-loading");
  $("#ppl-total", ROOT).textContent = fmt.num(S.total);
  const cols = COLUMNS.filter((c) => S.cols.has(c.key));
  if (!S.rows.length) {
    const filtered = F.activeCount(S.filters, CFG) || S.q;
    tbl.innerHTML = filtered ? ui.empty("filter", "No one matches these filters", "Loosen a filter or clear them all.", `<button class="btn" data-act="clear">Clear filters</button>`)
      : ui.empty("users", "Your workspace is empty", "Find people from free public sources, or import a CSV from Apollo, HubSpot or LinkedIn.",
        `<a class="btn btn--accent" href="#/prospect">${ico("radar")} Find people</a><a class="btn" href="#/enrich/import">${ico("upload")} Import CSV</a>`);
    renderBulk(); renderPager(); return;
  }
  const allOnPage = S.rows.every((r) => S.selected.has(r.email));
  const th = (label, sort) => {
    if (!sort) return `<th>${esc(label)}</th>`;
    const on = S.sort === sort;
    return `<th class="is-sortable ${on ? "is-sorted" : ""}" data-sort="${sort}">${esc(label)}<span class="sort">${on ? (S.direction === "asc" ? "▲" : "▼") : "↕"}</span></th>`;
  };
  tbl.innerHTML = `<table class="tbl ${S.dense ? "tbl--compact" : ""}"><thead><tr>
      <th class="col-check"><input type="checkbox" data-selpage ${allOnPage ? "checked" : ""} aria-label="Select page"/></th>
      ${th("Name", "name")}${cols.map((c) => th(c.label, c.sort)).join("")}</tr></thead>
    <tbody>${S.rows.map((r) => {
      const name = ui.name(r);
      return `<tr class="is-click ${S.selected.has(r.email) || S.allMatching ? "is-selected" : ""}" data-email="${esc(r.email)}">
        <td class="col-check"><input type="checkbox" data-sel="${esc(r.email)}" ${S.selected.has(r.email) || S.allMatching ? "checked" : ""}/></td>
        <td><div class="cell-person">
          <div><span class="name">${esc(name || r.organization || r.email)}</span><span class="sub">${esc(r.title || (name ? "" : "Company address"))}</span></div></div></td>
        ${cols.map((c) => cell(r, c.key)).join("")}</tr>`;
    }).join("")}</tbody></table>`;
  if (cursor >= 0) $$("#ppl-table tbody tr[data-email]", ROOT)[cursor]?.classList.add("is-cursor");
  renderBulk(); renderPager();
}

function selection() {
  return S.allMatching ? { all: true, filters: query(), total: S.total } : { emails: Array.from(S.selected) };
}

function renderBulk() {
  const el = $("#ppl-bulk", ROOT);
  const n = S.allMatching ? S.total : S.selected.size;
  if (!n) { el.innerHTML = ""; return; }
  const pageAll = S.rows.length && S.rows.every((r) => S.selected.has(r.email));
  el.innerHTML = `<div class="bulkbar"><span class="bulkbar__count">${fmt.num(n)} selected</span>
    ${!S.allMatching && pageAll && S.total > S.rows.length ? `<a class="link" data-act="all-matching">Select all ${fmt.num(S.total)} matching</a>` : ""}
    ${S.allMatching ? `<span style="opacity:.8">all matching this search</span>` : ""}
    <span class="spacer"></span>
    <button class="btn" data-act="b-list">${ico("list")} Add to list</button>
    <button class="btn" data-act="b-seq">${ico("sequence")} Add to sequence</button>
    <button class="btn" data-act="b-stage">${ico("flag")} Stage</button>
    <button class="btn" data-act="b-write">${ico("compose")} Write</button>
    <button class="btn" data-act="b-export">${ico("download")} Export</button>
    <button class="btn btn--icon" data-act="b-more" title="More">${ico("more")}</button>
    <button class="btn" data-act="b-clear">${ico("x")}</button></div>`;
}

function renderPager() {
  const el = $("#ppl-pager", ROOT);
  if (!S.total) { el.innerHTML = ""; return; }
  const from = (S.page - 1) * S.perPage + 1, to = Math.min(S.total, S.page * S.perPage);
  el.innerHTML = `<div class="pager"><span>${fmt.num(from)}–${fmt.num(to)} of ${fmt.num(S.total)}</span><span class="spacer"></span>
    <select class="select select--sm" data-perpage style="width:auto">${[25, 50, 100, 200].map((n) => `<option ${n === S.perPage ? "selected" : ""}>${n}</option>`).join("")}</select>
    <button class="btn btn--sm btn--icon" data-act="prev" ${S.page <= 1 ? "disabled" : ""} title="Previous">${ico("chevron-left")}</button>
    <span>${S.page} / ${S.pages}</span>
    <button class="btn btn--sm btn--icon" data-act="next" ${S.page >= S.pages ? "disabled" : ""} title="Next">${ico("chevron")}</button></div>`;
}

/* -------------------------------------------------------------- actions */
const refresh = () => load();
const afterBulk = () => { S.selected.clear(); S.allMatching = false; load(); };

async function addContact() {
  await modal({
    title: "Add a contact", body: `<div class="form-grid">
      <div class="field span-2"><label>Email</label><input class="input" name="email" type="email" required autofocus placeholder="jane@acme.com"/></div>
      <div class="field"><label>First name</label><input class="input" name="first_name"/></div>
      <div class="field"><label>Last name</label><input class="input" name="last_name"/></div>
      <div class="field"><label>Title</label><input class="input" name="title"/></div>
      <div class="field"><label>Company</label><input class="input" name="organization"/></div>
      <div class="field"><label>Phone</label><input class="input" name="phone"/></div>
      <div class="field"><label>LinkedIn URL</label><input class="input" name="linkedin_url"/></div></div>`,
    actions: [{ label: "Cancel", value: null }, { label: "Add contact", kind: "primary", submit: true }],
    onSubmit: async (f) => {
      const contact = Object.fromEntries(["email", "first_name", "last_name", "title", "organization", "phone", "linkedin_url"]
        .map((k) => [k, f[k].value.trim()]));
      const res = await api.post("/api/people/create", { contact });
      toast("Contact added"); load(); router.go("people", res.contact.email);
      return true;
    },
  });
}

async function savedMenu(anchor) {
  try { S.saved = (await api.get("/api/saved", { kind: "people" })).saved || []; } catch (_) { S.saved = []; }
  menu(anchor, [
    { header: "Saved searches" },
    ...S.saved.map((s) => ({ label: s.name, value: { id: s.id }, icon: "bookmark" })),
    ...(S.saved.length ? [{ sep: true }] : []),
    { label: "Save current search…", value: "save", icon: "plus" },
    ...(S.saved.length ? [{ label: "Delete a saved search…", value: "delete", icon: "trash", danger: true }] : []),
  ], async (v) => {
    if (v === "save") {
      const name = await promptDialog({ title: "Save this search", label: "Name", placeholder: "VPs in Texas, never contacted" });
      if (!name) return;
      await api.post("/api/saved/save", { name, kind: "people", filters: query() });
      toast(`Saved '${name}'`);
    } else if (v === "delete") {
      const name = await promptDialog({ title: "Delete a saved search", label: "Name", placeholder: S.saved[0]?.name || "" });
      const hit = S.saved.find((s) => s.name.toLowerCase() === (name || "").toLowerCase());
      if (hit) { await api.post("/api/saved/delete", { id: hit.id }); toast(`Deleted '${hit.name}'`); }
    } else if (v && v.id) {
      const s = S.saved.find((x) => x.id === v.id);
      const f = { ...s.filters };
      S.q = f.q || ""; delete f.q;
      F.clearAll(FSTATE); Object.assign(S.filters, f);
      S.page = 1; $("#ppl-q", ROOT).value = S.q;
      load(); toast(`Showing '${s.name}'`, "info");
    }
  }, { width: 260 });
}

function colsMenu(anchor) {
  menu(anchor, [{ header: "Columns" }, ...COLUMNS.map((c) => ({ value: c.key,
    html: `<input type="checkbox" ${S.cols.has(c.key) ? "checked" : ""} style="pointer-events:none;accent-color:var(--accent)"/> ${esc(c.label)}` }))],
  (key) => {
    S.cols.has(key) ? S.cols.delete(key) : S.cols.add(key);
    store.setPref("people-cols", Array.from(S.cols)); renderTable();
  }, { align: "right" });
}

/* -------------------------------------------------------------- drawer */
function syncDrawer(ctx) {
  if (ctx.id) {
    if (drawerHandle && drawerHandle.email === ctx.id && !drawerHandle.closed) return;
    drawerHandle?.close?.();
    const email = ctx.id;
    const handle = openContact(email, {
      onClose: () => {
        if (drawerHandle === handle) drawerHandle = null;
        // Only clear the URL if it still points at this record (not the one replacing it).
        const p = router.parse();
        if (p.name === "people" && p.id === email) history.replaceState(null, "", router.href("people", "", p.params));
      },
      onChange: () => load({ facets: false }),
    });
    drawerHandle = handle;
  } else if (drawerHandle) { drawerHandle.close(); drawerHandle = null; }
}

router.register("people", {
  title: "People",
  async mount(root, ctx) {
    ROOT = root;
    S.filters = F.fromParams(CFG, ctx.params);
    S.q = ctx.params.q || "";
    S.sort = ctx.params.sort || "updated";
    S.direction = ctx.params.dir || (["name", "organization", "location", "email"].includes(S.sort) ? "asc" : "desc");
    S.page = +ctx.params.page || 1;
    S.selected = new Set(); S.allMatching = false;
    lastKey = paramKey(ctx.params);
    shell();
    renderFilters();
    F.bind($("#ppl-filters", root), FSTATE, () => { S.page = 1; S.allMatching = false; load(); }, renderFilters);
    const typed = debounce(() => { S.page = 1; S.allMatching = false; load(); }, 300);
    $("#ppl-q", root).addEventListener("input", (e) => { S.q = e.target.value.trim(); typed(); });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.sel !== undefined) {
        S.allMatching = false;
        t.checked ? S.selected.add(t.dataset.sel) : S.selected.delete(t.dataset.sel);
        t.closest("tr")?.classList.toggle("is-selected", t.checked); renderBulk();
      } else if (t.dataset.selpage !== undefined) {
        S.allMatching = false;
        S.rows.forEach((r) => t.checked ? S.selected.add(r.email) : S.selected.delete(r.email));
        renderTable();
      } else if (t.dataset.perpage !== undefined) {
        S.perPage = +t.value; S.page = 1; store.setPref("people-per-page", S.perPage); load({ facets: false });
      }
    });
    root.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-fremove]");
      if (rm) {
        const k = rm.dataset.fremove;
        if (k === "q") { S.q = ""; $("#ppl-q", root).value = ""; }
        else { const c = CFG.find((x) => x.key === k); S.filters[k] = c.type === "text" || c.type === "select" ? "" : c.type === "bool" ? false : []; }
        S.page = 1; load(); return;
      }
      const th = e.target.closest("th[data-sort]");
      if (th) {
        const k = th.dataset.sort;
        if (S.sort === k) S.direction = S.direction === "asc" ? "desc" : "asc";
        else { S.sort = k; S.direction = ["name", "organization", "location", "email", "seniority"].includes(k) ? "asc" : "desc"; }
        S.page = 1; load({ facets: false }); return;
      }
      const tr = e.target.closest("tr[data-email]");
      if (tr && !e.target.closest("input, button, a, [data-stop]")) router.go("people", tr.dataset.email, router.parse().params);
    });
    onAct(root, {
      add: addContact, saved: (el) => savedMenu(el), cols: (el) => colsMenu(el),
      dense: () => { S.dense = !S.dense; store.setPref("people-dense", S.dense); renderTable(); },
      "export-all": (el) => exportMenu(el, { all: true, filters: query(), total: S.total }),
      clear: () => { F.clearAll(FSTATE); S.q = ""; $("#ppl-q", root).value = ""; S.page = 1; load(); },
      prev: () => { S.page = Math.max(1, S.page - 1); load({ facets: false }); },
      next: () => { S.page = Math.min(S.pages, S.page + 1); load({ facets: false }); },
      "all-matching": () => { S.allMatching = true; renderTable(); },
      "b-clear": () => { S.selected.clear(); S.allMatching = false; renderTable(); },
      "b-list": (el) => addToList(el, selection()).then((r) => r && refresh()),
      "b-seq": () => enroll(selection()).then((r) => r && refresh()),
      "b-stage": (el) => setStage(el, selection(), afterBulk),
      "b-export": (el) => exportMenu(el, selection()),
      "b-more": (el) => moreMenu(el, selection(), afterBulk),
      "b-write": () => {
        const rows = S.rows.filter((r) => S.allMatching || S.selected.has(r.email));
        if (S.allMatching && S.total > rows.length) toast(`Writing to the ${rows.length} on this page — use a sequence for all ${S.total}.`, "info");
        writeEmails(rows);
      },
    });
    cursor = -1;
    document.addEventListener("keydown", onKeys);
    await load();
    syncDrawer(ctx);
  },
  update(ctx) {
    // A link to the same page with different filters (#/people?stage=…) re-applies them.
    const key = paramKey(ctx.params);
    if (key !== lastKey) {
      lastKey = key;
      S.filters = F.fromParams(CFG, ctx.params);
      S.q = ctx.params.q || ""; S.page = +ctx.params.page || 1;
      if (ctx.params.sort) S.sort = ctx.params.sort;
      $("#ppl-q", ROOT).value = S.q;
      S.selected.clear(); S.allMatching = false;
      load();
    }
    syncDrawer(ctx);
  },
  unmount() { document.removeEventListener("keydown", onKeys); drawerHandle?.close(); drawerHandle = null; },
});

let lastKey = "";
function paramKey(params) { return JSON.stringify(Object.entries(params).sort()); }

/* Keyboard: J/K move through the rows (or through records while one is open),
   X selects, Enter or O opens. Ignored while typing or in a dialog. */
let cursor = -1;
function setCursor(i) {
  const rows = $$("#ppl-table tbody tr[data-email]", ROOT);
  if (!rows.length) return;
  cursor = Math.max(0, Math.min(rows.length - 1, i));
  rows.forEach((r, k) => r.classList.toggle("is-cursor", k === cursor));
  rows[cursor].scrollIntoView({ block: "nearest" });
}
function onKeys(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  if (document.querySelector(".modal-wrap, .palette, .menu")) return;
  const k = e.key.toLowerCase();
  if (!["j", "k", "x", "o", "enter"].includes(k)) return;
  const open = router.parse().id;
  const emails = S.rows.map((r) => r.email);
  if (open && (k === "j" || k === "k")) {          // step through records in the drawer
    const i = emails.indexOf(open) + (k === "j" ? 1 : -1);
    if (i >= 0 && i < emails.length) { e.preventDefault(); setCursor(i); router.go("people", emails[i], router.parse().params, { replace: true }); }
    return;
  }
  if (open || document.querySelector(".drawer")) return;
  e.preventDefault();
  if (k === "j") setCursor(cursor + 1);
  else if (k === "k") setCursor(cursor < 0 ? 0 : cursor - 1);
  else if (cursor >= 0 && emails[cursor]) {
    if (k === "x") {
      const box = $(`#ppl-table [data-sel="${CSS.escape(emails[cursor])}"]`, ROOT);
      if (box) { box.checked = !box.checked; box.dispatchEvent(new Event("change", { bubbles: true })); }
    } else router.go("people", emails[cursor], router.parse().params);
  }
}
