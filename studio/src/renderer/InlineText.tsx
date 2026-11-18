/**
 * Inline text editing on the canvas.
 *
 * `contentEditable` needs care in React: re-rendering the element while the
 * user types resets the caret. This component therefore writes the DOM once on
 * mount and then leaves it alone, treating the element as uncontrolled for as
 * long as the edit lasts. The store still receives every keystroke.
 *
 * Content is only ever read and written through `textContent` — no HTML is
 * parsed from user input at any point.
 */

import { createElement, useEffect, useRef, type CSSProperties, type ReactElement } from 'react';

export interface InlineTextProps {
  nodeId: string;
  tag: string;
  text: string;
  style: CSSProperties;
  onCommit: (nodeId: string, text: string) => void;
  onEnd: () => void;
}

export function InlineText({
  nodeId,
  tag,
  text,
  style,
  onCommit,
  onEnd,
}: InlineTextProps): ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  // Held in a ref so changing callbacks never re-run the mount effect.
  const latest = useRef({ onCommit, onEnd, text });
  latest.current = { onCommit, onEnd, text };

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.textContent = latest.current.text;
    element.focus({ preventScroll: true });

    // Put the caret at the end rather than selecting everything, so the first
    // keystroke appends instead of replacing the line.
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    // Runs once per edit session — `nodeId` changing means a different node.
  }, [nodeId]);

  return createElement(tag, {
    ref,
    'data-zory-id': nodeId,
    'data-zory-editing': 'true',
    contentEditable: 'plaintext-only',
    suppressContentEditableWarning: true,
    role: 'textbox',
    'aria-label': 'Edit text',
    tabIndex: 0,
    style: { ...style, cursor: 'text', outline: 'none' },
    onInput: (event: React.FormEvent<HTMLElement>) => {
      onCommit(nodeId, event.currentTarget.textContent ?? '');
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      // Keep canvas shortcuts from firing while the user is writing.
      event.stopPropagation();
      if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        (event.currentTarget as HTMLElement).blur();
      }
    },
    onPaste: (event: React.ClipboardEvent<HTMLElement>) => {
      // Paste as plain text so no markup ever enters the editable region.
      event.preventDefault();
      const plain = event.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, plain);
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      onCommit(nodeId, event.currentTarget.textContent ?? '');
      onEnd();
    },
    // The canvas selects on click; inside an active edit that would fight the
    // caret, so clicks stop here.
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => event.stopPropagation(),
    onClick: (event: React.MouseEvent<HTMLElement>) => event.stopPropagation(),
  });
}
