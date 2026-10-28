/* OpenLeads site: copy buttons, the live benchmark, the star count and one
   hero sequence. Everything on the page is readable without this script. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- nav rule once the page scrolls ---- */
  const nav = $("#nav");
  const onScroll = () => nav && nav.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---- copy ---- */
  const toast = $("#toast");
  let toastTimer;
  function say(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-on"), 1800);
  }
  $$("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy");
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add("is-copied");
        const hint = $(".cmd__hint", btn);
        if (hint) hint.textContent = "Copied";
        setTimeout(() => { btn.classList.remove("is-copied"); if (hint) hint.textContent = "Copy"; }, 1600);
      } catch (_) {
        say("Select the command and copy it");
      }
    });
  });

  /* ---- GitHub stars ---- */
  (async () => {
    const el = $("[data-stars]");
    if (!el) return;
    try {
      const res = await fetch("https://api.github.com/repos/Samyrrrrrr990/openleads", { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) return;
      const n = (await res.json()).stargazers_count;
      if (typeof n === "number") {
        el.textContent = n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);
        el.hidden = false;
        el.setAttribute("aria-label", `${n} stars`);
      }
    } catch (_) { /* offline: the button still works */ }
  })();

  /* ---- the benchmark, live from the repo (the page ships the last snapshot) ---- */
  const BENCH_URL = "https://raw.githubusercontent.com/Samyrrrrrr990/openleads/main/bench/latest.json";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso) => {
    const d = new Date(iso + "T12:00:00Z");
    return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  };
  function row(q, n) {
    const leads = Math.max(0, q.leads | 0);
    const cells = [].concat(
      Array(q.found | 0).fill("found"), Array(q.pattern | 0).fill("pattern"), Array(q.guessed | 0).fill("guessed"),
    ).slice(0, leads);
    while (cells.length < n) cells.push("none");
    const strip = cells.slice(0, n).map((c) => `<i class="ev ev--${c}"></i>`).join("");
    return `<tr${leads ? "" : ' class="is-empty"'}><td class="q">${esc(q.query)}</td>`
      + `<td><span class="strip" aria-label="${leads} of ${n} returned">${strip}</span></td>`
      + `<td class="n">${leads}</td><td class="n">${q.found | 0}</td><td class="n">${q.pattern | 0}</td>`
      + `<td class="n">${q.guessed | 0}</td><td class="n t">${Math.round(q.seconds || 0)} s</td></tr>`;
  }
  (async () => {
    const body = $("#bench-rows");
    if (!body) return;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(BENCH_URL, { signal: ctrl.signal, cache: "no-cache" });
      clearTimeout(timer);
      if (!res.ok) return;
      const d = await res.json();
      const n = d.count_per_query || 10, t = d.totals || {};
      if (!Array.isArray(d.queries) || !d.queries.length) return;
      body.innerHTML = d.queries.map((q) => row(q, n)).join("");
      const set = (k, v) => $$(`[data-bench="${k}"]`).forEach((el) => { el.textContent = v; });
      set("date", fmtDate(d.date));
      set("version", d.version || "");
      set("ok", t.queries_with_results);
      set("queries", t.queries);
      set("fill", Math.round((t.fill_rate || 0) * 100) + "%");
      set("evidence", Math.round((t.evidence_rate || 0) * 100) + "%");
    } catch (_) { /* keep the snapshot */ }
  })();

  /* ---- hero: type the search, then the results land, once ---- */
  const result = $("#result");
  const q = $("#result-q");
  const meta = $("#result-meta");
  if (result && q && meta && !reduced) {
    const text = q.textContent;
    const done = meta.textContent;
    const rows = $$("tbody tr", result);
    result.classList.add("is-staged", "is-typing");
    q.textContent = "";
    meta.textContent = "";
    let i = 0;
    const type = () => {
      q.textContent = text.slice(0, ++i);
      if (i < text.length) return setTimeout(type, 34 + (i % 3) * 14);
      result.classList.remove("is-typing");
      meta.textContent = "searching";
      rows.forEach((r, k) => setTimeout(() => {
        r.classList.add("is-in");
        if (k === rows.length - 1) meta.textContent = done;
      }, 380 + k * 140));
    };
    setTimeout(type, 450);
  }
})();
