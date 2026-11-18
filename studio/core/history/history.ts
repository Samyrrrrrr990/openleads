/**
 * Structured undo history.
 *
 * History stores commands and their inverses rather than project snapshots, so
 * depth costs almost nothing and every step stays inspectable.
 *
 * Entries are batches: an Intent proposal that emits four commands undoes as
 * one action, which is what a user expects.
 */

import type { ZoryCommand } from '../commands/types';

export interface HistoryEntry {
  /** Commands in the order they were applied. */
  commands: ZoryCommand[];
  /** Inverses in undo order — newest first. */
  inverses: ZoryCommand[];
  label: string;
  /**
   * Consecutive entries sharing a key merge into one undo step, so a burst of
   * typing or a colour-picker drag is a single action.
   */
  coalesceKey: string | null;
  at: number;
}

export interface History {
  entries: HistoryEntry[];
  /** Number of applied entries. `entries[0 … index-1]` are in effect. */
  index: number;
}

export const HISTORY_LIMIT = 200;
export const COALESCE_WINDOW_MS = 600;

export const emptyHistory = (): History => ({ entries: [], index: 0 });

export const canUndo = (history: History): boolean => history.index > 0;
export const canRedo = (history: History): boolean => history.index < history.entries.length;

export function undoLabel(history: History): string | null {
  return canUndo(history) ? (history.entries[history.index - 1]?.label ?? null) : null;
}

export function redoLabel(history: History): string | null {
  return canRedo(history) ? (history.entries[history.index]?.label ?? null) : null;
}

/** True when b fully supersedes a, so a can be dropped from a merged run. */
function supersedes(a: ZoryCommand, b: ZoryCommand): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'SET_TEXT' && b.type === 'SET_TEXT') return a.nodeId === b.nodeId;
  if (a.type === 'SET_STYLE' && b.type === 'SET_STYLE') {
    if (a.nodeId !== b.nodeId || a.breakpoint !== b.breakpoint) return false;
    const laterKeys = new Set(Object.keys(b.patch));
    return Object.keys(a.patch).every((key) => laterKeys.has(key));
  }
  if (a.type === 'SET_PROJECT_NAME' && b.type === 'SET_PROJECT_NAME') return true;
  if (a.type === 'RENAME_NODE' && b.type === 'RENAME_NODE') return a.nodeId === b.nodeId;
  return false;
}

/**
 * Drops commands that a later command in the run fully overwrites. Keeps
 * merged typing runs from growing one command per keystroke.
 */
function compact(commands: ZoryCommand[]): ZoryCommand[] {
  const out: ZoryCommand[] = [];
  for (let i = 0; i < commands.length; i += 1) {
    const current = commands[i]!;
    const next = commands[i + 1];
    if (next && supersedes(current, next)) continue;
    out.push(current);
  }
  return out;
}

function mergeEntries(previous: HistoryEntry, next: HistoryEntry): HistoryEntry {
  return {
    commands: compact([...previous.commands, ...next.commands]),
    // Inverses run newest-first, so the newer batch leads.
    inverses: compact([...next.inverses, ...previous.inverses]),
    label: next.label,
    coalesceKey: next.coalesceKey,
    at: next.at,
  };
}

export interface PushOptions {
  label: string;
  coalesceKey?: string | null;
  now?: number;
}

/**
 * Records a batch. Anything previously undone is discarded — the future is
 * rewritten from the point the user edited, as in every other editor.
 */
export function pushHistory(
  history: History,
  commands: ZoryCommand[],
  inverses: ZoryCommand[],
  options: PushOptions,
): History {
  const now = options.now ?? Date.now();
  const entry: HistoryEntry = {
    commands,
    inverses,
    label: options.label,
    coalesceKey: options.coalesceKey ?? null,
    at: now,
  };

  const kept = history.entries.slice(0, history.index);
  const previous = kept[kept.length - 1];

  if (
    previous &&
    entry.coalesceKey !== null &&
    previous.coalesceKey === entry.coalesceKey &&
    now - previous.at <= COALESCE_WINDOW_MS
  ) {
    const merged = mergeEntries(previous, entry);
    const entries = [...kept.slice(0, -1), merged];
    return { entries, index: entries.length };
  }

  const entries = [...kept, entry];
  const overflow = Math.max(0, entries.length - HISTORY_LIMIT);
  const trimmed = overflow > 0 ? entries.slice(overflow) : entries;
  return { entries: trimmed, index: trimmed.length };
}

/** The entry that undo would apply, and the resulting history. */
export function stepBack(history: History): { entry: HistoryEntry; history: History } | null {
  if (!canUndo(history)) return null;
  const entry = history.entries[history.index - 1];
  if (!entry) return null;
  return { entry, history: { ...history, index: history.index - 1 } };
}

/** The entry that redo would apply, and the resulting history. */
export function stepForward(history: History): { entry: HistoryEntry; history: History } | null {
  if (!canRedo(history)) return null;
  const entry = history.entries[history.index];
  if (!entry) return null;
  return { entry, history: { ...history, index: history.index + 1 } };
}
