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
  // threshold 0: tall blocks (the bento, the canvas) used to stay blank until 12% of
  // them was on screen, which left whole viewports empty mid-scroll.
  }, { threshold: 0, rootMargin: "0px 0px -40px 0px" });
  reveals.forEach((r) => io.observe(r));
}

/* ---- GitHub stars: one live count for every [data-stars] badge ---- */
const REPO_API = "https://api.github.com/repos/Samyrrrrrr990/openleads";
(async () => {
  const els = document.querySelectorAll("[data-stars]");
  if (!els.length) return;
  let n = null;
  try {
    const hit = JSON.parse(sessionStorage.getItem("ol-stars") || "null");
    if (hit && Date.now() - hit.t < 10 * 60 * 1000) n = hit.n;
  } catch (_) {}
  if (n == null) {
    try {
      const res = await fetch(REPO_API, { headers: { Accept: "application/vnd.github+json" } });
      if (res.ok) n = (await res.json()).stargazers_count;
      try { sessionStorage.setItem("ol-stars", JSON.stringify({ n, t: Date.now() })); } catch (_) {}
    } catch (_) {}
  }
  if (typeof n !== "number") return;
  const label = n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);
  els.forEach((el) => { el.textContent = label; el.hidden = false; });
})();

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

/* ---- workflow canvas: an n8n-style run that replays the benchmark searches ---- */
const canvas = document.getElementById("canvas");
const NODE_W = 160, NODE_H = 72;  // in the 1000x400 stage space

function layoutCanvas() {
  const nodes = {};
  canvas.querySelectorAll(".node").forEach((n) => {
    const x = +n.dataset.x, y = +n.dataset.y;
    n.style.left = x / 10 + "%";
    n.style.top = y / 4 + "%";
    nodes[n.dataset.node] = { el: n, x, y };
  });
  const edges = {};
  canvas.querySelectorAll("[data-edge]").forEach((path) => {
    const [a, b] = path.dataset.edge.split(">");
    const A = nodes[a], B = nodes[b];
    const x1 = A.x + NODE_W, y1 = A.y + NODE_H / 2, x2 = B.x, y2 = B.y + NODE_H / 2;
    const dx = Math.max(36, (x2 - x1) / 2);
    path.setAttribute("d", `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    edges[path.dataset.edge] = path;
  });
  return { nodes, edges };
}

function runCanvas(d) {
  const { nodes, edges } = layoutCanvas();
  const svg = canvas.querySelector(".canvas__edges");
  const log = document.getElementById("canvas-log");
  const status = document.querySelector("#canvas-status span");
  const findQ = document.getElementById("node-find-q");
  const qs = d.queries;

  const badge = (k, txt) => { nodes[k].el.querySelector(".node__badge").textContent = txt; };
  const state = (k, st) => {
    nodes[k].el.classList.toggle("is-running", st === "running");
    nodes[k].el.classList.toggle("is-done", st === "done");
  };
  let clock = 0;
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = () => `09:${pad(Math.floor(clock / 60))}:${pad(clock % 60)}`;
  const say = (html) => {
    const li = document.createElement("li");
    li.innerHTML = `<time>${stamp()}</time><span>${html}</span>`;
    log.appendChild(li);
    while (log.children.length > 4) log.firstElementChild.remove();
  };
  const reset = () => {
    Object.keys(nodes).forEach((k) => { state(k, ""); badge(k, ""); });
    Object.values(edges).forEach((e) => e.classList.remove("is-live", "is-done"));
    log.textContent = "";
    clock = 0;
  };
  const counts = (q) => {
    const safe = q.found + q.pattern;
    return { leads: q.leads, safe, held: Math.max(0, q.leads - safe), secs: Math.round(q.seconds) };
  };

  // A dot that travels along an edge, like n8n's data flowing between nodes.
  function flow(key, ms = 520) {
    const path = edges[key];
    path.classList.add("is-live");
    if (reduceMotion) { path.classList.replace("is-live", "is-done"); return Promise.resolve(); }
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("r", "5");
    svg.appendChild(dot);
    const len = path.getTotalLength();
    return new Promise((done) => {
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms);
        const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const pt = path.getPointAtLength(len * e);
        dot.setAttribute("cx", pt.x); dot.setAttribute("cy", pt.y);
        if (k < 1) requestAnimationFrame(step);
        else { dot.remove(); path.classList.replace("is-live", "is-done"); done(); }
      };
      requestAnimationFrame(step);
    });
  }
  async function countUp(k, to, suffix, ms) {
    const steps = Math.max(1, to);
    for (let i = 0; i <= to; i++) { badge(k, `${i} ${suffix}`); await sleep(ms / steps); }
  }

  function finalState(q) {
    const c = counts(q);
    findQ.textContent = q.query;
    Object.keys(nodes).forEach((k) => state(k, "done"));
    Object.values(edges).forEach((e) => e.classList.add("is-done"));
    badge("trigger", "fired"); badge("find", `${c.leads} items`); badge("verify", `${c.safe} safe`);
    badge("write", `${c.safe} drafts`); badge("send", `${c.safe} queued`);
    badge("review", `${c.held} held`); badge("export", `${c.leads} rows`);
    canvas.dataset.state = "done";
    status.textContent = `Succeeded in ${c.secs}s`;
  }

  // First frame is a finished run, so the card never looks empty.
  finalState(qs[0]);
  say(`<b>Find leads</b> returned ${counts(qs[0]).leads} leads for “${qs[0].query}”`);
  if (reduceMotion) return;

  let visible = false, wakeCanvas = null;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !document.hidden && wakeCanvas) { wakeCanvas(); wakeCanvas = null; }
  }, { threshold: 0.25 }).observe(canvas);
  document.addEventListener("visibilitychange", () => {
    if (visible && !document.hidden && wakeCanvas) { wakeCanvas(); wakeCanvas = null; }
  });
  const ready = () => (visible && !document.hidden) ? Promise.resolve() : new Promise((r) => { wakeCanvas = r; });

  (async () => {
    for (let i = 0; ; i = (i + 1) % qs.length) {
      await ready();
      const q = qs[i], c = counts(q);
      reset();
      findQ.textContent = q.query;
      canvas.dataset.state = "running";
      status.textContent = "Running";

      state("trigger", "running"); badge("trigger", "fired");
      say("<b>Schedule</b> fired, weekdays at 09:00");
      await sleep(500); state("trigger", "done");
      await flow("trigger>find");

      state("find", "running");
      say(`<b>Find leads</b> searching “${q.query}”`);
      await countUp("find", c.leads, "items", 1300);
      clock += Math.round(c.secs * .8);
      state("find", "done");
      say(`<b>Find leads</b> returned ${c.leads} leads, ${q.people} named people`);
      await flow("find>verify");

      state("verify", "running"); badge("verify", "checking");
      await sleep(800);
      clock += Math.max(1, Math.round(c.secs * .15));
      badge("verify", `${c.safe} safe`); state("verify", "done");
      say(`<b>Verify</b> ${c.safe} safe, ${c.held} held for review`);
      await Promise.all([flow("verify>write"), flow("verify>review")]);

      state("write", "running"); state("review", "running");
      badge("write", "writing"); badge("review", `${c.held} held`);
      await sleep(700);
      clock += 2;
      badge("write", `${c.safe} drafts`); state("write", "done"); state("review", "done");
      say(`<b>Write</b> ${c.safe} drafts, 0 spam flags`);
      await Promise.all([flow("write>send"), flow("review>export")]);

      state("send", "running"); state("export", "running"); badge("export", "exporting");
      await countUp("send", c.safe, "queued", 600);
      badge("export", `${c.leads} rows`);
      clock += 1;
      state("send", "done"); state("export", "done");
      say(`<b>Send</b> ${c.safe} queued under the warmup cap. <b>Export</b> ${c.leads} rows`);
      canvas.dataset.state = "done";
      status.textContent = `Succeeded in ${c.secs}s`;
      await sleep(4200);
    }
  })();
}

if (qEl && tilesEl && metaEl) {
  loadBench().then((d) => {
    fillStats(d);
    runSpotlight(d);
    if (canvas) runCanvas(d);
  });
} else if (canvas) {
  loadBench().then(runCanvas);
}
