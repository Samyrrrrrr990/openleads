/* =========================================================================
   Import & enrich — bring your own list. "Enrich" runs the email waterfall on
   rows that need an address; further tabs (CSV import) register themselves.
   ========================================================================= */
import { $, api, esc, fail, fmt, ico, onAct, router, ui } from "../core.js";
import { writeEmails } from "../actions.js";

let ROOT = null;
let TAB = "enrich";
const E = { leads: [], running: false };
const tabs = [];
let PREFILL = "";
export function registerEnrichTab(key, label, render) { tabs.push({ key, label, render }); }

/** Open the Enrich tab with rows already pasted in (from an import). */
export function openEnrichWith(csv) {
  PREFILL = csv; TAB = "enrich";
  if (router.current()?.name === "enrich") { history.replaceState(null, "", "#/enrich/enrich"); render(); }
  else router.go("enrich", "enrich");
}

function enrichBody() {
  return `<div class="grid grid-main-side">
    <div class="card"><div class="card__head"><h3>Enrich a list</h3></div>
      <div class="card__body stack">
        <p class="muted">Paste CSV with a header row. Any mix of <code>name</code>, <code>company</code>, <code>domain</code> and <code>email</code> works: rows with an email are verified; rows with a name and domain get their address found; domain-only rows get the company's people.</p>
        <textarea class="textarea input--mono" id="enrich-csv" rows="9" placeholder="name,company,domain&#10;Jane Smith,Acme,acme.com&#10;John Doe,,beta.io">${esc(PREFILL)}</textarea>
        ${PREFILL ? `<p class="hint">${fmt.plural(PREFILL.split("\n").length - 1, "row")} from your import that had no email. Press Enrich to find them.</p>` : ""}
        <div class="row">${ui.switch("deep", false, "Deep harvest (slower, more ground truth)")}<span class="spacer"></span>
          <button class="btn btn--primary" data-act="enrich" ${E.running ? "disabled" : ""}>${ico("spark")} Enrich</button></div>
        <div class="console hidden" id="enrich-log"></div>
      </div></div>
    <div class="card card--pad stack"><h3>What happens</h3>
      <div class="kv"><dt>Email given</dt><dd>Verified: MX, SPF/DMARC, Gravatar, SMTP where port 25 is open.</dd>
      <dt>Name + domain</dt><dd>Address found from the company's published pattern, then verified.</dd>
      <dt>Domain only</dt><dd>People discovered from team pages, then the same waterfall.</dd>
      <dt>Saved to</dt><dd>People, with seniority, department and fit score.</dd></div></div>
  </div>
  <div id="enrich-out" class="mt-lg">${results()}</div>`;
}

function results() {
  if (!E.leads.length) return "";
  const safe = E.leads.filter((l) => l.tier === "safe").length;
  return `<div class="card"><div class="card__head"><h3>${fmt.plural(E.leads.length, "row")} enriched</h3>
    <span class="muted">${fmt.num(safe)} deliverable</span>
    <div class="actions"><button class="btn btn--sm" data-act="write">${ico("compose")} Write to safe ones</button>
    <a class="btn btn--sm" href="#/people?sort=updated">${ico("users")} Open People</a></div></div>
    <div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Person</th><th>Email</th><th>Company</th><th>Tier</th></tr></thead><tbody>
    ${E.leads.map((l) => `<tr><td class="t-strong">${esc(ui.name(l) || "—")}</td><td><div class="cell-email">${l.email ? ui.mark(l.evidence, l.tier) : ""}<span class="addr">${esc(l.email || "—")}</span></div></td>
      <td class="muted">${esc(l.organization || "")}</td><td>${ui.tier(l.tier)}</td></tr>`).join("")}</tbody></table></div></div>`;
}

function render() {
  const all = [["enrich", "Enrich a list"], ...tabs.map((t) => [t.key, t.label])];
  const ext = tabs.find((t) => t.key === TAB);
  ROOT.innerHTML = `<section class="page">
    <div class="head"><div><div class="head__title"><h1>Import & enrich</h1></div>
      <p class="head__sub">Import a spreadsheet, or find and verify emails for a list of people.</p></div></div>
    ${all.length > 1 ? `<div class="tabs" style="border-bottom:1px solid var(--line);margin-bottom:16px">${all.map(([k, l]) =>
      `<button type="button" class="${TAB === k ? "is-on" : ""}" data-act="tab" data-k="${k}">${esc(l)}</button>`).join("")}</div>` : ""}
    <div id="tab-body">${ext ? "" : enrichBody()}</div></section>`;
  if (ext) ext.render($("#tab-body", ROOT));
  PREFILL = "";
}

async function enrich() {
  const csv = $("#enrich-csv", ROOT)?.value.trim();
  if (!csv) { fail("Paste a list first."); return; }
  E.leads = []; E.running = true;
  const log = $("#enrich-log", ROOT); log.classList.remove("hidden"); log.innerHTML = "";
  const line = (h) => { log.insertAdjacentHTML("beforeend", `<div>${h}</div>`); log.scrollTop = log.scrollHeight; };
  try {
    await api.stream("/api/enrich", { rows: csv, deep: $("input[name=deep]", ROOT)?.checked }, (ev) => {
      if (ev.type === "phase") line(`<span class="c-mut">◆</span> ${esc(ev.message)}`);
      else if (ev.type === "lead") { E.leads.push(ev.lead); line(`  ${esc(ev.lead.tier)} ${esc(ev.lead.email || "—")}`); }
      else if (ev.type === "done") { E.leads = ev.leads || E.leads; line(`<span class="c-ok">→ ${ev.safe} deliverable of ${ev.count}</span>`); }
      else if (ev.type === "error") line(`<span class="c-red">[!] ${esc(ev.message)}</span>`);
    });
  } catch (e) { fail(e); }
  E.running = false;
  $("#enrich-out", ROOT).innerHTML = results();
}

router.register("enrich", {
  title: "Import & enrich",
  mount(root, ctx) {
    ROOT = root;
    if (ctx.id) TAB = ctx.id;
    render();
    onAct(root, {
      tab: (el) => { TAB = el.dataset.k; history.replaceState(null, "", `#/enrich/${TAB}`); render(); },
      enrich,
      write: () => writeEmails(E.leads.filter((l) => l.tier === "safe")),
    });
  },
});
