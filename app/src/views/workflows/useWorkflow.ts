import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "~/lib/api";
import { canRedo, canUndo, emptyHistory, type History, pushHistory, redoLabel, stepBack, stepForward, undoLabel } from "~/lib/history";
import { href } from "~/lib/router";
import { fail, toast } from "~/lib/toast";
import { useApi } from "~/lib/use-api";

import { applyAll, describe, supersedes, type WfCommand } from "./commands";
import { type Catalog, type GNode, type Graph, nextId, type NodeRun, placeAfter, type Problem } from "./model";

/* A graph handed over from "Describe it" or a template, opened unsaved. */
export interface Draft {
  graph: Graph;
  understood: string[];
  skipped: string;
  /** The sentence it was built from, shown as your message in the thread. */
  text?: string;
}
let pending: Draft | null = null;
export function setDraft(graph: Graph, understood: string[], skipped: string, text?: string) {
  pending = { graph, understood, skipped, text };
}
export function takeDraft(): Draft | null {
  const d = pending;
  pending = null;
  return d;
}

export const EMPTY: Graph = {
  name: "",
  description: "",
  active: false,
  live: false,
  nodes: [{ id: "n1", type: "trigger.manual", params: {}, position: { x: 80, y: 200 } }],
  edges: [],
};

export interface PastRun {
  id: number;
  mode: string;
  trigger: string;
  status: string;
  started: number;
  seconds: number;
  error?: string;
  live: boolean;
}

export interface RunState {
  mode: "test" | "run";
  /** How many described turns came before it, so it shows in order. */
  after: number;
  status: "running" | "done" | "error";
  lines: string[];
  seconds?: number;
}

export interface Edit {
  label?: string;
  coalesceKey?: string | null;
}

export function useWorkflow(name: string) {
  const catalog = useApi<Catalog>("/api/workflows/catalog");
  const types = useMemo(() => new Map((catalog.data?.nodes ?? []).map((t) => [t.type, t])), [catalog.data]);
  const typesRef = useRef(types);
  typesRef.current = types;
  const label = useCallback((type: string) => typesRef.current.get(type)?.label ?? type, []);

  const [state, setState] = useState<{ g: Graph | null; h: History<WfCommand> }>({ g: null, h: emptyHistory() });
  const loadedRef = useRef(false);
  const [saved, setSaved] = useState(name);
  // The graph as last loaded or saved: undoing back to it is not a change.
  const [base, setBase] = useState("");
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [error, setError] = useState("");
  const [draft, setDraftState] = useState<Draft | null>(null);
  const [nodeRuns, setNodeRuns] = useState<Record<string, NodeRun>>({});
  const [edgeCounts, setEdgeCounts] = useState<Record<string, number>>({});
  const [run, setRun] = useState<RunState | null>(null);
  const past = useApi<{ runs: PastRun[] }>(saved ? `/api/workflows/runs?name=${encodeURIComponent(saved)}&limit=8` : null);

  // The name this editor saved under: opening that name again (the address changing
  // after a first save) keeps what's on screen instead of reloading it.
  const savedRef = useRef(name);
  savedRef.current = saved;

  // Load: a named workflow, a draft handed over, or a blank one.
  useEffect(() => {
    if (name && name === savedRef.current && loadedRef.current) return;
    loadedRef.current = true;
    setError("");
    setNodeRuns({});
    setEdgeCounts({});
    setRun(null);
    if (name) {
      setDraftState(null);
      setState({ g: null, h: emptyHistory() });
      api
        .get<{ workflow: Graph; problems: Problem[] }>("/api/workflows/get", { name })
        .then((r) => {
          setState({ g: r.workflow, h: emptyHistory() });
          setBase(JSON.stringify(r.workflow));
          setProblems(r.problems);
          setSaved(r.workflow.name);
          setDirty(false);
        })
        .catch((e: Error) => setError(e.message));
    } else {
      const d = takeDraft();
      setState({ g: d ? d.graph : structuredClone(EMPTY), h: emptyHistory() });
      setBase("");
      setDraftState(d);
      setSaved("");
      setDirty(!!d);
      setProblems([]);
    }
  }, [name]);

  const g = state.g;

  // Validate as you edit (debounced).
  useEffect(() => {
    if (!g || !dirty) return;
    const t = setTimeout(() => {
      api
        .post<{ problems: Problem[] }>("/api/workflows/validate", { workflow: g, check_name: false })
        .then((r) => setProblems(r.problems))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [g, dirty]);

  /** Every change goes through here, so it can be undone. */
  const dispatch = useCallback(
    (commands: WfCommand[], edit: Edit = {}) => {
      if (!commands.length) return;
      setState((prev) => {
        if (!prev.g) return prev;
        const { graph, inverses } = applyAll(prev.g, commands);
        if (graph === prev.g) return prev;
        const text = edit.label ?? describe(commands[0]!, prev.g, label);
        return { g: graph, h: pushHistory(prev.h, commands, inverses, { label: text, coalesceKey: edit.coalesceKey ?? null, supersedes }) };
      });
      setDirty(true);
    },
    [label],
  );

  const undo = useCallback(() => {
    setState((prev) => {
      const step = prev.g ? stepBack(prev.h) : null;
      if (!step || !prev.g) return prev;
      return { g: applyAll(prev.g, step.entry.inverses).graph, h: step.history };
    });
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      const step = prev.g ? stepForward(prev.h) : null;
      if (!step || !prev.g) return prev;
      return { g: applyAll(prev.g, step.entry.commands).graph, h: step.history };
    });
    setDirty(true);
  }, []);

  /** A new step of `type`, after `after` (wired from its `port`), or at `at` on the canvas. */
  const addStep = useCallback(
    (type: string, opts: { after?: string; port?: string; at?: { x: number; y: number } } = {}): string | null => {
      const t = typesRef.current.get(type);
      if (!t || !g) return null;
      const id = nextId(g.nodes);
      const params: Record<string, unknown> = {};
      t.params.forEach((p) => (params[p.key] = structuredClone(p.default)));
      const src = opts.after ? g.nodes.find((n) => n.id === opts.after) : undefined;
      const position = opts.at ? { x: Math.round(opts.at.x), y: Math.round(opts.at.y) } : placeAfter(g.nodes, src ?? g.nodes[g.nodes.length - 1]);
      const node: GNode = { id, type, params, position };
      const port = opts.port ?? (src ? (typesRef.current.get(src.type)?.outputs[0] ?? "out") : "out");
      const edges = src && !t.trigger ? [{ from: src.id, from_port: port, to: id }] : [];
      dispatch([{ type: "ADD_NODE", node, edges }]);
      return id;
    },
    [g, dispatch],
  );

  /** Swap in a described workflow, keeping this one's name and switches. One undo step. */
  const applyDescribed = useCallback(
    (graph: Graph) => {
      if (!g) return;
      dispatch([{ type: "REPLACE", graph: { ...graph, name: g.name || graph.name, active: g.active, live: g.live } }]);
      setNodeRuns({});
      setEdgeCounts({});
    },
    [g, dispatch],
  );

  const save = useCallback(async (): Promise<string | null> => {
    if (!g) return null;
    let nameNow = g.name.trim();
    if (!nameNow) {
      const first = g.nodes.find((n) => n.type === "find")?.params.query;
      nameNow = (typeof first === "string" && first ? first : "my-workflow").toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "my-workflow";
    }
    try {
      const r = await api.post<{ ok: boolean; workflow?: Graph; problems?: Problem[]; error?: string }>("/api/workflows/save", { workflow: { ...g, name: nameNow }, create: !saved });
      if (!r.ok || !r.workflow) {
        setProblems(r.problems ?? []);
        toast(r.error || "Can't save yet: fix the problems shown.", "error");
        return null;
      }
      const wf = r.workflow;
      // Saving isn't an edit: keep the history, so undo still reaches past it.
      setState((prev) => ({ ...prev, g: wf }));
      setBase(JSON.stringify(wf));
      setProblems(r.problems ?? []);
      setDirty(false);
      if (saved !== wf.name) {
        setSaved(wf.name);
        // replace(): no extra history entry, but the route (and the list) follow.
        window.location.replace(href("workflows", wf.name));
      }
      toast("Saved");
      return wf.name;
    } catch (e) {
      fail(e);
      return null;
    }
  }, [g, saved]);

  const start = useCallback(
    async (mode: "test" | "run", after = 0) => {
      if (!g || run?.status === "running") return;
      let body: Record<string, unknown>;
      if (mode === "run") {
        const n = dirty || !saved ? await save() : saved;
        if (!n) return;
        body = { name: n, mode: "run", live: g.live };
      } else {
        body = dirty || !saved ? { workflow: { ...g, name: g.name || "draft" }, mode: "test" } : { name: saved, mode: "test" };
      }
      setNodeRuns({});
      setEdgeCounts({});
      const first = mode === "test" ? "Test run: nothing is sent, saved or exported." : g.live ? "Real run: emails send inside your warm-up cap." : "Real run: emails wait for your approval on Today.";
      setRun({ mode, after, status: "running", lines: [first] });
      const add = (line: string) => setRun((r) => (r ? { ...r, lines: [...r.lines, line] } : r));
      try {
        await api.stream<Record<string, unknown>>("/api/workflows/run", body, (ev) => {
          if (ev.type === "node") setNodeRuns((r) => ({ ...r, [String(ev.id)]: ev as unknown as NodeRun }));
          else if (ev.type === "progress") setNodeRuns((r) => ({ ...r, [String(ev.node)]: { ...(r[String(ev.node)] ?? { status: "running" }), progress: Number(ev.count) } }));
          else if (ev.type === "phase") {
            const msg = String(ev.message);
            // A phase replaces the one before it: "searching…" then "done: 14 leads".
            setRun((r) => (r ? { ...r, lines: r.lines[r.lines.length - 1]?.startsWith("· ") ? [...r.lines.slice(0, -1), `· ${msg}`] : [...r.lines, `· ${msg}`] } : r));
          }
          else if (ev.type === "edge") setEdgeCounts((c) => ({ ...c, [`${ev.from}|${ev.from_port}|${ev.to}`]: Number(ev.count) }));
          else if (ev.type === "log") add(String(ev.message));
          else if (ev.type === "error") add(`Error: ${String(ev.message)}`);
          else if (ev.type === "done") {
            if (ev.error) add(String(ev.error));
            setRun((r) => (r ? { ...r, status: ev.status === "error" ? "error" : "done", seconds: Number(ev.seconds) } : r));
          }
        });
        setRun((r) => (r && r.status === "running" ? { ...r, status: "done" } : r));
      } catch (e) {
        fail(e);
        setRun((r) => (r ? { ...r, status: "error", lines: [...r.lines, (e as Error).message] } : r));
      } finally {
        if (saved || mode === "run") void past.reload();
      }
    },
    [g, dirty, saved, save, run, past],
  );

  return {
    catalog,
    types,
    label,
    g,
    saved,
    dirty: dirty && (!base || !g || JSON.stringify(g) !== base),
    problems,
    error,
    draft,
    clearDraft: () => setDraftState(null),
    dispatch,
    undo,
    redo,
    canUndo: canUndo(state.h),
    canRedo: canRedo(state.h),
    undoLabel: undoLabel(state.h),
    redoLabel: redoLabel(state.h),
    addStep,
    applyDescribed,
    save,
    start,
    run,
    clearRun: () => setRun(null),
    nodeRuns,
    edgeCounts,
    past: past.data?.runs ?? [],
  };
}

export type WorkflowModel = ReturnType<typeof useWorkflow>;
