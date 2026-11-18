/**
 * The Intent surface.
 *
 * A compact command bar, not a chat sidebar. It shows exactly what will change
 * before anything changes, and applying goes through the normal command path
 * so the result is a single undo step like any other edit.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { nodeLabel } from '@zory/core';
import { IntentError, activeProvider, propose } from '../../core/intent/engine';
import { activeKeyProviderLabel } from '../../core/intent/byokProvider';
import type { IntentProposal } from '../../core/intent/types';
import { EXAMPLE_PROMPTS } from '../../core/intent/localProvider';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { Button, Kbd } from '../../ui/controls';
import { SparkIcon } from '../../ui/icons';
import styles from './IntentBar.module.css';

export function IntentBar(): React.ReactElement | null {
  const open = useUiStore((s) => s.intentOpen);
  const setOpen = useUiStore((s) => s.setIntentOpen);
  const selectedId = useUiStore((s) => s.selectedId);
  const breakpoint = useUiStore((s) => s.breakpoint);
  const pageId = useUiStore((s) => s.pageId);
  const selectedName = useProjectStore((s) => {
    const node = selectedId ? s.project?.nodes[selectedId] : null;
    return node ? nodeLabel(node) : null;
  });

  const [prompt, setPrompt] = useState('');
  const [proposal, setProposal] = useState<IntentProposal | null>(null);
  const [error, setError] = useState<{ message: string; suggestions: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const applyRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusTo = useRef<Element | null>(null);
  // Guards against a slow provider resolving after the user has moved on.
  const requestSeq = useRef(0);

  // Reset each time the bar opens; remember where focus came from.
  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement;
    setPrompt('');
    setProposal(null);
    setError(null);
    setBusy(false);
    requestSeq.current += 1;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Return focus to whatever opened the bar.
  useEffect(() => {
    if (open) return;
    const previous = restoreFocusTo.current;
    if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
  }, [open]);

  // Move focus to Apply as soon as a proposal lands, so Enter confirms it.
  useEffect(() => {
    if (proposal) applyRef.current?.focus();
  }, [proposal]);

  const runPropose = useCallback(
    async (text: string) => {
      const project = useProjectStore.getState().project;
      if (!project) return;

      const seq = (requestSeq.current += 1);
      setBusy(true);
      setError(null);
      setProposal(null);

      try {
        const result = await propose({ project, selectedId, pageId, breakpoint }, text);
        if (seq !== requestSeq.current) return;
        setProposal(result);
      } catch (caught) {
        if (seq !== requestSeq.current) return;
        if (caught instanceof IntentError) {
          setError({ message: caught.message, suggestions: caught.suggestions });
        } else {
          setError({
            message: caught instanceof Error ? caught.message : 'Something went wrong.',
            suggestions: [],
          });
        }
      } finally {
        if (seq === requestSeq.current) setBusy(false);
      }
    },
    // `pageId` is read inside, so it belongs here. Without it a proposal made
    // after switching pages was still built against the page that was open
    // when this callback was last created.
    [selectedId, pageId, breakpoint],
  );

  const apply = useCallback(() => {
    if (!proposal) return;
    const result = useProjectStore.getState().run(proposal.commands, {
      label: proposal.summary,
      // Never merge an Intent change into a neighbouring edit — it must be
      // one discrete, reversible step.
      coalesceKey: null,
    });

    if (!result.ok) {
      setError({ message: `Studio refused that change: ${result.reason}`, suggestions: [] });
      setProposal(null);
      return;
    }
    setOpen(false);
  }, [proposal, setOpen]);

  if (!open) return null;

  const provider = activeProvider();
  const keyProvider = activeKeyProviderLabel();

  return (
    <div
      className={styles.scrim}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Intent, describe a change"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          // Keep focus inside the dialog.
          const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
            'input, button:not([disabled])',
          );
          if (!focusables || focusables.length === 0) return;
          const first = focusables[0]!;
          const last = focusables[focusables.length - 1]!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className={styles.inputRow}>
          <span className={styles.spark}>
            <SparkIcon size={15} />
          </span>
          <label className="sr-only" htmlFor="intent-prompt">
            Describe the change you want
          </label>
          <input
            id="intent-prompt"
            ref={inputRef}
            className={styles.input}
            value={prompt}
            placeholder={selectedId ? 'Describe a change…' : 'Select an element first'}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="intent-target"
            onChange={(event) => {
              setPrompt(event.target.value);
              // A new prompt invalidates the previous proposal.
              if (proposal) setProposal(null);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !busy) {
                event.preventDefault();
                if (proposal) apply();
                else void runPropose(prompt);
              }
            }}
          />
          <span
            id="intent-target"
            className={`${styles.target} ${selectedName ? '' : styles.targetEmpty}`}
          >
            {selectedName ?? 'Nothing selected'}
          </span>
        </div>

        <div className={styles.body}>
          {proposal && (
            <div className={styles.proposal}>
              <p className={styles.proposalHead}>Proposed change</p>
              <ul className={styles.changeList}>
                {proposal.descriptions.map((description, index) => (
                  <li key={`${description}-${index}`} className={styles.change}>
                    <span className={styles.changeType}>{proposal.commands[index]?.type}</span>
                    <span>{description}</span>
                  </li>
                ))}
              </ul>

              {/*
                What was asked for and refused.
                
                Shown rather than swallowed. A proposal that quietly dropped
                three of the twenty changes somebody asked for would look like
                Zory misunderstanding them, and they would have no way to tell
                the difference between "it did not try" and "it tried and the
                project would not take it".
              */}
              {proposal.skipped.length > 0 && (
                <div className={styles.skipped}>
                  <p className={styles.skippedHead}>
                    {proposal.skipped.length} not applied
                  </p>
                  <ul className={styles.changeList}>
                    {proposal.skipped.map((item, index) => (
                      <li key={`${item.what}-${index}`} className={styles.change}>
                        <span className={styles.changeType}>{item.what}</span>
                        <span>{item.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {error && (
            <>
              <p className={styles.error} role="alert">
                {error.message}
              </p>
              {error.suggestions.length > 0 && (
                <div className={styles.suggestions}>
                  <p className={styles.suggestionLabel}>Try one of these</p>
                  <div className={styles.chips}>
                    {error.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className={styles.chip}
                        onClick={() => {
                          setPrompt(suggestion);
                          void runPropose(suggestion);
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {!proposal && !error && (
            <div className={styles.suggestions}>
              <p className={styles.suggestionLabel}>Examples</p>
              <div className={styles.chips}>
                {EXAMPLE_PROMPTS.slice(0, 7).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className={styles.chip}
                    onClick={() => {
                      setPrompt(suggestion);
                      void runPropose(suggestion);
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.footerNote}>
            {proposal ? (
              <>
                <Kbd>↵</Kbd> to apply · <Kbd>esc</Kbd> to cancel · undoable
              </>
            ) : (
              <span className={styles.provider}>
                <span className={styles.providerDot} />
                {/*
                  Two providers are genuinely in play: the on-device rules
                  answer what they recognise and a key, when present, picks up
                  the rest. Naming only the first was misleading — someone who
                  had just pasted a key was told their edits ran locally.
                */}
                {keyProvider
                  ? `${provider.name} first, then your ${keyProvider} key`
                  : `${provider.name} · runs on this device, no account needed`}
              </span>
            )}
          </span>

          {busy && <span className={styles.spinner} aria-label="Working" role="status" />}

          {proposal ? (
            <>
              <Button variant="ghost" onClick={() => setProposal(null)}>
                Discard
              </Button>
              <Button ref={applyRef} variant="primary" onClick={apply}>
                Apply change
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              disabled={busy || prompt.trim() === ''}
              onClick={() => void runPropose(prompt)}
            >
              Preview change
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
