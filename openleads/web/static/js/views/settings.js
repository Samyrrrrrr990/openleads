/* =========================================================================
   Settings — every knob in one place, grouped into tabs. Secrets are stored
   chmod 600 on this machine and only ever shown masked here.
   ========================================================================= */
import { $, $$, api, esc, fail, ico, onAct, router, store, toast, ui } from "../core.js";

const GROUPS = {
  sender: ["Sender identity", "Who the emails are from, what you're offering and your proof. Drafts and templates use these, and never invent anything you didn't write here."],
  mailbox: ["Mailbox", "Your SMTP account (app password, not your login). IMAP is optional and lets replies and bounces stop sequences automatically."],
  sending: ["Sending policy", "Deliverability guardrails: daily cap, warmup ramp, pacing, and whether risky addresses may be emailed."],
  ai: ["AI model", "The model OpenLeads thinks with: it reads your requests, writes drafts and sorts replies. Use a Claude or ChatGPT subscription you already have (through the claude or codex command), an API key, or a free model (OpenRouter, Ollama, any OpenAI-compatible endpoint). With none, built-in rules do the work. Every draft is still checked against what we know about the lead."],
  discover: ["Discovery", "Optional keys that raise public API limits."],
  integrations: ["Integrations", "Where exports and alerts go: webhooks, Notion, Airtable, HubSpot."],
  web: ["Dashboard", "This local web app."],
};
// Friendlier names than the setting keys, where the key reads badly.
const LABELS = {
  sender_context: "Your pitch", sender_offer: "Your offer", sender_proof: "Proof",
  writing_tone: "Tone", writing_examples: "Your writing samples", writing_llm: "Use an LLM",
  openrouter_api_key: "OpenRouter API key", openrouter_model: "OpenRouter model",
  ai_base_url: "Custom endpoint URL", ai_api_key: "Custom endpoint key",
  ai_model: "Model for OpenRouter, Ollama or your endpoint", ai_provider_model: "Model for a subscription or key",
  ai_timeout: "LLM timeout (seconds)", ai_provider: "Model",
  anthropic_api_key: "Anthropic API key", openai_api_key: "OpenAI API key", gemini_api_key: "Gemini API key",
};
const KIND = { subscription: "your subscription", "api key": "API key", free: "free" };

async function aiCard(slot) {
  let s;
  try { s = await api.get("/api/ai"); } catch (_) { return; }
  const cur = s.current ? `<b>${esc(s.current.label)}</b>` : (s.problem ? esc(s.problem) : "No model connected. Built-in rules do the work.");
  const found = s.detected.filter((d) => !s.current || d.provider !== s.current.provider);
  slot.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card__body stack">
    <div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div><div class="hint">Using now</div><div>${cur}</div></div>
      ${s.current ? `<button class="btn btn--sm" data-act="ai-test">${ico("spark")} Test it</button>` : ""}</div>
    ${found.length ? `<div><div class="hint">Found on this computer</div>${found.map((d) =>
      `<div class="row" style="gap:8px;margin-top:6px"><span>${esc(d.label)}</span><span class="badge badge--sm">${esc(KIND[d.kind] || d.kind)}</span>
        <button class="btn btn--sm btn--ghost" data-act="ai-use" data-p="${esc(d.provider)}">Use this</button></div>`).join("")}</div>` : ""}
    <div class="hint" id="ai-test-out">A subscription or paid key is only used after you pick it here or with <code>openleads setup ai</code>.</div>
  </div></div>`;
}
const labelOf = (key) => LABELS[key] || key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
let ROOT = null;
let TAB = "sender";
let PRESETS = {};
const extraTabs = [];      // other modules (ICP scoring, …) register tabs here

export function registerSettingsTab(key, label, render) { extraTabs.push({ key, label, render }); }

function control(s) {
  const id = `set-${s.key}`;
  if (s.type === "bool") return ui.switch(s.key, !!s.value, s.value ? "On" : "Off", `data-set="${s.key}" id="${id}"`);
  if (s.type === "text") {
    return `<textarea class="textarea" id="${id}" data-set="${s.key}" rows="6" placeholder="${esc(s.description)}">${esc(s.value ?? "")}</textarea>`;
  }
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
        <div><label for="set-${s.key}" class="t-strong" style="font-weight:600">${esc(labelOf(s.key))}</label>
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
      <div class="head__actions"><a class="btn btn--ghost" href="#/health">${ico("heart")} Data health</a>
        <a class="btn" href="#/doctor">${ico("doctor")} Run Doctor</a></div></div>
    <div class="tabs" style="border-bottom:1px solid var(--line);margin-bottom:16px">${tabs.map(([k, l]) =>
      `<button type="button" class="${TAB === k ? "is-on" : ""}" data-act="tab" data-k="${k}">${esc(l)}</button>`).join("")}</div>
    ${TAB === "ai" ? '<div id="ai-card"></div>' : ""}
    <div id="tab-body">${extra ? "" : groupHtml(TAB)}</div></section>`;
  if (extra) extra.render($("#tab-body", ROOT));
  if (TAB === "ai") aiCard($("#ai-card", ROOT));
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
      "ai-use": async (el) => {
        // Test before saving, like `openleads setup ai`: a model that can't answer isn't kept.
        const out = $("#ai-test-out", ROOT);
        el.disabled = true; out.textContent = "Testing it...";
        try {
          const r = await api.post("/api/ai/use", { provider: el.dataset.p });
          if (!r.ok) { out.textContent = `Not switched: ${r.detail}`; el.disabled = false; return; }
          toast("Model connected");
          const s = await api.get("/api/settings"); Object.assign(store.state, s);
          render();
        } catch (e) { el.disabled = false; fail(e); }
      },
      "ai-test": async (el) => {
        const out = $("#ai-test-out", ROOT);
        el.disabled = true; out.textContent = "Asking the model...";
        try {
          const r = await api.post("/api/ai/test", {});
          out.textContent = r.ok ? `Working: ${r.detail}` : `Not working: ${r.detail}`;
        } catch (e) { fail(e); } finally { el.disabled = false; }
      },
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
