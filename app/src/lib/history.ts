/**
 * Structured undo history, from Studio (studio/core/history/history.ts), made generic
 * over the command type so any editor in the app can use it.
 *
 * History stores commands and their inverses rather than snapshots, so depth costs
 * almost nothing and every step stays inspectable. Entries are batches: a described
 * workflow that swaps in a whole graph undoes as one action. Consecutive entries that
 * share a coalesce key merge, so a burst of typing or one drag is a single undo step.
 */

export interface HistoryEntry<C> {
  /** Commands in the order they were applied. */
  commands: C[];
  /** Inverses in undo order, newest first. */
  inverses: C[];
  label: string;
  coalesceKey: string | null;
  at: number;
}

export interface History<C> {
  entries: HistoryEntry<C>[];
  /** Number of applied entries. `entries[0 … index-1]` are in effect. */
  index: number;
}

export const HISTORY_LIMIT = 200;
export const COALESCE_WINDOW_MS = 600;

export const emptyHistory = <C>(): History<C> => ({ entries: [], index: 0 });
export const canUndo = <C>(h: History<C>): boolean => h.index > 0;
export const canRedo = <C>(h: History<C>): boolean => h.index < h.entries.length;

export function undoLabel<C>(h: History<C>): string | null {
  return canUndo(h) ? (h.entries[h.index - 1]?.label ?? null) : null;
}

export function redoLabel<C>(h: History<C>): string | null {
  return canRedo(h) ? (h.entries[h.index]?.label ?? null) : null;
}

/** True when `b` fully overwrites `a`, so `a` can be dropped from a merged run. */
export type Supersedes<C> = (a: C, b: C) => boolean;

/** Drops commands that the next command in the run fully overwrites. */
function compact<C>(commands: C[], supersedes: Supersedes<C>): C[] {
  const out: C[] = [];
  for (let i = 0; i < commands.length; i += 1) {
    const next = commands[i + 1];
    if (next !== undefined && supersedes(commands[i]!, next)) continue;
    out.push(commands[i]!);
  }
  return out;
}

export interface PushOptions<C> {
  label: string;
  coalesceKey?: string | null;
  now?: number;
  supersedes?: Supersedes<C>;
}

/** Records a batch. Anything undone before it is discarded, as in every editor. */
export function pushHistory<C>(history: History<C>, commands: C[], inverses: C[], options: PushOptions<C>): History<C> {
  const now = options.now ?? Date.now();
  const supersedes = options.supersedes ?? (() => false);
  const entry: HistoryEntry<C> = { commands, inverses, label: options.label, coalesceKey: options.coalesceKey ?? null, at: now };
  const kept = history.entries.slice(0, history.index);
  const previous = kept[kept.length - 1];
  if (previous && entry.coalesceKey !== null && previous.coalesceKey === entry.coalesceKey && now - previous.at <= COALESCE_WINDOW_MS) {
    const merged: HistoryEntry<C> = {
      commands: compact([...previous.commands, ...entry.commands], supersedes),
      // Inverses run newest-first, so the newer batch leads.
      inverses: compact([...entry.inverses, ...previous.inverses], supersedes),
      label: entry.label,
      coalesceKey: entry.coalesceKey,
      at: now,
    };
    const entries = [...kept.slice(0, -1), merged];
    return { entries, index: entries.length };
  }
  const entries = [...kept, entry];
  const trimmed = entries.length > HISTORY_LIMIT ? entries.slice(entries.length - HISTORY_LIMIT) : entries;
  return { entries: trimmed, index: trimmed.length };
}

/** The entry undo would apply, and the history after it. */
export function stepBack<C>(h: History<C>): { entry: HistoryEntry<C>; history: History<C> } | null {
  const entry = canUndo(h) ? h.entries[h.index - 1] : undefined;
  return entry ? { entry, history: { ...h, index: h.index - 1 } } : null;
}

/** The entry redo would apply, and the history after it. */
export function stepForward<C>(h: History<C>): { entry: HistoryEntry<C>; history: History<C> } | null {
  const entry = canRedo(h) ? h.entries[h.index] : undefined;
  return entry ? { entry, history: { ...h, index: h.index + 1 } } : null;
}
