/* =========================================================================
   Deals — the pipeline as a drag-and-drop board (or a table), with open,
   weighted and won totals. Moving a deal to Won makes its contact and
   company customers. #/deals/<id> opens a deal's record.
   ========================================================================= */
import { $, $$, api, confirmDialog, drawer, esc, fail, fmt, ico, modal, onAct, router, store, toast, ui } from "../core.js";
import { timeline } from "../timeline.js";

const D = { view: "board", q: "", board: null, open: null };
let ROOT = null;

const isOpenStage = (k) => !["won", "lost"].includes(k);
const today = () => new Date().toISOString().slice(0, 10);

function card(d) {
  const late = d.close_date && isOpenStage(d.stage) && d.close_date < today();
  const stale = isOpenStage(d.stage) && d.updated && Date.now() / 1000 - d.updated > 14 * 86400;
  return `<div class="deal-card" draggable="true" data-deal="${d.id}" tabindex="0">
    <div class="row" style="gap:8px;align-items:flex-start"><b class="deal-card__name" title="${esc(d.name)}">${esc(d.name)}</b>
      ${stale ? `<span class="faint" title="No change in ${Math.floor((Date.now() / 1000 - d.updated) / 86400)} days">${ico("clock", "ico--sm")}</span>` : ""}</div>
    ${d.account || d.account_name ? `<div class="row hint" style="gap:6px">${ui.companyAvatar(d.account_name || d.account, "avatar--xs")}<span class="ellipsis">${esc(d.account_name || d.account)}</span></div>` : ""}
    <div class="row" style="gap:6px"><span class="deal-card__amt">${d.amount ? esc(fmt.money(d.amount, d.currency)) : '<span class="faint">No amount</span>'}</span>
      <span class="spacer"></span>${d.close_date ? `<span class="hint" style="${late ? "color:var(--bad)" : ""}" title="Expected close">${ico("calendar", "ico--sm")} ${esc(fmt.date(Date.parse(d.close_date + "T12:00:00") / 1000))}</span>` : ""}</div>
    ${d.contact ? `<div class="hint ellipsis">${ico("user", "ico--sm")} ${esc(d.contact_name || d.contact)}</div>` : ""}
  </div>`;
}

function boardHtml() {
  const b = D.board;
  return `<div class="board">${b.columns.map((c) => `
    <div class="board__col board__col--${c.key}" data-col="${c.key}">
      <div class="board__head"><div class="row"><i class="stage-dot stage-dot--${c.key}"></i><b>${esc(c.label)}</b><span class="faint">${c.count}</span>
        <span class="spacer"></span>${isOpenStage(c.key) ? `<span class="hint" title="Win probability">${c.probability}%</span>` : ""}</div>
        <div class="hint ellipsis" title="${esc(fmt.money(c.total))}${isOpenStage(c.key) ? ` total · ${esc(fmt.money(c.weighted))} weighted` : ""}">${esc(fmt.moneyCompact(c.total))}${isOpenStage(c.key) && c.total ? ` · ${esc(fmt.moneyCompact(c.weighted))} weighted` : ""}</div></div>
      <div class="board__items" data-drop="${c.key}">${c.deals.map(card).join("")}
        ${isOpenStage(c.key) ? `<button class="board__add" data-act="new" data-stage="${c.key}">${ico("plus", "ico--sm")} Add deal</button>` : ""}</div>
    </div>`).join("")}</div>`;
}

function tableHtml() {
  const rows = D.board.columns.flatMap((c) => c.deals);
  if (!rows.length) return `<div class="card">${ui.empty("deal", "No deals match", "")}</div>`;
  return `<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Deal</th><th>Stage</th><th>Company</th><th>Contact</th>
    <th class="col-num">Amount</th><th class="col-num">Weighted</th><th>Close date</th><th>Updated</th></tr></thead><tbody>
    ${rows.map((d) => {
      const col = D.board.columns.find((c) => c.key === d.stage);
      const w = isOpenStage(d.stage) ? (d.amount || 0) * (col?.probability || 0) / 100 : d.stage === "won" ? d.amount : 0;
      return `<tr class="is-click" data-deal="${d.id}"><td class="t-strong">${esc(d.name)}</td>
        <td><span class="row" style="gap:6px"><i class="stage-dot stage-dot--${d.stage}"></i>${esc(store.label("deal_stages", d.stage))}</span></td>
        <td>${esc(d.account_name || d.account || "—")}</td><td>${esc(d.contact_name || d.contact || "—")}</td>
        <td class="col-num">${esc(fmt.money(d.amount || 0, d.currency))}</td><td class="col-num">${esc(fmt.money(w || 0, d.currency))}</td>
        <td>${d.close_date ? esc(d.close_date) : "—"}</td><td class="muted">${esc(fmt.rel(d.updated))}</td></tr>`;
    }).join("")}</tbody></table></div></div>`;
}

function render() {
  const t = D.board.totals;
  ROOT.innerHTML = `<section class="page page--wide">
    <div class="head"><div><div class="head__title"><h1>Deals</h1></div>
      <p class="head__sub">Your pipeline from first meeting to signed. Drag a deal between stages; winning one marks its contact and company as customers.</p></div>
      <div class="head__actions"><button class="btn btn--primary" data-act="new">${ico("plus")} New deal</button></div></div>
    <div class="grid grid-4 mb">
      <div class="card stat"><div class="stat__label">${ico("layers", "ico--sm")} Open pipeline</div><div class="stat__value">${esc(fmt.money(t.open_value))}</div><div class="hint">${fmt.plural(t.open_count, "open deal")}</div></div>
      <div class="card stat"><div class="stat__label">${ico("chart", "ico--sm")} Weighted forecast</div><div class="stat__value">${esc(fmt.money(t.weighted))}</div><div class="hint">value × stage probability</div></div>
      <div class="card stat"><div class="stat__label">${ico("star", "ico--sm")} Won</div><div class="stat__value">${esc(fmt.money(t.won_value))}</div><div class="hint">${fmt.plural(t.won_count, "deal")}</div></div>
      <div class="card stat"><div class="stat__label">${ico("flag", "ico--sm")} Win rate</div><div class="stat__value">${fmt.pct(t.win_rate)}</div><div class="hint">${t.won_count} won · ${t.lost_count} lost</div></div>
    </div>
    <div class="toolbar toolbar--bare mb">
      <div class="seg">${[["board", "Board", "columns"], ["table", "Table", "table"]].map(([k, l, i]) =>
        `<button type="button" class="${D.view === k ? "is-on" : ""}" data-act="view" data-k="${k}">${ico(i, "ico--sm")} ${l}</button>`).join("")}</div>
      <span class="spacer"></span>
      <div class="search-input">${ico("find", "ico--sm")}<input class="input input--sm" id="deal-q" placeholder="Search deals or companies" value="${esc(D.q)}"/></div>
    </div>
    <div id="deal-body">${D.view === "board" ? boardHtml() : tableHtml()}</div>
  </section>`;
}

async function load() { D.board = await api.get("/api/deals", { q: D.q }); }
async function reload() { await load(); const body = $("#deal-body", ROOT); if (body) body.innerHTML = D.view === "board" ? boardHtml() : tableHtml(); else render(); refreshTotals(); }
function refreshTotals() { /* totals live in the header cards; re-render cheaply */
  const q = $("#deal-q", ROOT); const had = document.activeElement === q; const pos = q?.selectionStart;
  render(); if (had) { const n = $("#deal-q", ROOT); n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) { /* */ } }
}

function dealForm(d = {}, { focus = true } = {}) {
  return `<div class="form-grid">
    <div class="field span-2"><label>Name</label><input class="input" name="name" value="${esc(d.name || "")}" placeholder="Acme — annual plan" ${focus ? "autofocus" : ""}/></div>
    <div class="field"><label>Amount</label><input class="input" name="amount" value="${d.amount ? esc(d.amount) : ""}" placeholder="12,000 or 2.5k"/></div>
    <div class="field"><label>Stage</label><select class="select" name="stage">${(store.meta?.deal_stages || []).map((s) =>
      `<option value="${s.key}" ${s.key === (d.stage || "qualify") ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>
    <div class="field"><label>Company domain</label><input class="input" name="account" value="${esc(d.account || "")}" placeholder="acme.com"/></div>
    <div class="field"><label>Contact email</label><input class="input" name="contact" value="${esc(d.contact || "")}" placeholder="jane@acme.com"/></div>
    <div class="field"><label>Expected close</label><input class="input" type="date" name="close_date" value="${esc(d.close_date || "")}"/></div>
    <div class="field"><label>Owner</label><input class="input" name="owner" value="${esc(d.owner || "")}" placeholder="optional"/></div>
    <div class="field span-2"><label>Note</label><textarea class="textarea" name="note" rows="3">${esc(d.note || "")}</textarea></div></div>`;
}
const formBody = (f) => ({ name: f.name.value, amount: f.amount.value, stage: f.stage.value, account: f.account.value,
  contact: f.contact.value, close_date: f.close_date.value, owner: f.owner.value, note: f.note.value });

async function newDeal(stage) {
  await modal({ title: "New deal", body: dealForm({ stage }),
    actions: [{ label: "Cancel", value: null }, { label: "Create deal", kind: "primary", submit: true }],
    onSubmit: async (f) => { await api.post("/api/deals/save", formBody(f)); toast("Deal created"); await reload(); return true; } });
}

async function openDeal(id) {
  const deal = D.board.columns.flatMap((c) => c.deals).find((x) => String(x.id) === String(id))
    || (await api.get("/api/deals", {})).columns.flatMap((c) => c.deals).find((x) => String(x.id) === String(id));
  if (!deal) { toast("That deal no longer exists", "err"); router.go("deals", "", null, { replace: true }); return; }
  const d = drawer({ onClose: () => { D.open = null; if (router.current()?.ctx?.id) router.go("deals", "", null, { replace: true }); } });
  D.open = d;
  const acts = (await api.get("/api/activity", { ref_type: "deal", ref: String(deal.id), limit: 50 })).activity || [];
  const stages = store.meta?.deal_stages || [];
  d.el.innerHTML = `<div class="drawer__head"><div class="drawer__top">
      <span class="tl-icon tl-icon--good" style="width:40px;height:40px">${ico("deal")}</span>
      <div class="drawer__title"><h2>${esc(deal.name)}</h2><div class="sub">${esc(deal.account_name || deal.account || "No company")} · ${esc(fmt.money(deal.amount || 0, deal.currency))}</div></div>
      <button class="btn btn--ghost btn--icon btn--sm" data-d="close">${ico("x")}</button></div>
      <div class="stage-track">${stages.map((s) => `<button type="button" class="stage-track__step ${s.key === deal.stage ? "is-on" : ""} stage-track__step--${s.key}" data-move="${s.key}">${esc(s.label)}</button>`).join("")}</div>
    </div>
    <div class="drawer__body"><form class="stack" data-deal-form>${dealForm(deal, { focus: false })}
      <div class="row"><button class="btn btn--ghost" type="button" data-d="delete" style="color:var(--bad)">${ico("trash")} Delete</button><span class="spacer"></span>
        ${deal.contact ? `<a class="btn" href="#/people/${encodeURIComponent(deal.contact)}">${ico("user")} Contact</a>` : ""}
        ${deal.account ? `<a class="btn" href="#/companies/${encodeURIComponent(deal.account)}">${ico("building")} Company</a>` : ""}
        <button class="btn btn--primary" type="submit">${ico("check")} Save</button></div></form>
      <h3 class="mt-lg mb">Activity</h3>${timeline(acts)}</div>`;
  d.el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-d], [data-move]"); if (!b) return;
    try {
      if (b.dataset.d === "close") d.close();
      else if (b.dataset.d === "delete") {
        if (await confirmDialog(`Delete '${deal.name}'?`, { ok: "Delete", danger: true })) { await api.post("/api/deals/delete", { id: deal.id }); toast("Deal deleted"); d.close(); await reload(); }
      } else if (b.dataset.move && b.dataset.move !== deal.stage) {
        await api.post("/api/deals/move", { id: deal.id, stage: b.dataset.move });
        toast(`Moved to ${store.label("deal_stages", b.dataset.move)}`); d.close(); await reload(); openDeal(deal.id);
      }
    } catch (err) { fail(err); }
  });
  d.el.querySelector("[data-deal-form]").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api.post("/api/deals/save", { id: deal.id, ...formBody(e.target) }); toast("Deal saved"); d.close(); await reload(); }
    catch (err) { fail(err); }
  });
}

/* ------------------------------------------------------------ drag & drop */
function bindDnd(root) {
  let dragId = null;
  root.addEventListener("dragstart", (e) => {
    const c = e.target.closest?.(".deal-card"); if (!c) return;
    dragId = c.dataset.deal; c.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId);
  });
  root.addEventListener("dragend", () => { $$(".is-dragging, .is-over", root).forEach((x) => x.classList.remove("is-dragging", "is-over")); $$(".drop-marker", root).forEach((m) => m.remove()); dragId = null; });
  const afterCard = (zone, y) => {
    const cards = $$(".deal-card:not(.is-dragging)", zone);
    return cards.find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
  };
  root.addEventListener("dragover", (e) => {
    const zone = e.target.closest?.("[data-drop]"); if (!zone || !dragId) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    $$(".board__col.is-over", root).forEach((x) => x !== zone.parentElement && x.classList.remove("is-over"));
    zone.parentElement.classList.add("is-over");
    let m = $(".drop-marker", root);
    if (!m) { m = document.createElement("div"); m.className = "drop-marker"; }
    const before = afterCard(zone, e.clientY);
    if (before) zone.insertBefore(m, before); else zone.insertBefore(m, $(".board__add", zone) || null);
  });
  root.addEventListener("drop", async (e) => {
    const zone = e.target.closest?.("[data-drop]"); if (!zone || !dragId) return;
    e.preventDefault();
    const stage = zone.dataset.drop;
    const col = D.board.columns.find((c) => c.key === stage);
    const marker = $(".drop-marker", zone);
    const next = marker?.nextElementSibling?.classList.contains("deal-card") ? marker.nextElementSibling : null;
    const prev = marker?.previousElementSibling?.classList.contains("deal-card") ? marker.previousElementSibling : null;
    const pos = (el) => col.deals.find((x) => String(x.id) === el.dataset.deal)?.position ?? 0;
    let position = null;
    if (prev && prev.dataset.deal !== dragId && next && next.dataset.deal !== dragId) position = (pos(prev) + pos(next)) / 2;
    else if (next && next.dataset.deal !== dragId) position = pos(next) - 1;
    else if (prev && prev.dataset.deal !== dragId) position = pos(prev) + 1;
    const id = dragId;
    try {
      const moved = D.board.columns.flatMap((c) => c.deals).find((x) => String(x.id) === id);
      await api.post("/api/deals/move", { id, stage, position });
      if (moved && moved.stage !== stage) toast(stage === "won" ? `Won ${moved.name} 🎉` : `Moved to ${col.label}`);
      await reload();
    } catch (err) { fail(err); }
  });
  // Keyboard: focus a card, then [ / ] moves it to the previous / next stage.
  root.addEventListener("keydown", async (e) => {
    const c = e.target.closest?.(".deal-card"); if (!c) return;
    if (e.key === "Enter") { openDeal(c.dataset.deal); return; }
    if (e.key !== "[" && e.key !== "]") return;
    const keys = D.board.columns.map((x) => x.key);
    const deal = D.board.columns.flatMap((x) => x.deals).find((x) => String(x.id) === c.dataset.deal);
    const j = keys.indexOf(deal.stage) + (e.key === "]" ? 1 : -1);
    if (j < 0 || j >= keys.length) return;
    try { await api.post("/api/deals/move", { id: deal.id, stage: keys[j] }); await reload(); $(`.deal-card[data-deal="${deal.id}"]`, root)?.focus(); }
    catch (err) { fail(err); }
  });
}

router.register("deals", {
  title: "Deals",
  async mount(root, ctx) {
    ROOT = root;
    D.view = store.pref("deals-view", "board");
    root.innerHTML = `<div class="page">${ui.skeleton(8)}</div>`;
    await load(); render();
    onAct(root, {
      new: (el) => newDeal(el.dataset.stage),
      view: (el) => { D.view = el.dataset.k; store.setPref("deals-view", D.view); render(); },
    });
    root.addEventListener("click", (e) => {
      const c = e.target.closest("[data-deal]");
      if (c && !e.target.closest("a, button")) router.go("deals", c.dataset.deal);
    });
    let timer = null;
    root.addEventListener("input", (e) => {
      if (e.target.id !== "deal-q") return;
      clearTimeout(timer); timer = setTimeout(async () => { D.q = e.target.value; await load(); refreshTotals(); }, 200);
    });
    bindDnd(root);
    if (ctx.id) openDeal(ctx.id);
  },
  update(ctx) { if (ctx.id && !D.open) openDeal(ctx.id); },
  unmount() { D.open && D.open.close(); D.open = null; },
});
