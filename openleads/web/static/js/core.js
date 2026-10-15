/* =========================================================================
   OpenLeads workspace — runtime core.
   Helpers, the API client, the hash router, dialogs, menus, drawers, toasts and
   the small UI atoms every view shares. Vanilla ES modules, no build step, and
   CSP-safe: no inline handlers, everything is wired by delegation.
   ========================================================================= */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const ico = (id, cls = "") => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
export const debounce = (fn, ms = 250) => {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
export const uniq = (arr) => Array.from(new Set(arr));

/* ------------------------------------------------------------- format */
const NF = new Intl.NumberFormat();
export const fmt = {
  num: (n) => NF.format(Number(n) || 0),
  compact(n) {
    n = Number(n) || 0;
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(Math.round(n));
  },
  money(n, cur = "USD") {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "USD",
        maximumFractionDigits: (Number(n) % 1 ? 2 : 0) }).format(Number(n) || 0);
    } catch (_) { return "$" + fmt.num(n); }
  },
  moneyCompact(n) { return "$" + fmt.compact(n); },
  pct: (n) => `${(Number(n) || 0).toFixed(Number(n) % 1 ? 1 : 0)}%`,
  date(ts) {
    if (!ts) return "—";
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric",
      year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  },
  datetime(ts) {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit" });
  },
  rel(ts) {
    if (!ts) return "—";
    const s = Math.round(Date.now() / 1000 - ts), a = Math.abs(s), fut = s < 0;
    const u = a < 60 ? [a, "s"] : a < 3600 ? [Math.floor(a / 60), "m"] : a < 86400
      ? [Math.floor(a / 3600), "h"] : a < 86400 * 30 ? [Math.floor(a / 86400), "d"]
        : a < 86400 * 365 ? [Math.floor(a / 86400 / 30), "mo"] : [Math.floor(a / 86400 / 365), "y"];
    if (a < 45) return fut ? "in a moment" : "just now";
    return fut ? `in ${u[0]}${u[1]}` : `${u[0]}${u[1]} ago`;
  },
  due(ts) {
    if (!ts) return "No date";
    const d = new Date(ts * 1000), now = new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(d) - day(now)) / 86400000);
    const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (diff === 0) return `Today ${t}`;
    if (diff === 1) return `Tomorrow ${t}`;
    if (diff === -1) return `Yesterday ${t}`;
    if (diff < 0) return `${-diff} days overdue`;
    if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return fmt.date(ts);
  },
  phone(p) {
    const d = String(p || "").replace(/[^\d+]/g, "");
    if (/^\+1\d{10}$/.test(d)) return `+1 ${d.slice(2, 5)}-${d.slice(5, 8)}-${d.slice(8)}`;
    if (/^\d{10}$/.test(d)) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    return p || "";
  },
  plural: (n, one, many) => `${fmt.num(n)} ${Number(n) === 1 ? one : (many || one + "s")}`,
};

/* ---------------------------------------------------------------- API */
async function handle(r) {
  let data = null;
  try { data = await r.json(); } catch (_) { /* non-JSON */ }
  if (!r.ok || (data && data.ok === false && data.error)) {
    const err = new Error((data && data.error) || `${r.status} ${r.statusText}`);
    err.status = r.status; err.data = data;
    throw err;
  }
  return data;
}
export const api = {
  async get(path, params) {
    const qs = params ? "?" + new URLSearchParams(Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")).toString() : "";
    return handle(await fetch(path + qs, { headers: { Accept: "application/json" } }));
  },
  async post(path, body) {
    return handle(await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }));
  },
  async stream(path, body, onEvent) {
    const r = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) return handle(r);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line) { try { onEvent(JSON.parse(line)); } catch (_) { /* partial */ } }
      }
    }
    if (buf.trim()) { try { onEvent(JSON.parse(buf.trim())); } catch (_) { /* ignore */ } }
  },
};

/* --------------------------------------------------------------- store */
export const store = {
  meta: null, state: null, version: "",
  stageOf(key) { return (this.meta?.contact_stages || []).find((s) => s.key === key); },
  label(kind, key) {
    const list = this.meta?.[kind] || [];
    const hit = list.find((x) => x.key === key);
    return hit ? hit.label : (key || "").replace(/_/g, " ");
  },
  pref(key, fallback) {
    try { const v = localStorage.getItem("ol-" + key); return v === null ? fallback : JSON.parse(v); }
    catch (_) { return fallback; }
  },
  setPref(key, value) { try { localStorage.setItem("ol-" + key, JSON.stringify(value)); } catch (_) { /* */ } },
};

/* --------------------------------------------------------------- toast */
export function toast(msg, kind = "ok", action) {
  const host = $("#toasts");
  const t = document.createElement("div");
  t.className = `toast toast--${kind}`;
  t.innerHTML = `${ico(kind === "err" ? "x" : kind === "info" ? "spark" : "check")}<span>${esc(msg)}</span>`
    + (action ? `<button type="button">${esc(action.label)}</button>` : "");
  if (action) t.querySelector("button").addEventListener("click", () => { action.run(); dismiss(); });
  host.appendChild(t);
  const dismiss = () => { t.classList.add("is-out"); setTimeout(() => t.remove(), 260); };
  setTimeout(dismiss, kind === "err" ? 6000 : 3600);
}
export function fail(e) { toast(e?.message || String(e), "err"); }

/* ------------------------------------------------------------- overlays */
const overlays = () => $("#overlays");
const escStack = [];
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && escStack.length) { e.preventDefault(); escStack[escStack.length - 1](); }
});

/** A modal dialog. Resolves with the clicked action's value (or null on cancel). */
export function modal({ title, body, actions, wide = false, onMount, onSubmit }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="scrim"></div><div class="modal-wrap" role="dialog" aria-modal="true">
      <form class="modal ${wide ? "modal--wide" : ""}" novalidate>
        <div class="modal__head"><h2>${esc(title)}</h2><span class="spacer"></span>
          <button type="button" class="btn btn--ghost btn--icon btn--sm" data-x>${ico("x")}</button></div>
        <div class="modal__body">${body || ""}</div>
        <div class="modal__foot">${(actions || [{ label: "Close", value: null }]).map((a, i) =>
          `<button type="${a.submit ? "submit" : "button"}" class="btn ${a.kind ? "btn--" + a.kind : ""}" data-i="${i}">${a.icon ? ico(a.icon) : ""}${esc(a.label)}</button>`).join("")}</div>
      </form></div>`;
    overlays().appendChild(wrap);
    const form = wrap.querySelector("form");
    const close = (v) => { escStack.pop(); wrap.remove(); resolve(v); };
    escStack.push(() => close(null));
    wrap.querySelector(".modal-wrap").addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("modal-wrap")) close(null);
    });
    wrap.querySelector("[data-x]").addEventListener("click", () => close(null));
    form.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-i]");
      if (!b || b.type === "submit") return;
      const a = actions[+b.dataset.i];
      if (a.run) { const keep = await a.run(form); if (keep === false) return; }
      close(a.value === undefined ? a.label : a.value);
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const a = (actions || []).find((x) => x.submit);
      if (onSubmit) {
        const btn = form.querySelector('button[type="submit"]');
        btn && (btn.disabled = true);
        try { const v = await onSubmit(form); if (v !== false) close(v === undefined ? true : v); }
        catch (err) { fail(err); }
        finally { btn && (btn.disabled = false); }
        return;
      }
      close(a ? (a.value === undefined ? true : a.value) : true);
    });
    onMount && onMount(form);
    setTimeout(() => (form.querySelector("[autofocus]") || form.querySelector("input, textarea, select"))?.focus(), 20);
  });
}

export async function confirmDialog(message, { title = "Are you sure?", ok = "Confirm", danger = false } = {}) {
  const v = await modal({ title, body: `<p class="muted">${esc(message)}</p>`,
    actions: [{ label: "Cancel", value: false }, { label: ok, value: true, kind: danger ? "accent" : "primary", submit: true }] });
  return v === true;
}

export async function promptDialog({ title, label, value = "", placeholder = "", ok = "Save", hint = "" }) {
  let out = null;
  const v = await modal({
    title, body: `<div class="field"><label>${esc(label)}</label>
      <input class="input" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus />
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>`,
    actions: [{ label: "Cancel", value: null }, { label: ok, kind: "primary", submit: true }],
    onSubmit: (f) => { out = f.v.value.trim(); return out ? true : false; },
  });
  return v ? out : null;
}

/** A dropdown menu next to ``anchor``. items: {label, icon, value, danger, sep, header, input} */
export function menu(anchor, items, onPick, { align = "left", width } = {}) {
  closeMenus();
  const m = document.createElement("div");
  m.className = "menu"; m.setAttribute("role", "menu");
  if (width) m.style.minWidth = width + "px";
  m.innerHTML = items.map((it, i) => it.sep ? '<div class="menu__sep"></div>'
    : it.header ? `<div class="menu__label">${esc(it.header)}</div>`
      : it.input ? `<div class="menu__input"><input class="input input--sm" data-mi="${i}" placeholder="${esc(it.placeholder || "")}"/></div>`
        : `<button type="button" class="menu__item ${it.danger ? "menu__item--danger" : ""}" data-mi="${i}" role="menuitem">${it.icon ? ico(it.icon) : ""}${it.html || esc(it.label)}</button>`).join("");
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = align === "right" ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.left = left + "px"; m.style.top = top + "px";
  const pick = (i) => { const it = items[i]; closeMenus(); onPick && onPick(it.value !== undefined ? it.value : it.label, it); };
  m.addEventListener("click", (e) => { const b = e.target.closest("button[data-mi]"); if (b) pick(+b.dataset.mi); });
  m.addEventListener("keydown", (e) => {
    const inp = e.target.closest("input[data-mi]");
    if (inp && e.key === "Enter" && inp.value.trim()) {
      const it = items[+inp.dataset.mi]; closeMenus(); it.onEnter && it.onEnter(inp.value.trim());
    }
  });
  setTimeout(() => { m.querySelector("input")?.focus(); }, 10);
  escStack.push(closeMenus);
  return m;
}
export function closeMenus() {
  const had = $$(".menu");
  had.forEach((m) => m.remove());
  if (had.length && escStack.length && escStack[escStack.length - 1] === closeMenus) escStack.pop();
}
document.addEventListener("mousedown", (e) => { if (!e.target.closest(".menu")) closeMenus(); });
window.addEventListener("resize", closeMenus);

/** A right-side drawer. Returns {el, body, close}. */
export function drawer({ onClose } = {}) {
  const wrap = document.createElement("div");
  wrap.innerHTML = '<div class="scrim"></div><aside class="drawer" role="dialog" aria-modal="true"></aside>';
  overlays().appendChild(wrap);
  const el = wrap.querySelector(".drawer");
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    const i = escStack.indexOf(close); if (i >= 0) escStack.splice(i, 1);
    wrap.remove(); onClose && onClose();
  };
  escStack.push(close);
  wrap.querySelector(".scrim").addEventListener("click", close);
  return { el, close, get closed() { return closed; } };
}

/* ------------------------------------------------------------ UI atoms */
export const ui = {
  tierDot(tier) {
    const t = tier === "safe" || tier === "risky" ? tier : tier === "bad" ? "bad" : "unknown";
    const label = { safe: "Verified safe", risky: "Risky", bad: "Bad", unknown: "Unverified" }[t];
    return `<span class="tier-dot tier-dot--${t}" title="${label}"></span>`;
  },
  tier(tier) {
    const map = { safe: ["good", "Safe"], risky: ["warn", "Risky"], bad: ["bad", "Bad"] };
    const [tone, label] = map[tier] || ["", "Unverified"];
    return `<span class="badge ${tone ? "badge--" + tone : ""}"><span class="dot"></span>${label}</span>`;
  },
  evidence(ev) {
    const map = { found: ["good", "Found", "Published on the web or confirmed by the mail server"],
      pattern: ["info", "Pattern", "Built from a real address format seen at this company"],
      guessed: ["", "Guessed", "A common format with nothing confirming it"] };
    const m = map[ev];
    return m ? `<span class="badge badge--sm ${m[0] ? "badge--" + m[0] : ""}" title="${m[2]}">${m[1]}</span>` : "";
  },
  stage(key) {
    const s = store.stageOf(key || "new") || { label: key || "New", tone: "neutral" };
    const tone = { neutral: "", info: "badge--info", good: "badge--good", warn: "badge--warn", bad: "badge--bad" }[s.tone] || "";
    return `<span class="badge ${tone}">${esc(s.label)}</span>`;
  },
  grade(score) {
    const s = Number(score) || 0;
    const g = s >= 75 ? "A" : s >= 55 ? "B" : s >= 35 ? "C" : "D";
    return `<span class="grade grade--${g}" title="ICP fit ${s}/100">${g}</span>`;
  },
  avatar(name, seed, cls = "") {
    const n = String(name || "").trim();
    const parts = n.split(/\s+/).filter(Boolean);
    const ini = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "?").slice(0, 2)).toUpperCase();
    let h = 0; for (const c of String(seed || n)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `<span class="avatar av-${h % 8} ${cls}" aria-hidden="true">${esc(ini)}</span>`;
  },
  companyAvatar(name, cls = "") {
    const ini = String(name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "?";
    return `<span class="avatar avatar--sq av-co ${cls}" aria-hidden="true">${esc(ini)}</span>`;
  },
  copy(text, title = "Copy") {
    return `<button type="button" class="copy" data-copy="${esc(text)}" title="${esc(title)}">${ico("copy", "ico--sm")}</button>`;
  },
  empty(icon, title, text, action = "") {
    return `<div class="empty"><div class="empty__icon">${ico(icon)}</div><h3>${esc(title)}</h3>
      ${text ? `<p>${text}</p>` : ""}${action ? `<div class="row mt" style="justify-content:center">${action}</div>` : ""}</div>`;
  },
  skeleton(rows = 6) {
    return `<div style="padding:16px;display:grid;gap:14px">${Array.from({ length: rows }, (_, i) =>
      `<div class="row" style="gap:12px"><div class="skel" style="width:30px;height:30px;border-radius:50%"></div>
       <div class="skel" style="width:${30 + (i * 13) % 40}%"></div><div class="skel" style="width:14%;margin-left:auto"></div></div>`).join("")}</div>`;
  },
  switch(name, on, label, attrs = "") {
    return `<label class="switch"><input type="checkbox" name="${esc(name)}" ${on ? "checked" : ""} ${attrs}/><span class="switch__track"></span>${label ? `<span class="switch__label">${esc(label)}</span>` : ""}</label>`;
  },
  name(row) {
    return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.name || "";
  },
};

/* clipboard: any [data-copy] button anywhere */
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  e.stopPropagation(); e.preventDefault();
  try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copied"); }
  catch (_) { toast("Couldn't copy — select and copy manually", "err"); }
});

/** Save text as a file in the browser (exports). */
export function download(filename, content, type = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Delegate clicks on [data-act] inside ``root`` to ``handlers[act](el, event)``. */
export function onAct(root, handlers) {
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || !root.contains(el)) return;
    const fn = handlers[el.dataset.act];
    if (fn) { e.preventDefault(); Promise.resolve(fn(el, e)).catch(fail); }
  });
}

/* --------------------------------------------------------------- router */
const views = {};
let current = null;      // {name, view, root, ctx}
export const router = {
  register(name, view) { views[name] = view; },
  views,
  parse(hash = location.hash) {
    const raw = hash.replace(/^#\/?/, "");
    const [path, qs] = raw.split("?");
    const segs = (path || "").split("/").filter(Boolean).map(decodeURIComponent);
    return { name: segs[0] || "home", id: segs.slice(1).join("/") || "",
      params: Object.fromEntries(new URLSearchParams(qs || "")), raw };
  },
  href(name, id = "", params = null) {
    let h = `#/${name}`;
    if (id) h += "/" + encodeURIComponent(id);
    if (params) {
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null)).toString();
      if (q) h += "?" + q;
    }
    return h;
  },
  go(name, id = "", params = null, { replace = false } = {}) {
    const h = this.href(name, id, params);
    if (replace) { history.replaceState(null, "", h); this.render(); }
    else if (location.hash !== h) location.hash = h;
    else this.render();
  },
  current() { return current; },
  async render() {
    const ctx = this.parse();
    if (!views[ctx.name]) { this.go("home", "", null, { replace: true }); return; }
    if (current && current.name === ctx.name && current.view.update) {
      current.ctx = ctx;
      await current.view.update(ctx, current.root);
      this.onChange && this.onChange(ctx);
      return;
    }
    if (current && current.view.unmount) { try { current.view.unmount(); } catch (_) { /* */ } }
    closeMenus();
    const main = $("#main");
    const root = document.createElement("div");
    root.className = "view";
    root.style.height = "100%";
    main.replaceChildren(root);
    main.scrollTop = 0;
    current = { name: ctx.name, view: views[ctx.name], root, ctx };
    document.title = `${views[ctx.name].title || ctx.name} · OpenLeads`;
    this.onChange && this.onChange(ctx);
    try { await views[ctx.name].mount(root, ctx); }
    catch (e) { root.innerHTML = `<div class="page">${ui.empty("x", "This page hit an error", esc(e.message))}</div>`; console.error(e); }
  },
};
window.addEventListener("hashchange", () => router.render());
