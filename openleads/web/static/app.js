/* =========================================================================
   OpenLeads local console — single-page app (vanilla, no build, offline).
   CSP-safe: no inline handlers; everything wired via event delegation.
   ========================================================================= */
"use strict";

/* ----------------------------- tiny helpers ---------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ico = (id) => `<svg class="ico"><use href="#i-${id}"/></svg>`;

async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}
async function postJSON(path, body) {
  const r = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}
async function stream(path, body, onEvent) {
  const r = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { onEvent(JSON.parse(line)); } catch (_) {} }
    }
  }
  if (buf.trim()) { try { onEvent(JSON.parse(buf.trim())); } catch (_) {} }
}

function toast(msg, kind = "ok") {
  const t = document.createElement("div");
  t.className = `toast toast--${kind}`;
  t.innerHTML = `${ico(kind === "err" ? "x" : "check")}<span>${esc(msg)}</span>`;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 3200);
}

/* ------------------------------- state --------------------------------- */
const S = {
  route: "find",
  sources: [], settings: [], groups: [], identity: {}, presets: {},
  crm: null, version: "v3",
  query: "", opts: { source: "", count: 25, verified_only: true, deep: false },
  leads: [], selected: new Set(), drafts: [], doctor: null,
  running: false,
};

/* ---------------------------- shared bits ------------------------------ */
function tierBadge(t) {
  const cls = t === "safe" ? "safe" : t === "risky" ? "risky" : "bad";
  return `<span class="tier tier--${cls}">${esc(t || "bad")}</span>`;
}
function scoreChip(score) {
  const s = Math.max(0, Math.min(100, score | 0));
  const low = s < 50 ? "low" : "";
  return `<span class="score"><span class="score__bar"><span class="score__fill ${low}" style="width:${s}%"></span></span>${s}</span>`;
}
function fullName(ld) {
  return [ld.first_name, ld.last_name].filter(Boolean).join(" ").trim()
    || ld.name || ld.organization || "—";
}

/* =======================================================================
   VIEWS
   ===================================================================== */
function viewFind() {
  const srcChips = ['<button class="chip ' + (!S.opts.source ? "is-on" : "") +
    '" data-action="src" data-src=""><span class="chip__kind">auto</span></button>']
    .concat(S.sources.map((s) =>
      `<button class="chip ${S.opts.source === s.name ? "is-on" : ""}" data-action="src" data-src="${esc(s.name)}">
         ${esc(s.name)}<span class="chip__kind">${esc(s.kind)}</span></button>`)).join("");

  return `
  <section class="page">
    <div class="page-head">
      <div class="eyebrow">click 1 — find</div>
      <h1>Find anyone. Verify deliverably.</h1>
      <p>Describe who you want in plain English. The engine searches free public sources,
         resolves emails, and grades each one — <b>safe</b>, <b>risky</b>, or dropped.</p>
    </div>

    <div class="command">
      <span class="command__prompt">›</span>
      <input id="q" type="text" autocomplete="off" spellcheck="false"
        placeholder="50 AI founders in SF, verified only" value="${esc(S.query)}" />
      <button class="btn btn--primary" data-action="find">${ico("bolt")} Run</button>
    </div>

    <div class="row mt-lg" style="gap:18px">
      <div class="field" style="max-width:120px">
        <label>How many</label>
        <input class="input input--mono" id="count" type="number" min="1" max="200" value="${S.opts.count}" />
      </div>
      <label class="toggle" style="margin-top:22px">
        <input type="checkbox" id="vo" ${S.opts.verified_only ? "checked" : ""} />
        <span class="toggle__track"></span>
        <span class="toggle__label">deliverable only (safe tier)</span>
      </label>
      <label class="toggle" style="margin-top:22px">
        <input type="checkbox" id="deep" ${S.opts.deep ? "checked" : ""} />
        <span class="toggle__track"></span>
        <span class="toggle__label">deep harvest (slower, more ground-truth)</span>
      </label>
    </div>

    <div class="mt">
      <p class="rail__group" style="margin-left:0">source</p>
      <div class="chips">${srcChips}</div>
    </div>

    <div id="find-out" class="mt-lg">
      <div class="row" style="gap:18px;color:var(--faint);font-size:12.5px" class="mono">
        <span class="mono">⏎ run</span><span class="muted">·</span>
        <span class="mono">results stream in live</span><span class="muted">·</span>
        <span class="mono"><span class="tier tier--safe" style="padding:1px 6px">safe</span> = won't bounce</span>
      </div>
    </div>
  </section>`;
}

function renderFindResults() {
  const host = $("#find-out");
  if (!host) return;
  const safe = S.leads.filter((l) => l.tier === "safe").length;
  const risky = S.leads.filter((l) => l.tier === "risky").length;
  host.innerHTML = `
    <div class="card">
      <div class="card__head">
        <h3>Engine console</h3>
        <span class="count-pill" id="run-stat">${S.running ? "running…" : `${S.leads.length} found`}</span>
      </div>
      <div class="card__body" style="display:grid;gap:14px">
        ${S.running ? '<div class="sweep"></div>' : ""}
        <div class="console" id="console"></div>
      </div>
    </div>
    ${S.leads.length ? `
    <div class="row row--between mt-lg">
      <div class="row" style="gap:10px">
        <strong>${S.leads.length} leads</strong>
        <span class="muted">· ${safe} safe · ${risky} risky</span>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn btn--ghost btn--sm" data-action="export">${ico("download")} Export CSV</button>
        <button class="btn btn--primary btn--sm" data-action="to-write">${ico("compose")} Write ${safe} safe → </button>
      </div>
    </div>
    <div class="table-wrap mt">${leadsTable(S.leads)}</div>` : ""}`;
}

function leadsTable(rows) {
  if (!rows.length) return `<div class="empty">${ico("leads")}<h3>No leads yet</h3><p>Run a search to populate this table.</p></div>`;
  const body = rows.map((ld) => {
    const reasons = (ld.reasons || []).join(" · ");
    return `<tr class="row-in">
      <td>${tierBadge(ld.tier)}</td>
      <td class="t-email">${esc(ld.email || "—")}</td>
      <td class="t-name">${esc(fullName(ld))}</td>
      <td class="t-mut">${esc(ld.title || "")}</td>
      <td class="t-mut">${esc(ld.organization || "")}</td>
      <td class="t-num">${scoreChip(ld.score)}</td>
      <td class="t-mut" title="${esc(reasons)}" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(reasons || "")}</td>
    </tr>`;
  }).join("");
  return `<table><thead><tr>
    <th>Tier</th><th>Email</th><th>Name</th><th>Title</th><th>Org</th><th class="t-num">Score</th><th>Why</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}

function viewLeads() {
  return `
  <section class="page page--wide">
    <div class="page-head"><div class="eyebrow">workspace</div><h1>Leads</h1>
      <p>Everything found this session. Filter by tier, then send the safe ones to compose.</p></div>
    ${S.leads.length ? `
      <div class="row row--between">
        <div class="chips">
          <button class="chip is-on" data-action="lf" data-f="all">all <span class="chip__kind">${S.leads.length}</span></button>
          <button class="chip" data-action="lf" data-f="safe">safe</button>
          <button class="chip" data-action="lf" data-f="risky">risky</button>
        </div>
        <button class="btn btn--primary btn--sm" data-action="to-write">${ico("compose")} Write safe leads</button>
      </div>
      <div class="table-wrap mt" id="leads-table">${leadsTable(S.leads)}</div>`
      : `<div class="empty">${ico("find")}<h3>No leads in this session</h3>
         <p>Head to <a data-action="go" data-route="find">Find</a> to discover some.</p></div>`}
  </section>`;
}

function viewCompose() {
  const safe = S.leads.filter((l) => l.tier === "safe");
  return `
  <section class="page">
    <div class="page-head"><div class="eyebrow">click 2 — write</div><h1>Write the emails</h1>
      <p>Personalized, spam-linted, plain-text-first drafts. ${S.identity.llm_configured
        ? "Generated by your free LLM." : "Template-based (add an OpenRouter key in Connect for AI drafts)."}
        Edit anything — your edits are what gets sent.</p></div>

    ${!S.drafts.length ? `
      <div class="banner mt">${ico("spark")}
        <div>${safe.length
          ? `<b>${safe.length} safe leads</b> are ready to write. Generate drafts to continue.`
          : `No safe leads yet — <a data-action="go" data-route="find">find some</a> first.`}</div>
      </div>
      ${safe.length ? `<div class="mt-lg"><button class="btn btn--primary" data-action="gen-drafts">${ico("spark")} Generate ${safe.length} drafts</button></div>` : ""}
      <div id="compose-out" class="mt-lg"></div>`
    : `<div class="row row--between">
         <span class="count-pill">${S.drafts.length} drafts</span>
         <div class="row" style="gap:8px">
           <button class="btn btn--ghost btn--sm" data-action="gen-drafts">${ico("refresh")} Regenerate</button>
           <button class="btn btn--primary btn--sm" data-action="go" data-route="send">${ico("send")} Go to Send →</button>
         </div>
       </div>
       <div class="mt" style="display:grid;gap:14px">${S.drafts.map(draftCard).join("")}</div>`}
  </section>`;
}

function draftCard(d, i) {
  const lintBad = d.lint && d.lint.ok === false;
  return `<div class="draft" data-i="${i}">
    <div class="draft__top">
      <span class="draft__to">${ico("send")} ${esc(d.email)}</span>
      <span class="lint ${lintBad ? "bad" : ""}">spam-lint ${esc(d.lint?.score ?? 0)}${lintBad ? " ⚠" : " ✓"}</span>
    </div>
    <div class="draft__body">
      <div class="field"><label>Subject</label>
        <input class="input input--mono" data-draft="${i}" data-k="subject" value="${esc(d.subject)}" /></div>
      <div class="field"><label>Body</label>
        <textarea class="input" data-draft="${i}" data-k="body">${esc(d.body)}</textarea></div>
    </div>
  </div>`;
}

function viewSend() {
  const id = S.identity;
  const ready = id.mailbox_configured;
  return `
  <section class="page">
    <div class="page-head"><div class="eyebrow">click 4 — send</div><h1>Send safely</h1>
      <p>Dry-run by default. Throttled, warmup-capped, suppression-aware. One-click unsubscribe
         headers, no tracking pixels. Your mailbox, your machine.</p></div>

    ${!ready ? `<div class="banner banner--warn">${ico("shield")}
      <div>No mailbox connected yet. <a data-action="go" data-route="settings">Open Connect</a>
      to add your SMTP provider + app password. You can still preview drafts (dry-run) below.</div></div>` : ""}

    <div class="grid grid--3 mt">
      <div class="stat stat--accent"><div class="stat__k">drafts ready</div><div class="stat__v">${S.drafts.length}</div></div>
      <div class="stat"><div class="stat__k">mailbox</div><div class="stat__v" style="font-size:16px;margin-top:12px">${ready ? esc(S.settings.find(s=>s.key==="smtp_user")?.value || "connected") : "—"}</div></div>
      <div class="stat"><div class="stat__k">deliverability</div><div class="stat__v ${S.doctor?.preflight ? "grade-"+S.doctor.preflight.grade : ""}">${S.doctor?.preflight?.grade || "?"}</div></div>
    </div>

    <div class="card mt-lg">
      <div class="card__head"><h3>Outbox</h3>
        <label class="toggle"><input type="checkbox" id="live" />
          <span class="toggle__track"></span><span class="toggle__label">live send (off = preview)</span></label>
      </div>
      <div class="card__body" style="display:grid;gap:14px">
        ${!S.drafts.length ? `<div class="empty">${ico("compose")}<h3>No drafts</h3>
          <p>Write some in <a data-action="go" data-route="compose">step 2</a> first.</p></div>` : `
          <div class="row row--between">
            <span class="muted">${S.drafts.length} recipients · sends to <b>safe</b> tier only by default</span>
            <button class="btn btn--primary" data-action="send" ${S.running ? "disabled" : ""}>${ico("send")} <span id="send-label">Preview sends</span></button>
          </div>
          ${S.running ? '<div class="sweep"></div>' : ""}
          <div class="console" id="send-console"></div>`}
      </div>
    </div>
  </section>`;
}

function viewCrm() {
  const o = S.crm || { total_leads: 0, by_status: {}, sent_total: 0, sent_today: 0, suppressed: 0 };
  const rows = (S.crm && S.crm.rows) || [];
  return `
  <section class="page page--wide">
    <div class="page-head"><div class="eyebrow">workspace</div><h1>CRM</h1>
      <p>Every lead and every touch, stored locally in SQLite. No spreadsheet, no SaaS.</p></div>
    <div class="grid grid--3">
      <div class="stat stat--accent"><div class="stat__k">total leads</div><div class="stat__v">${o.total_leads}</div></div>
      <div class="stat"><div class="stat__k">sent</div><div class="stat__v">${o.sent_total} <small>· ${o.sent_today} today</small></div></div>
      <div class="stat"><div class="stat__k">suppressed</div><div class="stat__v">${o.suppressed}</div></div>
    </div>
    <div class="table-wrap mt-lg">
      ${rows.length ? `<table><thead><tr><th>Status</th><th>Email</th><th>Name</th><th>Org</th><th>Tier</th><th class="t-num">Score</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td><span class="tier tier--${r.status === "bounced" ? "bad" : r.status === "sent" ? "safe" : "risky"}">${esc(r.status)}</span></td>
        <td class="t-email">${esc(r.email)}</td><td class="t-name">${esc(r.name || "—")}</td>
        <td class="t-mut">${esc(r.organization || "")}</td><td>${tierBadge(r.tier)}</td>
        <td class="t-num">${scoreChip(r.score)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">${ico("crm")}<h3>CRM is empty</h3><p>Found leads are saved here automatically.</p></div>`}
    </div>
  </section>`;
}

function viewSettings() {
  const grouped = {};
  S.settings.forEach((s) => { (grouped[s.group] ||= []).push(s); });
  const groupTitle = {
    ai: "AI drafting (optional, free)", discover: "Discovery", sender: "Sender identity",
    mailbox: "Mailbox — Connect", sending: "Sending policy", web: "Web dashboard",
  };
  const body = S.groups.map((g) => `
    <div class="set-group">
      <h2 class="set-group__title">${esc(groupTitle[g] || g)}</h2>
      ${(grouped[g] || []).map(settingRow).join("")}
    </div>`).join("");
  return `
  <section class="page">
    <div class="page-head"><div class="eyebrow">click 3 — connect</div><h1>Settings &amp; Connect</h1>
      <p>Configure everything here — no dotfiles. Secrets are stored <code class="mono">chmod 600</code>
         on your machine and never sent back to the browser in full.</p></div>
    ${body}
    <div class="row mt-lg"><button class="btn btn--primary" data-action="save-settings">${ico("check")} Save changes</button>
      <span class="muted mono" id="save-hint"></span></div>
  </section>`;
}

function settingRow(s) {
  const id = `set-${s.key}`;
  let control;
  if (s.type === "bool") {
    control = `<label class="toggle"><input type="checkbox" id="${id}" data-set="${s.key}" ${s.value ? "checked" : ""} />
      <span class="toggle__track"></span><span class="toggle__label">${s.value ? "on" : "off"}</span></label>`;
  } else if (s.choices && s.choices.length) {
    control = `<select class="select" id="${id}" data-set="${s.key}">${s.choices.map((c) =>
      `<option ${String(s.value) === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
  } else {
    const ph = s.secret ? (s.value ? "•••• stored" : "not set") : "";
    control = `<input class="input ${s.secret ? "input--mono" : ""}" id="${id}" data-set="${s.key}"
      type="${s.secret ? "password" : s.type === "int" ? "number" : "text"}"
      placeholder="${esc(ph)}" value="${s.secret ? "" : esc(s.value)}" autocomplete="off" />`;
  }
  return `<div class="set-row">
    <div class="set-row__meta"><div class="k">${esc(s.key)}<span class="set-row__src">${esc(s.source)}</span></div>
      <div class="d">${esc(s.description)}</div></div>
    <div>${control}</div>
  </div>`;
}

function viewDoctor() {
  const d = S.doctor;
  if (!d) return `<section class="page"><div class="page-head"><div class="eyebrow">health</div><h1>Doctor</h1>
    <p>Checking your finding + sending setup…</p></div><div class="sweep"></div></section>`;
  const groups = {};
  d.checks.forEach((c) => { (groups[c.group] ||= []).push(c); });
  const sum = d.summary;
  return `
  <section class="page">
    <div class="page-head"><div class="eyebrow">health</div><h1>Doctor</h1>
      <p>What works, what to fix — in plain language. Nothing here sends mail.
         <b>${sum.ok}</b> ok · <b>${sum.warn}</b> warnings · <b style="color:var(--red)">${sum.bad}</b> issues.</p></div>
    <div class="row" style="justify-content:flex-end"><button class="btn btn--ghost btn--sm" data-action="recheck">${ico("refresh")} Re-check</button></div>
    ${Object.entries(groups).map(([g, items]) => `
      <div class="doc-group mt">
        <h3>${esc(g)}</h3>
        ${items.map((c) => `<div class="doc-check">
          <span class="dot dot--${c.status}"></span>
          <span class="doc-check__label">${esc(c.label)}</span>
          <span class="doc-check__detail">${esc(c.detail || "")}</span>
        </div>`).join("")}
      </div>`).join("")}
  </section>`;
}

/* =======================================================================
   ROUTING + RENDER
   ===================================================================== */
const VIEWS = {
  find: viewFind, leads: viewLeads, compose: viewCompose, send: viewSend,
  crm: viewCrm, settings: viewSettings, doctor: viewDoctor,
};

function setRoute(route) {
  if (!VIEWS[route]) route = "find";
  S.route = route;
  if (location.hash.slice(1) !== route) location.hash = route;
  $$(".navlink").forEach((n) => n.classList.toggle("is-active", n.dataset.route === route));
  const main = $("#main");
  main.innerHTML = (VIEWS[route] || viewFind)();
  main.focus({ preventScroll: true });
  afterRender(route);
}

async function afterRender(route) {
  if (route === "find" && S.leads.length) renderFindResults();
  if (route === "crm") { await refreshCrm(); $("#main").innerHTML = viewCrm(); }
  if (route === "doctor" && !S.doctor) { await loadDoctor(); $("#main").innerHTML = viewDoctor(); }
}

/* =======================================================================
   ACTIONS
   ===================================================================== */
function readFindOpts() {
  S.query = $("#q")?.value.trim() || S.query;
  S.opts.count = parseInt($("#count")?.value, 10) || S.opts.count;
  S.opts.verified_only = $("#vo")?.checked ?? S.opts.verified_only;
  S.opts.deep = $("#deep")?.checked ?? S.opts.deep;
}

async function runFind() {
  readFindOpts();
  if (!S.query) { toast("Type what you're looking for first.", "err"); $("#q")?.focus(); return; }
  S.leads = []; S.selected.clear(); S.running = true;
  renderFindResults();
  const con = $("#console");
  const log = (html, cls = "") => {
    if (!con) return;
    const line = document.createElement("div");
    line.className = "console__line " + cls;
    line.innerHTML = html;
    con.appendChild(line); con.scrollTop = con.scrollHeight;
  };
  log(`<span class="c-mut">$</span> openleads find "${esc(S.query)}"<span class="console__caret"></span>`);

  const body = { query: S.query, ...S.opts };
  try {
    await stream("/api/find", body, (ev) => {
      if (ev.type === "phase") log(`<span class="c-mut">[engine]</span> ${esc(ev.message)}`);
      else if (ev.type === "lead") {
        S.leads.push(ev.lead);
        const t = ev.lead.tier;
        const tag = t === "safe" ? '<span class="c-ok">safe</span>'
          : t === "risky" ? "risky" : '<span class="c-red">bad</span>';
        log(`  ${tag}  <span class="c-ok">${esc(ev.lead.email || "—")}</span> <span class="c-mut">· ${esc(fullName(ev.lead))} · ${ev.lead.score}</span>`);
        $("#run-stat") && ($("#run-stat").textContent = `${S.leads.length} found`);
      } else if (ev.type === "done") {
        S.leads = ev.leads || S.leads;
        S.leads.filter((l) => l.tier === "safe").forEach((l) => S.selected.add(l.email));
        log(`<span class="c-mut">→</span> done — <span class="c-ok">${ev.safe} safe</span>, ${ev.risky} risky, ${ev.count} total`);
      } else if (ev.type === "error") {
        log(`<span class="c-red">[!] ${esc(ev.message)}</span>`);
        toast(ev.message, "err");
      }
    });
  } catch (e) { toast("Find failed: " + e.message, "err"); }
  S.running = false;
  renderFindResults();
}

async function genDrafts() {
  const safe = S.leads.filter((l) => l.tier === "safe");
  if (!safe.length) { toast("No safe leads to write.", "err"); return; }
  toast(`Drafting ${safe.length} emails…`);
  const res = await postJSON("/api/write", { leads: safe });
  S.drafts = res.drafts || [];
  setRoute("compose");
  toast(`${S.drafts.length} drafts ready${res.llm ? " (AI)" : " (template)"}.`);
}

async function runSend() {
  if (!S.drafts.length) return;
  const live = $("#live")?.checked;
  if (live && !confirm(`Send ${S.drafts.length} real emails now? This cannot be undone.`)) return;
  S.running = true;
  const con = $("#send-console");
  const log = (html, cls = "") => {
    if (!con) return;
    const l = document.createElement("div"); l.className = "console__line " + cls;
    l.innerHTML = html; con.appendChild(l); con.scrollTop = con.scrollHeight;
  };
  $("[data-action='send']")?.setAttribute("disabled", "true");
  log(`<span class="c-mut">$</span> openleads send ${live ? "--live" : "(dry-run)"}<span class="console__caret"></span>`);
  try {
    await stream("/api/send", { drafts: S.drafts, live }, (ev) => {
      if (ev.type === "phase") log(`<span class="c-mut">[outbox]</span> ${esc(ev.message)}`);
      else if (ev.type === "send") {
        const r = ev.result, st = r.status;
        const tag = st === "sent" ? '<span class="c-ok">sent</span>'
          : st === "preview" ? '<span class="c-mut">preview</span>'
          : st === "skipped" ? "skipped" : '<span class="c-red">error</span>';
        log(`  ${tag} → ${esc(r.email)}${r.detail ? ` <span class="c-mut">(${esc(r.detail)})</span>` : ""}`);
      } else if (ev.type === "done") {
        log(`<span class="c-mut">→</span> ${ev.live ? `<span class="c-ok">${ev.sent} sent</span>` : `${ev.preview} previewed`}, ${ev.skipped} skipped`);
        toast(ev.live ? `${ev.sent} emails sent.` : `${ev.preview} previewed (dry-run).`);
      } else if (ev.type === "error") { log(`<span class="c-red">[!] ${esc(ev.message)}</span>`); toast(ev.message, "err"); }
    });
  } catch (e) { toast("Send failed: " + e.message, "err"); }
  S.running = false;
  $("[data-action='send']")?.removeAttribute("disabled");
  refreshCrm();
}

function exportCsv() {
  if (!S.leads.length) return;
  const fields = ["tier", "score", "email", "first_name", "last_name", "title",
    "organization", "city", "country", "source", "linkedin_url"];
  const head = fields.join(",");
  const lines = S.leads.map((l) => fields.map((f) => {
    const v = String(l[f] ?? "").replace(/"/g, '""');
    return /[",\n]/.test(v) ? `"${v}"` : v;
  }).join(","));
  const blob = new Blob([head + "\n" + lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "openleads.csv"; a.click();
  URL.revokeObjectURL(a.href);
  toast(`Exported ${S.leads.length} leads.`);
}

async function saveSettings() {
  const values = {};
  $$("[data-set]").forEach((el) => {
    const key = el.dataset.set;
    if (el.type === "checkbox") values[key] = el.checked;
    else if (el.type === "password") { if (el.value) values[key] = el.value; }
    else values[key] = el.value;
  });
  const res = await postJSON("/api/settings", { values });
  S.settings = res.settings; S.identity = res.identity;
  if (Object.keys(res.errors || {}).length) toast("Some keys were invalid.", "err");
  else toast("Settings saved.");
  $("#save-hint") && ($("#save-hint").textContent = `saved ${res.applied.length} keys`);
  updateReadiness();
}

async function refreshCrm() {
  try { S.crm = await postJSON("/api/crm", { limit: 500 }); S.crm = { ...S.crm.overview, rows: S.crm.rows }; }
  catch (_) {}
}
async function loadDoctor() {
  try { S.doctor = await getJSON("/api/doctor"); updateReadiness(); } catch (_) {}
}
function updateReadiness() {
  const g = S.doctor?.preflight?.grade;
  const el = $("#readiness-grade");
  if (el) { el.textContent = g || "—"; el.className = "readiness__grade grade-" + (g || ""); }
}

/* =======================================================================
   EVENT DELEGATION
   ===================================================================== */
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-action]");
  if (!a) return;
  const act = a.dataset.action;
  if (act === "find") { e.preventDefault(); runFind(); }
  else if (act === "src") {
    S.opts.source = a.dataset.src || "";
    $$('[data-action="src"]').forEach((c) => c.classList.toggle("is-on", c.dataset.src === S.opts.source));
  }
  else if (act === "to-write" || act === "gen-drafts") { e.preventDefault(); genDrafts(); }
  else if (act === "export") exportCsv();
  else if (act === "send") { e.preventDefault(); runSend(); }
  else if (act === "save-settings") { e.preventDefault(); saveSettings(); }
  else if (act === "recheck") { S.doctor = null; setRoute("doctor"); }
  else if (act === "go") { e.preventDefault(); setRoute(a.dataset.route); }
  else if (act === "lf") {
    $$('[data-action="lf"]').forEach((c) => c.classList.toggle("is-on", c === a));
    const f = a.dataset.f;
    const rows = f === "all" ? S.leads : S.leads.filter((l) => l.tier === f);
    $("#leads-table") && ($("#leads-table").innerHTML = leadsTable(rows));
  }
});

document.addEventListener("input", (e) => {
  const d = e.target.closest("[data-draft]");
  if (d) {
    const i = +d.dataset.draft, k = d.dataset.k;
    if (S.drafts[i]) S.drafts[i][k] = d.target?.value ?? d.value;
  }
});

// nav links
$$(".navlink").forEach((n) => n.addEventListener("click", (e) => {
  e.preventDefault(); setRoute(n.dataset.route);
}));

// Enter key in command bar
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "q") { e.preventDefault(); runFind(); }
});

/* =======================================================================
   BOOT
   ===================================================================== */
async function boot() {
  try {
    const st = await getJSON("/api/state");
    S.version = st.version; S.sources = st.sources; S.settings = st.settings;
    S.groups = st.groups; S.identity = st.identity;
    S.crm = st.crm;
    $("#version").textContent = "v" + st.version;
  } catch (e) {
    toast("Could not reach the local server.", "err");
  }
  $("#app").setAttribute("data-loading", "false");
  setTimeout(() => $("#boot")?.remove(), 450);
  const start = location.hash.slice(1);
  setRoute(VIEWS[start] ? start : "find");
  loadDoctor(); // background — populates readiness grade + send page
}
window.addEventListener("hashchange", () => {
  const r = location.hash.slice(1);
  if (VIEWS[r] && r !== S.route) setRoute(r);
});
boot();
