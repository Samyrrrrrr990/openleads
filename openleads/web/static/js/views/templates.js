/* =========================================================================
   Templates — reusable emails with {{variables}}, {{var|fallback}} and
   {spin|tax}. A library on the left, the editor in the middle and a live
   preview rendered for a real contact (with spam score and blank-variable
   warnings) on the right. #/templates/<id> opens one.
   ========================================================================= */
import { $, api, confirmDialog, debounce, esc, fail, fmt, ico, onAct, router, store, toast, ui } from "../core.js";

const S = { list: [], cur: null, draft: null, dirty: false, q: "", cat: "", people: [], email: "" };
let ROOT = null;

const blank = () => ({ id: null, name: "", category: "", subject: "", body: "Hi {{first_name|there}},\n\n\n\n{{sender_name}}" });
const cats = () => Array.from(new Set(S.list.map((t) => t.category).filter(Boolean))).sort();

function libraryHtml() {
  const q = S.q.toLowerCase();
  const rows = S.list.filter((t) => (!S.cat || t.category === S.cat)
    && (!q || `${t.name} ${t.subject} ${t.body}`.toLowerCase().includes(q)));
  return `<div class="tpl-lib__tools"><div class="search-input">${ico("find", "ico--sm")}<input class="input input--sm" id="tpl-q" placeholder="Search templates" value="${esc(S.q)}"/></div>
      ${cats().length ? `<div class="row row--wrap" style="gap:4px">${["", ...cats()].map((c) =>
        `<button type="button" class="chip chip--toggle ${S.cat === c ? "is-on" : ""}" data-cat="${esc(c)}">${esc(c || "All")}</button>`).join("")}</div>` : ""}</div>
    <div class="tpl-lib__list">${rows.length ? rows.map((t) => `
      <button type="button" class="tpl-item ${S.draft && S.draft.id === t.id ? "is-on" : ""}" data-tpl="${t.id}">
        <div class="row" style="gap:6px"><b class="ellipsis" style="flex:1;min-width:0">${esc(t.name)}</b>${t.category ? `<span class="badge badge--sm">${esc(t.category)}</span>` : ""}</div>
        <div class="hint ellipsis">${esc(t.subject || "(no subject)")}</div>
        <div class="hint">${t.used ? `used ${fmt.plural(t.used, "time")} · ` : ""}edited ${esc(fmt.rel(t.updated))}</div></button>`).join("")
      : `<p class="hint" style="padding:12px">No templates match.</p>`}</div>`;
}

function editorHtml() {
  const t = S.draft;
  if (!t) return ui.empty("template", "Pick a template", "Or start a new one.", `<button class="btn btn--primary" data-act="new">${ico("plus")} New template</button>`);
  return `<form class="stack" data-tpl-form autocomplete="off">
    <div class="row" style="gap:8px"><input class="input tpl-name" name="name" value="${esc(t.name)}" placeholder="Template name" ${t.id ? "" : "autofocus"}/>
      ${S.dirty ? `<span class="badge badge--warn">Unsaved</span>` : t.id ? `<span class="badge badge--good">Saved</span>` : ""}</div>
    <div class="form-grid">
      <div class="field"><label>Category</label><input class="input input--sm" name="category" list="tpl-cats" value="${esc(t.category)}" placeholder="intro, follow-up, breakup…"/>
        <datalist id="tpl-cats">${cats().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
      <div class="field"><label>Subject</label><input class="input input--sm" name="subject" value="${esc(t.subject)}" placeholder="quick question about {{company}}"/></div>
    </div>
    <div class="field"><label>Body</label><textarea class="textarea tpl-body" name="body" rows="14">${esc(t.body)}</textarea></div>
    <div><div class="hint mb-sm">Insert a variable · use <code>{{first_name|there}}</code> for a fallback and <code>{Hi|Hey}</code> to vary wording per person</div>
      <div class="var-chips">${(store.meta?.template_variables || []).map((v) =>
        `<button type="button" data-insert="{{${v.key}}}" title="${esc(v.label)} — e.g. ${esc(v.example)}">{{${v.key}}}</button>`).join("")}</div></div>
    <div class="row" style="gap:8px">
      ${t.id ? `<button type="button" class="btn btn--ghost" data-act="delete" style="color:var(--bad)">${ico("trash")} Delete</button>
        <button type="button" class="btn" data-act="duplicate">${ico("copy")} Duplicate</button>` : ""}
      <span class="spacer"></span>
      ${S.dirty && t.id ? `<button type="button" class="btn" data-act="revert">Discard</button>` : ""}
      <button type="submit" class="btn btn--primary" ${S.dirty || !t.id ? "" : "disabled"}>${ico("check")} ${t.id ? "Save" : "Create template"}</button></div>
  </form>`;
}

function previewShell() {
  return `<div class="card" style="position:sticky;top:16px"><div class="card__head"><h3>Preview</h3></div>
    <div class="card__body stack">
      <select class="select select--sm" id="tpl-person"><option value="">Sample contact (Jane at Acme)</option>${S.people.map((p) =>
        `<option value="${esc(p.email)}" ${p.email === S.email ? "selected" : ""}>${esc(ui.name(p) || p.email)}${p.organization ? ` — ${esc(p.organization)}` : ""}</option>`).join("")}</select>
      <div id="tpl-preview" class="stack">${ui.skeleton(3)}</div></div></div>`;
}

async function refreshPreview() {
  const box = $("#tpl-preview", ROOT); if (!box || !S.draft) return;
  try {
    const r = await api.post("/api/templates/preview", { subject: S.draft.subject, body: S.draft.body, email: S.email });
    const d = r.draft, lint = d.lint || { score: 0, warnings: [], ok: true };
    const words = (d.body.match(/\w+/g) || []).length;
    box.innerHTML = `<div class="email-preview">
        <div class="hint">To ${esc(d.email)}${r.sample ? " (sample)" : ""}</div>
        <div class="email-preview__subject">${esc(d.subject) || '<span class="faint">(no subject)</span>'}</div>
        <div class="email-preview__body">${esc(d.body)}</div></div>
      <div class="row row--wrap" style="gap:6px">
        <span class="badge ${lint.ok ? "badge--good" : "badge--warn"}" title="0 is clean, 35+ risks the spam folder">spam score ${lint.score}</span>
        <span class="badge">${fmt.plural(words, "word")}</span>
        ${(r.missing || []).map((m) => `<span class="badge badge--warn" title="Blank for this contact — add a fallback like {{${esc(m)}|…}}">{{${esc(m)}}} blank</span>`).join("")}
        ${(r.unknown || []).map((m) => `<span class="badge badge--bad" title="Not a known variable">{{${esc(m)}}} unknown</span>`).join("")}</div>
      ${lint.warnings.length ? `<ul class="lint-list">${lint.warnings.map((w) => `<li>${ico("flag", "ico--sm")} ${esc(w)}</li>`).join("")}</ul>` : ""}`;
  } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
}
const queuePreview = debounce(refreshPreview, 250);

function render() {
  ROOT.innerHTML = `<section class="page page--wide">
    <div class="head"><div><div class="head__title"><h1>Templates</h1></div>
      <p class="head__sub">Reusable emails for Compose and sequence steps. Variables fill from each contact; blanks fall back to what you write after the <code>|</code>.</p></div>
      <div class="head__actions"><button class="btn btn--primary" data-act="new">${ico("plus")} New template</button></div></div>
    <div class="tpl-shell">
      <aside class="card tpl-lib" id="tpl-lib">${libraryHtml()}</aside>
      <div class="card card--pad" id="tpl-editor">${editorHtml()}</div>
      <div id="tpl-side">${S.draft ? previewShell() : ""}</div>
    </div></section>`;
  if (S.draft) refreshPreview();
}

function rerenderEditor() {
  $("#tpl-editor", ROOT).innerHTML = editorHtml();
  $("#tpl-lib", ROOT).innerHTML = libraryHtml();
}

async function load() { S.list = (await api.get("/api/templates")).templates || []; }

async function confirmLeave() {
  if (!S.dirty) return true;
  return confirmDialog("You have unsaved changes to this template. Discard them?", { ok: "Discard", danger: true });
}

async function select(id, { push = true } = {}) {
  if (!(await confirmLeave())) return;
  const t = S.list.find((x) => String(x.id) === String(id));
  S.draft = t ? { ...t } : null; S.dirty = false;
  if (push) router.go("templates", t ? String(t.id) : "", null, { replace: true });
  render();
}

function insertAtCursor(el, text) {
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, s) + text + el.value.slice(e);
  el.selectionStart = el.selectionEnd = s + text.length;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
}

router.register("templates", {
  title: "Templates",
  async mount(root, ctx) {
    ROOT = root;
    root.innerHTML = `<div class="page">${ui.skeleton(8)}</div>`;
    const [, ppl] = await Promise.all([load(), api.post("/api/people/search", { per_page: 60, sort: "updated" }).catch(() => ({ rows: [] }))]);
    S.people = (ppl.rows || []).filter((p) => p.email);
    const start = ctx.id ? S.list.find((x) => String(x.id) === ctx.id) : S.list[0];
    S.draft = start ? { ...start } : null; S.dirty = false;
    render();
    let lastField = null;
    root.addEventListener("focusin", (e) => { if (e.target.matches("[data-tpl-form] [name=subject], [data-tpl-form] [name=body]")) lastField = e.target; });
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "tpl-q") { S.q = t.value; $("#tpl-lib", root).innerHTML = libraryHtml(); const q = $("#tpl-q", root); q.focus(); q.setSelectionRange(q.value.length, q.value.length); return; }
      if (t.closest("[data-tpl-form]") && S.draft && t.name in S.draft) {
        S.draft[t.name] = t.value;
        if (!S.dirty) { S.dirty = true; const f = $("[data-tpl-form]", root); const pos = [document.activeElement?.name, t.selectionStart]; rerenderEditor(); const el = f && $(`[data-tpl-form] [name=${pos[0]}]`, root); if (el) { el.focus(); try { el.setSelectionRange(pos[1], pos[1]); } catch (_) { /* */ } } }
        if (t.name === "subject" || t.name === "body") queuePreview();
      }
    });
    root.addEventListener("change", (e) => { if (e.target.id === "tpl-person") { S.email = e.target.value; refreshPreview(); } });
    root.addEventListener("click", (e) => {
      const item = e.target.closest("[data-tpl]");
      if (item) { select(item.dataset.tpl); return; }
      const c = e.target.closest("[data-cat]");
      if (c) { S.cat = c.dataset.cat; $("#tpl-lib", root).innerHTML = libraryHtml(); return; }
      const ins = e.target.closest("[data-insert]");
      if (ins) { e.preventDefault(); insertAtCursor(lastField && root.contains(lastField) ? lastField : $("[data-tpl-form] [name=body]", root), ins.dataset.insert); }
    });
    root.addEventListener("submit", async (e) => {
      if (!e.target.matches("[data-tpl-form]")) return;
      e.preventDefault();
      try {
        const body = { name: S.draft.name, category: S.draft.category, subject: S.draft.subject, body: S.draft.body };
        if (S.draft.id) body.id = S.draft.id;
        const r = await api.post("/api/templates/save", body);
        toast(S.draft.id ? "Template saved" : "Template created");
        await load(); S.draft = { ...r.template }; S.dirty = false;
        router.go("templates", String(r.template.id), null, { replace: true });
        render();
      } catch (err) { fail(err); }
    });
    onAct(root, {
      new: async () => { if (!(await confirmLeave())) return; S.draft = blank(); S.dirty = false; router.go("templates", "", null, { replace: true }); render(); },
      revert: () => { S.dirty = false; select(S.draft.id, { push: false }); },
      duplicate: async () => {
        if (!(await confirmLeave())) return;
        const src = S.draft;
        let name = `${src.name} (copy)`, n = 2;
        while (S.list.some((t) => t.name.toLowerCase() === name.toLowerCase())) name = `${src.name} (copy ${n++})`;
        const r = await api.post("/api/templates/save", { name, category: src.category, subject: src.subject, body: src.body });
        toast("Duplicated"); await load(); S.dirty = false; select(r.template.id);
      },
      delete: async () => {
        if (!(await confirmDialog(`Delete '${S.draft.name}'? Sequences that copied it keep their own text.`, { ok: "Delete", danger: true }))) return;
        await api.post("/api/templates/delete", { id: S.draft.id }); toast("Deleted");
        await load(); S.dirty = false; S.draft = S.list[0] ? { ...S.list[0] } : null;
        router.go("templates", S.draft ? String(S.draft.id) : "", null, { replace: true }); render();
      },
    });
  },
  update(ctx) {
    if (ctx.id && (!S.draft || String(S.draft.id) !== ctx.id)) select(ctx.id, { push: false });
  },
});
