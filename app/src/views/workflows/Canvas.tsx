import { CheckIcon, MaximizeIcon, PlusIcon, XIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { type PointerEvent as RPointerEvent, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

import { GROUP_TONE, iconFor } from "./icons";
import { type Catalog, curve, type GNode, H, inPort, type NodeRun, type NodeType, outPort, type Problem, summary, W } from "./model";
import type { WorkflowModel } from "./useWorkflow";

interface View {
  x: number;
  y: number;
  k: number;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "node"; id: string; sx: number; sy: number; nx: number; ny: number; moved: boolean; x: number; y: number }
  | { kind: "wire"; from: string; port: string; x: number; y: number };

export type Selection = { node?: string; edge?: number } | null;

/**
 * The workflow drawn as boxes and wires: drag to move, drag from a port to connect,
 * drop a wire on empty space to pick the next step. Every change is a command, so
 * it can be undone; a drag is one command, sent when you let go.
 */
export function Canvas({
  wf,
  sel,
  onSelect,
  onAdd,
  fitSignal,
}: {
  wf: WorkflowModel;
  sel: Selection;
  onSelect: (s: Selection) => void;
  onAdd: (from?: { node: string; port: string }) => void;
  fitSignal: number;
}) {
  const g = wf.g!;
  const { types, nodeRuns: runs, edgeCounts, problems } = wf;
  const [view, setView] = useState<View>({ x: 40, y: 40, k: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !g.nodes.length) return;
    const xs = g.nodes.map((n) => n.position.x);
    const ys = g.nodes.map((n) => n.position.y);
    const minX = Math.min(...xs) - 60;
    const minY = Math.min(...ys) - 80;
    const maxX = Math.max(...xs) + W + 60;
    const maxY = Math.max(...ys) + H + 80;
    const k = Math.min(1.1, Math.max(0.35, Math.min(el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY))));
    setView({ k, x: (el.clientWidth - (maxX - minX) * k) / 2 - minX * k, y: (el.clientHeight - (maxY - minY) * k) / 2 - minY * k });
  }, [g.nodes]);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    requestAnimationFrame(() => fitRef.current());
  }, [fitSignal]);

  const toCanvas = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
  };

  // While a node is dragged it is drawn at the drag position; the graph moves on release.
  const at = (n: GNode): GNode => (drag?.kind === "node" && drag.id === n.id && drag.moved ? { ...n, position: { x: drag.x, y: drag.y } } : n);
  const nodes = g.nodes.map(at);
  const find = (id: string) => nodes.find((n) => n.id === id);

  const onPointerMove = (e: RPointerEvent) => {
    if (!drag) return;
    if (drag.kind === "pan") setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }));
    else if (drag.kind === "node") {
      const dx = (e.clientX - drag.sx) / view.k;
      const dy = (e.clientY - drag.sy) / view.k;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      setDrag({ ...drag, moved: true, x: Math.round((drag.nx + dx) / 8) * 8, y: Math.round((drag.ny + dy) / 8) * 8 });
    } else if (drag.kind === "wire") {
      const p = toCanvas(e.clientX, e.clientY);
      setDrag({ ...drag, x: p.x, y: p.y });
    }
  };
  const onPointerUp = (e: RPointerEvent) => {
    if (drag?.kind === "node" && drag.moved) wf.dispatch([{ type: "MOVE_NODE", id: drag.id, to: { x: drag.x, y: drag.y } }]);
    if (drag?.kind === "wire") {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-node]");
      const to = el?.dataset.node;
      if (to && to !== drag.from) {
        const t = types.get(g.nodes.find((n) => n.id === to)?.type ?? "");
        if (t && !t.trigger) wf.dispatch([{ type: "CONNECT", edge: { from: drag.from, from_port: drag.port, to } }]);
      } else if (!to) {
        // Dropped on empty canvas: pick what comes next.
        onAdd({ node: drag.from, port: drag.port });
      }
    }
    setDrag(null);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const r = box.current!.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(2, Math.max(0.25, v.k * Math.exp(-e.deltaY * 0.01)));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  };
  const zoom = (f: number) => {
    const el = box.current;
    if (!el) return;
    const mx = el.clientWidth / 2;
    const my = el.clientHeight / 2;
    setView((v) => {
      const k = Math.min(2, Math.max(0.25, v.k * f));
      return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
    });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "1" && e.shiftKey) fitRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nodeProblems = (id: string) => problems.filter((p) => p.node === id && p.level === "error");

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      <div
        ref={box}
        className="absolute inset-0 touch-none select-none bg-background"
        style={{
          backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--color-muted-foreground) 22%, transparent) 1px, transparent 1px)",
          backgroundSize: `${20 * view.k}px ${20 * view.k}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
          cursor: drag?.kind === "pan" ? "grabbing" : "default",
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || e.target !== e.currentTarget) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          onSelect(null);
          setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            {g.edges.map((e, i) => {
              const a = find(e.from);
              const b = find(e.to);
              if (!a || !b) return null;
              const pa = outPort(a, types.get(a.type), e.from_port);
              const pb = inPort(b);
              const d = curve(pa, pb);
              const count = edgeCounts[`${e.from}|${e.from_port}|${e.to}`];
              const on = sel?.edge === i;
              return (
                <g key={`${e.from}|${e.from_port}|${e.to}`}>
                  <path
                    d={d}
                    stroke="transparent"
                    strokeWidth={14}
                    fill="none"
                    className="pointer-events-auto cursor-pointer"
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      onSelect({ edge: i });
                    }}
                  />
                  <path d={d} fill="none" strokeWidth={on ? 2.5 : 1.5} className={cn(count !== undefined && count > 0 ? "stroke-primary" : on ? "stroke-foreground" : "stroke-muted-foreground/50")} />
                  {count !== undefined && (
                    <text x={(pa.x + pb.x) / 2} y={(pa.y + pb.y) / 2 - 7} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">
                      {count} {count === 1 ? "item" : "items"}
                    </text>
                  )}
                </g>
              );
            })}
            {drag?.kind === "wire" &&
              (() => {
                const a = find(drag.from);
                return a ? <path d={curve(outPort(a, types.get(a.type), drag.port), { x: drag.x, y: drag.y })} fill="none" strokeWidth={1.5} strokeDasharray="5 4" className="stroke-foreground" /> : null;
              })()}
          </svg>
          {nodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              type={types.get(n.type)}
              selected={sel?.node === n.id}
              run={runs[n.id]}
              problems={nodeProblems(n.id)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                box.current?.setPointerCapture(e.pointerId);
                onSelect({ node: n.id });
                setDrag({ kind: "node", id: n.id, sx: e.clientX, sy: e.clientY, nx: n.position.x, ny: n.position.y, moved: false, x: n.position.x, y: n.position.y });
              }}
              onPortDown={(port, e) => {
                e.stopPropagation();
                box.current?.setPointerCapture(e.pointerId);
                const p = toCanvas(e.clientX, e.clientY);
                setDrag({ kind: "wire", from: n.id, port, x: p.x, y: p.y });
              }}
              onPlus={(port) => {
                onSelect({ node: n.id });
                onAdd({ node: n.id, port });
              }}
            />
          ))}
        </div>
      </div>

      <div className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-xl border border-border bg-card p-1 shadow-xs/5">
        <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
          <ZoomOutIcon />
        </Button>
        <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(view.k * 100)}%</span>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => zoom(1.2)}>
          <ZoomInIcon />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Fit to view (Shift+1)" onClick={fit}>
          <MaximizeIcon />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onAdd(sel?.node ? { node: sel.node, port: types.get(g.nodes.find((n) => n.id === sel.node)?.type ?? "")?.outputs[0] ?? "out" } : undefined)}>
          <PlusIcon /> Add step
        </Button>
      </div>
    </div>
  );
}

function NodeCard({
  node,
  type,
  selected,
  run,
  problems,
  onPointerDown,
  onPortDown,
  onPlus,
}: {
  node: GNode;
  type: NodeType | undefined;
  selected: boolean;
  run?: NodeRun;
  problems: Problem[];
  onPointerDown: (e: RPointerEvent) => void;
  onPortDown: (port: string, e: RPointerEvent) => void;
  onPlus: (port: string) => void;
}) {
  const Icon = iconFor(type?.icon);
  const outs = type?.outputs ?? ["out"];
  const sub = summary(node);
  const status = run?.status;
  const outTotal = run?.out ? Object.values(run.out).reduce((a, b) => a + b, 0) : undefined;
  return (
    <div
      data-node={node.id}
      className={cn(
        "pointer-events-auto absolute flex cursor-grab items-center gap-2.5 rounded-xl border bg-card px-3 shadow-sm transition-[box-shadow,border-color] active:cursor-grabbing",
        selected ? "border-foreground/70 ring-2 ring-foreground/15" : "border-border hover:border-input",
        problems.length > 0 && "border-destructive/60",
        status === "error" && "border-destructive",
        status === "ok" && "border-chart-1/70",
        node.disabled && "opacity-50",
        type?.trigger && "rounded-s-[28px]",
      )}
      style={{ left: node.position.x, top: node.position.y, width: W, height: H }}
      onPointerDown={onPointerDown}
    >
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", GROUP_TONE[type?.group ?? ""] ?? "bg-muted")}>
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-5">{node.name || type?.label || node.type}</span>
        <span className="block truncate text-xs leading-4 text-muted-foreground">{sub || type?.group}</span>
      </span>
      {/* run status */}
      {status && (
        <span
          className={cn(
            "absolute -top-2.5 right-2 flex h-5 items-center gap-1 rounded-full border bg-card px-1.5 text-[11px] tabular-nums",
            status === "error" ? "border-destructive text-destructive" : status === "running" ? "border-border text-muted-foreground" : "border-chart-1/60 text-foreground",
          )}
        >
          {status === "running" ? <span className="size-2 animate-pulse rounded-full bg-chart-1" /> : status === "error" ? <XIcon className="size-3" /> : <CheckIcon className="size-3" />}
          {status !== "running" && outTotal !== undefined ? outTotal : ""}
        </span>
      )}
      {/* input port */}
      {(type?.inputs.length ?? 1) > 0 && <span className="absolute -left-[7px] top-1/2 size-3.5 -translate-y-1/2 rounded-full border-2 border-muted-foreground/60 bg-background" />}
      {/* output ports: drag to connect, + to add the next step */}
      {outs.map((port, i) => (
        <span key={port} className="absolute -right-[7px] flex -translate-y-1/2 items-center" style={{ top: (H * (i + 1)) / (outs.length + 1) }}>
          <span
            role="button"
            aria-label={`Connect from ${type?.port_labels[port] ?? port}`}
            className="size-3.5 cursor-crosshair rounded-full border-2 border-muted-foreground/60 bg-background hover:border-foreground"
            onPointerDown={(e) => onPortDown(port, e)}
          />
          {outs.length > 1 && <span className="pointer-events-none ms-1 text-[10px] text-muted-foreground">{type?.port_labels[port] ?? port}</span>}
          {selected && (
            <button
              type="button"
              aria-label="Add the next step"
              className="ms-1.5 grid size-5 place-items-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onPlus(port)}
            >
              <PlusIcon className="size-3" />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

export function QuickAdd({ catalog, onPick, onClose }: { catalog: Catalog; onPick: (type: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const hits = catalog.nodes.filter((n) => !n.trigger || !q).filter((n) => !q || `${n.label} ${n.group}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center bg-background/40 pt-[12vh]" onPointerDown={onClose}>
      <div className="w-[420px] max-w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg" onPointerDown={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setI((x) => Math.min(hits.length - 1, x + 1));
            else if (e.key === "ArrowUp") setI((x) => Math.max(0, x - 1));
            else if (e.key === "Enter" && hits[i]) onPick(hits[i].type);
            else if (e.key === "Escape") onClose();
          }}
          placeholder="What happens next?"
          aria-label="Find a step"
          className="rounded-none border-0 border-b"
        />
        <div className="max-h-80 overflow-y-auto p-1.5">
          {hits.map((n, j) => {
            const Icon = iconFor(n.icon);
            return (
              <button key={n.type} type="button" onClick={() => onPick(n.type)} onMouseEnter={() => setI(j)} className={cn("flex w-full items-start gap-2.5 rounded-lg p-2 text-start", j === i && "bg-accent")}>
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", GROUP_TONE[n.group] ?? "bg-muted")}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{n.label}</span>
                  <span className="line-clamp-1 block text-xs text-muted-foreground">{n.doc}</span>
                </span>
              </button>
            );
          })}
          {!hits.length && <p className="p-3 text-[13px] text-muted-foreground">No step matches.</p>}
        </div>
      </div>
    </div>
  );
}
