/* =========================================================================
   Small, dependency-free charts: daily columns, sparklines, horizontal bars.
   Specs: columns <= 24px wide with a 4px rounded data-end and a square base,
   2px lines, end markers r=4 with a surface ring, hairline solid gridlines,
   text in ink tokens (never the series color), and a hover tooltip on every
   mark with a hit target larger than the mark.
   ========================================================================= */
import { esc, fmt } from "./core.js";

function niceMax(v) {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function roundTopRect(x, y, w, h, r) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const shortDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** A single-series daily column chart rendered at the container's real width.
 *  points: [{date: "2026-10-01", count: 3}] */
export function columns(el, points, { height = 150, unit = "", empty = "No data yet" } = {}) {
  const draw = () => {
    const W = Math.max(240, el.clientWidth || 600);
    const H = height, padL = 30, padR = 6, padT = 10, padB = 22;
    const max = niceMax(Math.max(0, ...points.map((p) => p.count)));
    const n = points.length || 1;
    const band = (W - padL - padR) / n;
    const bw = Math.max(2, Math.min(24, band - 2));       // 2px surface gap between bars
    const y = (v) => padT + (H - padT - padB) * (1 - v / max);
    const ticks = [0, max / 2, max];
    let svg = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit || "per day")}">`;
    for (const t of ticks) {
      const yy = Math.round(y(t)) + 0.5;
      svg += `<line class="${t === 0 ? "axis-line" : "grid-line"}" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="tick" x="${padL - 6}" y="${yy + 3.5}" text-anchor="end">${fmt.compact(t)}</text>`;
    }
    points.forEach((p, i) => {
      const x = padL + i * band + (band - bw) / 2;
      const top = y(p.count), h = y(0) - top;
      if (p.count > 0) svg += `<path class="bar" data-i="${i}" d="${roundTopRect(x, top, bw, h, Math.min(4, bw / 2))}"/>`;
      svg += `<rect class="hit" data-i="${i}" x="${padL + i * band}" y="${padT}" width="${band}" height="${H - padT - padB}"
        data-tip-title="${esc(shortDate(p.date))}" data-tip-v="${esc(fmt.num(p.count))}${unit ? " " + esc(unit) : ""}"/>`;
    });
    const labelAt = [0, Math.floor((n - 1) / 2), n - 1];
    for (const i of labelAt) {
      if (!points[i]) continue;
      const x = padL + i * band + band / 2;
      const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
      const ax = i === 0 ? padL : i === n - 1 ? W - padR : x;
      svg += `<text class="tick" x="${ax}" y="${H - 6}" text-anchor="${anchor}">${esc(shortDate(points[i].date))}</text>`;
    }
    svg += "</svg>";
    const total = points.reduce((s, p) => s + p.count, 0);
    el.innerHTML = total ? svg : `<div class="empty" style="padding:28px 8px">${esc(empty)}</div>`;
  };
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe(el);
  return () => ro.disconnect();
}

/** A tiny trend line (stat tiles). values: numbers, oldest first. */
export function sparkline(values, { w = 84, h = 28 } = {}) {
  const vals = values.length ? values : [0];
  const max = Math.max(1, ...vals), n = vals.length;
  const x = (i) => 4 + (n === 1 ? 0 : (i * (w - 8)) / (n - 1));
  const y = (v) => h - 4 - (v / max) * (h - 8);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${d}L${x(n - 1).toFixed(1)},${h - 4}L${x(0).toFixed(1)},${h - 4}Z`;
  const last = vals[n - 1];
  return `<svg class="chart stat__spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path class="area" d="${area}"/><path class="line" d="${d}"/>
    <circle class="end-dot" cx="${x(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="4"/></svg>`;
}

/** Horizontal bars (HTML). items: [{label, value, href?, dot?, title?}] — value at the tip. */
export function hbars(items, { max, valueFmt = fmt.num, color } = {}) {
  if (!items.length) return '<p class="muted">No data yet.</p>';
  const m = max || Math.max(1, ...items.map((i) => i.value));
  return `<div class="hbars">${items.map((it) => {
    const pct = Math.max(0, Math.min(100, (it.value / m) * 100));
    const tag = it.href ? "a" : "div";
    return `<${tag} class="hbar ${it.href ? "hbar--link" : ""}" ${it.href ? `href="${esc(it.href)}"` : ""}
        data-tip-title="${esc(it.title || it.label)}" data-tip-v="${esc(valueFmt(it.value))}">
      <span class="hbar__label">${it.dot ? `<i class="color-dot ${esc(it.dot)}"></i>` : ""}${esc(it.label)}</span>
      <span class="hbar__track"><span class="hbar__fill" style="width:${pct}%;${it.color || color ? `background:${it.color || color}` : ""}"></span></span>
      <span class="hbar__value">${esc(valueFmt(it.value))}</span></${tag}>`;
  }).join("")}</div>`;
}

/* ------------------------------------------------- one shared tooltip */
let tip = null;
document.addEventListener("mousemove", (e) => {
  const t = e.target.closest && e.target.closest("[data-tip-v]");
  if (!t) { if (tip) { tip.remove(); tip = null; } document.querySelectorAll(".bar.is-hover").forEach((b) => b.classList.remove("is-hover")); return; }
  if (!tip) { tip = document.createElement("div"); tip.className = "chart-tip"; document.body.appendChild(tip); }
  tip.innerHTML = `<b>${esc(t.dataset.tipTitle || "")}</b><span class="v">${esc(t.dataset.tipV)}</span>`;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = Math.max(8, e.clientY - tip.offsetHeight - 10);
  tip.style.left = x + "px"; tip.style.top = y + "px";
  if (t.dataset.i !== undefined && t.closest("svg")) {
    const svg = t.closest("svg");
    svg.querySelectorAll(".bar.is-hover").forEach((b) => b.classList.remove("is-hover"));
    svg.querySelector(`.bar[data-i="${t.dataset.i}"]`)?.classList.add("is-hover");
  }
}, { passive: true });

