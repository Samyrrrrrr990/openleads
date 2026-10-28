/* =========================================================================
   Recipes & watchers — saved searches that run themselves. A recipe is an
   ICP + pitch + schedule (find → write → send → export); a watcher reports only
   new matches. Both fire from the on-device heartbeat (`openleads schedule on`).
   ========================================================================= */
import { $, api, confirmDialog, esc, fail, fmt, ico, onAct, router, toast, ui } from "../core.js";

const SINKS = ["csv", "json", "ndjson", "sheets", "webhook", "notion", "airtable", "hubspot"];
let ROOT = null;
let DATA = { recipes: [], watchers: {} };

async function load() {
  const [r, w] = await Promise.all([api.get("/api/recipes"), api.get("/api/watchers")]);
  DATA = { recipes: r.recipes || [], watchers: w.watchers || {} };
}

function render() {
  const watchers = Object.values(DATA.watchers);
  ROOT.innerHTML = `<section class="page">
    <div class="head"><div><div class="head__title"><h1>Recipes & watchers</h1></div>
      <p class="head__sub">A recipe finds, writes, sends and exports on a schedule. A watcher tells you only when new leads match. Both run on this machine once <code>openleads schedule on</code> is set up.</p></div></div>
    <div class="card">
      <div class="card__head"><h3>${ico("robot")} Recipes</h3><span class="muted">${fmt.num(DATA.recipes.length)}</span></div>
      <form class="card__body form-grid" data-form="recipe" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="field"><label>Name</label><input class="input" name="name" placeholder="miami-agencies" required/></div>
        <div class="field" style="grid-column:span 2"><label>Audience</label><input class="input" name="query" placeholder="marketing agencies in Miami" required/></div>
        <div class="field"><label>When</label><input class="input input--mono" name="schedule" placeholder="weekdays 9am"/></div>
        <div class="field" style="grid-column:span 2"><label>Pitch (optional)</label><input class="input" name="context" placeholder="our local SEO service"/></div>
        <div class="field"><label>Leads per run</label><input class="input input--mono" name="count" type="number" value="25" min="1"/></div>
        <div class="field"><label>Export to</label><select class="select" name="sink"><option value="">— none —</option>${SINKS.map((s) => `<option>${s}</option>`).join("")}</select></div>
        <div class="row" style="grid-column:1/-1">${ui.switch("send", false, "Sends email on scheduled runs")}<span class="spacer"></span>
          <button class="btn btn--primary" type="submit">${ico("check")} Save recipe</button></div>
      </form>
      ${DATA.recipes.length ? `<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Name</th><th>Audience</th><th>When</th><th>Mode</th><th>Export</th><th class="col-num"></th></tr></thead><tbody>
        ${DATA.recipes.map((r) => `<tr><td class="t-strong">${esc(r.name)}</td><td class="muted">${esc(r.query)}, ${r.count} leads</td>
          <td>${r.enabled ? `<span class="badge badge--info">${esc(r.when || r.schedule || "scheduled")}</span>` : '<span class="badge">manual</span>'}</td>
          <td>${r.send ? '<span class="badge badge--accent">sends</span>' : '<span class="badge">finds</span>'}</td>
          <td class="muted">${r.export ? esc(r.export.sink) : "—"}</td>
          <td class="col-num"><div class="row" style="justify-content:flex-end">
            <button class="btn btn--sm" data-act="run" data-name="${esc(r.name)}">${ico("play")} Test run</button>
            <button class="btn btn--sm btn--ghost btn--icon" data-act="del" data-name="${esc(r.name)}" title="Delete">${ico("trash")}</button></div></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card__body">${ui.empty("robot", "No recipes yet", "Save one above to automate an outreach play.")}</div>`}
      <div id="recipe-out"></div>
    </div>
    <div class="card mt-lg">
      <div class="card__head"><h3>${ico("eye")} Watchers</h3><span class="muted">${fmt.num(watchers.length)}</span></div>
      <form class="card__body form-grid" data-form="watch" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="field"><label>Name</label><input class="input" name="name" placeholder="new-miami-agencies" required/></div>
        <div class="field" style="grid-column:span 2"><label>Watch for</label><input class="input" name="query" placeholder="marketing agencies in Miami" required/></div>
        <div class="field"><label>Deliver new to</label><select class="select" name="sink">${["csv", "json", "ndjson", "webhook"].map((s) => `<option>${s}</option>`).join("")}</select></div>
        <div class="row" style="grid-column:1/-1;justify-content:flex-end"><button class="btn btn--primary" type="submit">${ico("check")} Save watcher</button></div>
      </form>
      ${watchers.length ? `<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Name</th><th>Query</th><th>Sink</th><th class="col-num">Seen</th><th></th></tr></thead><tbody>
        ${watchers.map((w) => `<tr><td class="t-strong">${esc(w.name)}</td><td class="muted">${esc(w.query)}</td><td>${esc(w.sink || "csv")}</td>
          <td class="col-num">${fmt.num((w.seen || []).length)}</td>
          <td class="col-num"><button class="btn btn--sm btn--ghost btn--icon" data-act="wdel" data-name="${esc(w.name)}">${ico("trash")}</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card__body">${ui.empty("eye", "No watchers", "Get alerted when fresh leads match your niche.")}</div>`}
    </div></section>`;
}

router.register("automations", {
  title: "Recipes & watchers",
  async mount(root) {
    ROOT = root;
    root.innerHTML = `<div class="page">${ui.skeleton(6)}</div>`;
    await load(); render();
    root.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        if (f.dataset.form === "recipe") {
          const body = { name: f.name.value.trim(), query: f.query.value.trim(), count: +f.count.value || 25,
            context: f.context.value.trim(), send: f.send.checked, schedule: f.schedule.value.trim(),
            enabled: !!f.schedule.value.trim(), export: f.sink.value ? { sink: f.sink.value, target: "" } : null };
          await api.post("/api/recipes/save", body); toast(`Saved recipe '${body.name}'`);
        } else {
          await api.post("/api/watch/save", { name: f.name.value.trim(), query: f.query.value.trim(), sink: f.sink.value });
          toast(`Watching '${f.name.value.trim()}'`);
        }
        await load(); render();
      } catch (err) { fail(err); }
    });
    onAct(root, {
      run: async (el) => {
        const out = $("#recipe-out", root);
        out.innerHTML = '<div class="sweep"></div>';
        await api.stream("/api/recipes/run", { name: el.dataset.name, live: false }, (ev) => {
          if (ev.type === "done") out.innerHTML = `<div class="banner banner--good" style="margin:12px 16px">${ico("check")}<div><b>${esc(el.dataset.name)}</b>: found ${ev.found}, drafted ${ev.drafted}, sent 0 (test run).</div></div>`;
          else if (ev.type === "error") { out.innerHTML = ""; toast(ev.message, "err"); }
        });
      },
      del: async (el) => {
        if (!(await confirmDialog(`Delete the recipe '${el.dataset.name}'?`, { ok: "Delete", danger: true }))) return;
        await api.post("/api/recipes/delete", { name: el.dataset.name }); await load(); render();
      },
      wdel: async (el) => { await api.post("/api/watch/delete", { name: el.dataset.name }); await load(); render(); },
    });
  },
});
