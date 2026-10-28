/* =========================================================================
   Settings — every knob in one place, grouped into tabs. Secrets are stored
   chmod 600 on this machine and only ever shown masked here.
   ========================================================================= */
import { $, $$, api, esc, fail, ico, onAct, router, store, toast, ui } from "../core.js";

const GROUPS = {
  sender: ["Sender identity", "Who the emails are from and what you're offering. Drafts and templates use these."],
  mailbox: ["Mailbox", "Your SMTP account (app password, not your login). IMAP is optional and lets replies and bounces stop sequences automatically."],
  sending: ["Sending policy", "Deliverability guardrails: daily cap, warmup ramp, pacing, and whether risky addresses may be emailed."],
  ai: ["AI writing", "Optional free LLM (OpenRouter) for personalized drafts and plain-English queries."],
  discover: ["Discovery", "Optional keys that raise public API limits."],
  integrations: ["Integrations", "Where exports and alerts go: webhooks, Notion, Airtable, HubSpot."],
  web: ["Dashboard", "This local web app."],
};
let ROOT = null;
let TAB = "sender";
let PRESETS = {};
const extraTabs = [];      // other modules (ICP scoring, …) register tabs here

export function registerSettingsTab(key, label, render) { extraTabs.push({ key, label, render }); }

function control(s) {
  const id = `set-${s.key}`;
  if (s.type === "bool") return ui.switch(s.key, !!s.value, s.value ? "On" : "Off", `data-set="${s.key}" id="${id}"`);
  if (s.choices && s.choices.length) {
    return `<select class="select" id="${id}" data-set="${s.key}">${s.choices.map((c) =>
      `<option ${String(s.value) === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
  }
  const ph = s.secret ? (s.is_set ? "•••• stored — type to replace" : "not set") : String(s.default ?? "");
  const type = s.secret ? "password" : s.type === "int" ? "number" : "text";
  return `<input class="input ${s.secret || s.key.includes("id") ? "input--mono" : ""}" id="${id}" data-set="${s.key}"
    type="${type}" placeholder="${esc(ph)}" value="${s.secret ? "" : esc(s.value ?? "")}" autocomplete="off"/>`;
}

function groupHtml(g) {
  const items = (store.state?.settings || []).filter((s) => s.group === g);
  const [title, desc] = GROUPS[g] || [g, ""];
  return `<div class="card"><div class="card__head"><div><h3>${esc(title)}</h3><p class="hint" style="margin-top:2px">${esc(desc)}</p></div></div>
    <div class="card__body stack">${items.map((s) => `
      <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:16px;align-items:center">
        <div><label for="set-${s.key}" class="t-strong" style="font-weight:600">${esc(s.key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()))}</label>
          <div class="hint">${esc(s.description)}${s.source === "env" ? ' <span class="badge badge--sm badge--info">from env</span>' : ""}</div></div>
        <div>${control(s)}</div></div>`).join('<div class="divider" style="margin:2px 0"></div>')}
    </div>
    <div class="modal__foot" style="border-radius:0 0 14px 14px"><span class="hint" id="save-hint"></span>
      <button class="btn btn--primary" data-act="save">${ico("check")} Save changes</button></div></div>`;
}

function render() {
  const groups = store.state?.groups || Object.keys(GROUPS);
  const order = ["sender", "mailbox", "sending", "ai", "discover", "integrations", "web"].filter((g) => groups.includes(g));
  const tabs = [...order.map((g) => [g, (GROUPS[g] || [g])[0]]), ...extraTabs.map((t) => [t.key, t.label])];
  const extra = extraTabs.find((t) => t.key === TAB);
  ROOT.innerHTML = `<section class="page">
    <div class="head"><div><div class="head__title"><h1>Settings</h1></div>
      <p class="head__sub">Saved to <code>~/.openleads</code> on this machine. Passwords and keys are never sent back to the browser.</p></div>
      <div class="head__actions"><a class="btn" href="#/doctor">${ico("doctor")} Run Doctor</a></div></div>
    <div class="tabs" style="border-bottom:1px solid var(--line);margin-bottom:16px">${tabs.map(([k, l]) =>
      `<button type="button" class="${TAB === k ? "is-on" : ""}" data-act="tab" data-k="${k}">${esc(l)}</button>`).join("")}</div>
    <div id="tab-body">${extra ? "" : groupHtml(TAB)}</div></section>`;
  if (extra) extra.render($("#tab-body", ROOT));
}

async function save() {
  const values = {};
  $$("[data-set]", ROOT).forEach((el) => {
    const k = el.dataset.set;
    if (el.type === "checkbox") values[k] = el.checked;
    else if (el.type === "password") { if (el.value) values[k] = el.value; }
    else values[k] = el.value;
  });
  try {
    const res = await api.post("/api/settings", { values });
    store.state.settings = res.settings; store.state.identity = res.identity;
    const bad = Object.keys(res.errors || {});
    if (bad.length) toast(`Couldn't save: ${bad.join(", ")}`, "err"); else toast("Settings saved");
    render();
  } catch (e) { fail(e); }
}

router.register("settings", {
  title: "Settings",
  async mount(root, ctx) {
    ROOT = root;
    if (ctx.id) TAB = ctx.id;
    try { PRESETS = (await api.get("/api/providers")).presets || {}; } catch (_) { PRESETS = {}; }
    try { const s = await api.get("/api/settings"); Object.assign(store.state, s); } catch (_) { /* keep boot copy */ }
    render();
    onAct(root, {
      tab: (el) => { TAB = el.dataset.k; history.replaceState(null, "", `#/settings/${TAB}`); render(); },
      save,
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.set === "smtp_provider" && PRESETS[t.value]) {
        const p = PRESETS[t.value];
        const host = $("#set-smtp_host", root), port = $("#set-smtp_port", root);
        if (host && p.host) host.value = p.host;
        if (port && p.port) port.value = p.port;
        const hint = $("#save-hint", root); if (hint && p.help) hint.textContent = p.help;
      }
      if (t.type === "checkbox" && t.dataset.set) {
        const lab = t.closest(".switch")?.querySelector(".switch__label"); if (lab) lab.textContent = t.checked ? "On" : "Off";
      }
    });
  },
});
