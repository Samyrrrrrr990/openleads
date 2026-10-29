/* OpenLeads docs: the mobile menu, the on-this-page highlight, copy buttons,
   the GitHub star count and search. Dependency-free; every page reads fine
   without it. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const body = document.body;

  /* ---- shortcut labels: ⌘K on Apple devices, Ctrl K elsewhere ---- */
  const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  if (!apple) $$("kbd[data-mod-k]").forEach((k) => { k.textContent = "Ctrl K"; });

  /* ---- mobile menu: the rail opens as a sheet under the nav ---- */
  const toggle = $("#dsbToggle");
  const menuOpen = () => body.classList.contains("menu-open");
  const setMenu = (open) => {
    body.classList.toggle("menu-open", open);
    if (!toggle) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close the docs menu" : "Open the docs menu");
  };
  if (toggle) {
    toggle.addEventListener("click", () => setMenu(!menuOpen()));
    $$(".dsb a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
    const wide = window.matchMedia("(min-width: 961px)");
    const onWide = (e) => { if (e.matches) setMenu(false); };
    if (wide.addEventListener) wide.addEventListener("change", onWide);
  }

  /* ---- on this page: mark the section being read ---- */
  const pairs = $$(".dtoc__list a[href^='#']")
    .map((a) => ({ a, h: document.getElementById(decodeURIComponent(a.hash.slice(1))) }))
    .filter((p) => p.h);
  if (pairs.length) {
    let current = null;
    let queued = false;
    const update = () => {
      queued = false;
      const line = 120;                       // px from the top of the viewport
      let on = null;
      for (const p of pairs) {
        if (p.h.getBoundingClientRect().top <= line) on = p;
        else break;
      }
      const root = document.documentElement;
      if (window.scrollY > 0 && window.innerHeight + window.scrollY >= root.scrollHeight - 2) on = pairs[pairs.length - 1];
      if (on === current) return;
      if (current) { current.a.classList.remove("is-active"); current.a.removeAttribute("aria-current"); }
      current = on;
      if (current) { current.a.classList.add("is-active"); current.a.setAttribute("aria-current", "location"); }
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue, { passive: true });
    update();
  }

  /* ---- copy buttons on code blocks ---- */
  $$(".codeblock__copy").forEach((btn) => {
    let timer;
    btn.addEventListener("click", async () => {
      const code = btn.parentElement.querySelector("code");
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.innerText);
        btn.textContent = "Copied";
        btn.classList.add("is-done");
      } catch (_) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        btn.textContent = "Selected";
      }
      btn.setAttribute("aria-label", btn.textContent);
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.textContent = "Copy";
        btn.setAttribute("aria-label", "Copy code");
        btn.classList.remove("is-done");
      }, 1600);
    });
  });

  /* ---- GitHub stars (same as the landing page, cached for ten minutes) ---- */
  (async () => {
    const els = $$("[data-stars]");
    if (!els.length) return;
    let n = null;
    try {
      const hit = JSON.parse(sessionStorage.getItem("ol-stars") || "null");
      if (hit && typeof hit.n === "number" && Date.now() - hit.t < 10 * 60 * 1000) n = hit.n;
    } catch (_) { /* storage blocked */ }
    if (n === null) {
      try {
        const res = await fetch("https://api.github.com/repos/Samyrrrrrr990/openleads", { headers: { Accept: "application/vnd.github+json" } });
        if (!res.ok) return;
        n = (await res.json()).stargazers_count;
        if (typeof n === "number") {
          try { sessionStorage.setItem("ol-stars", JSON.stringify({ n, t: Date.now() })); } catch (_) { /* storage blocked */ }
        }
      } catch (_) { return; /* offline: the button still works */ }
    }
    if (typeof n !== "number") return;
    const label = n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);
    els.forEach((el) => {
      el.textContent = label;
      el.hidden = false;
      el.setAttribute("aria-label", `${n} stars`);
    });
  })();

  /* ---- search ---- */
  const dlg = $("#search");
  const input = $("#searchInput");
  const list = $("#searchResults");
  const empty = $("#searchEmpty");
  if (!dlg || !input || !list) return;
  let index = null;
  let results = [];
  let sel = 0;
  let lastFocus = null;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const highlight = (text, terms) => {
    let out = esc(text);
    terms.forEach((t) => { if (t.length > 1) out = out.replace(new RegExp(`(${reEsc(esc(t))})`, "gi"), "<mark>$1</mark>"); });
    return out;
  };
  const snippet = (text, terms) => {
    const lower = text.toLowerCase();
    const at = Math.min(...terms.map((t) => { const i = lower.indexOf(t); return i < 0 ? Infinity : i; }));
    const start = isFinite(at) ? Math.max(0, at - 50) : 0;
    return (start > 0 ? "…" : "") + text.slice(start, start + 180);
  };

  async function loadIndex() {
    if (index) return index;
    try { index = await (await fetch("search.json")).json(); } catch (_) { index = []; }
    return index;
  }

  function find(q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length || !index) return [];
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

  function select(i) {
    const items = $$("a", list);
    if (!items.length) { input.removeAttribute("aria-activedescendant"); return; }
    sel = (i + items.length) % items.length;
    items.forEach((a, k) => a.setAttribute("aria-selected", String(k === sel)));
    input.setAttribute("aria-activedescendant", items[sel].id);
    items[sel].scrollIntoView({ block: "nearest" });
  }

  function show() {
    const q = input.value.trim();
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    results = q ? find(q) : [];
    list.innerHTML = results.map((r, i) => `<li role="presentation"><a id="sr-${i}" href="${esc(r.u)}" role="option" aria-selected="false">
      <span class="r-path">${esc(r.s)} / ${esc(r.p)}</span>
      <span class="r-head">${highlight(r.h, terms)}</span>
      ${r.t ? `<span class="r-text">${highlight(snippet(r.t, terms), terms)}</span>` : ""}</a></li>`).join("");
    input.setAttribute("aria-expanded", String(results.length > 0));
    if (empty) {
      empty.hidden = !(q && !results.length);
      empty.textContent = empty.hidden ? "" : `No results for “${q}”`;
    }
    select(0);
  }

  async function openSearch() {
    lastFocus = document.activeElement;
    setMenu(false);
    dlg.hidden = false;
    input.value = "";
    show();
    input.focus();
    await loadIndex();
  }
  function closeSearch() {
    if (dlg.hidden) return;
    dlg.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  $$("[data-search-open]").forEach((b) => b.addEventListener("click", openSearch));
  $$("[data-search-close]").forEach((b) => b.addEventListener("click", closeSearch));
  input.addEventListener("input", async () => { await loadIndex(); show(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); select(sel + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); select(sel - 1); }
    else if (e.key === "Enter") {
      const a = $$("a", list)[sel];
      if (a) { e.preventDefault(); closeSearch(); location.href = a.href; }
    }
  });
  list.addEventListener("click", (e) => { if (e.target.closest("a")) closeSearch(); });
  // keep Tab inside the dialog while it is open
  dlg.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = $$("input, button, a[href]", dlg).filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  document.addEventListener("keydown", (e) => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (dlg.hidden) openSearch(); else closeSearch();
    } else if (e.key === "/" && dlg.hidden && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      openSearch();
    } else if (e.key === "Escape") {
      if (!dlg.hidden) closeSearch();
      else if (menuOpen()) { setMenu(false); if (toggle) toggle.focus(); }
    }
  });
})();
