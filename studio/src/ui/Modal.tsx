/**
 * A dialog that is always centred on the viewport.
 *
 * This exists because of a bug that looked like a sync bug and was not. The
 * account dialog — the one holding "Sync projects now" — rendered as a child
 * of the dashboard header, and that header has `backdrop-filter` on it. A
 * filtered element becomes the containing block for its fixed-position
 * descendants, so `position: fixed; inset: 0` stopped meaning "the viewport"
 * and started meaning "the 52px strip at the top of the page". The dialog was
 * laid out inside that strip: pinned to the top, clipped, nowhere near the
 * centre. Sync worked the whole time. It just looked broken, which for a
 * backup feature is the same thing.
 *
 * The general fix is not "remove the blur" — it is to stop dialogs depending
 * on where in the tree they happen to be mounted. A portal to `document.body`
 * makes position independent of ancestry, so no future `transform`, `filter`,
 * `perspective`, `will-change` or `contain` on any parent can move a dialog
 * again.
 *
 * Everything else here is the behaviour a dialog owes a keyboard: focus goes
 * in, Tab cycles inside, Escape leaves, and focus returns to whatever opened
 * it.
 */

import { useCallback, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from './useDialogFocus';

export interface ModalProps {
  /** Accessible name. A dialog without one is an unlabelled region. */
  label: string;
  onClose: () => void;
  /** Class for the full-viewport backdrop. */
  scrimClassName?: string;
  /** Class for the panel itself. */
  className?: string;
  children: ReactNode;
}

export function Modal({
  label,
  onClose,
  scrimClassName,
  className,
  children,
}: ModalProps): React.ReactElement | null {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useDialogFocus(panelRef, onClose);

  const onScrimPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Only a press that both starts and lands on the backdrop closes. A
      // drag that began on a text selection inside the panel and released
      // over the scrim is not a request to discard the dialog.
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  // Rendered in the body, deliberately outside every stacking context the app
  // creates. Server-side there is no body to portal into; the dialogs here are
  // all opened by a click, so there is nothing to render before hydration.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={scrimClassName} onPointerDown={onScrimPointerDown}>
      <div
        ref={panelRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
