/* =========================================================================
   Compose & send — one-off outreach to a selection. Every draft is written
   from a research brief (what we already know about the lead), shown next to
   it with a 0–100 quality score and the reasons, and can be rewritten in one
   click (shorter, warmer, more direct, more casual) or swapped for an A/B
   variant. What you edit here is exactly what gets sent. Dry run by default;
   live sends are warmup-capped and skip suppressed addresses.
   ========================================================================= */
import { $, api, confirmDialog, debounce, esc, fail, fmt, ico, onAct, router, store, toast, ui } from "../core.js";

let ROOT = null;
let TEMPLATES = [];
const C = () => (store.compose ||= { leads: [], drafts: [] });
const O = () => (C().opts ||= { tpl: "", angle: "", tone: "", variants: 1 });

const ANGLES = [["", "Angle: auto"], ["mutual-signal", "Mutual signal"], ["compliment", "Compliment"],
  ["curiosity", "Curiosity"], ["pain", "Pain"], ["short-ask", "Short ask"]];
const TONES = [["", "Tone: from Settings"], ["plain", "Plain"], ["warm", "Warm"], ["direct", "Direct"], ["casual", "Casual"]];
const REWRITES = [["shorter", "Shorter"], ["warmer", "Warmer"], ["more direct", "More direct"], ["more casual", "More casual"]];
const ANGLE_LABEL = { "mutual-signal": "mutual signal", "short-ask": "short ask", inbox: "shared inbox", breakup: "breakup",
  "follow-up": "follow-up", nudge: "nudge" };

const tone = (s) => (s >= 80 ? "good" : s >= 60 ? "warn" : "bad");
function qualityBadge(q, edited) {
  if (!q || q.score === undefined) return "";
  const why = (q.reasons || []).map((r) => r.message).join("\n") || "Nothing to fix";
  return `<span class="badge badge--${tone(q.score)}" title="${esc(why)}">Quality ${q.score}${edited ? "*" : ""}</span>`;
}

const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === v ? "selected" : ""}>${esc(l)}</option>`).join("");

function render() {
  const c = C(), o = O();
  const id = store.state?.identity || {};
  if (!c.leads.length && !c.drafts.length) {
    ROOT.innerHTML = `<section class="page">${head()}${ui.empty("send", "Pick who to write to",
      "Select people in <a class='link' href='#/people'>People</a> or <a class='link' href='#/prospect'>Find people</a> and choose <b>Write emails</b>. For multi-step follow-ups, use a <a class='link' href='#/sequences'>sequence</a> instead.",
      `<a class="btn btn--primary" href="#/prospect">${ico("radar")} Find people</a><a class="btn" href="#/people">${ico("users")} Open People</a>`)}</section>`;
    return;
  }
  const n = c.leads.length || c.drafts.length;
  const scores = c.drafts.map((d) => d.quality?.score).filter((s) => s !== undefined);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  ROOT.innerHTML = `<section class="page page--wide">${head()}
    <div class="grid grid-main-side">
      <div class="stack">
        <div class="card">
          <div class="card__head"><h3>${fmt.plural(n, "recipient")}</h3>
            ${avg !== null ? `<span class="hint">Average quality ${avg}</span>` : ""}
            <div class="actions"><button class="btn btn--sm btn--ghost" data-act="clear">${ico("x")} Clear</button></div></div>
          <div class="card__body stack">
            <div class="tags">${(c.leads.length ? c.leads : c.drafts).slice(0, 24).map((l) =>
              `<span class="tag">${esc(ui.name(l) || l.email)}</span>`).join("")}${n > 24 ? `<span class="tag">+${n - 24} more</span>` : ""}</div>
            <div class="compose-controls">
              <select class="select select--sm" name="tpl" aria-label="Writer">
                <option value="">${id.llm_configured ? "AI writer (LLM, checked)" : "Built-in writer"}</option>
                ${TEMPLATES.map((t) => `<option value="${t.id}" ${String(o.tpl) === String(t.id) ? "selected" : ""}>Template: ${esc(t.name)}</option>`).join("")}
              </select>
              <select class="select select--sm" name="angle" aria-label="Angle" ${o.tpl ? "disabled" : ""}>${opt(ANGLES, o.angle)}</select>
              <select class="select select--sm" name="tone" aria-label="Tone" ${o.tpl ? "disabled" : ""}>${opt(TONES, o.tone)}</select>
              <select class="select select--sm" name="variants" aria-label="Versions per person" ${o.tpl ? "disabled" : ""}>${opt([["1", "1 version"], ["2", "2 versions (A/B)"], ["3", "3 versions"]], o.variants)}</select>
              <button class="btn btn--primary btn--sm" data-act="gen">${ico("spark")} ${c.drafts.length ? "Regenerate" : "Write"} ${fmt.num(n)}</button>
            </div>
            <span class="hint">${id.sender_name ? "Each draft uses only what we know about that person: their company, stack, signals and role, plus your pitch." : "Tip: set your name, pitch and proof in <a class='link' href='#/settings/sender'>Settings</a> so drafts say what you offer and sign off properly."}</span>
          </div>
        </div>
        <div id="drafts" class="stack">${c.drafts.map(draftCard).join("")}</div>
      </div>
      <div class="card compose-outbox">
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
  <p class="head__sub">One-off emails to a selection. What you edit here is exactly what gets sent.</p></div>
  <div class="head__actions"><a class="btn" href="#/sequences">${ico("sequence")} Use a sequence instead</a></div></div>`;

function briefHtml(b) {
  if (!b || !b.facts) return "";
  const facts = (b.facts || []).filter((f) => f.weight >= 1);
  const who = [ui.name(b), b.title].filter(Boolean).join(", ");
  return `<div class="brief">
    <div class="brief__head">What we know</div>
    <div class="brief__who">${b.kind === "company" ? `Shared inbox at ${esc(b.company || b.domain || "this company")}` : esc(who || b.email)}</div>
    ${facts.length ? `<dl class="brief__facts">${facts.map((f) =>
      `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}${f.source && f.weight >= 2 ? ` <span class="faint">(${esc(f.source)})</span>` : ""}</dd>`).join("")}</dl>`
      : `<p class="hint">Nothing specific beyond the name and company.</p>`}
    ${b.topic ? `<p class="hint">Your pitch is about ${esc(b.topic_object)}.</p>` : ""}
    ${(b.gaps || []).length ? `<ul class="brief__gaps">${b.gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

function qualityHtml(q, d) {
  if (!q || q.score === undefined) return "";
  return `<div class="brief">
    <div class="brief__head">Quality ${q.score} of 100${d._edited ? `, after your edits` : ""}</div>
    ${(q.reasons || []).length ? `<ul class="lint-list">${q.reasons.map((r) => `<li>${ico("flag", "ico--sm")} ${esc(r.message)}</li>`).join("")}</ul>`
      : `<p class="hint">Nothing to fix.</p>`}
    ${(q.good || []).length ? `<p class="hint">${esc(q.good.join(", "))}</p>` : ""}
    ${(d.explain || []).length ? `<details class="why"><summary>Why these lines</summary><ul>${d.explain.map((x) =>
      `<li><b>${esc(x.slot)}</b> ${esc(x.why)}</li>`).join("")}</ul></details>` : ""}
  </div>`;
}

function draftCard(d, i) {
  const vs = d.variants || [];
  const writer = d.model === "template" ? "template" : d.model === "writer" ? "built-in writer" : d.model === "edited" ? "" : d.model ? "AI" : "";
  return `<div class="card draft" data-d="${i}">
    <div class="card__head"><span class="row" style="min-width:0">${ico("mail")}<b class="ellipsis">${esc(d.email)}</b></span>
      <span class="hint">${esc([writer, ANGLE_LABEL[d.angle] || d.angle].filter(Boolean).join(", "))}</span>
      <div class="actions"><span data-qbadge="${i}">${qualityBadge(d.quality, d._edited)}</span><button class="btn btn--xs btn--ghost" data-act="drop" data-i="${i}" title="Remove">${ico("x")}</button></div></div>
    <div class="card__body draft__grid">
      <div class="stack">
        ${vs.length > 1 ? `<div class="seg" role="tablist" aria-label="Versions">${vs.map((v, k) =>
          `<button type="button" class="${(d._v || 0) === k ? "is-on" : ""}" data-act="variant" data-i="${i}" data-k="${k}">${String.fromCharCode(65 + k)} <span class="faint">${v.quality?.score ?? ""}</span></button>`).join("")}</div>` : ""}
        <input class="input" data-k="subject" data-i="${i}" value="${esc(d.subject)}" aria-label="Subject"/>
        <textarea class="textarea" rows="10" data-k="body" data-i="${i}" aria-label="Body">${esc(d.body)}</textarea>
        ${d.missing?.length ? `<div class="banner banner--warn">${ico("flag")}<div>Blank: ${d.missing.map((m) => `<code>{{${esc(m)}}}</code>`).join(" ")}</div></div>` : ""}
        <div class="row row--wrap" style="gap:6px"><span class="hint">Rewrite</span>${REWRITES.map(([m, l]) =>
          `<button type="button" class="btn btn--xs" data-act="rw" data-i="${i}" data-mode="${esc(m)}">${esc(l)}</button>`).join("")}</div>
      </div>
      <div class="stack draft__side" data-side="${i}">${briefHtml(d.brief)}${qualityHtml(d.quality, d)}</div>
    </div></div>`;
}

function refreshCard(i) {
  const d = C().drafts[i];
  const side = $(`[data-side="${i}"]`, ROOT);
  if (side) side.innerHTML = briefHtml(d.brief) + qualityHtml(d.quality, d);
  const b = $(`[data-qbadge="${i}"]`, ROOT);
  if (b) b.innerHTML = qualityBadge(d.quality, d._edited);
}

const rescore = debounce(async (i) => {
  const d = C().drafts[i];
  if (!d) return;
  try {
    const r = await api.post("/api/write/score", { subject: d.subject, body: d.body, email: d.email, step: d.step || 1 });
    d.quality = r.quality; refreshCard(i);
  } catch (_) { /* keep the last score */ }
}, 400);

async function generate() {
  const c = C(), o = O();
  const leads = c.leads.length ? c.leads : c.drafts.map((d) => ({ email: d.email, first_name: d.first_name, organization: d.organization }));
  const btn = $('[data-act="gen"]', ROOT); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing…'; }
  try {
    if (o.tpl) {
      const t = TEMPLATES.find((x) => String(x.id) === String(o.tpl));
      c.drafts = [];
      for (const l of leads) {
        const r = await api.post("/api/templates/preview", { subject: t.subject, body: t.body, email: l.email });
        c.drafts.push({ ...r.draft, email: l.email, missing: r.missing });
      }
    } else {
      const r = await api.post("/api/write", { leads, angle: o.angle || undefined, tone: o.tone || undefined, variants: Number(o.variants) || 1 });
      c.drafts = r.drafts || [];
    }
    toast(`${fmt.num(c.drafts.length)} drafts ready`);
  } catch (e) { fail(e); }
  render();
}

async function rewriteOne(el) {
  const i = +el.dataset.i, d = C().drafts[i];
  el.disabled = true; const label = el.textContent; el.innerHTML = '<span class="spinner"></span>';
  try {
    const r = await api.post("/api/write/rewrite", { draft: { email: d.email, subject: d.subject, body: d.body, step: d.step, angle: d.angle }, mode: el.dataset.mode });
    Object.assign(d, { subject: r.draft.subject, body: r.draft.body, quality: r.draft.quality, _edited: false,
      explain: [...(r.draft.explain || []), ...(d.explain || [])].slice(0, 14), model: r.draft.model === "writer" ? d.model : r.draft.model });
    if (!d.brief?.facts) d.brief = r.draft.brief;
    const card = $(`[data-d="${i}"]`, ROOT);
    if (card) card.outerHTML = draftCard(d, i);
    toast(`Rewritten: ${label.toLowerCase()}`);
  } catch (e) { fail(e); el.disabled = false; el.textContent = label; }
}

function pickVariant(el) {
  const i = +el.dataset.i, k = +el.dataset.k, d = C().drafts[i];
  const v = d.variants[k];
  Object.assign(d, { _v: k, subject: v.subject, body: v.body, quality: v.quality, angle: v.angle, model: v.model || d.model, _edited: false });
  const card = $(`[data-d="${i}"]`, ROOT);
  if (card) card.outerHTML = draftCard(d, i);
}

async function send() {
  const c = C();
  const live = $("input[name=live]", ROOT)?.checked;
  if (live && !(await confirmDialog(`Send ${fmt.plural(c.drafts.length, "real email")} now? This can't be undone.`,
    { title: "Send for real?", ok: "Send", danger: true }))) return;
  const out = $("#send-log", ROOT); out.classList.remove("hidden"); out.innerHTML = "";
  const log = (h) => { out.insertAdjacentHTML("beforeend", `<div>${h}</div>`); out.scrollTop = out.scrollHeight; };
  const btn = $('[data-act="send"]', ROOT); btn.disabled = true;
  const drafts = c.drafts.map((d) => ({ email: d.email, subject: d.subject, body: d.body, first_name: d.first_name,
    organization: d.organization, model: d.model }));
  try {
    await api.stream("/api/send", { drafts, live, campaign: "compose" }, (ev) => {
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
      if (t.dataset.k && t.dataset.i !== undefined) {
        const i = +t.dataset.i, d = C().drafts[i];
        d[t.dataset.k] = t.value;
        d._edited = true;
        rescore(i);
      }
    });
    root.addEventListener("change", (e) => {
      const t = e.target, o = O();
      if (t.name === "live") {
        const n = C().drafts.length;
        $("#send-label", root).textContent = t.checked ? `Send ${fmt.plural(n, "email")}` : `Preview ${fmt.num(n)} sends`;
      } else if (["tpl", "angle", "tone", "variants"].includes(t.name)) {
        o[t.name] = t.value;
        if (t.name === "tpl") render();
      }
    });
    onAct(root, {
      gen: generate,
      send,
      rw: rewriteOne,
      variant: pickVariant,
      clear: () => { store.compose = { leads: [], drafts: [] }; render(); },
      drop: (el) => { C().drafts.splice(+el.dataset.i, 1); render(); },
    });
  },
});
