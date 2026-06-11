/* OpenLeads marketing site — vanilla, dependency-free. */
"use strict";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---- nav shadow on scroll ---- */
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 12);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

/* ---- copy-to-clipboard ---- */
const toast = document.getElementById("toast");
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = btn.getAttribute("data-copy");
    try {
      await navigator.clipboard.writeText(text);
      showToast("copied  ·  " + text);
    } catch (_) {
      showToast(text);
    }
  });
});

/* ---- scroll reveals ---- */
const reveals = document.querySelectorAll(".reveal");
if (reduceMotion || !("IntersectionObserver" in window)) {
  reveals.forEach((r) => r.classList.add("in"));
} else {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        const els = Array.from(e.target.parentElement.querySelectorAll(".reveal"));
        const idx = els.indexOf(e.target);
        e.target.style.transitionDelay = Math.min(idx, 5) * 70 + "ms";
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });
  reveals.forEach((r) => io.observe(r));
}

/* ---- flow line draws when the flow section enters ---- */
const flowLine = document.getElementById("flow-line");
if (flowLine) {
  if (reduceMotion) { flowLine.style.width = "100%"; }
  else {
    const fio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { flowLine.style.width = "100%"; fio.disconnect(); }
      });
    }, { threshold: 0.4 });
    fio.observe(document.getElementById("flow"));
  }
}

/* ---- animated terminal demo ---- */
const term = document.getElementById("term-body");
const SCRIPT = [
  { t: "cmd", s: 'openleads run "50 AI founders in SF, verified only" --live' },
  { t: "gap" },
  { t: "dim", s: "[engine] source=yc (startup founders) — searching…" },
  { t: "lead", tier: "safe", email: "ada@anthropic-founders.ai", who: "Ada N.", sc: 96 },
  { t: "lead", tier: "safe", email: "grace@hopperlabs.dev", who: "Grace H.", sc: 91 },
  { t: "lead", tier: "risky", email: "j.doe@stealth.io", who: "J. Doe", sc: 58 },
  { t: "lead", tier: "safe", email: "lin@tensor.so", who: "Lin K.", sc: 89 },
  { t: "dim", s: "[engine] done — 41 safe · 9 risky" },
  { t: "gap" },
  { t: "dim", s: "[write] drafting 41 personalized emails…" },
  { t: "ok", s: "  drafted → ada@anthropic-founders.ai  «quick idea re: your launch»" },
  { t: "gap" },
  { t: "dim", s: "[outbox] sender grade A · warmup day 6 · 40/day" },
  { t: "send", email: "ada@anthropic-founders.ai" },
  { t: "send", email: "grace@hopperlabs.dev" },
  { t: "send", email: "lin@tensor.so" },
  { t: "done", s: "→ 40 sent · 1 held (cap) · 0 bounced" },
];

function lineHTML(step) {
  if (step.t === "cmd")
    return `<span class="l"><span class="t-prompt">openleads&gt;</span> <span class="t-cmd">${step.rendered}</span><span class="caret"></span></span>`;
  if (step.t === "dim") return `<span class="l t-dim">${step.s}</span>`;
  if (step.t === "ok") return `<span class="l t-ok">${step.s}</span>`;
  if (step.t === "lead") {
    const tag = step.tier === "safe" ? `<span class="t-safe">safe</span>`
      : step.tier === "risky" ? `<span class="t-dim">risky</span>` : `<span class="t-red">bad</span>`;
    return `<span class="l">  ${tag}  <span class="t-ok">${step.email}</span> <span class="t-dim">· ${step.who} · ${step.sc}</span></span>`;
  }
  if (step.t === "send")
    return `<span class="l">  <span class="t-ok">sent</span> → ${step.email}</span>`;
  if (step.t === "done") return `<span class="l t-safe">${step.s}</span>`;
  return `<span class="l"> </span>`;
}

function renderStatic() {
  const cmd = SCRIPT[0]; cmd.rendered = cmd.s;
  term.innerHTML = SCRIPT.map((s) => {
    if (s.t === "cmd") return `<span class="l"><span class="t-prompt">openleads&gt;</span> <span class="t-cmd">${s.s}</span></span>`;
    return lineHTML(s);
  }).join("");
}

async function playTerminal() {
  if (!term) return;
  term.innerHTML = "";
  const cmd = SCRIPT[0];
  // typewriter the command
  cmd.rendered = "";
  let html = lineHTML(cmd);
  term.innerHTML = html;
  const target = cmd.s;
  for (let i = 0; i <= target.length; i++) {
    cmd.rendered = target.slice(0, i);
    term.innerHTML = lineHTML(cmd);
    await sleep(22 + Math.random() * 26);
  }
  await sleep(420);
  // remove caret from command (final state)
  term.innerHTML = `<span class="l"><span class="t-prompt">openleads&gt;</span> <span class="t-cmd">${target}</span></span>`;
  for (let i = 1; i < SCRIPT.length; i++) {
    const step = SCRIPT[i];
    term.insertAdjacentHTML("beforeend", lineHTML(step));
    term.scrollTop = term.scrollHeight;
    await sleep(step.t === "gap" ? 120 : step.t === "send" ? 300 : step.t === "lead" ? 360 : 520);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (term) {
  if (reduceMotion) {
    renderStatic();
  } else {
    const tio = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { playTerminal(); tio.disconnect(); } });
    }, { threshold: 0.3 });
    tio.observe(term);
  }
}
