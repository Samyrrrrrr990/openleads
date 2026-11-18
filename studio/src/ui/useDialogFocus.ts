/**
 * The keyboard contract every dialog owes, in one place.
 *
 * `Modal` already implemented this correctly, but three dialogs do not use
 * `Modal` — the editor's preview overlay, the export dialog and the delete
 * confirmation each render their own scrim for layout reasons and each
 * hand-rolled a partial version of the behaviour. Partial is the problem: one
 * moved focus in but never gave it back, another handled Escape but let Tab
 * walk out into the page still rendered behind it. A keyboard user does not
 * get "most of a dialog".
 *
 * So the behaviour lives here and the container stays the caller's business:
 *
 *   focus goes in, preferring a real control over the panel itself
 *   Tab and Shift+Tab cycle inside, wrapping at both ends
 *   Escape closes, in the capture phase so it beats global shortcuts
 *   the page behind cannot scroll
 *   focus returns to whatever opened it, if nothing else has claimed it
 *
 * The panel needs `tabIndex={-1}` so there is somewhere to land when it holds
 * no focusable control; landing on `<body>` strands the keyboard outside.
 */

import { useEffect, useRef, type RefObject } from 'react';

/** Elements that can hold focus, for the Tab cycle and the initial landing. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface DialogFocusOptions {
  /**
   * Whether the dialog is currently open.
   *
   * Several dialogs here stay mounted and return `null` while closed, so the
   * hook cannot be called conditionally. Gating inside the effect keeps the
   * call unconditional and the behaviour correct.
   */
  enabled?: boolean;
  /**
   * Whether Escape should close. Off while a dialog is mid-operation, where
   * leaving would abandon work the person cannot see the state of.
   */
  closeOnEscape?: boolean;
}

export function useDialogFocus(
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  { enabled = true, closeOnEscape = true }: DialogFocusOptions = {},
): void {
  /*
   * `onClose` is usually an inline arrow, so it is a new function on every
   * render of the parent. Reading it from a ref keeps the effect below from
   * tearing down and re-attaching its listener on every keystroke the parent
   * re-renders for.
   */
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const escapeRef = useRef(closeOnEscape);
  useEffect(() => {
    escapeRef.current = closeOnEscape;
  }, [closeOnEscape]);

  useEffect(() => {
    if (!enabled) return;

    // Whatever had focus before the dialog opened, so it can be given back.
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (!escapeRef.current) return;
        event.stopPropagation();
        closeRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      // Re-queried each time: dialogs swap their contents, so a list captured
      // on open goes stale immediately.
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;

      const firstNode = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;

      // Wrap at both ends. Without this, Tab walks out of the dialog and into
      // the page behind it, which is still rendered and still focusable.
      if (event.shiftKey && (active === firstNode || !panelRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        firstNode.focus();
      }
    }

    // Capture phase so Escape closes the dialog before any handler underneath
    // it — the editor's global shortcuts, for one — reacts to the same key.
    document.addEventListener('keydown', onKey, true);

    /*
     * Scroll lock. Restoring the exact previous value rather than clearing it
     * matters: two dialogs can be open at once (an export dialog over the
     * editor), and the inner one closing must not unlock the page.
     */
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      // Only take focus back if it is still inside the dialog. If something
      // else has claimed it — a toast, a redirect — stealing it is worse.
      if (!opener) return;
      if (document.activeElement === document.body || panel?.contains(document.activeElement)) {
        opener.focus?.();
      }
    };
  }, [panelRef, enabled]);
}
