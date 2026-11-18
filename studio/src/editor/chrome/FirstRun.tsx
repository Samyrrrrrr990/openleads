/**
 * The first five minutes.
 *
 * Zory had no onboarding at all: a new project opened onto a canvas, a
 * three-panel editor and no indication of which of those things to touch
 * first. Everything worked and nothing said so, which is the failure mode
 * where people conclude a tool is not for them while it is behaving perfectly.
 *
 * The shape here is deliberate, and it is not a tour.
 *
 * **Nothing is blocked and nothing is dimmed.** A coach mark that greys the
 * interface and walks a cursor around it teaches the tour rather than the
 * tool; when it ends the person is where they started with one more thing to
 * dismiss. This is a card in the corner of the work.
 *
 * **Steps tick themselves.** Each one watches the store for the thing actually
 * happening — a selection, a command landing in history, the breakpoint
 * moving — so the list is a record of what someone has already found rather
 * than instructions to follow in order. Somebody who explores out of sequence
 * gets credit for it, which is the difference between a guide and a chore.
 *
 * **It is honest about being finished.** Once every step is done it says so
 * once and goes, rather than lingering as a permanent widget.
 *
 * The person who has already done this does not see it again: dismissal and
 * completion are both remembered, and a failure to read that memory shows the
 * guide rather than hiding it, because a repeated guide is a smaller cost than
 * a missing one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { CheckIcon, CloseIcon } from '../../ui/icons';
import { shortcut } from './platform';
import styles from './FirstRun.module.css';

/** Remembered per browser, not per project: you learn the editor once. */
const STORAGE_KEY = 'zory.firstRun.done';
const PROGRESS_KEY = 'zory.firstRun.seen';

interface Seen {
  selected: boolean;
  edited: boolean;
  responsive: boolean;
  intent: boolean;
  exported: boolean;
}

const NOTHING_SEEN: Seen = {
  selected: false,
  edited: false,
  responsive: false,
  intent: false,
  exported: false,
};

function remembered(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private browsing, or site data blocked. Showing the guide to somebody
    // who has seen it beats hiding it from somebody who has not.
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* Nothing to do. The guide reappears next time, which is survivable. */
  }
}

/**
 * Progress, kept across projects.
 *
 * Held only in component state at first, which meant the latch reset on every
 * mount — so somebody with nine projects met "0 of 5" again each time they
 * opened one, having already done four of the five. A guide that forgets is
 * worse than no guide: it stops reading as help and starts reading as a
 * widget that will not go away.
 *
 * Stored per browser for the same reason as the dismissal: the editor is
 * learned once, not once per project.
 */
function rememberedProgress(): Seen {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return NOTHING_SEEN;
    const parsed = JSON.parse(raw) as Partial<Seen>;
    return {
      selected: parsed.selected === true,
      edited: parsed.edited === true,
      responsive: parsed.responsive === true,
      intent: parsed.intent === true,
      exported: parsed.exported === true,
    };
  } catch {
    // Unreadable or malformed. Starting over is the survivable direction.
    return NOTHING_SEEN;
  }
}

function rememberProgress(seen: Seen): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(seen));
  } catch {
    /* Nothing to do. */
  }
}

interface Step {
  id: string;
  label: string;
  hint: string;
  done: boolean;
}

export function FirstRun(): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(remembered);
  const [celebrated, setCelebrated] = useState(false);

  const selectedId = useUiStore((s) => s.selectedId);
  const breakpoint = useUiStore((s) => s.breakpoint);
  const intentOpen = useUiStore((s) => s.intentOpen);
  const exportOpen = useUiStore((s) => s.exportOpen);
  const historyIndex = useProjectStore((s) => s.history.index);

  /*
   * Latched, not live.
   *
   * A step asks "has this ever happened", so each flag is sticky once set.
   * Reading the store directly would un-tick "select something" the moment
   * somebody clicks the background, which turns a record of progress into a
   * thing that punishes them for moving on.
   */
  const [seen, setSeen] = useState<Seen>(rememberedProgress);

  useEffect(() => {
    setSeen((prev) => {
      const next: Seen = {
        selected: prev.selected || selectedId !== null,
        edited: prev.edited || historyIndex > 0,
        responsive: prev.responsive || breakpoint !== 'base',
        intent: prev.intent || intentOpen,
        exported: prev.exported || exportOpen,
      };
      const changed = (Object.keys(next) as (keyof Seen)[]).some((key) => next[key] !== prev[key]);
      if (changed) rememberProgress(next);
      return changed ? next : prev;
    });
  }, [selectedId, historyIndex, breakpoint, intentOpen, exportOpen]);

  const steps: Step[] = useMemo(
    () => [
      {
        id: 'select',
        label: 'Click something on the page',
        hint: 'Anything on the canvas. The panel on the right becomes that element.',
        done: seen.selected,
      },
      {
        id: 'edit',
        label: 'Change it',
        hint: 'Type over the text, or move a slider on the right. Undo is ' + shortcut('Z') + '.',
        done: seen.edited,
      },
      {
        id: 'responsive',
        label: 'Check it on a phone',
        hint: 'The three icons at the top. What you change there only applies there.',
        done: seen.responsive,
      },
      {
        id: 'intent',
        label: 'Ask for a change in words',
        hint: shortcut('K') + ' — describe it, see exactly what will change, then apply or cancel.',
        done: seen.intent,
      },
      {
        id: 'export',
        label: 'Take the code',
        hint: 'Export gives you a React and TypeScript project. It is yours, with no Studio in it.',
        done: seen.exported,
      },
    ],
    [seen],
  );

  const doneCount = steps.filter((step) => step.done).length;
  const complete = doneCount === steps.length;

  // Said once, then gone. A guide that stays after it is finished is a widget.
  useEffect(() => {
    if (!complete) return;
    setCelebrated(true);
    remember();
    const timer = window.setTimeout(() => setDismissed(true), 4000);
    return () => window.clearTimeout(timer);
  }, [complete]);

  const dismiss = useCallback(() => {
    remember();
    setDismissed(true);
  }, []);

  if (dismissed) return null;

  const current = steps.find((step) => !step.done);

  return (
    <aside className={styles.card} aria-label="Getting started">
      <button type="button" className={styles.dismiss} aria-label="Hide the guide" onClick={dismiss}>
        <CloseIcon size={11} />
      </button>

      {complete && celebrated ? (
        <p className={styles.done}>
          That is the whole editor. Everything else is more of the same — select, change, check,
          export.
        </p>
      ) : (
        <>
          <div className={styles.head}>
            <p className={styles.title}>Getting started</p>
            <span className={styles.count}>
              {doneCount}/{steps.length}
            </span>
          </div>

          <div
            className={styles.track}
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-label="Getting started progress"
          >
            <div
              className={styles.fill}
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>

          <ul className={styles.steps}>
            {steps.map((step) => (
              <li
                key={step.id}
                className={`${styles.step} ${step.done ? styles.stepDone : ''} ${
                  step === current ? styles.stepNow : ''
                }`}
              >
                <span className={`${styles.tick} ${step.done ? styles.tickDone : ''}`}>
                  <CheckIcon size={8} />
                </span>
                <span className={styles.label}>
                  {step.label}
                  {/*
                    Only the step in hand carries its hint. Five hints at once
                    is a wall of text nobody reads; one is a next action.
                  */}
                  {step === current ? <span className={styles.hint}>{step.hint}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
