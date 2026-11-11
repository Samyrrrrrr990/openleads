import { useCallback, useRef, useState } from "react";

import { api } from "~/lib/api";
import { setCounts } from "~/lib/counts";
import { remember } from "~/lib/requests";
import type { Counts, Plan, PlanReply, RunResult } from "~/lib/types";

export type TurnStatus = "reading" | "plan" | "running" | "done" | "answer" | "error" | "dismissed";

export interface Turn {
  id: number;
  text: string;
  status: TurnStatus;
  plan?: Plan;
  planId?: string;
  runnable?: boolean;
  /** Short lines of what's happening while a plan runs. */
  log: string[];
  found: number;
  answer?: string;
  result?: RunResult;
  error?: string;
}

export type RunEvent =
  | { type: "phase" | "log"; message: string }
  | { type: "lead" }
  | { type: "progress"; count: number }
  | { type: "node"; id: string; status: string; out?: Record<string, number> }
  | { type: "done"; result?: RunResult; answer?: string; counts?: Counts }
  | { type: "error"; message: string }
  | { type: "run" | "edge" };

const NODE_WORDS: Record<string, string> = {
  ok: "done",
  error: "failed",
  waiting: "waiting",
  disabled: "skipped",
};

/** What one stream event adds to a running turn. Pure, so it can be tested. */
export function applyEvent(turn: Turn, ev: RunEvent): Turn {
  switch (ev.type) {
    case "phase":
    case "log":
      return ev.message ? { ...turn, log: [...turn.log, ev.message].slice(-6) } : turn;
    case "lead":
      return { ...turn, found: turn.found + 1 };
    case "progress":
      return { ...turn, found: Math.max(turn.found, ev.count) };
    case "node": {
      if (ev.status === "running") return turn;
      const total = ev.out ? Object.values(ev.out).reduce((a, b) => a + b, 0) : null;
      const line = `${ev.id}: ${NODE_WORDS[ev.status] ?? ev.status}${total === null ? "" : ` (${total})`}`;
      return { ...turn, log: [...turn.log, line].slice(-6) };
    }
    case "done":
      // A workflow's own "done" carries no result; ours (the last one) does.
      return ev.result ? { ...turn, status: "done", result: ev.result, answer: ev.answer } : turn;
    case "error":
      return { ...turn, status: "error", error: ev.message };
    default:
      return turn;
  }
}

export function useAsk(onChanged: () => void) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const nextId = useRef(1);

  const patch = useCallback((id: number, fn: (t: Turn) => Turn) => {
    setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const ask = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const id = nextId.current++;
      remember(text);
      setTurns((all) => [...all, { id, text, status: "reading", log: [], found: 0 }]);
      try {
        const r = await api.post<PlanReply>("/api/ask/plan", { text });
        if (r.kind === "answer") patch(id, (t) => ({ ...t, status: "answer", answer: r.answer }));
        else patch(id, (t) => ({ ...t, status: "plan", plan: r.plan, planId: r.id, runnable: r.runnable }));
      } catch (e) {
        patch(id, (t) => ({ ...t, status: "error", error: (e as Error).message }));
      }
    },
    [patch],
  );

  const run = useCallback(
    async (id: number, planId: string, confirmed: boolean) => {
      patch(id, (t) => ({ ...t, status: "running" }));
      try {
        await api.stream<RunEvent>("/api/ask/run", { id: planId, confirmed }, (ev) => {
          if (ev.type === "done" && ev.counts) setCounts(ev.counts);
          patch(id, (t) => applyEvent(t, ev));
        });
        patch(id, (t) =>
          t.status === "running" ? { ...t, status: "error", error: "The run ended without a result." } : t,
        );
      } catch (e) {
        patch(id, (t) => ({ ...t, status: "error", error: (e as Error).message }));
      }
      onChanged();
    },
    [patch, onChanged],
  );

  const dismiss = useCallback((id: number) => patch(id, (t) => ({ ...t, status: "dismissed" })), [patch]);

  return { turns, ask, run, dismiss };
}
