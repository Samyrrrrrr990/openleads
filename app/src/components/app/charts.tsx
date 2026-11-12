import { useId, useRef, useState } from "react";

import { cn } from "~/lib/utils";

// Charts drawn by hand in SVG: thin marks, hairline grid, text in text colours (never
// the series colour), and a tooltip on hover or keyboard focus. Two series colours,
// --chart-1 and --chart-2, are the only data colours in the app.

export interface Point {
  date: string;
  count: number;
}

export interface Series {
  key: string;
  label: string;
  /** How one and many are said in the readout: ["email sent", "emails sent"]. */
  unit: [string, string];
  color: string;
  points: Point[];
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A round upper bound and tick step for a count axis. */
export function niceMax(max: number): { top: number; step: number } {
  if (max <= 4) return { top: 4, step: 1 };
  const pow = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((m) => (m * pow) / 2).find((s) => max / s <= 4) ?? pow * 5;
  const whole = Math.max(1, Math.round(step));
  return { top: Math.ceil(max / whole) * whole, step: whole };
}

export function Legend({ series }: { series: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span className="size-2 rounded-xs" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Counts per day for one or two series that share a unit. Each day is a pair of thin
 * bars, because a day's count is a separate amount, not a point on a slope. Hover, or
 * focus and use the arrow keys, to read a day.
 */
export function TrendChart({ series, height = 200, className }: { series: Series[]; height?: number; className?: string }) {
  const [at, setAt] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const n = series[0]?.points.length ?? 0;
  const W = 720;
  const pad = { l: 28, r: 4, t: 10, b: 22 };
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.count)));
  const { top, step } = niceMax(max);
  const slot = n ? (W - pad.l - pad.r) / n : 0;
  const bar = Math.min(7, Math.max(2, (slot - 6) / series.length));
  const x = (i: number) => pad.l + slot * (i + 0.5);
  const y = (v: number) => pad.t + (1 - v / top) * (height - pad.t - pad.b);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  // A date under every seventh day, counted back from today.
  const labels = Array.from({ length: n }, (_, i) => i).filter((i) => (n - 1 - i) % 7 === 0);

  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !n) return;
    const inside = ((clientX - r.left) / r.width) * W;
    setAt(Math.max(0, Math.min(n - 1, Math.floor((inside - pad.l) / slot))));
  };

  if (!n) return null;
  return (
    <div
      ref={box}
      className={cn("relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60", className)}
      tabIndex={0}
      role="img"
      aria-label={`${series.map((s) => `${s.label}: ${s.points.reduce((a, p) => a + p.count, 0)}`).join(", ")} over ${n} days. Arrow keys read each day.`}
      onPointerMove={(e) => move(e.clientX)}
      onPointerLeave={() => setAt(null)}
      onBlur={() => setAt(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") setAt((v) => Math.min(n - 1, (v ?? -1) + 1));
        else if (e.key === "ArrowLeft") setAt((v) => Math.max(0, (v ?? n) - 1));
        else if (e.key === "Escape") setAt(null);
        else return;
        e.preventDefault();
      }}
    >
      <svg viewBox={`0 0 ${W} ${height}`} className="block w-full" style={{ height }} preserveAspectRatio="none" aria-hidden>
        {at !== null && <rect x={x(at) - slot / 2} y={pad.t} width={slot} height={y(0) - pad.t} fill="var(--accent)" />}
        {ticks.map((t) => (
          <line key={t} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s, si) =>
          s.points.map((p, i) => {
            if (!p.count) return null;
            const left = x(i) - (series.length * bar + (series.length - 1) * 2) / 2 + si * (bar + 2);
            const h = y(0) - y(p.count);
            const r = Math.min(2, h);
            // Rounded at the top, square on the baseline.
            return (
              <path
                key={`${s.key}${i}`}
                fill={s.color}
                d={`M${left} ${y(0)}V${y(p.count) + r}q0 ${-r} ${r} ${-r}h${bar - 2 * r}q${r} 0 ${r} ${r}V${y(0)}z`}
              />
            );
          }),
        )}
      </svg>
      {/* Text sits in HTML so it keeps its shape while the plot stretches. */}
      <div className="pointer-events-none absolute inset-0 text-2xs text-muted-foreground tabular-nums" aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-y-1/2" style={{ left: 0, top: y(t), width: `${((pad.l - 8) / W) * 100}%`, textAlign: "right" }}>
            {t}
          </span>
        ))}
        {labels.map((i) => (
          <span key={`${id}${i}`} className={cn("absolute bottom-0 whitespace-nowrap", i === n - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${((i === n - 1 ? W - pad.r : x(i)) / W) * 100}%` }}>
            {shortDate(series[0].points[i].date)}
          </span>
        ))}
        {at !== null && (
          <div
            className={cn("absolute top-1 w-max rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-foreground shadow-lg", at > n / 2 ? "-translate-x-full" : "")}
            style={{ left: `calc(${(x(at) / W) * 100}% + ${at > n / 2 ? -14 : 14}px)` }}
          >
            <div className="mb-0.5 text-muted-foreground">{shortDate(series[0].points[at].date)}</div>
            {series.map((s) => {
              const count = s.points[at].count;
              return (
                <div key={s.key} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-xs" style={{ background: s.color }} />
                  <span className="font-medium">{count}</span>
                  <span className="text-muted-foreground">{s.unit[count === 1 ? 0 : 1]}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** A small trend with no axes, for a stat tile. The tile's number says what it is. */
export function Spark({ points, label, color = "var(--chart-1)", className }: { points: Point[]; label: string; color?: string; className?: string }) {
  const n = points.length;
  if (n < 2) return null;
  const max = Math.max(1, ...points.map((p) => p.count));
  const W = 120;
  const H = 32;
  const line = points.map((p, i) => `${i ? "L" : "M"}${((i * W) / (n - 1)).toFixed(1)} ${(H - 2 - (p.count / max) * (H - 5)).toFixed(1)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("block h-7 w-full", className)}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}, last ${n} days: from ${points[0].count} to ${points[n - 1].count}, highest ${max}`}
    >
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={color} opacity="0.1" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** What to print at the end of the row; defaults to the value. */
  shown?: string;
  /** Context printed beside the value in quieter text, e.g. "2 of 4". */
  note?: string;
}

/** Horizontal bars for comparing a handful of named things on one scale. */
export function BarList({ rows, max, color = "var(--chart-1)", empty = "Nothing to show yet." }: { rows: BarRow[]; max?: number; color?: string; empty?: string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="px-1.5 py-3 text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid grid-cols-[minmax(0,max-content)_minmax(3rem,1fr)_auto] items-center gap-x-3">
      {rows.map((r) => (
        <li key={r.key} className="col-span-3 grid grid-cols-subgrid items-center rounded-md px-1.5 py-[5px] text-[13px] hover:bg-accent">
          <span className="max-w-[11rem] leading-5">{r.label}</span>
          <span className="h-2 rounded-full bg-accent">
            <span className="block h-2 rounded-full" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / top) * 100)}%`, background: color }} />
          </span>
          <span className="text-end tabular-nums">
            {r.shown ?? r.value.toLocaleString()}
            {r.note && <span className="ms-1.5 text-xs text-muted-foreground">{r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** How much of a daily allowance is used. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label} className="h-1.5 rounded-full bg-accent">
      <span className="block h-1.5 rounded-full bg-chart-1" style={{ width: `${share * 100}%`, minWidth: value > 0 ? 6 : 0 }} />
    </div>
  );
}
