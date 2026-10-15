/* =========================================================================
   Import CSV — a tab in Import & enrich (#/enrich/import). Drop or paste an
   export from Apollo, HubSpot, LinkedIn or any spreadsheet; columns map
   themselves (each one adjustable, with real values shown), then the rows
   land in People — optionally in a list, tagged and staged. Existing
   contacts are updated without blanking anything. Rows with a name and a
   company but no email go to the enrich waterfall.
   ========================================================================= */
import { enroll } from "../actions.js";
import { $, api, esc, fail, fmt, ico, router, store, toast } from "../core.js";
import { openEnrichWith, registerEnrichTab } from "./enrich.js";

const LABELS = {
  email: "Email", first_name: "First name", last_name: "Last name", name: "Full name", title: "Job title",
  organization: "Company", website: "Website / domain", phone: "Phone", linkedin_url: "LinkedIn URL",
  city: "City", state: "State / region", country: "Country", industry: "Industry", employees: "Employees",
  tags: "Tags", stage: "Stage", notes: "Note",
};
const I = { csv: "", filename: "", preview: null, mapping: {}, opts: { list_name: "", tags: "", stage: "" }, result: null, busy: false };
let HOST = null;

function dropzone() {
  return `<div class="grid grid-main-side">
    <div class="card card--pad stack">
      <label class="dropzone" id="imp-drop">
        <input type="file" accept=".csv,.tsv,.txt,text/csv" id="imp-file" hidden/>
        <span class="dropzone__icon">${ico("upload")}</span>
        <b>Drop a CSV here or click to choose a file</b>
        <span class="hint">Apollo, HubSpot, Salesforce, LinkedIn Sales Navigator or any spreadsheet export · up to 50,000 rows</span>
      </label>
      <details class="mt"><summary class="link">…or paste CSV text</summary>
        <textarea class="textarea input--mono mt" id="imp-paste" rows="7" placeholder="First Name,Last Name,Email,Company,Title&#10;Jane,Doe,jane@acme.com,Acme,VP of Sales"></textarea>
        <div class="row mt"><span class="spacer"></span><button class="btn btn--primary" data-i="paste">${ico("arrow")} Continue</button></div></details>
    </div>
    <div class="card card--pad stack"><h3>How it works</h3>
      <div class="kv"><dt>Columns</dt><dd>Recognised automatically from 100+ header spellings. You can change any of them.</dd>
      <dt>Existing people</dt><dd>Matched by email and updated — blank cells never overwrite what you have.</dd>
      <dt>No email?</dt><dd>Rows with a name and company go to the email finder.</dd>
      <dt>After</dt><dd>Put them in a list, tag them, set a stage, then add them to a sequence.</dd></div></div>
  </div>`;
}

function mappingTable() {
  const p = I.preview;
  const fields = p.fields || Object.keys(LABELS);
  const used = Object.values(I.mapping);
  return p.headers.map((h) => {
    const cur = I.mapping[h] || "";
    const dup = cur && used.filter((f) => f === cur).length > 1;
    const vals = (p.raw || []).map((r) => r[h]).filter(Boolean).slice(0, 2);
    return `<tr class="${cur ? "" : "is-muted"}"><td><b>${esc(h)}</b><div class="hint ellipsis" style="max-width:280px">${vals.length ? vals.map(esc).join(" · ") : "<i>empty</i>"}</div></td>
      <td>${ico("arrow", "ico--sm faint")}</td>
      <td><select class="select select--sm" data-map="${esc(h)}"><option value="">Don't import</option>${fields.map((f) =>
        `<option value="${f}" ${f === cur ? "selected" : ""}>${esc(LABELS[f] || f)}</option>`).join("")}</select>
        ${dup ? `<div class="hint" style="color:var(--warn)">Also mapped from another column — the first non-blank wins.</div>` : ""}</td></tr>`;
  }).join("");
}

function sampleTable() {
  const rows = I.preview.sample || [];
  if (!rows.length) return "";
  const cols = ["email", "first_name", "last_name", "title", "organization", "phone", "stage"].filter((c) => rows.some((r) => r[c]));
  return `<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr>${cols.map((c) => `<th>${esc(LABELS[c])}</th>`).join("")}</tr></thead><tbody>
    ${rows.map((r) => `<tr>${cols.map((c) => `<td class="${c === "email" ? "t-mono" : ""}">${esc(r[c] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function mapStep() {
  const p = I.preview;
  const hasEmail = Object.values(I.mapping).includes("email");
  return `<div class="row mb" style="gap:10px">${ico("table")}<b>${esc(I.filename || "Pasted CSV")}</b>
      <span class="faint">${fmt.plural(p.total, "row")} · ${fmt.plural(p.headers.length, "column")}</span><span class="spacer"></span>
      <button class="btn btn--sm btn--ghost" data-i="reset">${ico("x")} Start over</button></div>
    <div class="grid grid-main-side">
      <div class="stack">
        <div class="card"><div class="card__head"><h3>Map columns</h3><span class="faint">${fmt.num(Object.values(I.mapping).filter(Boolean).length)} of ${p.headers.length} mapped</span></div>
          <div class="table-wrap"><table class="tbl map-tbl"><tbody>${mappingTable()}</tbody></table></div></div>
        <div class="card"><div class="card__head"><h3>Preview</h3><span class="faint">first ${Math.min(5, p.total)} rows as they'll be saved</span></div>${sampleTable()}</div>
      </div>
      <div class="stack" style="position:sticky;top:16px">
        <div class="card card--pad stack">
          <div class="imp-stat"><span>${ico("check", "ico--sm")} With an email</span><b>${fmt.num(p.with_email)}</b></div>
          <div class="imp-stat"><span>${ico("find", "ico--sm")} Email can be found</span><b>${fmt.num((p.needs_email || []).length)}</b></div>
          <div class="imp-stat"><span>${ico("minus", "ico--sm")} Skipped (no email, no name)</span><b>${fmt.num(Math.max(0, p.without_email - (p.needs_email || []).length))}</b></div>
          ${hasEmail ? "" : `<div class="banner banner--warn">${ico("flag")}<div>No column is mapped to <b>Email</b> yet.</div></div>`}
        </div>
        <div class="card card--pad stack"><h3>Options</h3>
          <div class="field"><label>Add to list</label><input class="input input--sm" data-opt="list_name" list="imp-lists" value="${esc(I.opts.list_name)}" placeholder="New or existing list (optional)"/>
            <datalist id="imp-lists">${(I.lists || []).map((l) => `<option value="${esc(l.name)}">`).join("")}</datalist></div>
          <div class="field"><label>Tags</label><input class="input input--sm" data-opt="tags" value="${esc(I.opts.tags)}" placeholder="apollo, q4 (comma separated)"/></div>
          <div class="field"><label>Stage for new people</label><select class="select select--sm" data-opt="stage"><option value="">Keep from file / New</option>${(store.meta?.contact_stages || []).map((s) =>
            `<option value="${s.key}" ${I.opts.stage === s.key ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>
          <button class="btn btn--primary" data-i="run" ${hasEmail && p.with_email && !I.busy ? "" : "disabled"}>${ico("upload")} Import ${fmt.plural(p.with_email, "contact")}</button>
          ${(p.needs_email || []).length ? `<button class="btn" data-i="find">${ico("spark")} Find emails for ${fmt.plural(p.needs_email.length, "row")}</button>` : ""}
        </div>
      </div>
    </div>`;
}

function resultStep() {
  const r = I.result;
  return `<div class="card card--pad stack" style="max-width:720px">
    <div class="row" style="gap:12px"><span class="tl-icon tl-icon--good" style="width:40px;height:40px">${ico("check")}</span>
      <div><h2 style="margin:0">Import complete</h2><div class="muted">${fmt.plural(r.created, "new contact")} · ${fmt.plural(r.updated, "updated")}${r.list ? ` · in list <b>${esc(r.list.name)}</b>` : ""}</div></div></div>
    ${r.skipped.length ? `<details><summary class="link">${fmt.plural(r.skipped.length, "row")} skipped</summary>
      <div class="table-wrap mt" style="max-height:220px"><table class="tbl tbl--compact"><thead><tr><th>Row</th><th>Value</th><th>Why</th></tr></thead><tbody>
      ${r.skipped.slice(0, 200).map((s) => `<tr><td>${s.row}</td><td class="t-mono">${esc(s.email)}</td><td>${esc(s.reason)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
    ${r.no_email ? `<p class="hint">${fmt.plural(r.no_email, "row")} had no email.${(I.preview?.needs_email || []).length ? " You can find emails for the ones with a name and company below." : ""}</p>` : ""}
    <div class="row row--wrap" style="gap:8px">
      <a class="btn btn--primary" href="${r.list ? router.href("people", "", { list: r.list.id }) : router.href("people", "", { sort: "updated" })}">${ico("users")} Open in People</a>
      ${r.list ? `<button class="btn" data-i="enroll">${ico("sequence")} Add to a sequence</button>` : ""}
      ${(I.preview?.needs_email || []).length ? `<button class="btn" data-i="find">${ico("spark")} Find ${fmt.plural(I.preview.needs_email.length, "missing email")}</button>` : ""}
      <a class="btn" href="#/enrich/enrich">${ico("shield")} Verify emails</a>
      <span class="spacer"></span><button class="btn btn--ghost" data-i="reset">Import another file</button></div></div>`;
}

function draw() {
  if (!HOST || !HOST.isConnected) return;
  HOST.innerHTML = I.result ? resultStep() : I.preview ? mapStep() : dropzone();
}

async function loadCsv(text, name = "") {
  if (!text.trim()) { fail("That file is empty."); return; }
  I.csv = text; I.filename = name;
  try {
    const [p, l] = await Promise.all([api.post("/api/import/preview", { csv: text }), api.get("/api/lists", { kind: "people" }).catch(() => ({ lists: [] }))]);
    if (!p.headers.length) { fail("Couldn't find a header row in that file."); return; }
    I.preview = p; I.mapping = { ...p.mapping }; I.lists = l.lists || [];
    draw();
  } catch (err) { fail(err); }
}

const repreview = async () => {
  try { I.preview = await api.post("/api/import/preview", { csv: I.csv, mapping: I.mapping }); draw(); } catch (err) { fail(err); }
};

function findEmails() {
  const rows = I.preview?.needs_email || [];
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  openEnrichWith(["name,company,domain", ...rows.map((r) => [r.name, r.company, r.domain].map(q).join(","))].join("\n"));
}

function bind(host) {
  host.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.id === "imp-file" && t.files[0]) {
      const f = t.files[0];
      if (f.size > 24 * 1024 * 1024) { fail("That file is over 24 MB — split it and import in parts."); return; }
      loadCsv(await f.text(), f.name);
    } else if (t.dataset.map !== undefined) {
      if (t.value) I.mapping[t.dataset.map] = t.value; else delete I.mapping[t.dataset.map];
      repreview();
    } else if (t.dataset.opt) I.opts[t.dataset.opt] = t.value;
  });
  host.addEventListener("input", (e) => { if (e.target.dataset.opt) I.opts[e.target.dataset.opt] = e.target.value; });
  host.addEventListener("dragover", (e) => { const z = e.target.closest("#imp-drop"); if (z) { e.preventDefault(); z.classList.add("is-over"); } });
  host.addEventListener("dragleave", (e) => { const z = e.target.closest("#imp-drop"); if (z) z.classList.remove("is-over"); });
  host.addEventListener("drop", async (e) => {
    const z = e.target.closest("#imp-drop"); if (!z) return;
    e.preventDefault(); z.classList.remove("is-over");
    const f = e.dataTransfer.files[0]; if (f) loadCsv(await f.text(), f.name);
  });
  host.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-i]"); if (!b) return;
    const a = b.dataset.i;
    if (a === "paste") loadCsv($("#imp-paste", host).value, "");
    else if (a === "reset") { Object.assign(I, { csv: "", filename: "", preview: null, mapping: {}, result: null, opts: { list_name: "", tags: "", stage: "" } }); draw(); }
    else if (a === "find") findEmails();
    else if (a === "enroll") enroll({ all: true, filters: { list_id: [String(I.result.list.id)] }, total: I.result.created + I.result.updated });
    else if (a === "run") {
      I.busy = true; b.disabled = true; b.innerHTML = `${ico("refresh")} Importing…`;
      try {
        I.result = await api.post("/api/import", { csv: I.csv, mapping: I.mapping, list_name: I.opts.list_name.trim(),
          tags: I.opts.tags.split(",").map((t) => t.trim()).filter(Boolean), stage: I.opts.stage, source: "import" });
        toast(`Imported ${fmt.num(I.result.created + I.result.updated)} contacts`);
        document.dispatchEvent(new Event("ol:refresh-badges"));
      } catch (err) { fail(err); }
      I.busy = false; draw();
    }
  });
}

registerEnrichTab("import", "Import CSV", (host) => { HOST = host; bind(host); draw(); });
