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
  crm: null, version: "v4",
  query: "", opts: { source: "", count: 25, verified_only: true, deep: false },
  leads: [], selected: new Set(), drafts: [], doctor: null,
  running: false,
  enrichLeads: [], recipes: [], watchers: {}, analytics: null,
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
      <div class="eyebrow">find — one box, federated</div>
      <h1>Describe your ICP. Get verified people.</h1>
      <p>One box fans out across free public sources — <b>local businesses</b> (OpenStreetMap),
         startups, companies, developers — finds the <b>people</b> behind each, resolves their
         email, and grades it <b>safe</b> / <b>risky</b>. Leave the source on <b>auto</b> to federate.</p>
    </div>

    <div class="command">
      <span class="command__prompt">›</span>
      <input id="q" type="text" autocomplete="off" spellcheck="false"
        placeholder="marketing agencies in Miami   ·   50 fintech founders   ·   dentists in Austin"
        value="${esc(S.query)}" />
      <button class="btn btn--primary" data-action="find">${ico("bolt")} Run</button>
    </div>

    <div class="row mt" style="gap:8px;flex-wrap:wrap">
      ${["marketing agencies in Miami","law firms in London","fintech founders, verified only",
         "dentists in Austin","rust developers in Berlin"].map((ex) =>
        `<button class="chip" data-action="ex" data-ex="${esc(ex)}">${esc(ex)}</button>`).join("")}
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

function viewEnrich() {
  return `
  <section class="page page--wide">
    <div class="page-head"><div class="eyebrow">enrich — bring your own list</div>
      <h1>Paste a list. Get verified emails.</h1>
      <p>Have names, companies, or domains already? Paste CSV (with a header row) or just
         <code class="mono">name,company,domain,email</code> lines. OpenLeads runs the same
         waterfall — find, harvest, pattern, verify — and tiers every row. Clay-style, $0.</p></div>

    <div class="field"><label>Your list (CSV with header, e.g. name,company,domain,email)</label>
      <textarea class="input input--mono" id="enrich-csv" rows="8"
        placeholder="name,company,domain&#10;Jane Smith,Acme,acme.com&#10;John Doe,,beta.io"></textarea></div>
    <div class="row mt" style="gap:10px">
      <button class="btn btn--primary" data-action="enrich-run">${ico("enrich")} Enrich list</button>
      <label class="toggle" style="margin-top:6px"><input type="checkbox" id="enrich-deep" />
        <span class="toggle__track"></span><span class="toggle__label">deep harvest</span></label>
    </div>
    <div id="enrich-out" class="mt-lg"></div>
  </section>`;
}

function renderEnrichResults() {
  const host = $("#enrich-out"); if (!host) return;
  const safe = S.enrichLeads.filter((l) => l.tier === "safe").length;
  host.innerHTML = `
    <div class="card"><div class="card__head"><h3>Enrichment console</h3>
      <span class="count-pill">${S.running ? "running…" : `${S.enrichLeads.length} rows`}</span></div>
      <div class="card__body" style="display:grid;gap:14px">
        ${S.running ? '<div class="sweep"></div>' : ""}<div class="console" id="enrich-console"></div></div></div>
    ${S.enrichLeads.length ? `
    <div class="row row--between mt-lg"><div class="row" style="gap:10px">
      <strong>${S.enrichLeads.length} enriched</strong><span class="muted">· ${safe} deliverable</span></div>
      <button class="btn btn--ghost btn--sm" data-action="enrich-export">${ico("download")} Export CSV</button></div>
    <div class="table-wrap mt">${leadsTable(S.enrichLeads)}</div>` : ""}`;
}

function viewAutomations() {
  const recipes = S.recipes || [];
  const watchers = Object.values(S.watchers || {});
  return `
  <section class="page page--wide">
    <div class="page-head"><div class="eyebrow">automate — set &amp; forget</div>
      <h1>Recipes &amp; watchers</h1>
      <p>A <b>recipe</b> saves an ICP + message + schedule and runs itself (find → write → send → export).
         A <b>watcher</b> pings you only when <i>new</i> leads match. The on-device scheduler fires them
         daily — <a data-action="go" data-route="settings">set a send time in Connect</a>.</p></div>

    <div class="card"><div class="card__head"><h3>${ico("robot")} Recipes</h3></div>
      <div class="card__body" style="display:grid;gap:12px">
        <div class="grid grid--2" style="gap:10px;align-items:end">
          <div class="field"><label>Name</label><input class="input" id="rc-name" placeholder="miami-agencies"/></div>
          <div class="field"><label>Audience (ICP)</label><input class="input" id="rc-query" placeholder="marketing agencies in Miami"/></div>
          <div class="field" style="max-width:120px"><label>Count</label><input class="input input--mono" id="rc-count" type="number" value="25"/></div>
          <div class="field" style="max-width:120px"><label>Send at</label><input class="input input--mono" id="rc-at" placeholder="09:00"/></div>
          <div class="field"><label>Pitch (optional)</label><input class="input" id="rc-context" placeholder="our local SEO service"/></div>
          <div class="field"><label>Export to</label><select class="select" id="rc-export">
            <option value="">— none —</option>${["csv","json","ndjson","sheets","webhook","notion","airtable"]
              .map((s)=>`<option>${s}</option>`).join("")}</select></div>
          <label class="toggle"><input type="checkbox" id="rc-send" checked/><span class="toggle__track"></span><span class="toggle__label">sends email</span></label>
          <button class="btn btn--primary" data-action="recipe-save">${ico("check")} Save recipe</button>
        </div>
        ${recipes.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Audience</th><th>When</th><th>Mode</th><th>Export</th><th></th></tr></thead>
          <tbody>${recipes.map((r)=>`<tr><td class="t-name">${esc(r.name)}</td><td class="t-mut">${esc(r.query)}</td>
          <td class="mono">${r.enabled?`${String(r.send_hour).padStart(2,"0")}:${String(r.send_minute).padStart(2,"0")}`:"manual"}</td>
          <td>${r.send?'<span class="tier tier--safe">send</span>':'<span class="tier tier--risky">find</span>'}</td>
          <td class="t-mut">${r.export?esc(r.export.sink):"—"}</td>
          <td class="row" style="gap:6px"><button class="btn btn--ghost btn--sm" data-action="recipe-run" data-name="${esc(r.name)}">${ico("bolt")} Run</button>
          <button class="btn btn--ghost btn--sm" data-action="recipe-del" data-name="${esc(r.name)}">${ico("x")}</button></td></tr>`).join("")}</tbody></table></div>`
          : `<div class="empty">${ico("robot")}<h3>No recipes yet</h3><p>Save one above to automate an outreach play.</p></div>`}
        <div id="recipe-out"></div>
      </div></div>

    <div class="card mt-lg"><div class="card__head"><h3>${ico("pin")} Watchers</h3></div>
      <div class="card__body" style="display:grid;gap:12px">
        <div class="grid grid--2" style="gap:10px;align-items:end">
          <div class="field"><label>Name</label><input class="input" id="wt-name" placeholder="new-miami-agencies"/></div>
          <div class="field"><label>Watch for</label><input class="input" id="wt-query" placeholder="marketing agencies in Miami"/></div>
          <div class="field"><label>Deliver new to</label><select class="select" id="wt-sink">${["csv","json","ndjson","webhook"]
            .map((s)=>`<option>${s}</option>`).join("")}</select></div>
          <button class="btn btn--primary" data-action="watch-save">${ico("check")} Save watcher</button>
        </div>
        ${watchers.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Query</th><th>Sink</th><th>Seen</th><th></th></tr></thead>
          <tbody>${watchers.map((w)=>`<tr><td class="t-name">${esc(w.name)}</td><td class="t-mut">${esc(w.query)}</td>
          <td class="t-mut">${esc(w.sink||"csv")}</td><td class="t-num">${(w.seen||[]).length}</td>
          <td><button class="btn btn--ghost btn--sm" data-action="watch-del" data-name="${esc(w.name)}">${ico("x")}</button></td></tr>`).join("")}</tbody></table></div>`
          : `<div class="empty">${ico("pin")}<h3>No watchers</h3><p>Get alerted when fresh leads match your niche.</p></div>`}
      </div></div>
  </section>`;
}

function viewAnalytics() {
  const a = S.analytics || { total_leads:0, deliverable:0, sent:0, replied:0, bounced:0,
    reply_rate:0, bounce_rate:0, by_source:{}, by_tier:{}, by_status:{} };
  const bars = (obj) => {
    const max = Math.max(1, ...Object.values(obj));
    return Object.entries(obj).sort((x,y)=>y[1]-x[1]).map(([k,v])=>`
      <div class="abar"><span class="abar__k">${esc(k)}</span>
        <span class="abar__track"><span class="abar__fill" style="width:${Math.round(100*v/max)}%"></span></span>
        <span class="abar__v">${v}</span></div>`).join("") || '<p class="muted">No data yet.</p>';
  };
  return `
  <section class="page page--wide">
    <div class="page-head"><div class="eyebrow">analytics</div><h1>Your funnel</h1>
      <p>Everything computed locally from your CRM + send log.</p></div>
    <div class="grid grid--3">
      <div class="stat stat--accent"><div class="stat__k">total leads</div><div class="stat__v">${a.total_leads}</div></div>
      <div class="stat"><div class="stat__k">deliverable</div><div class="stat__v">${a.deliverable}</div></div>
      <div class="stat"><div class="stat__k">sent</div><div class="stat__v">${a.sent} <small>· ${a.sent_today||0} today</small></div></div>
      <div class="stat"><div class="stat__k">reply rate</div><div class="stat__v">${a.reply_rate}%</div></div>
      <div class="stat"><div class="stat__k">replied</div><div class="stat__v">${a.replied}</div></div>
      <div class="stat"><div class="stat__k">bounce rate</div><div class="stat__v">${a.bounce_rate}%</div></div>
    </div>
    <div class="grid grid--2 mt-lg">
      <div class="card"><div class="card__head"><h3>By source</h3></div><div class="card__body">${bars(a.by_source)}</div></div>
      <div class="card"><div class="card__head"><h3>By tier</h3></div><div class="card__body">${bars(a.by_tier)}</div></div>
    </div>
  </section>`;
}

/* =======================================================================
   ROUTING + RENDER
   ===================================================================== */
const VIEWS = {
  find: viewFind, leads: viewLeads, compose: viewCompose, send: viewSend,
  crm: viewCrm, settings: viewSettings, doctor: viewDoctor,
  enrich: viewEnrich, automations: viewAutomations, analytics: viewAnalytics,
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
  if (route === "enrich" && S.enrichLeads.length) renderEnrichResults();
  if (route === "crm") { await refreshCrm(); $("#main").innerHTML = viewCrm(); }
  if (route === "doctor" && !S.doctor) { await loadDoctor(); $("#main").innerHTML = viewDoctor(); }
  if (route === "automations") { await loadAutomations(); $("#main").innerHTML = viewAutomations(); }
  if (route === "analytics") { await loadAnalytics(); $("#main").innerHTML = viewAnalytics(); }
}

async function loadAutomations() {
  try {
    const [r, w] = await Promise.all([getJSON("/api/recipes"), getJSON("/api/watchers")]);
    S.recipes = r.recipes || []; S.watchers = w.watchers || {};
  } catch (_) {}
}
async function loadAnalytics() {
  try { S.analytics = await getJSON("/api/analytics"); } catch (_) {}
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

async function runEnrich() {
  const csv = $("#enrich-csv")?.value.trim();
  if (!csv) { toast("Paste a list first.", "err"); return; }
  S.enrichLeads = []; S.running = true; renderEnrichResults();
  const con = $("#enrich-console");
  const log = (h) => { if (!con) return; const l = document.createElement("div");
    l.className = "console__line"; l.innerHTML = h; con.appendChild(l); con.scrollTop = con.scrollHeight; };
  log(`<span class="c-mut">$</span> openleads enrich (pasted list)<span class="console__caret"></span>`);
  try {
    await stream("/api/enrich", { rows: csv, deep: $("#enrich-deep")?.checked }, (ev) => {
      if (ev.type === "phase") log(`<span class="c-mut">[engine]</span> ${esc(ev.message)}`);
      else if (ev.type === "lead") { S.enrichLeads.push(ev.lead);
        const t = ev.lead.tier, tag = t==="safe"?'<span class="c-ok">safe</span>':t==="risky"?"risky":'<span class="c-red">bad</span>';
        log(`  ${tag}  <span class="c-ok">${esc(ev.lead.email||"—")}</span> <span class="c-mut">· ${esc(fullName(ev.lead))}</span>`); }
      else if (ev.type === "done") { S.enrichLeads = ev.leads || S.enrichLeads;
        log(`<span class="c-mut">→</span> done — <span class="c-ok">${ev.safe} deliverable</span> of ${ev.count}`); }
      else if (ev.type === "error") { log(`<span class="c-red">[!] ${esc(ev.message)}</span>`); toast(ev.message, "err"); }
    });
  } catch (e) { toast("Enrich failed: " + e.message, "err"); }
  S.running = false; renderEnrichResults();
}

async function exportEnrich() {
  const res = await postJSON("/api/export", { leads: S.enrichLeads, sink: "csv" });
  toast(res.ok ? `Exported ${res.count} → ${res.target}` : "Export failed", res.ok ? "ok" : "err");
}

async function saveRecipe() {
  const body = {
    name: $("#rc-name")?.value.trim(), query: $("#rc-query")?.value.trim(),
    count: parseInt($("#rc-count")?.value, 10) || 25, context: $("#rc-context")?.value.trim(),
    send: $("#rc-send")?.checked, enabled: !!$("#rc-at")?.value.trim(),
  };
  const at = ($("#rc-at")?.value || "").trim().match(/^(\d{1,2}):?(\d{2})?$/);
  if (at) { body.send_hour = +at[1]; body.send_minute = +(at[2] || 0); }
  const sink = $("#rc-export")?.value;
  if (sink) body.export = { sink, target: "" };
  if (!body.name || !body.query) { toast("Recipe needs a name + audience.", "err"); return; }
  const res = await postJSON("/api/recipes/save", body);
  if (res.ok) { toast(`Saved recipe '${body.name}'.`); await loadAutomations(); setRoute("automations"); }
  else toast(res.error || "Save failed", "err");
}

async function runRecipe(name) {
  toast(`Running '${name}' (dry-run)…`);
  const out = $("#recipe-out");
  if (out) out.innerHTML = '<div class="sweep"></div>';
  try {
    await stream("/api/recipes/run", { name, live: false }, (ev) => {
      if (ev.type === "done") { toast(`'${name}': found ${ev.found}, drafted ${ev.drafted}, sent ${ev.sent}.`);
        if (out) out.innerHTML = `<p class="muted mono">found ${ev.found} · drafted ${ev.drafted} · sent ${ev.sent}</p>`; }
      else if (ev.type === "error") toast(ev.message, "err");
    });
  } catch (e) { toast("Run failed: " + e.message, "err"); }
}

async function deleteRecipe(name) {
  if (!confirm(`Delete recipe '${name}'?`)) return;
  await postJSON("/api/recipes/delete", { name }); await loadAutomations(); setRoute("automations");
}

async function saveWatcher() {
  const body = { name: $("#wt-name")?.value.trim(), query: $("#wt-query")?.value.trim(),
    sink: $("#wt-sink")?.value || "csv" };
  if (!body.name || !body.query) { toast("Watcher needs a name + query.", "err"); return; }
  const res = await postJSON("/api/watch/save", body);
  if (res.ok) { toast(`Watching '${body.name}'.`); await loadAutomations(); setRoute("automations"); }
  else toast(res.error || "Save failed", "err");
}
async function deleteWatcher(name) {
  await postJSON("/api/watch/delete", { name }); await loadAutomations(); setRoute("automations");
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
  else if (act === "ex") { S.query = a.dataset.ex; const q = $("#q"); if (q) q.value = a.dataset.ex; runFind(); }
  else if (act === "enrich-run") { e.preventDefault(); runEnrich(); }
  else if (act === "enrich-export") { e.preventDefault(); exportEnrich(); }
  else if (act === "recipe-save") { e.preventDefault(); saveRecipe(); }
  else if (act === "recipe-run") { e.preventDefault(); runRecipe(a.dataset.name); }
  else if (act === "recipe-del") { e.preventDefault(); deleteRecipe(a.dataset.name); }
  else if (act === "watch-save") { e.preventDefault(); saveWatcher(); }
  else if (act === "watch-del") { e.preventDefault(); deleteWatcher(a.dataset.name); }
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
