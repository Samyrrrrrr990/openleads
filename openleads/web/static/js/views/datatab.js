/* =========================================================================
   Settings → Data & backup (#/settings/data). Where the workspace lives,
   one-click backups, exporting everyone, and links to import and cleanup.
   ========================================================================= */
import { exportMenu } from "../actions.js";
import { api, esc, fail, fmt, ico, toast, ui } from "../core.js";
import { registerSettingsTab } from "./settings.js";

async function draw(host) {
  const [b, h] = await Promise.all([api.get("/api/backups"), api.get("/api/home")]);
  host.innerHTML = `<div class="grid grid-main-side">
    <div class="stack">
      <div class="card"><div class="card__head"><div><h3>Back up</h3>
          <p class="hint" style="margin-top:2px">A consistent snapshot of everything — people, companies, lists, sequences, tasks, deals, notes and history — safe to take while sequences run.</p></div>
          <div class="actions"><button class="btn btn--primary btn--sm" data-d="backup">${ico("download")} Back up now</button></div></div>
        <div class="card__body">${b.backups.length ? `<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Backup</th><th class="col-num">Size</th><th>Taken</th></tr></thead><tbody>
          ${b.backups.map((x) => `<tr><td class="t-mono">${esc(x.name)}</td><td class="col-num">${fmt.num(Math.round(x.bytes / 1024))} KB</td><td class="muted">${esc(fmt.rel(x.ts))}</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="muted">No backups yet.</p>`}
          <p class="hint mt">Saved in <code>${esc(b.folder)}</code>. To restore, stop OpenLeads and copy a backup over <code>${esc(b.db)}</code>. From a terminal: <code>openleads backup</code>.</p></div></div>
      <div class="card"><div class="card__head"><div><h3>Export everyone</h3>
          <p class="hint" style="margin-top:2px">All ${fmt.num(h.contacts.total)} people as CSV, JSON, or ready to import into Apollo or HubSpot.</p></div>
          <div class="actions"><button class="btn btn--sm" data-d="export">${ico("download")} Export…</button></div></div></div>
    </div>
    <div class="card card--pad stack"><h3>Your data</h3>
      <div class="kv"><dt>People</dt><dd>${fmt.num(h.contacts.total)}</dd><dt>Companies</dt><dd>${fmt.num(h.companies.total)}</dd>
        <dt>Lists</dt><dd>${fmt.num(h.lists.total)}</dd><dt>Sequences</dt><dd>${fmt.num(h.sequences.total)}</dd></div>
      <p class="hint">Stored only on this machine in <code>${esc(b.db)}</code>. Nothing is uploaded anywhere.</p>
      <a class="link" href="#/enrich/import">${ico("upload", "ico--sm")} Import a CSV</a>
      <a class="link" href="#/health">${ico("heart", "ico--sm")} Data health & duplicates</a></div>
  </div>`;
}

registerSettingsTab("data", "Data & backup", async (host) => {
  host.innerHTML = ui.skeleton(5);
  try { await draw(host); } catch (err) { host.innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
  host.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-d]"); if (!b) return;
    try {
      if (b.dataset.d === "backup") {
        b.disabled = true;
        const r = await api.post("/api/backup", {});
        toast(`Backed up (${fmt.num(Math.round(r.bytes / 1024))} KB)`);
        await draw(host);
      } else if (b.dataset.d === "export") {
        const h = await api.get("/api/home");
        exportMenu(b, { all: true, filters: {}, total: h.contacts.total });
      }
    } catch (err) { fail(err); b.disabled = false; }
  });
});
