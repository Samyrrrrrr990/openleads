/* =========================================================================
   Compose & send — one-off outreach to a selection: draft every email (free
   LLM, the built-in writer, or one of your templates), edit any of them, then
   preview or send. Dry run by default; live sends are warmup-capped and skip
   suppressed addresses.
   ========================================================================= */
import { $, api, confirmDialog, esc, fail, fmt, ico, onAct, router, store, toast, ui } from "../core.js";

let ROOT = null;
let TEMPLATES = [];
const C = () => (store.compose ||= { leads: [], drafts: [] });

function lintBadge(d) {
  const s = d.lint?.score ?? 0;
  const tone = s < 20 ? "good" : s < 35 ? "warn" : "bad";
  return `<span class="badge badge--${tone}" title="${esc((d.lint?.warnings || []).join(" · ") || "No spam triggers found")}">spam score ${s}</span>`;
}

function render() {
  const c = C();
  const id = store.state?.identity || {};
  if (!c.leads.length && !c.drafts.length) {
    ROOT.innerHTML = `<section class="page">${head()}${ui.empty("send", "Pick who to write to",
      "Select people in <a class='link' href='#/people'>People</a> or <a class='link' href='#/prospect'>Find people</a> and choose <b>Write emails</b>. For multi-step follow-ups, use a <a class='link' href='#/sequences'>sequence</a> instead.",
      `<a class="btn btn--primary" href="#/prospect">${ico("radar")} Find people</a><a class="btn" href="#/people">${ico("users")} Open People</a>`)}</section>`;
    return;
  }
  ROOT.innerHTML = `<section class="page">${head()}
    <div class="grid grid-main-side">
      <div class="stack">
        <div class="card">
          <div class="card__head"><h3>${fmt.plural(c.leads.length || c.drafts.length, "recipient")}</h3>
            <div class="actions"><button class="btn btn--sm btn--ghost" data-act="clear">${ico("x")} Clear</button></div></div>
          <div class="card__body"><div class="tags">${(c.leads.length ? c.leads : c.drafts).slice(0, 24).map((l) =>
            `<span class="tag">${esc(ui.name(l) || l.email)}</span>`).join("")}${(c.leads.length || c.drafts.length) > 24 ? `<span class="tag">+${(c.leads.length || c.drafts.length) - 24} more</span>` : ""}</div>
            <div class="row row--wrap mt" style="gap:10px">
              <select class="select select--sm" name="tpl" style="width:auto;min-width:220px">
                <option value="">${id.llm_configured ? "AI-written (free LLM)" : "Built-in writer"}</option>
                ${TEMPLATES.map((t) => `<option value="${t.id}">Template: ${esc(t.name)}</option>`).join("")}
              </select>
              <button class="btn btn--primary btn--sm" data-act="gen">${ico("spark")} ${c.drafts.length ? "Regenerate" : "Write"} ${fmt.num(c.leads.length || c.drafts.length)} drafts</button>
              <span class="hint">${id.sender_name ? "" : "Tip: set your name and pitch in <a class='link' href='#/settings'>Settings</a> so drafts sign off properly."}</span>
            </div>
          </div>
        </div>
        <div id="drafts" class="stack">${c.drafts.map(draftCard).join("")}</div>
      </div>
      <div class="card" style="position:sticky;top:16px">
        <div class="card__head"><h3>Outbox</h3></div>
        <div class="card__body stack">
          ${id.mailbox_configured ? `<div class="kv"><dt>Mailbox</dt><dd>${esc((store.state.settings || []).find((s) => s.key === "smtp_user")?.value || "connected")}</dd>
            <dt>Deliverability</dt><dd>${esc(store.doctor?.preflight?.grade || "?")}</dd></div>`
            : `<div class="banner banner--warn">${ico("mail")}<div>No mailbox connected. You can preview, but connect one in <a href="#/settings">Settings</a> to send.</div></div>`}
          ${ui.switch("live", false, "Send for real (off = preview)")}
          <button class="btn btn--accent" data-act="send" ${c.drafts.length ? "" : "disabled"}>${ico("send")} <span id="send-label">Preview ${fmt.num(c.drafts.length)} sends</span></button>
          <p class="hint">Plain text, one-click unsubscribe header, no tracking pixels. Live sends respect your daily warmup cap and pace themselves.</p>
          <div class="console hidden" id="send-log"></div>
        </div>
      </div>
    </div></section>`;
}

const head = () => `<div class="head"><div><div class="head__title"><h1>Compose & send</h1></div>
  <p class="head__sub">One-off emails to a selection. Edit anything — your edits are what gets sent.</p></div>
  <div class="head__actions"><a class="btn" href="#/sequences">${ico("sequence")} Use a sequence instead</a></div></div>`;

function draftCard(d, i) {
  return `<div class="card" data-d="${i}">
    <div class="card__head"><span class="row" style="min-width:0">${ico("mail")}<b class="ellipsis">${esc(d.email)}</b></span>
      <span class="faint">${esc(d.model === "template" ? "template" : d.model ? "AI" : "")}</span>
      <div class="actions">${lintBadge(d)}<button class="btn btn--xs btn--ghost" data-act="drop" data-i="${i}" title="Remove">${ico("x")}</button></div></div>
    <div class="card__body stack">
      <input class="input" data-k="subject" data-i="${i}" value="${esc(d.subject)}" aria-label="Subject"/>
      <textarea class="textarea" rows="7" data-k="body" data-i="${i}" aria-label="Body">${esc(d.body)}</textarea>
      ${d.missing?.length ? `<div class="banner banner--warn">${ico("flag")}<div>Blank: ${d.missing.map((m) => `<code>{{${esc(m)}}}</code>`).join(" ")}</div></div>` : ""}
    </div></div>`;
}

async function generate() {
  const c = C();
  const leads = c.leads.length ? c.leads : c.drafts.map((d) => ({ email: d.email, first_name: d.first_name, organization: d.organization }));
  const tplId = $("select[name=tpl]", ROOT)?.value;
  const btn = $('[data-act="gen"]', ROOT); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing…'; }
  try {
    if (tplId) {
      const t = TEMPLATES.find((x) => String(x.id) === tplId);
      c.drafts = [];
      for (const l of leads) {
        const r = await api.post("/api/templates/preview", { subject: t.subject, body: t.body, email: l.email });
        c.drafts.push({ ...r.draft, email: l.email, missing: r.missing });
      }
    } else {
      const r = await api.post("/api/write", { leads });
      c.drafts = r.drafts || [];
    }
    toast(`${fmt.num(c.drafts.length)} drafts ready`);
  } catch (e) { fail(e); }
  render();
}

async function send() {
  const c = C();
  const live = $("input[name=live]", ROOT)?.checked;
  if (live && !(await confirmDialog(`Send ${fmt.plural(c.drafts.length, "real email")} now? This can't be undone.`,
    { title: "Send for real?", ok: "Send", danger: true }))) return;
  const out = $("#send-log", ROOT); out.classList.remove("hidden"); out.innerHTML = "";
  const log = (h) => { out.insertAdjacentHTML("beforeend", `<div>${h}</div>`); out.scrollTop = out.scrollHeight; };
  const btn = $('[data-act="send"]', ROOT); btn.disabled = true;
  try {
    await api.stream("/api/send", { drafts: c.drafts, live, campaign: "compose" }, (ev) => {
      if (ev.type === "phase") log(`<span class="c-mut">◆</span> ${esc(ev.message)}`);
      else if (ev.type === "send") {
        const r = ev.result;
        log(`  <span class="${r.status === "sent" ? "c-ok" : r.status === "error" ? "c-red" : "c-mut"}">${esc(r.status)}</span> → ${esc(r.email)}${r.detail ? ` <span class="c-mut">(${esc(r.detail)})</span>` : ""}`);
      } else if (ev.type === "done") {
        log(`<span class="c-mut">→</span> ${ev.live ? `<span class="c-ok">${ev.sent} sent</span>` : `${ev.preview} previewed`}, ${ev.skipped} skipped`);
        toast(ev.live ? `${fmt.num(ev.sent)} sent` : `${fmt.num(ev.preview)} previewed (dry run)`);
      } else if (ev.type === "error") { log(`<span class="c-red">[!] ${esc(ev.message)}</span>`); toast(ev.message, "err"); }
    });
  } catch (e) { fail(e); }
  btn.disabled = false;
}

router.register("compose", {
  title: "Compose & send",
  async mount(root) {
    ROOT = root;
    try { TEMPLATES = (await api.get("/api/templates")).templates || []; } catch (_) { TEMPLATES = []; }
    render();
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.k && t.dataset.i !== undefined) C().drafts[+t.dataset.i][t.dataset.k] = t.value;
    });
    root.addEventListener("change", (e) => {
      if (e.target.name === "live") {
        const n = C().drafts.length;
        $("#send-label", root).textContent = e.target.checked ? `Send ${fmt.plural(n, "email")}` : `Preview ${fmt.num(n)} sends`;
      }
    });
    onAct(root, {
      gen: generate,
      send,
      clear: () => { store.compose = { leads: [], drafts: [] }; render(); },
      drop: (el) => { C().drafts.splice(+el.dataset.i, 1); render(); },
    });
  },
});
