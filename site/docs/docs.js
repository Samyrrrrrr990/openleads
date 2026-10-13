/* OpenLeads docs: menu, scroll-spy, copy buttons, stars, and Cmd+K search. Dependency-free. */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---- mobile sidebar ---- */
const toggle = $("#dsbToggle");
const setMenu = (open) => {
  document.body.classList.toggle("menu-open", open);
  if (toggle) toggle.setAttribute("aria-expanded", String(open));
};
if (toggle) {
  toggle.addEventListener("click", () => setMenu(!document.body.classList.contains("menu-open")));
  $$(".dsb__link").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  document.addEventListener("click", (e) => {
    if (document.body.classList.contains("menu-open") && !e.target.closest(".dsb, #dsbToggle")) setMenu(false);
  });
}

/* ---- scroll-spy for the right rail ---- */
const tocLinks = $$(".dtoc > a[href^='#']");
if (tocLinks.length && "IntersectionObserver" in window) {
  const byId = new Map(tocLinks.map((a) => [a.getAttribute("href").slice(1), a]));
  let active = null;
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      if (active) active.classList.remove("active");
      active = byId.get(e.target.id);
      if (active) active.classList.add("active");
    });
  }, { rootMargin: "-80px 0px -70% 0px", threshold: 0 });
  tocLinks.forEach((a) => { const h = document.getElementById(a.getAttribute("href").slice(1)); if (h) spy.observe(h); });
}

/* ---- copy buttons on code blocks ---- */
$$(".codeblock__copy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const code = btn.closest(".codeblock").querySelector("code").innerText;
    const label = btn.querySelector("span");
    try {
      await navigator.clipboard.writeText(code);
      btn.classList.add("is-done"); label.textContent = "Copied";
    } catch (_) { label.textContent = "Press Cmd+C"; }
    setTimeout(() => { btn.classList.remove("is-done"); label.textContent = "Copy"; }, 1600);
  });
});

/* ---- live GitHub stars (shared cache with the home page) ---- */
(async () => {
  const els = $$("[data-stars]");
  if (!els.length) return;
  let n = null;
  try {
    const hit = JSON.parse(sessionStorage.getItem("ol-stars") || "null");
    if (hit && Date.now() - hit.t < 10 * 60 * 1000) n = hit.n;
  } catch (_) {}
  if (n == null) {
    try {
      const res = await fetch("https://api.github.com/repos/Samyrrrrrr990/openleads");
      if (res.ok) n = (await res.json()).stargazers_count;
      try { sessionStorage.setItem("ol-stars", JSON.stringify({ n, t: Date.now() })); } catch (_) {}
    } catch (_) {}
  }
  if (typeof n !== "number") return;
  const label = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
  els.forEach((el) => { el.textContent = label; el.hidden = false; });
})();

/* ---- search ---- */
const dlg = $("#search");
const input = $("#searchInput");
const list = $("#searchResults");
let index = null, results = [], sel = 0, lastFocus = null;

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const highlight = (text, terms) => {
  let out = esc(text);
  terms.forEach((t) => { if (t.length > 1) out = out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>"); });
  return out;
};
const snippet = (text, terms) => {
  const lower = text.toLowerCase();
  const at = Math.max(0, Math.min(...terms.map((t) => { const i = lower.indexOf(t); return i < 0 ? Infinity : i; })));
  const start = isFinite(at) ? Math.max(0, at - 50) : 0;
  return (start > 0 ? "…" : "") + text.slice(start, start + 180);
};

async function loadIndex() {
  if (index) return index;
  try { index = await (await fetch("search.json")).json(); } catch (_) { index = []; }
  return index;
}

function search(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return index.map((r) => {
    const h = r.h.toLowerCase(), p = r.p.toLowerCase(), t = r.t.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const s = (h.includes(term) ? 6 : 0) + (p.includes(term) ? 3 : 0) + (t.includes(term) ? 1 : 0);
      if (!s) return null;
      score += s + (h.startsWith(term) ? 2 : 0);
    }
    return { r, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12).map((x) => x.r);
}

function render() {
  const q = input.value.trim();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  results = q ? search(q) : [];
  sel = 0;
  if (q && !results.length) { list.innerHTML = `<li class="search__empty">No results for “${esc(q)}”</li>`; return; }
  list.innerHTML = results.map((r, i) => `<li><a href="${r.u}" role="option" aria-selected="${i === sel}">
    <span class="r-path">${esc(r.s)} / ${esc(r.p)}</span>
    <span class="r-head">${highlight(r.h, terms)}</span>
    ${r.t ? `<span class="r-text">${highlight(snippet(r.t, terms), terms)}</span>` : ""}</a></li>`).join("");
}

function move(d) {
  const items = $$("a", list);
  if (!items.length) return;
  sel = (sel + d + items.length) % items.length;
  items.forEach((a, i) => a.setAttribute("aria-selected", String(i === sel)));
  items[sel].scrollIntoView({ block: "nearest" });
}

async function openSearch() {
  if (!dlg) return;
  lastFocus = document.activeElement;
  setMenu(false);
  dlg.hidden = false;
  input.value = "";
  list.innerHTML = "";
  input.focus();
  await loadIndex();
}
function closeSearch() {
  if (!dlg || dlg.hidden) return;
  dlg.hidden = true;
  if (lastFocus) lastFocus.focus();
}

$$("[data-search-open]").forEach((b) => b.addEventListener("click", openSearch));
$$("[data-search-close]").forEach((b) => b.addEventListener("click", closeSearch));
if (input) {
  input.addEventListener("input", async () => { await loadIndex(); render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { const a = $$("a", list)[sel]; if (a) { e.preventDefault(); location.href = a.href; } }
  });
}
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); dlg.hidden ? openSearch() : closeSearch(); }
  else if (e.key === "/" && dlg && dlg.hidden && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
  else if (e.key === "Escape") closeSearch();
});
