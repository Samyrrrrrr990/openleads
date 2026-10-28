/* =========================================================================
   Find people — the live search. One box fans out across free public sources,
   finds the people behind each company, verifies their email and streams the
   results in. Everyone found is saved to People automatically.
   ========================================================================= */
import { addToList, enroll, exportMenu, writeEmails } from "../actions.js";
import { $, $$, api, esc, fail, fmt, ico, onAct, router, store, toast, ui } from "../core.js";

const EXAMPLES = ["marketing agencies in Miami", "dentists in Austin", "VPs of sales at fintech companies",
  "rust developers in Berlin", "law firms in London", "machine learning researchers", "emails at stripe.com"];
const LEVELS = [["c_suite", "C-suite"], ["owner", "Owner"], ["founder", "Founder"], ["vp", "VP"],
  ["head", "Head"], ["director", "Director"], ["manager", "Manager"]];

const P = {
  query: "", count: 25, verified_only: false, deep: false, company: true, source: "",
  seniority: [], department: "", leads: [], selected: new Set(), running: false, log: [], done: null,
};
let ROOT = null;

function opts() {
  return `
  <div class="row row--wrap mt" style="gap:14px">
    <div class="seg" role="group" aria-label="How many">${[10, 25, 50, 100].map((n) =>
      `<button type="button" class="${P.count === n ? "is-on" : ""}" data-act="count" data-n="${n}">${n}</button>`).join("")}</div>
    ${ui.switch("verified_only", P.verified_only, "Verified only")}
    ${ui.switch("company", P.company, "Company profiles")}
    ${ui.switch("deep", P.deep, "Deep harvest")}
    <select class="select select--sm" name="source" style="width:auto">
      <option value="">All sources (auto)</option>
      ${(store.state?.sources || []).map((s) => `<option value="${esc(s.name)}" ${P.source === s.name ? "selected" : ""}>${esc(s.name)} · ${esc(s.vertical)}</option>`).join("")}
    </select>
  </div>
  <div class="row row--wrap mt" style="gap:6px">
    <span class="label" style="margin-right:4px">Seniority</span>
    ${LEVELS.map(([k, l]) => `<button type="button" class="chip chip--toggle ${P.seniority.includes(k) ? "is-on" : ""}" data-act="level" data-k="${k}">${l}</button>`).join("")}
    <span class="label" style="margin:0 4px 0 10px">Department</span>
    <select class="select select--sm" name="department" style="width:auto">
      <option value="">Any</option>
      ${(store.meta?.departments || []).map((d) => `<option value="${d.key}" ${P.department === d.key ? "selected" : ""}>${esc(d.label)}</option>`).join("")}
    </select>
  </div>`;
}

function render() {
  ROOT.innerHTML = `
  <div class="prospect-hero">
    <div class="head" style="margin-bottom:14px"><div>
      <div class="head__title"><h1>Find people</h1></div>
      <p class="head__sub">Describe who you want. OpenLeads searches free public sources, finds the people and labels every email. Everyone found is saved to <a class="link" href="#/people">People</a>.</p>
    </div></div>
    <form class="bigsearch" data-form="search">
      ${ico("find")}
      <input name="q" value="${esc(P.query)}" placeholder="dentists in Austin · VPs of marketing at SaaS companies · emails at acme.com" autocomplete="off" spellcheck="false" />
      <button class="btn btn--accent" type="submit" ${P.running ? "disabled" : ""}>${P.running ? '<span class="spinner"></span> Searching' : ico("bolt") + " Search"}</button>
    </form>
    <div class="row row--wrap mt" style="gap:6px">${EXAMPLES.map((x) =>
      `<button type="button" class="chip chip--toggle" data-act="example" data-q="${esc(x)}">${esc(x)}</button>`).join("")}</div>
    ${opts()}
  </div>
  <div class="page page--full" id="results">${results()}</div>`;
}

function results() {
  if (!P.leads.length && !P.running) {
    return P.done ? ui.empty("find", "No leads this time", esc(P.done.message || "Try a broader query, turn off Verified only, or pick another source."))
      : `<div class="find-intro">
        <p class="muted">Every address gets a mark: its shape says how we know it, its color says whether it will deliver.</p>
        <div class="ev-key mt">
          <span>${ui.mark("found", "safe")} Found: published on the web or confirmed by the mail server</span>
          <span>${ui.mark("pattern", "safe")} Pattern: built from an address format seen at that company</span>
          <span>${ui.mark("guessed", "risky")} Guessed: a common format, nothing confirms it</span>
        </div>
        <div class="ev-key mt">
          <span><i class="tier-dot tier-dot--safe"></i> Deliverable</span>
          <span><i class="tier-dot tier-dot--risky"></i> Risky</span>
          <span><i class="tier-dot tier-dot--bad"></i> Will bounce</span>
        </div></div>`;
  }
  const safe = P.leads.filter((l) => l.tier === "safe").length;
  const fresh = P.leads.filter((l) => l.is_new).length;
  const nsel = P.selected.size;
  return `
  <div class="card">
    ${P.running ? '<div class="sweep"></div>' : ""}
    <div class="card__head">
      <h3>${P.running ? "Searching…" : "Results"}</h3>
      <span class="muted">${fmt.num(P.leads.length)} found · ${fmt.num(safe)} safe · ${fmt.num(fresh)} new to your CRM</span>
      <div class="actions">
        <button class="btn btn--sm" data-act="log">${ico("code")} Engine log</button>
        ${P.leads.length ? `<button class="btn btn--sm" data-act="open-people">${ico("users")} Open in People</button>` : ""}
      </div>
    </div>
    ${nsel ? `<div class="bulkbar"><span class="bulkbar__count">${fmt.num(nsel)} selected</span>
      <button class="btn" data-act="b-list">${ico("list")} Add to list</button>
      <button class="btn" data-act="b-seq">${ico("sequence")} Add to sequence</button>
      <button class="btn" data-act="b-write">${ico("compose")} Write emails</button>
      <button class="btn" data-act="b-export">${ico("download")} Export</button>
      <span class="spacer"></span><button class="btn" data-act="b-clear">Clear</button></div>` : ""}
    <div class="console ${P.showLog ? "" : "hidden"}" id="p-log" style="margin:12px 16px;border-radius:10px">${P.log.join("")}</div>
    <div class="table-wrap" style="max-height:none">
      <table class="tbl"><thead><tr>
        <th class="col-check"><input type="checkbox" data-all ${nsel && nsel === P.leads.length ? "checked" : ""} aria-label="Select all"/></th>
        <th>Person</th><th>Email</th><th>Company</th><th>Seniority</th><th>Location</th><th>Fit</th><th></th>
      </tr></thead><tbody>${P.leads.map(row).join("")}</tbody></table>
    </div>
  </div>`;
}

function row(l, i) {
  const name = ui.name(l);
  const sel = P.selected.has(l.email);
  return `<tr class="${sel ? "is-selected" : ""} ${l._fresh ? "row-in" : ""} ${l.email ? "is-click" : ""}" data-i="${i}">
    <td class="col-check"><input type="checkbox" data-sel="${esc(l.email)}" ${sel ? "checked" : ""} ${l.email ? "" : "disabled"}/></td>
    <td><div class="cell-person">
      <div><span class="name">${esc(name || l.organization || "—")}</span><span class="sub">${esc(l.title || "")}</span></div></div></td>
    <td><div class="cell-email">${l.email ? ui.mark(l.evidence, l.tier) : ""}<span class="addr">${esc(l.email || "—")}</span>${l.email ? ui.copy(l.email) : ""}</div></td>
    <td><div class="ellipsis" style="max-width:200px">${esc(l.organization || "")}</div><div class="t-sub">${esc(l.industry || "")}</div></td>
    <td>${l.seniority ? `<span class="badge badge--outline">${esc(store.label("seniorities", l.seniority))}</span>` : '<span class="faint">—</span>'}</td>
    <td class="t-sub">${esc([l.city, l.country].filter(Boolean).join(", "))}</td>
    <td>${ui.grade(l.fit_score || 0)}</td>
    <td>${l.is_new ? '<span class="badge badge--good badge--sm">New</span>' : '<span class="badge badge--sm">In CRM</span>'}</td>
  </tr>`;
}

function refreshResults() { const r = $("#results", ROOT); if (r) r.innerHTML = results(); }

async function run() {
  if (P.running) return;
  if (!P.query.trim()) { toast("Describe who you're looking for first.", "err"); $("input[name=q]", ROOT)?.focus(); return; }
  Object.assign(P, { leads: [], selected: new Set(), running: true, log: [], done: null });
  const log = (h) => { P.log.push(`<div>${h}</div>`); const el = $("#p-log", ROOT); if (el) { el.insertAdjacentHTML("beforeend", `<div>${h}</div>`); el.scrollTop = el.scrollHeight; } };
  render();
  log(`<span class="c-mut">$</span> openleads find "${esc(P.query)}" -n ${P.count}`);
  const body = { query: P.query, count: P.count, verified_only: P.verified_only, deep: P.deep,
    source: P.source || undefined, seniority: P.seniority, department: P.department ? [P.department] : [],
    no_company: !P.company };
  let pending = 0;
  try {
    await api.stream("/api/find", body, (ev) => {
      if (ev.type === "phase") log(`<span class="c-mut">◆</span> ${esc(ev.message)}`);
      else if (ev.type === "lead") {
        P.leads.push({ ...ev.lead, _fresh: true });
        log(`  <span class="${ev.lead.tier === "safe" ? "c-ok" : ""}">${esc(ev.lead.tier)}</span> ${esc(ev.lead.email || "—")} <span class="c-mut">${esc(ui.name(ev.lead) || ev.lead.organization || "")}</span>`);
        if (!pending) { pending = requestAnimationFrame(() => { pending = 0; refreshResults(); P.leads.forEach((l) => { l._fresh = false; }); }); }
      } else if (ev.type === "done") {
        P.leads = (ev.leads || P.leads).map((l) => ({ ...l, _fresh: false }));
        P.done = ev;
        log(`<span class="c-mut">→</span> done: <span class="c-ok">${ev.safe} safe</span>, ${ev.risky} risky, ${ev.count} total, ${ev.new} new`);
        P.leads.filter((l) => l.tier === "safe" && l.email).forEach((l) => P.selected.add(l.email));
      } else if (ev.type === "error") { log(`<span class="c-red">[!] ${esc(ev.message)}</span>`); toast(ev.message, "err"); }
    });
  } catch (e) { fail(e); }
  P.running = false;
  render();
  if (P.done && P.done.count) toast(`${fmt.num(P.done.count)} found · ${fmt.num(P.done.new || 0)} new in People`);
}

const sel = () => ({ emails: Array.from(P.selected) });

router.register("prospect", {
  title: "Find people",
  mount(root, ctx) {
    ROOT = root;
    if (ctx.params.q) P.query = ctx.params.q;
    render();
    root.addEventListener("submit", (e) => {
      if (e.target.matches('[data-form="search"]')) { e.preventDefault(); P.query = e.target.q.value.trim(); run(); }
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.name === "verified_only") P.verified_only = t.checked;
      else if (t.name === "company") P.company = t.checked;
      else if (t.name === "deep") P.deep = t.checked;
      else if (t.name === "source") P.source = t.value;
      else if (t.name === "department") P.department = t.value;
      else if (t.dataset.all !== undefined) {
        if (t.checked) P.leads.forEach((l) => l.email && P.selected.add(l.email)); else P.selected.clear();
        refreshResults();
      } else if (t.dataset.sel !== undefined) {
        t.checked ? P.selected.add(t.dataset.sel) : P.selected.delete(t.dataset.sel);
        refreshResults();
      }
    });
    root.addEventListener("input", (e) => { if (e.target.name === "q") P.query = e.target.value; });
    root.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-i]");
      if (tr && !e.target.closest("input, button, a")) {
        const l = P.leads[+tr.dataset.i];
        if (l?.email) router.go("people", l.email);
      }
    });
    onAct(root, {
      example: (el) => { P.query = el.dataset.q; render(); run(); },
      count: (el) => { P.count = +el.dataset.n; $$('[data-act="count"]', root).forEach((b) => b.classList.toggle("is-on", b === el)); },
      level: (el) => {
        const k = el.dataset.k;
        P.seniority = P.seniority.includes(k) ? P.seniority.filter((x) => x !== k) : [...P.seniority, k];
        el.classList.toggle("is-on", P.seniority.includes(k));
      },
      log: () => { P.showLog = !P.showLog; $("#p-log", root)?.classList.toggle("hidden", !P.showLog); },
      "open-people": () => router.go("people", "", { created_within: 1, sort: "created" }),
      "b-clear": () => { P.selected.clear(); refreshResults(); },
      "b-list": (el) => addToList(el, sel()),
      "b-seq": () => enroll(sel()),
      "b-export": (el) => exportMenu(el, sel()),
      "b-write": () => writeEmails(P.leads.filter((l) => P.selected.has(l.email))),
    });
    setTimeout(() => $("input[name=q]", root)?.focus(), 30);
  },
});
