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
          <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Counts per day for one or two series that share a unit, with a crosshair readout. */
export function TrendChart({ series, height = 200, className }: { series: Series[]; height?: number; className?: string }) {
  const [at, setAt] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const n = series[0]?.points.length ?? 0;
  const W = 720;
  const pad = { l: 28, r: 10, t: 10, b: 22 };
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.count)));
  const { top, step } = niceMax(max);
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (1 - v / top) * (height - pad.t - pad.b);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const labels = n ? [0, Math.floor((n - 1) / 3), Math.floor(((n - 1) * 2) / 3), n - 1] : [];

  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !n) return;
    const inside = ((clientX - r.left) / r.width) * W;
    setAt(Math.max(0, Math.min(n - 1, Math.round(((inside - pad.l) / (W - pad.l - pad.r)) * (n - 1)))));
  };

  if (!n) return null;
  return (
    <div
      ref={box}
      className={cn("relative outline-none focus-visible:ring-2 focus-visible:ring-ring/60 rounded-md", className)}
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
        {ticks.map((t) => (
          <line key={t} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s, si) => {
          const line = s.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.count).toFixed(1)}`).join(" ");
          return (
            <g key={s.key}>
              {si === 0 && <path d={`${line} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={s.color} opacity="0.1" />}
              <path d={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {at !== null && <line x1={x(at)} x2={x(at)} y1={pad.t} y2={y(0)} stroke="var(--input)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Text and dots sit in HTML so they keep their shape while the plot stretches. */}
      <div className="pointer-events-none absolute inset-0 text-2xs text-muted-foreground tabular-nums" aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-y-1/2" style={{ left: 0, top: y(t), width: `${((pad.l - 8) / W) * 100}%`, textAlign: "right" }}>
            {t}
          </span>
        ))}
        {labels.map((i, k) => (
          <span
            key={`${id}${i}`}
            className={cn("absolute bottom-0 whitespace-nowrap", k === 0 ? "" : k === labels.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
            style={{ left: `${(x(i) / W) * 100}%` }}
          >
            {shortDate(series[0].points[i].date)}
          </span>
        ))}
        {at !== null &&
          series.map((s) => (
            <span
              key={s.key}
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
              style={{ left: `${(x(at) / W) * 100}%`, top: y(s.points[at].count), background: s.color }}
            />
          ))}
        {at !== null && (
          <div
            className={cn("absolute top-1 w-max rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-foreground shadow-lg", at > n / 2 ? "-translate-x-full" : "")}
            style={{ left: `calc(${(x(at) / W) * 100}% + ${at > n / 2 ? -10 : 10}px)` }}
          >
            <div className="mb-0.5 text-muted-foreground">{shortDate(series[0].points[at].date)}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="h-0.5 w-2.5 rounded-full" style={{ background: s.color }} />
                <span className="font-medium">{s.points[at].count}</span>
                <span className="text-muted-foreground">{s.label.toLowerCase()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** A small trend with no axes, for a stat tile. The tile's number says what it is. */
export function Spark({ points, color = "var(--chart-1)", className }: { points: Point[]; color?: string; className?: string }) {
  const n = points.length;
  if (n < 2) return null;
  const max = Math.max(1, ...points.map((p) => p.count));
  const W = 120;
  const H = 32;
  const line = points.map((p, i) => `${i ? "L" : "M"}${((i * W) / (n - 1)).toFixed(1)} ${(H - 2 - (p.count / max) * (H - 5)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("block h-8 w-full", className)} preserveAspectRatio="none" aria-hidden>
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
  /** A second line of context for the tooltip, e.g. "2 of 4 replied". */
  note?: string;
}

/** Horizontal bars for comparing a handful of named things on one scale. */
export function BarList({ rows, max, color = "var(--chart-1)", empty = "Nothing to show yet." }: { rows: BarRow[]; max?: number; color?: string; empty?: string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-3 text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col">
      {rows.map((r) => (
        <li
          key={r.key}
          title={r.note ? `${r.label}: ${r.note}` : undefined}
          className="group grid grid-cols-[minmax(5.5rem,34%)_1fr_auto] items-center gap-3 rounded-md px-1.5 py-[5px] text-[13px] hover:bg-accent"
        >
          <span className="truncate">{r.label}</span>
          <span className="h-2 rounded-full bg-accent group-hover:bg-background">
            <span className="block h-2 rounded-full" style={{ width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / top) * 100)}%`, background: color }} />
          </span>
          <span className="min-w-9 text-end tabular-nums text-muted-foreground group-hover:text-foreground">{r.shown ?? r.value.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

/** One bar cut into ordered parts (pipeline stages), each a step of the same hue. */
export function Segments({ parts, format }: { parts: { key: string; label: string; value: number }[]; format: (n: number) => string }) {
  const live = parts.filter((p) => p.value > 0);
  const total = live.reduce((a, p) => a + p.value, 0);
  if (!total) return null;
  const shade = (i: number) => `color-mix(in oklab, var(--chart-1) ${Math.round(38 + (62 * i) / Math.max(1, live.length - 1))}%, var(--card))`;
  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={live.map((p) => `${p.label} ${format(p.value)}`).join(", ")}>
        {live.map((p, i) => (
          <span key={p.key} title={`${p.label}: ${format(p.value)}`} className="h-full first:rounded-s-full last:rounded-e-full" style={{ width: `${(p.value / total) * 100}%`, background: shade(i) }} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-col gap-1 text-[13px]">
        {live.map((p, i) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="size-2 rounded-xs" style={{ background: shade(i) }} />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="ms-auto tabular-nums">{format(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
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
