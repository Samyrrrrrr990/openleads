import {
  ArrowUpIcon,
  CheckIcon,
  CircleAlertIcon,
  CornerDownRightIcon,
  ListIcon,
  PlayIcon,
  PlusIcon,
  Redo2Icon,
  SparklesIcon,
  Trash2Icon,
  Undo2Icon,
  WorkflowIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { api } from "~/lib/api";
import { ago } from "~/lib/format";
import { href, navigate } from "~/lib/router";
import { cn, isMacPlatform } from "~/lib/utils";

import { Canvas, QuickAdd, type Selection } from "./Canvas";
import { GROUP_TONE, iconFor } from "./icons";
import { type GNode, type Graph, type Problem, stepRows, summary, title } from "./model";
import { StepSettings } from "./StepSettings";
import { type PastRun, type RunState, useWorkflow, type WorkflowModel } from "./useWorkflow";

const MOD = typeof navigator !== "undefined" && isMacPlatform(navigator.platform) ? "⌘" : "Ctrl+";
const VIEW_KEY = "openleads.workflows.view";

/** Something you asked for in the composer, and what came of it. */
interface Turn {
  id: number;
  text: string;
  status: "reading" | "proposed" | "applied" | "dismissed" | "error";
  understood: string[];
  skipped: string;
  graph?: Graph;
  error?: string;
}

/** Tells the workflow list to reload (after a save or a switch flips). */
export function workflowsChanged() {
  window.dispatchEvent(new Event("openleads:workflows-changed"));
}

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/** When it runs, in words, from the trigger step. */
function whenText(g: Graph): string {
  const t = g.nodes.find((n) => n.type.startsWith("trigger."));
  if (!t) return "";
  if (t.type === "trigger.schedule") return String(t.params.schedule || "on a schedule");
  if (t.type === "trigger.reply") return "when someone replies";
  if (t.type === "trigger.new_leads") return "when new leads come in";
  return "when you press Run";
}

/** A graph with nothing but a trigger (or nothing): a described one replaces it without asking. */
function blank(g: Graph): boolean {
  return g.nodes.every((n) => n.type.startsWith("trigger.")) && g.nodes.length <= 1;
}

export function WorkflowView({ name }: { name: string }) {
  const wf = useWorkflow(name);
  const { g, types } = wf;
  const [view, setViewState] = useState<"steps" | "canvas">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "canvas" ? "canvas" : "steps";
    } catch {
      return "steps";
    }
  });
  const setView = (v: "steps" | "canvas") => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* a remembered view is a nicety */
    }
  };
  const [sel, setSel] = useState<Selection>(null);
  const [adding, setAdding] = useState<{ from?: { node: string; port: string } } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [fitSignal, setFitSignal] = useState(0);
  const turnId = useRef(0);
  const turnsRef = useRef(0);
  turnsRef.current = turns.length;

  // A workflow opened from "Describe it" starts its thread with that sentence.
  const draft = wf.draft;
  useEffect(() => {
    setSel(null);
    setAdding(null);
    if (draft?.text) {
      setTurns([{ id: ++turnId.current, text: draft.text, status: "applied", understood: draft.understood, skipped: draft.skipped }]);
    } else if (!wf.saved || wf.saved !== name) {
      setTurns([]);
    }
    setFitSignal((n) => n + 1);
    // Only when a different workflow (or draft) is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, draft]);

  const describeIt = useCallback(
    async (text: string) => {
      const id = ++turnId.current;
      setTurns((t) => [...t, { id, text, status: "reading", understood: [], skipped: "" }]);
      try {
        const out = await api.post<{ workflow: Graph; understood: string[]; skipped: string }>("/api/workflows/draft", { text });
        const fresh = !!wf.g && blank(wf.g) && out.workflow.nodes.length > 1;
        if (fresh) {
          wf.applyDescribed(out.workflow);
          setFitSignal((n) => n + 1);
        }
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, status: fresh ? "applied" : out.workflow.nodes.length > 1 ? "proposed" : "error", understood: out.understood, skipped: out.skipped, graph: out.workflow, error: out.workflow.nodes.length > 1 ? undefined : out.skipped || "I couldn't find any steps in that." } : x)));
      } catch (e) {
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, status: "error", error: (e as Error).message } : x)));
      }
    },
    [wf],
  );

  const removeSelected = useCallback(() => {
    if (!g || !sel) return;
    if (sel.node) wf.dispatch([{ type: "REMOVE_NODE", id: sel.node }]);
    else if (sel.edge !== undefined && g.edges[sel.edge]) wf.dispatch([{ type: "DISCONNECT", edge: g.edges[sel.edge]! }]);
    setSel(null);
  }, [g, sel, wf]);

  // Keyboard: undo and redo, save, test run, delete, add.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void wf.save().then((n) => n && workflowsChanged());
        return;
      }
      if (mod && e.key === "Enter" && !isTyping(e.target)) {
        e.preventDefault();
        void wf.start("test", turnsRef.current);
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) wf.redo();
        else wf.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        wf.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (!sel) return;
        e.preventDefault();
        removeSelected();
      } else if (e.key === "Escape") {
        setSel(null);
        setAdding(null);
      } else if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        setAdding({});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wf, sel, removeSelected]);

  if (wf.error)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-[13px]">
        <p>{wf.error}</p>
        <a className="underline underline-offset-2" href={href("workflows")}>
          Back to workflows
        </a>
      </div>
    );
  if (!g || !wf.catalog.data)
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
        <Spinner className="size-3.5" /> Loading the workflow
      </div>
    );

  const catalog = wf.catalog.data;
  const selNode = sel?.node ? g.nodes.find((n) => n.id === sel.node) : undefined;
  const errors = wf.problems.filter((p) => p.level === "error");
  const running = wf.run?.status === "running";
  const pickAfter = (from?: { node: string; port: string }) => setAdding({ from });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Header wf={wf} view={view} setView={setView} errors={errors.length} running={running} turns={turns.length} />
      <div className="relative flex min-h-0 flex-1">
        {view === "steps" ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-col gap-6 px-5 py-6 max-md:px-4 max-md:py-4">
                <StepsCard wf={wf} sel={sel} onSelect={setSel} onAdd={pickAfter} />
                {wf.run && wf.run.after === 0 && <RunCard run={wf.run} onClose={wf.clearRun} />}
                {turns.map((t, i) => (
                  <Fragment key={t.id}>
                  <TurnView
                    turn={t}
                    onUse={() => {
                      if (!t.graph) return;
                      wf.applyDescribed(t.graph);
                      setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, status: "applied" } : x)));
                      setSel(null);
                    }}
                    onDismiss={() => setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, status: "dismissed" } : x)))}
                  />
                  {wf.run && wf.run.after === i + 1 && <RunCard run={wf.run} onClose={wf.clearRun} />}
                  </Fragment>
                ))}
                {wf.run && wf.run.after > turns.length && <RunCard run={wf.run} onClose={wf.clearRun} />}
                {wf.past.length > 0 && <PastRuns runs={wf.past} />}
              </div>
            </div>
            <div className="relative mx-auto w-full max-w-[var(--content-max)] px-5 pb-5 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-background before:to-transparent max-md:px-4 max-md:pb-3">
              <DescribeComposer onSend={describeIt} busy={turns.some((t) => t.status === "reading")} replacing={!blank(g)} />
            </div>
          </div>
        ) : (
          <Canvas wf={wf} sel={sel} onSelect={setSel} onAdd={pickAfter} fitSignal={fitSignal} />
        )}

        {selNode && (
          <StepSettings
            key={selNode.id}
            node={selNode}
            type={types.get(selNode.type)}
            catalog={catalog}
            run={wf.nodeRuns[selNode.id]}
            problems={wf.problems.filter((p) => p.node === selNode.id)}
            onChange={(next) => {
              const patch: Partial<GNode> = {};
              for (const k of ["params", "name", "on_error", "disabled"] as const) {
                if (JSON.stringify(next[k]) !== JSON.stringify(selNode[k])) (patch as Record<string, unknown>)[k] = next[k];
              }
              if (Object.keys(patch).length)
                wf.dispatch([{ type: "UPDATE_NODE", id: selNode.id, patch }], { coalesceKey: `edit:${selNode.id}:${Object.keys(patch).join(",")}` });
            }}
            onDelete={removeSelected}
            onClose={() => setSel(null)}
          />
        )}
        {!selNode && wf.problems.length > 0 && view === "canvas" && <ProblemsPanel problems={wf.problems} onPick={(id) => setSel({ node: id })} />}

        {adding && (
          <QuickAdd
            catalog={catalog}
            onClose={() => setAdding(null)}
            onPick={(type) => {
              const after = adding.from?.node ?? sel?.node ?? undefined;
              const id = wf.addStep(type, { after, port: adding.from?.port });
              setAdding(null);
              if (id) setSel({ node: id });
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------- */

function IconTip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** T3's thread header: the name, when it runs, and what you can do with it. */
function Header({ wf, view, setView, errors, running, turns }: { wf: WorkflowModel; view: "steps" | "canvas"; setView: (v: "steps" | "canvas") => void; errors: number; running: boolean; turns: number }) {
  const g = wf.g!;
  const when = whenText(g);
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4 max-md:px-3">
      <Button size="icon-sm" variant="ghost" className="md:hidden" aria-label="All workflows" onClick={() => navigate("workflows")}>
        <ListIcon />
      </Button>
      {wf.saved ? (
        <h1 className="min-w-0 truncate text-sm font-semibold" title={wf.saved}>
          {title(wf.saved)}
        </h1>
      ) : (
        <input
          value={g.name}
          onChange={(e) => wf.dispatch([{ type: "SET_META", patch: { name: e.target.value.replace(/\s+/g, "-") } }], { coalesceKey: "rename" })}
          placeholder="New workflow"
          aria-label="Workflow name"
          className="h-7 min-w-0 max-w-56 flex-1 rounded-sm bg-transparent text-sm font-semibold outline-none ring-ring/50 placeholder:text-muted-foreground focus:ring-1"
        />
      )}
      {when && <span className="shrink-0 truncate text-xs text-muted-foreground max-lg:hidden">Runs {when}</span>}
      {g.live ? <Badge variant="warning" className="max-md:hidden">Sends without asking</Badge> : <Badge variant="secondary" className="max-md:hidden">Emails wait for approval</Badge>}
      {wf.dirty && <span className="shrink-0 text-xs text-muted-foreground max-md:hidden">Unsaved</span>}
      {errors > 0 && <Badge variant="error">{errors} to fix</Badge>}

      <div className="ms-auto flex shrink-0 items-center gap-1.5">
        <div className="flex items-center max-sm:hidden">
          <IconTip label={wf.undoLabel ? `Undo ${wf.undoLabel} (${MOD}Z)` : "Nothing to undo"}>
            <Button size="icon-sm" variant="ghost" aria-label="Undo" disabled={!wf.canUndo} onClick={wf.undo}>
              <Undo2Icon />
            </Button>
          </IconTip>
          <IconTip label={wf.redoLabel ? `Redo ${wf.redoLabel} (${MOD}⇧Z)` : "Nothing to redo"}>
            <Button size="icon-sm" variant="ghost" aria-label="Redo" disabled={!wf.canRedo} onClick={wf.redo}>
              <Redo2Icon />
            </Button>
          </IconTip>
        </div>
        <div className="flex h-7 items-center rounded-lg border border-border p-0.5 max-md:hidden" role="group" aria-label="View">
          {(["steps", "canvas"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn("flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground", view === v && "bg-accent font-medium text-foreground")}
            >
              {v === "steps" ? <ListIcon className="size-3.5" /> : <WorkflowIcon className="size-3.5" />}
              {v === "steps" ? "Steps" : "Canvas"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground" title="On: scheduled and event triggers fire by themselves.">
          <span className="max-sm:hidden">On</span>
          <Switch checked={g.active} onCheckedChange={(v) => wf.dispatch([{ type: "SET_META", patch: { active: v } }])} aria-label="Workflow on" />
        </label>
        <Button size="sm" variant="outline" className="max-sm:hidden" onClick={() => void wf.save().then((n) => n && workflowsChanged())} disabled={!wf.dirty && !!wf.saved}>
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={() => void wf.start("test", turns)} disabled={running} title={`${MOD}↵ runs a test: nothing is sent or saved`}>
          {running && wf.run?.mode === "test" ? <Spinner /> : <PlayIcon />} Test
        </Button>
        <Button size="sm" onClick={() => void wf.start("run", turns).then(workflowsChanged)} disabled={running || errors > 0}>
          {running && wf.run?.mode === "run" ? <Spinner /> : <ZapIcon />} Run
        </Button>
      </div>
    </header>
  );
}

/** The workflow, read top to bottom like T3's work log. Branches indent under the step that splits. */
function StepsCard({ wf, sel, onSelect, onAdd }: { wf: WorkflowModel; sel: Selection; onSelect: (s: Selection) => void; onAdd: (from?: { node: string; port: string }) => void }) {
  const g = wf.g!;
  const rows = stepRows(g, wf.types);
  const live = g.live ? "Send emails go out inside your warm-up cap." : "Emails it writes wait for your approval on Today.";
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Steps">
      <div className="flex min-h-10 items-center gap-2 border-b border-border px-3.5 py-1.5">
        <span className="text-[13px] font-semibold">Steps</span>
        <span className="text-xs text-muted-foreground tabular-nums">{g.nodes.length}</span>
        <span className="truncate text-xs text-muted-foreground max-sm:hidden">· {live}</span>
        <Button size="xs" variant="ghost" className="ms-auto" onClick={() => onAdd(undefined)}>
          <PlusIcon /> Add step
        </Button>
      </div>
      {g.description && <p className="border-b border-border px-3.5 py-2.5 text-[13px] leading-5 text-muted-foreground">{g.description}</p>}
      <ol className="flex flex-col py-1.5">
        {rows.map((r, i) => {
          const t = wf.types.get(r.node.type);
          const Icon = iconFor(t?.icon);
          const run = wf.nodeRuns[r.node.id];
          const outTotal = run?.out ? Object.values(run.out).reduce((a, b) => a + b, 0) : undefined;
          const probs = wf.problems.filter((p) => p.node === r.node.id && !r.again);
          const on = sel?.node === r.node.id;
          const outs = t?.outputs ?? ["out"];
          return (
            <li key={`${r.node.id}-${i}`} className="group/step relative">
              {r.depth > 0 && <span aria-hidden className="absolute inset-y-0 border-s border-border" style={{ insetInlineStart: 22 + (r.depth - 1) * 22 }} />}
              <div
                className={cn(
                  "mx-1.5 flex min-h-9 items-center gap-1 rounded-lg pe-2 transition-colors hover:bg-accent/60 has-focus-visible:ring-2 has-focus-visible:ring-ring",
                  on && "bg-accent",
                  (r.node.disabled || r.again) && "opacity-55",
                )}
                style={{ paddingInlineStart: 8 + r.depth * 22 }}
              >
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect({ node: r.node.id })}
                  className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1 text-start outline-none"
                >
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", GROUP_TONE[t?.group ?? ""] ?? "bg-muted")}>
                  <Icon className="size-3.5" />
                </span>
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[13px] leading-5 max-md:text-sm">
                  {r.via && <span className="shrink-0 text-xs text-muted-foreground">{wf.types.get(g.nodes.find((x) => x.id === r.from)?.type ?? "")?.port_labels[r.via] ?? r.via} →</span>}
                  <span className={cn("shrink-0 font-medium", r.node.disabled && "line-through")}>{r.node.name || t?.label || r.node.type}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{r.again ? "continues here too" : r.loose ? "not connected" : summary(r.node)}</span>
                </span>
                {run && (
                  <span className={cn("flex shrink-0 items-center gap-1 text-xs tabular-nums", run.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                    {run.status === "running" ? <Spinner className="size-3" /> : run.status === "error" ? <XIcon className="size-3" /> : <CheckIcon className="size-3 text-success" />}
                    {run.status === "running" ? (run.progress ? `${run.progress} so far` : "") : `${run.in ?? 0} → ${outTotal ?? 0}`}
                    {run.ms !== undefined && <span className="max-sm:hidden"> · {run.ms} ms</span>}
                  </span>
                )}
                {probs.some((p) => p.level === "error") && <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" aria-label="Needs fixing" />}
                </button>
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/step:opacity-100 group-focus-within/step:opacity-100 max-md:hidden">
                  <IconTip label="Add a step after this">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Add a step after this"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAdd({ node: r.node.id, port: outs[0] ?? "out" });
                      }}
                    >
                      <PlusIcon />
                    </Button>
                  </IconTip>
                  <IconTip label="Delete step">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Delete step"
                      onClick={(e) => {
                        e.stopPropagation();
                        wf.dispatch([{ type: "REMOVE_NODE", id: r.node.id }]);
                        if (sel?.node === r.node.id) onSelect(null);
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </IconTip>
                </span>
              </div>
              {probs.length > 0 && (
                <div className="mx-1.5 flex flex-col gap-0.5 pb-1" style={{ paddingInlineStart: 8 + r.depth * 22 + 34 }}>
                  {probs.map((p, j) => (
                    <span key={j} className={cn("text-xs leading-4", p.level === "error" ? "text-destructive" : "text-muted-foreground")}>
                      {p.message}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {wf.problems.some((p) => !p.node) && (
        <div className="border-t border-border bg-muted/60 px-3.5 py-2 text-xs leading-5">
          {wf.problems
            .filter((p) => !p.node)
            .map((p, i) => (
              <div key={i} className={p.level === "error" ? "text-destructive" : "text-muted-foreground"}>
                {p.message}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

/** Your sentence, then the workflow it reads as: T3's proposed-plan card. */
function TurnView({ turn, onUse, onDismiss }: { turn: Turn; onUse: () => void; onDismiss: () => void }) {
  return (
    <article className="flex flex-col gap-3" aria-label={`You asked: ${turn.text}`}>
      <div className="ms-auto max-w-[85%] rounded-2xl rounded-br-md bg-message px-3.5 py-2 text-[15px] leading-6">{turn.text}</div>
      {turn.status === "reading" && (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner className="size-3.5" /> Reading it
        </div>
      )}
      {turn.status === "error" && (
        <div className="flex gap-2.5">
          <span className="mt-0.5 grid size-5.5 shrink-0 place-items-center rounded-full bg-error-surface text-error-foreground">
            <CircleAlertIcon className="size-3" />
          </span>
          <p className="text-[15px] leading-6 text-error-foreground">{turn.error}</p>
        </div>
      )}
      {(turn.status === "proposed" || turn.status === "applied" || turn.status === "dismissed") && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex min-h-10 items-center gap-2 border-b border-border px-3.5 py-1.5">
            <SparklesIcon className="size-3.5 text-muted-foreground" />
            <span className="text-[13px] font-semibold">{turn.status === "proposed" ? "Here's the workflow" : "Here's what I built"}</span>
          </div>
          <ol className="flex flex-col gap-1.5 px-3.5 py-3">
            {turn.understood.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-5 max-md:text-sm">
                <span className="w-4 shrink-0 text-end text-muted-foreground tabular-nums">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          {turn.skipped && <p className="px-3.5 pb-3 text-[13px] text-muted-foreground">{turn.skipped}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-muted/60 px-3.5 py-2.5">
            {turn.status === "proposed" ? (
              <>
                <span className="min-w-48 flex-1 text-[13px] leading-5 text-muted-foreground">Using it replaces the steps above. {MOD}Z puts them back.</span>
                <Button size="sm" variant="ghost" onClick={onDismiss}>
                  Not now
                </Button>
                <Button size="sm" onClick={onUse} autoFocus>
                  Use this
                </Button>
              </>
            ) : turn.status === "applied" ? (
              <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <CheckIcon className="size-3.5" /> On the steps above. Click one to change it, or Test to see what each would do.
              </span>
            ) : (
              <span className="text-[13px] text-muted-foreground">Kept the steps you had.</span>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** A run streaming in, like T3's working indicator and its log lines. */
function RunCard({ run, onClose }: { run: RunState; onClose: () => void }) {
  return (
    <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3" aria-live="polite">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        {run.status === "running" ? <Spinner className="size-3.5" /> : run.status === "error" ? <CircleAlertIcon className="size-3.5 text-destructive" /> : <CheckIcon className="size-3.5 text-success" />}
        {run.mode === "test" ? "Test run" : "Run"}
        <span className="font-normal text-muted-foreground">{run.status === "running" ? "working" : run.status === "error" ? "stopped" : `done${run.seconds !== undefined ? ` in ${run.seconds}s` : ""}`}</span>
        {run.status !== "running" && (
          <Button size="icon-xs" variant="ghost" className="ms-auto" aria-label="Close the run" onClick={onClose}>
            <XIcon />
          </Button>
        )}
      </div>
      {run.lines.map((line, i) => (
        <div key={i} className={cn("flex gap-2 text-xs text-muted-foreground", line.startsWith("Error") && "text-destructive", i === run.lines.length - 1 && run.status === "running" && "text-foreground")}>
          <CornerDownRightIcon className="mt-0.5 size-3 shrink-0 opacity-60" />
          <span className="min-w-0 break-words">{line.replace(/^· /, "")}</span>
        </div>
      ))}
    </section>
  );
}

const RUN_STATUS: Record<string, string> = { ok: "finished", error: "failed", running: "running", waiting: "waiting for approval", paused: "paused", partial: "partly done" };

function PastRuns({ runs }: { runs: PastRun[] }) {
  return (
    <section aria-label="Earlier runs">
      <h2 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">Earlier runs</h2>
      <ul className="flex flex-col">
        {runs.map((r) => (
          <li key={r.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 text-[13px]">
            <span className={cn("size-1.5 shrink-0 rounded-full", r.status === "ok" ? "bg-success" : r.status === "error" ? "bg-destructive" : "bg-muted-foreground/50")} />
            <span className="font-medium">{r.mode === "test" ? "Test run" : r.trigger && r.trigger !== "manual" ? `Ran ${r.trigger}` : "Run"}</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {RUN_STATUS[r.status] ?? r.status}
              {r.error ? `: ${r.error}` : ""}
            </span>
            <span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              {ago(r.started)} · {r.seconds}s
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProblemsPanel({ problems, onPick }: { problems: Problem[]; onPick: (id: string) => void }) {
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-s border-border p-3.5 max-lg:hidden">
      <h2 className="text-[13px] font-semibold">Before it can run</h2>
      <ul className="mt-2 space-y-2 text-[13px]">
        {problems.map((p, i) => (
          <li key={i}>
            <button type="button" className="cursor-pointer text-start" onClick={() => p.node && onPick(p.node)}>
              <Badge variant={p.level === "error" ? "error" : "warning"} className="me-1.5">
                {p.level === "error" ? "Fix" : "Note"}
              </Badge>
              {p.message}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** The T3 composer: describe the workflow, or a new version of it. Enter sends. */
export function DescribeComposer({ onSend, busy, replacing, autoFocus, hint }: { onSend: (text: string) => void; busy: boolean; replacing?: boolean; autoFocus?: boolean; hint?: string }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);
  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };
  return (
    <div
      className="cursor-text rounded-2xl border border-input bg-card shadow-composer transition-shadow focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/15"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button,a")) ref.current?.focus();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        maxLength={1000}
        placeholder={replacing ? "Describe a new version: when it runs and each step" : "Describe it: every weekday at 9 find 20 dentists in Toronto, write emails and send them"}
        aria-label="Describe the workflow"
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 outline-none placeholder:text-placeholder"
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5">
        <span className="flex items-center gap-1.5 px-1.5 text-xs text-muted-foreground">
          <SparklesIcon className="size-3.5" /> {hint ?? (replacing ? "You see it before it replaces anything" : "It fills in the steps above. Nothing is saved yet")}
        </span>
        <Button size="icon-sm-pill" className="ms-auto" disabled={!text.trim() || busy} onClick={send} aria-label="Build it">
          {busy ? <Spinner /> : <ArrowUpIcon />}
        </Button>
      </div>
    </div>
  );
}

export type { Turn };
