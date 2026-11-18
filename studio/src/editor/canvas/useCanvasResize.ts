/**
 * Resizing an element by its handles.
 *
 * The other half of direct manipulation. Dragging moves a thing; without
 * resizing you can put a card anywhere on the page and still have to open a
 * panel to make it wider, which is the moment a visual editor stops feeling
 * direct.
 *
 * Like dragging, this writes a live transform during the gesture and one
 * command on release, so the undo stack gets a single entry rather than one
 * per frame.
 *
 * What it writes is deliberately plain: `width` and `height`, plus `left` and
 * `top` when a handle moves the origin. No transform scaling, because a scaled
 * element renders blurry text and exports as something no one would have
 * written by hand.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Breakpoint, NodeId, Project, StylePatch } from '@zory/core';
import { setStyle } from '@zory/core';
import { useProjectStore } from '../state/projectStore';

/** Which edges a handle moves. */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Nothing may be resized below this, or it becomes impossible to grab again. */
const MIN_SIZE = 16;

export interface ResizeGeometry {
  width: number;
  height: number;
  left: number;
  top: number;
}

/**
 * Applies a pointer delta to a box, given which handle is being dragged.
 *
 * Pure, so the arithmetic that decides whether a west handle grows or shrinks
 * a box can be tested without a browser — it is the part that is easy to get
 * backwards and impossible to eyeball from a screenshot.
 */
export function resizeBox(
  start: ResizeGeometry,
  handle: ResizeHandle,
  dx: number,
  dy: number,
): ResizeGeometry {
  let { width, height, left, top } = start;

  if (handle.includes('e')) width = start.width + dx;
  if (handle.includes('s')) height = start.height + dy;

  /*
   * West and north handles move the origin as well as the size. Clamping has
   * to happen against the *far* edge, otherwise dragging past the minimum
   * keeps pushing the element sideways while its width sits at the floor.
   */
  if (handle.includes('w')) {
    const right = start.left + start.width;
    left = Math.min(start.left + dx, right - MIN_SIZE);
    width = right - left;
  }
  if (handle.includes('n')) {
    const bottom = start.top + start.height;
    top = Math.min(start.top + dy, bottom - MIN_SIZE);
    height = bottom - top;
  }

  return {
    width: Math.max(MIN_SIZE, Math.round(width)),
    height: Math.max(MIN_SIZE, Math.round(height)),
    left: Math.round(left),
    top: Math.round(top),
  };
}

export interface CanvasResize {
  nodeId: NodeId | null;
  handle: ResizeHandle | null;
}

export function useCanvasResize(
  frameRef: RefObject<HTMLElement | null>,
  project: Project | null,
  zoom: number,
  breakpoint: Breakpoint,
): {
  resize: CanvasResize;
  begin: (event: React.PointerEvent, nodeId: NodeId, handle: ResizeHandle) => void;
} {
  const [resize, setResize] = useState<CanvasResize>({ nodeId: null, handle: null });

  const active = useRef<{
    nodeId: NodeId;
    handle: ResizeHandle;
    startX: number;
    startY: number;
    start: ResizeGeometry;
    /** Whether the element is placed, so left/top are its to write. */
    placed: boolean;
    latest: ResizeGeometry;
  } | null>(null);

  const live = useRef({ project, zoom, breakpoint });
  live.current = { project, zoom, breakpoint };

  const begin = useCallback(
    (event: React.PointerEvent, nodeId: NodeId, handle: ResizeHandle) => {
      if (event.button !== 0) return;
      // The handle sits on the selection overlay, above the element. Without
      // this the canvas would also treat the press as a click and reselect.
      event.stopPropagation();
      event.preventDefault();

      const frame = frameRef.current;
      const current = live.current.project;
      if (!frame || !current) return;

      const element = frame.querySelector<HTMLElement>(`[data-zory-id="${CSS.escape(nodeId)}"]`);
      if (!element) return;

      const scale = live.current.zoom || 1;
      const a = element.getBoundingClientRect();
      const b = frame.getBoundingClientRect();
      const start: ResizeGeometry = {
        width: a.width / scale,
        height: a.height / scale,
        left: (a.left - b.left) / scale,
        top: (a.top - b.top) / scale,
      };

      const node = current.nodes[nodeId];
      const placed = node?.styles[live.current.breakpoint]?.position === 'absolute';

      active.current = {
        nodeId,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        start,
        placed,
        latest: start,
      };
      setResize({ nodeId, handle });
    },
    [frameRef],
  );

  useEffect(() => {
    function onMove(event: PointerEvent): void {
      const state = active.current;
      const frame = frameRef.current;
      if (!state || !frame) return;

      const scale = live.current.zoom || 1;
      const next = resizeBox(
        state.start,
        state.handle,
        (event.clientX - state.startX) / scale,
        (event.clientY - state.startY) / scale,
      );
      state.latest = next;

      const element = frame.querySelector<HTMLElement>(
        `[data-zory-id="${CSS.escape(state.nodeId)}"]`,
      );
      if (!element) return;

      // Live preview without touching the graph. Width and height are set
      // directly rather than scaled, so text reflows exactly as it will.
      element.style.width = `${next.width}px`;
      element.style.height = `${next.height}px`;
      if (state.placed) {
        element.style.marginLeft = `${next.left - state.start.left}px`;
        element.style.marginTop = `${next.top - state.start.top}px`;
      }
    }

    function finish(commit: boolean): void {
      const state = active.current;
      active.current = null;
      setResize({ nodeId: null, handle: null });
      if (!state) return;

      const frame = frameRef.current;
      const element = frame?.querySelector<HTMLElement>(
        `[data-zory-id="${CSS.escape(state.nodeId)}"]`,
      );
      // Clear the preview before the graph re-renders, or the inline styles
      // would stack on top of the committed ones.
      if (element) {
        element.style.width = '';
        element.style.height = '';
        element.style.marginLeft = '';
        element.style.marginTop = '';
      }

      if (!commit) return;
      const { latest, start } = state;
      if (latest.width === start.width && latest.height === start.height) return;

      const patch: StylePatch = {
        width: `${latest.width}px`,
        height: `${latest.height}px`,
      };
      // Only a placed element owns its offsets; moving them on a flow element
      // would fight its parent's layout.
      if (state.placed) {
        patch.left = `${latest.left}px`;
        patch.top = `${latest.top}px`;
      }

      useProjectStore
        .getState()
        .run([setStyle(state.nodeId, live.current.breakpoint, patch)], { label: 'Resize element' });
    }

    const onUp = (): void => finish(true);
    const onCancel = (): void => finish(false);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [frameRef]);

  return { resize, begin };
}
