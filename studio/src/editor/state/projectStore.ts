/**
 * The canonical project store.
 *
 * This holds the project graph and its history and nothing else — no
 * selection, no zoom, no panel state. Editor UI state lives in `uiStore`, so
 * that moving the cursor can never invalidate a subscription that reads the
 * graph.
 *
 * Every mutation enters through `run`. There is no setter for the graph.
 */

import { create } from 'zustand';
import type { Project, ZoryCommand, History } from '@zory/core';
import {
  applyCommand,
  executeBatch,
  validateCommand,
  describeCommand,
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  emptyHistory,
  pushHistory,
  redoLabel as historyRedoLabel,
  stepBack,
  stepForward,
  undoLabel as historyUndoLabel,
} from '@zory/core';
import { saveProject } from '../../core/persistence/repository';
import { snapshot } from '../../core/history/versions';
import { trackFirstEdit } from '../../core/analytics/analytics';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

/** Delay after the last edit before the project is written to IndexedDB. */
export const AUTOSAVE_DELAY_MS = 700;

export interface RunOptions {
  /** Undo label. Derived from the first command when omitted. */
  label?: string;
  /** Consecutive runs sharing a key merge into one undo step. */
  coalesceKey?: string | null;
}

export type RunResult = { ok: true } | { ok: false; reason: string };

interface ProjectState {
  project: Project | null;
  history: History;
  saveState: SaveState;
  lastSavedAt: number | null;
  saveError: string | null;

  load: (project: Project) => void;
  close: () => void;
  run: (commands: ZoryCommand[], options?: RunOptions) => RunResult;
  undo: () => boolean;
  redo: () => boolean;
  flush: () => Promise<void>;
}

/**
 * Where a save goes.
 *
 * IndexedDB by default. Zory Local swaps this for a function that writes
 * through the loopback bridge into a real repository, and the store never
 * learns the difference — which is the whole reason autosave, save state and
 * the unsaved-changes warning work identically in both.
 */
export type PersistTarget = (project: Project) => Promise<void>;

let persistTarget: PersistTarget = saveProject;

export function setPersistTarget(target: PersistTarget | null): void {
  persistTarget = target ?? saveProject;
}

/**
 * How long versions are kept, and what to call the next one.
 *
 * Injected rather than imported, because the project store is the one module
 * in the editor that must not depend on billing — it is what Zory Local and
 * the desktop app both drive, and neither has an account.
 */
let retentionDaysFor: () => number = () => 0;
let historyLabel: () => string = () => 'Autosaved';

export function configureHistory(options: {
  retentionDays: () => number;
  label?: () => string;
}): void {
  retentionDaysFor = options.retentionDays;
  if (options.label) historyLabel = options.label;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
/** Serialises writes so a slow save can't be overtaken by a newer one. */
let saveChain: Promise<void> = Promise.resolve();

function cancelAutosave(): void {
  if (autosaveTimer !== null) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

export const useProjectStore = create<ProjectState>((set, get) => {
  /** Writes the current project. Never called during a pointer interaction. */
  const persist = async (): Promise<void> => {
    const { project } = get();
    if (!project) return;
    set({ saveState: 'saving' });

    saveChain = saveChain.then(async () => {
      const current = get().project;
      if (!current) return;
      try {
        await persistTarget(current);
        // Only report "saved" if nothing changed while the write was in flight.
        if (get().project === current) {
          set({ saveState: 'saved', lastSavedAt: Date.now(), saveError: null });
        }

        /*
         * A version, if the plan keeps them and enough has changed.
         *
         * On the save path rather than on a timer of its own, so a project
         * nobody is editing costs nothing. `snapshot` does its own throttling
         * and returns null when it decides not to; a failure here is never
         * allowed to turn into a failed save.
         */
        void snapshot(current, {
          label: historyLabel(),
          retentionDays: retentionDaysFor(),
        }).catch(() => {});
      } catch (error) {
        set({
          saveState: 'error',
          saveError: error instanceof Error ? error.message : 'Could not save to this browser.',
        });
      }
    });

    return saveChain;
  };

  const scheduleAutosave = (): void => {
    cancelAutosave();
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void persist();
    }, AUTOSAVE_DELAY_MS);
  };

  return {
    project: null,
    history: emptyHistory(),
    saveState: 'saved',
    lastSavedAt: null,
    saveError: null,

    load: (project) => {
      cancelAutosave();
      set({
        project,
        history: emptyHistory(),
        saveState: 'saved',
        lastSavedAt: null,
        saveError: null,
      });
    },

    close: () => {
      cancelAutosave();
      set({ project: null, history: emptyHistory(), saveState: 'saved', saveError: null });
    },

    run: (commands, options = {}) => {
      const { project, history } = get();
      if (!project) return { ok: false, reason: 'No project is open.' };
      if (commands.length === 0) return { ok: true };

      // Validate the whole batch against the state each command would see, so
      // a batch either lands completely or not at all.
      let probe = project;
      for (const command of commands) {
        const result = validateCommand(probe, command);
        if (!result.ok) return result;
        probe = applyCommand(probe, command);
      }

      const { next, inverses } = executeBatch(project, commands);
      const label = options.label ?? describeCommand(project, commands[0]!);

      /*
       * "Active" means somebody changed something, not that they loaded the
       * editor — and this is the only place every change passes through.
       * Latched to once per session inside `trackFirstEdit`, so a drag that
       * emits forty commands is still one activation.
       */
      trackFirstEdit(commands[0]!.type);

      set({
        project: { ...next, updatedAt: Date.now() },
        history: pushHistory(history, commands, inverses, {
          label,
          coalesceKey: options.coalesceKey ?? null,
        }),
        saveState: 'unsaved',
      });
      scheduleAutosave();
      return { ok: true };
    },

    undo: () => {
      const { project, history } = get();
      if (!project) return false;
      const step = stepBack(history);
      if (!step) return false;

      let cursor = project;
      for (const inverse of step.entry.inverses) cursor = applyCommand(cursor, inverse);

      set({
        project: { ...cursor, updatedAt: Date.now() },
        history: step.history,
        saveState: 'unsaved',
      });
      scheduleAutosave();
      return true;
    },

    redo: () => {
      const { project, history } = get();
      if (!project) return false;
      const step = stepForward(history);
      if (!step) return false;

      let cursor = project;
      for (const command of step.entry.commands) cursor = applyCommand(cursor, command);

      set({
        project: { ...cursor, updatedAt: Date.now() },
        history: step.history,
        saveState: 'unsaved',
      });
      scheduleAutosave();
      return true;
    },

    flush: async () => {
      cancelAutosave();
      await persist();
    },
  };
});

// ---- Narrow selectors -------------------------------------------------------
// Components subscribe through these so that editing one node does not wake
// every subscriber in the editor.

export const selectCanUndo = (s: ProjectState): boolean => historyCanUndo(s.history);
export const selectCanRedo = (s: ProjectState): boolean => historyCanRedo(s.history);

/** What undo would reverse, e.g. "Set size to 72px on Hero title". */
export const selectUndoLabel = (s: ProjectState): string | null => historyUndoLabel(s.history);
export const selectRedoLabel = (s: ProjectState): string | null => historyRedoLabel(s.history);
