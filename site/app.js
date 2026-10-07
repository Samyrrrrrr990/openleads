/* OpenLeads marketing site. Vanilla, dependency-free. */
"use strict";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- nav hairline once the page has scrolled (sentinel, no scroll listener) ---- */
const nav = document.getElementById("nav");
if (nav && "IntersectionObserver" in window) {
  const sentinel = document.createElement("div");
  sentinel.style.cssText = "position:absolute;top:0;left:0;width:1px;height:12px;pointer-events:none";
  document.body.prepend(sentinel);
  new IntersectionObserver(([e]) => nav.classList.toggle("scrolled", !e.isIntersecting)).observe(sentinel);
}

/* ---- copy to clipboard ---- */
const toast = document.getElementById("toast");
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}
document.querySelectorAll("[data-copy]").forEach((btn) => {
  let t;
  btn.addEventListener("click", async () => {
    const text = btn.getAttribute("data-copy");
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add("copied");
      clearTimeout(t);
      t = setTimeout(() => btn.classList.remove("copied"), 1600);
      showToast("Copied to clipboard");
    } catch (_) {
      showToast(text);
    }
  });
});

/* ---- scroll reveals: things entering together cascade by 60ms ---- */
const reveals = document.querySelectorAll(".reveal");
if (reduceMotion || !("IntersectionObserver" in window)) {
  reveals.forEach((r) => r.classList.add("in"));
} else {
  const io = new IntersectionObserver((entries) => {
    let k = 0;
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.style.transitionDelay = Math.min(k++, 5) * 60 + "ms";
      e.target.classList.add("in");
      io.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  reveals.forEach((r) => io.observe(r));
}

/* ---- install segmented control (tabs) ---- */
const seg = document.querySelector(".seg");
if (seg) {
  const tabs = Array.from(seg.querySelectorAll('[role="tab"]'));
  const select = (i, focus) => {
    seg.dataset.active = String(i);
    tabs.forEach((tab, j) => {
      const on = i === j;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      panel.hidden = !on;
      if (on) { panel.classList.remove("is-in"); void panel.offsetWidth; panel.classList.add("is-in"); }
    });
    if (focus) tabs[i].focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i));
    tab.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        select((i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length, true);
      }
    });
  });
}

/* ---- benchmark data: live from the repo, with the last snapshot as fallback ---- */
const BENCH_URL = "https://raw.githubusercontent.com/Samyrrrrrr990/openleads/main/bench/latest.json";
const SNAPSHOT = {
  date: "2026-10-07",
  count_per_query: 10,
  totals: { queries: 12, queries_with_results: 12, fill_rate: 0.842, evidence_rate: 0.317, junk_rate: 0 },
  queries: [
    ["dentists in Austin", 10, 6, 4, 0, 6, 67.7],
    ["software companies in Berlin", 10, 3, 7, 0, 3, 57.0],
    ["real estate agents in Chicago", 10, 3, 9, 0, 1, 53.6],
    ["law firms in London", 10, 8, 2, 0, 8, 66.0],
    ["fintech founders", 10, 9, 1, 0, 9, 8.7],
    ["marketing agencies in Miami", 4, 3, 2, 0, 2, 38.5],
    ["accountants in Toronto", 10, 7, 3, 0, 7, 63.0],
    ["rust developers in Berlin", 10, 10, 0, 0, 10, 5.4],
    ["gyms in Sydney", 4, 1, 3, 0, 1, 67.3],
    ["emails at stripe.com", 3, 3, 1, 0, 2, 2.9],
  ].map(([query, leads, people, found, pattern, guessed, seconds]) =>
    ({ query, leads, people, found, pattern, guessed, seconds })),
};

async function loadBench() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(BENCH_URL, { signal: ctrl.signal, cache: "no-cache" });
    clearTimeout(timer);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    const qs = (d.queries || []).filter((q) => !q.error && q.leads > 0);
    if (!d.totals || !qs.length) throw new Error("empty");
    // Lead with the searches that show the full range: found, guessed, and gaps.
    qs.sort((a, b) => (b.found > 0 && b.found < b.leads) - (a.found > 0 && a.found < a.leads));
    return { ...d, queries: qs };
  } catch (_) {
    return SNAPSHOT;
  }
}

function fmtDate(iso) {
  const d = new Date(iso + "T12:00:00Z");
  return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function fillStats(d) {
  const t = d.totals;
  const set = (k, v) => document.querySelectorAll(`[data-bench="${k}"]`).forEach((el) => { el.textContent = v; });
  set("date", fmtDate(d.date));
  set("ok", t.queries_with_results);
  set("queries", t.queries);
  set("fill", Math.round(t.fill_rate * 100));
  set("evidence", Math.round(t.evidence_rate * 100));
  set("junk", Math.round(t.junk_rate * 100));
}

/* ---- spotlight: types each benchmark search, then fills one tile per requested lead ---- */
const qEl = document.getElementById("spot-q");
const tilesEl = document.getElementById("spot-tiles");
const metaEl = document.getElementById("spot-meta");
const spotEl = document.querySelector(".spot");

function kinds(q, per) {
  const out = [];
  for (let i = 0; i < q.found; i++) out.push("found");
  for (let i = 0; i < q.pattern; i++) out.push("pattern");
  for (let i = 0; i < q.guessed; i++) out.push("guessed");
  while (out.length < per) out.push("none");
  return out.slice(0, per);
}

function ensureTiles(per) {
  while (tilesEl.children.length < per) {
    const s = document.createElement("span");
    s.className = "tile";
    tilesEl.appendChild(s);
  }
  while (tilesEl.children.length > per) tilesEl.lastElementChild.remove();
  tilesEl.style.gridTemplateColumns = `repeat(${per}, 1fr)`;
}

function setMeta(q) {
  const v = { leads: q.leads, people: q.people, found: q.found, seconds: Math.round(q.seconds) + "s" };
  metaEl.querySelectorAll("dd").forEach((dd) => { dd.textContent = v[dd.dataset.f]; });
}

function renderStatic(q, per) {
  qEl.textContent = q.query;
  ensureTiles(per);
  kinds(q, per).forEach((k, i) => { const t = tilesEl.children[i]; t.dataset.k = k; t.classList.remove("is-out"); });
  setMeta(q);
}

// Pause the loop while the card is off screen or the tab is hidden.
let onScreen = true;
let wake = null;
const waitVisible = () => (onScreen && !document.hidden)
  ? Promise.resolve()
  : new Promise((r) => { wake = r; });
const maybeWake = () => { if (onScreen && !document.hidden && wake) { wake(); wake = null; } };
document.addEventListener("visibilitychange", maybeWake);

async function typeQuery(text) {
  for (let i = 1; i <= text.length; i++) {
    qEl.textContent = text.slice(0, i);
    await sleep(38 + Math.random() * 34);
  }
}
async function eraseQuery() {
  const text = qEl.textContent;
  for (let i = text.length - 1; i >= 0; i--) {
    qEl.textContent = text.slice(0, i);
    await sleep(14);
  }
}

async function runSpotlight(d) {
  const per = d.count_per_query || 10;
  const qs = d.queries;
  ensureTiles(per);
  // First frame: the card already shows a complete result (no layout shift).
  renderStatic(qs[0], per);
  if (reduceMotion) return;

  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; maybeWake(); }, { threshold: 0.2 }).observe(spotEl);

  let i = 0;
  for (;;) {
    await sleep(3600);
    await waitVisible();
    // out
    Array.from(tilesEl.children).forEach((t) => t.classList.add("is-out"));
    metaEl.classList.add("is-out");
    await eraseQuery();
    // in
    i = (i + 1) % qs.length;
    const q = qs[i];
    await sleep(180);
    await typeQuery(q.query);
    await sleep(240);
    setMeta(q);
    metaEl.classList.remove("is-out");
    kinds(q, per).forEach((k, j) => {
      const t = tilesEl.children[j];
      t.dataset.k = k;
      setTimeout(() => t.classList.remove("is-out"), j * 40);
    });
  }
}

if (qEl && tilesEl && metaEl) {
  loadBench().then((d) => { fillStats(d); runSpotlight(d); });
}
