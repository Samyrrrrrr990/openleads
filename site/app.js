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
      document.dispatchEvent(new Event("ol:bench"));
      const set = (k, v) => $$(`[data-bench="${k}"]`).forEach((el) => { el.textContent = v; });
      set("date", fmtDate(d.date));
      set("version", d.version || "");
      set("ok", t.queries_with_results);
      set("queries", t.queries);
      set("fill", Math.round((t.fill_rate || 0) * 100) + "%");
      set("evidence", Math.round((t.evidence_rate || 0) * 100) + "%");
    } catch (_) { /* keep the snapshot */ }
  })();

  /* ================================================================= motion */
  if (!reduced) document.documentElement.classList.add("js-motion");
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const inView = (el, fn, opts) => {
    if (!el) return;
    if (!("IntersectionObserver" in window)) { fn(); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.disconnect(); fn(); } }),
      opts || { threshold: 0.25 });
    io.observe(el);
  };
  const belowFold = (el) => el && el.getBoundingClientRect().top > window.innerHeight * 0.9;

  /* ---- headline: split into words that rise once ---- */
  const h1 = $(".hero h1");
  if (h1 && !reduced) {
    let d = 0;
    h1.innerHTML = h1.innerHTML.split(/(<br\s*\/?>)/).map((part) => /^<br/.test(part) ? part
      : part.split(/(\s+)/).map((w) => (w.trim() ? `<span class="w" style="--d:${d++}">${w}</span>` : w)).join("")).join("");
  }

  /* ---- hero map: a field of places; a ring wherever a business turns up ---- */
  const map = (() => {
    const cv = $("#hero-map");
    if (!cv || !cv.getContext || reduced) return { ping() {} };
    const ctx = cv.getContext("2d");
    const GAP = 22;
    let W = 0, H = 0, dpr = 1, pts = [], rings = [], raf = 0, visible = true;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pts = [];
      for (let y = GAP; y < H; y += GAP) {
        for (let x = GAP; x < W; x += GAP) {
          // a soft "coastline": keep dots where a cheap noise field is high
          const n = Math.sin(x * 0.011) + Math.cos(y * 0.017) + Math.sin((x + y) * 0.006);
          if (n > -0.35) pts.push([x + ((x * 7 + y * 3) % 5) - 2, y + ((x * 3 + y * 11) % 5) - 2]);
        }
      }
    };
    const frame = (t) => {
      raf = 0;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = css("--line-strong");
      for (const [x, y] of pts) ctx.fillRect(x, y, 1.6, 1.6);
      const good = css("--good"), ink = css("--text");
      rings = rings.filter((r) => t - r.t0 < r.life);
      for (const r of rings) {
        const k = (t - r.t0) / r.life;
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.strokeStyle = r.strong ? good : ink;
        ctx.lineWidth = r.strong ? 2 : 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, 3 + k * (r.strong ? 46 : 26), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = r.strong ? good : ink;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.strong ? 3.2 : 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (rings.length && visible) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf && visible) raf = requestAnimationFrame(frame); };
    const ping = (strong) => {
      if (!pts.length) return;
      const right = pts.filter(([x]) => x > W * 0.45);
      const [x, y] = (right.length ? right : pts)[Math.floor(Math.random() * (right.length || pts.length))];
      rings.push({ x, y, t0: performance.now(), life: strong ? 1600 : 1100, strong });
      kick();
    };
    resize();
    requestAnimationFrame(frame);
    window.addEventListener("resize", () => { resize(); kick(); }, { passive: true });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }).observe(cv);
    }
    // a quiet heartbeat while the hero is on screen
    setInterval(() => { if (visible && !document.hidden) ping(false); }, 900);
    return { ping };
  })();

  /* ---- hero: type the search, light the sources, rows land and resolve ---- */
  const result = $("#result");
  const q = $("#result-q");
  const meta = $("#result-meta");
  if (result && q && meta && !reduced) {
    const text = q.textContent;
    const done = meta.textContent;
    const rows = $$("tbody tr", result);
    const srcs = $$("#result-sources span", result);
    const finals = rows.map((r) => {
      const ev = $(".ev", r), how = $(".how", r);
      return { ev, cls: ev ? ev.className : "", how, word: how ? how.textContent : "" };
    });
    result.classList.add("is-staged", "is-typing");
    q.textContent = ""; meta.textContent = "";
    let i = 0;
    const later = (ms, fn) => setTimeout(fn, ms);
    const type = () => {
      q.textContent = text.slice(0, ++i);
      if (i < text.length) return later(30 + (i % 3) * 14, type);
      result.classList.remove("is-typing");
      meta.textContent = "searching";
      srcs.forEach((s, k) => {
        later(120 + k * 220, () => { s.classList.add("is-busy"); map.ping(false); });
        later(420 + k * 260, () => { s.classList.remove("is-busy"); s.classList.add("is-on"); });
      });
      rows.forEach((r, k) => {
        const f = finals[k];
        later(900 + k * 230, () => {
          if (f.ev) f.ev.className = "ev ev--pending";
          if (f.how) { f.how.textContent = "checking"; f.how.classList.add("is-typing"); }
          r.classList.add("is-in");
          meta.textContent = `${k + 1} found`;
        });
        later(1350 + k * 230 + (k % 3) * 120, () => {
          if (f.ev) { f.ev.className = f.cls + " is-resolved"; }
          if (f.how) { f.how.textContent = f.word; f.how.classList.remove("is-typing"); }
          map.ping(/safe/.test(f.cls));
          if (k === rows.length - 1) later(250, () => { meta.textContent = done; });
        });
      });
    };
    later(700, type);
  }

  /* ---- labels: the three marks arrive one by one ---- */
  const marks = $(".marks");
  if (marks && !reduced && belowFold(marks)) {
    $$(".mark-row", marks).forEach((r, k) => r.style.setProperty("--i", k));
    marks.classList.add("is-armed");
    inView(marks, () => marks.classList.add("is-in"));
  }

  /* ---- benchmark: the squares fill in, row by row ---- */
  const bench = $("#bench");
  const armBench = () => {
    if (!bench || reduced) return;
    $$("tbody tr", bench).forEach((tr, r) => $$(".strip .ev", tr).forEach((ev, k) => {
      ev.style.setProperty("--r", r); ev.style.setProperty("--i", k);
    }));
  };
  if (bench && !reduced && belowFold(bench)) {
    armBench();
    bench.classList.add("is-armed");
    inView(bench, () => bench.classList.add("is-in"), { threshold: 0.15 });
  }
  document.addEventListener("ol:bench", armBench);

  /* ---- the dashboard screenshot tilts up into place as you scroll ---- */
  const shot = $(".shot");
  if (shot && !reduced) {
    shot.classList.add("is-tilt");
    let ticking = false;
    const tilt = () => {
      ticking = false;
      const r = shot.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (r.top - vh * 0.25) / (vh * 0.7)));
      shot.style.setProperty("--tilt", p.toFixed(3));
    };
    window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(tilt); } }, { passive: true });
    tilt();
  }

  /* ---- workflow: items flow through the graph, on a loop while visible ---- */
  const flow = $("#flow");
  if (flow) {
    const SVGNS = "http://www.w3.org/2000/svg";
    const node = (n) => $(`[data-node="${n}"]`, flow);
    const count = (n, v) => { const t = $(".n", node(n)); if (t) t.textContent = v === "" ? "" : String(v); };
    const FINAL = { trigger: "", find: 10, verify: 10, write: 8, send: 8, review: 2, export: 2 };
    if (reduced) {
      Object.keys(FINAL).forEach((k) => count(k, FINAL[k]));
    } else {
      const dots = $("#flow-dots");
      const edge = (id) => $("#" + id, flow);
      const travel = (id, n, cls, gap) => new Promise((res) => {
        const path = edge(id); const len = path.getTotalLength();
        path.classList.add("is-live");
        let left = n;
        for (let k = 0; k < n; k++) {
          const c = document.createElementNS(SVGNS, "circle");
          c.setAttribute("r", "4"); if (cls) c.setAttribute("class", cls);
          dots.appendChild(c);
          const t0 = performance.now() + k * gap, dur = 520;
          const step = (t) => {
            const kk = Math.min(1, Math.max(0, (t - t0) / dur));
            const pt = path.getPointAtLength(kk * len);
            c.setAttribute("cx", pt.x); c.setAttribute("cy", pt.y);
            c.style.opacity = t < t0 ? 0 : 1;
            if (kk < 1) requestAnimationFrame(step);
            else { c.remove(); if (--left === 0) { path.classList.remove("is-live"); res(); } }
          };
          requestAnimationFrame(step);
        }
      });
      const light = (n, v) => { const g = node(n); g.classList.remove("is-on"); void g.getBBox(); g.classList.add("is-on"); if (v !== undefined) count(n, v); };
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let running = false, onScreen = false;
      const run = async () => {
        if (running) return; running = true;
        while (onScreen) {
          Object.keys(FINAL).forEach((k) => { count(k, ""); node(k).classList.remove("is-on"); });
          light("trigger"); await wait(350);
          await travel("e1", 1, "", 0); light("find"); 
          for (let k = 1; k <= 10; k++) { count("find", k); await wait(60); }
          await travel("e2", 10, "", 70); light("verify", 10); await wait(250);
          await Promise.all([
            travel("e3", 8, "is-safe", 80).then(() => { light("write", 8); return travel("e5", 8, "is-safe", 60); }).then(() => light("send", 8)),
            travel("e4", 2, "is-risky", 240).then(() => { light("review", 2); return travel("e6", 2, "is-risky", 120); }).then(() => light("export", 2)),
          ]);
          await wait(2600);
        }
        running = false;
      };
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) run(); }, { threshold: 0.35 }).observe(flow);
      } else { Object.keys(FINAL).forEach((k) => count(k, FINAL[k])); }
    }
  }
})();
