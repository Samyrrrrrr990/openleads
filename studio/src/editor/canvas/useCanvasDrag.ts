/**
 * Dragging elements on the canvas.
 *
 * Every drop becomes a MOVE_NODE command, so a drag is undoable, autosaves and
 * survives reload exactly like an inspector edit. Nothing here mutates the
 * graph directly.
 *
 * Two things this deliberately does not do:
 *
 *   - It does not validate. `run()` already rejects moving a page root, moving
 *     a node inside itself, or parenting to something that cannot hold
 *     children. Re-checking here would be a second copy of those rules that
 *     could drift from the real ones, so the drag only ever *proposes*.
 *
 *   - It does not re-render per pointer move. The pointer position is read
 *     from the event and the target is only pushed into React state when the
 *     drop target actually changes, which on a long drag is a handful of
 *     renders rather than one per frame.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { NodeId, Project, Breakpoint } from '@zory/core';
import { setStyle, resolveStyleValue } from '@zory/core';
import { reorder } from '../state/actions';
import { useProjectStore } from '../state/projectStore';
import type { Rect } from './useNodeRects';

/** Movement, in screen pixels, before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 5;

export interface DropTarget {
  parentId: NodeId;
  index: number;
  /** Where to draw the insertion line, in unscaled frame coordinates. */
  line: Rect;
}

export interface CanvasDrag {
  /** The node being dragged, or null when nothing is being dragged. */
  nodeId: NodeId | null;
  target: DropTarget | null;
  /** True while dragging a freely placed element rather than reordering. */
  free: boolean;
  /** Alignment guides to draw, in unscaled frame coordinates. */
  guides: { x: number[]; y: number[] };
}

/** How close, in canvas pixels, an edge has to be before it snaps. */
export const SNAP_DISTANCE = 6;

interface SnapResult {
  offset: number;
  /** The line to draw, if it snapped. */
  guide: number | null;
}

/**
 * Snaps one axis of the dragged box against a set of candidate lines.
 *
 * Three points are tested per axis — the leading edge, the centre and the
 * trailing edge — because aligning centres is as common as aligning edges and
 * a tool that only does edges feels half-finished. The closest match inside the
 * threshold wins, so a near-tie does not flicker between two guides.
 */
export function snapAxis(start: number, size: number, candidates: number[]): SnapResult {
  let best: { delta: number; guide: number } | null = null;

  for (const point of [start, start + size / 2, start + size]) {
    for (const candidate of candidates) {
      const delta = candidate - point;
      if (Math.abs(delta) > SNAP_DISTANCE) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, guide: candidate };
      }
    }
  }

  return best ? { offset: best.delta, guide: best.guide } : { offset: 0, guide: null };
}

/**
 * Edges worth aligning to: every sibling, plus the parent's own box and
 * centre. The dragged element is excluded — it cannot align to itself.
 */
function snapCandidates(
  frame: HTMLElement,
  project: Project,
  draggedId: NodeId,
  zoom: number,
): { x: number[]; y: number[] } {
  const node = project.nodes[draggedId];
  const parentId = node?.parentId;
  const parent = parentId ? project.nodes[parentId] : null;
  if (!parent || !parentId) return { x: [], y: [] };

  const parentElement = frame.querySelector<HTMLElement>(
    `[data-zory-id="${CSS.escape(parentId)}"]`,
  );
  if (!parentElement) return { x: [], y: [] };

  const parentRect = rectIn(frame, parentElement, zoom);
  const x = [parentRect.left, parentRect.left + parentRect.width / 2, parentRect.left + parentRect.width];
  const y = [parentRect.top, parentRect.top + parentRect.height / 2, parentRect.top + parentRect.height];

  for (const siblingId of parent.children) {
    if (siblingId === draggedId) continue;
    const element = frame.querySelector<HTMLElement>(`[data-zory-id="${CSS.escape(siblingId)}"]`);
    if (!element) continue;
    const rect = rectIn(frame, element, zoom);
    x.push(rect.left, rect.left + rect.width / 2, rect.left + rect.width);
    y.push(rect.top, rect.top + rect.height / 2, rect.top + rect.height);
  }

  return { x, y };
}

/** True when this element is placed rather than laid out by its parent. */
export function isFreelyPlaced(
  project: Project,
  nodeId: NodeId,
  breakpoint: Breakpoint,
): boolean {
  const node = project.nodes[nodeId];
  if (!node) return false;
  return resolveStyleValue(node.styles, breakpoint, 'position').value === 'absolute';
}

function numeric(raw: unknown, fallback: number): number {
  const value = Number.parseFloat(String(raw ?? ''));
  return Number.isFinite(value) ? value : fallback;
}

/** True when `candidate` is `nodeId` or sits underneath it. */
function isSelfOrDescendant(project: Project, candidate: NodeId, nodeId: NodeId): boolean {
  let cursor: NodeId | null = candidate;
  const seen = new Set<NodeId>();
  while (cursor && !seen.has(cursor)) {
    if (cursor === nodeId) return true;
    seen.add(cursor);
    cursor = project.nodes[cursor]?.parentId ?? null;
  }
  return false;
}

function rectIn(frame: HTMLElement, element: HTMLElement, zoom: number): Rect {
  const a = element.getBoundingClientRect();
  const b = frame.getBoundingClientRect();
  const scale = zoom || 1;
  return {
    top: (a.top - b.top) / scale,
    left: (a.left - b.left) / scale,
    width: a.width / scale,
    height: a.height / scale,
  };
}

/**
 * Finds the deepest rendered node under the pointer that is a legal drop
 * neighbour — skipping the dragged node's own subtree, which would otherwise
 * sit under the cursor for the whole drag.
 */
function nodeUnderPointer(
  frame: HTMLElement,
  project: Project,
  draggedId: NodeId,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const element of stack) {
    if (!(element instanceof HTMLElement)) continue;
    if (!frame.contains(element)) continue;
    const id = element.dataset['zoryId'];
    if (!id || !project.nodes[id]) continue;
    if (isSelfOrDescendant(project, id, draggedId)) continue;
    return element;
  }
  return null;
}

/**
 * Where a drop would land.
 *
 * Containers are entered rather than displaced: pointing at a container means
 * "put it in here", and pointing at a leaf means "put it next to this". That
 * matches how every other canvas tool behaves, and it makes empty containers
 * reachable, which index-only maths would not.
 */
function computeTarget(
  frame: HTMLElement,
  project: Project,
  draggedId: NodeId,
  zoom: number,
  clientX: number,
  clientY: number,
): DropTarget | null {
  const element = nodeUnderPointer(frame, project, draggedId, clientX, clientY);
  if (!element) return null;

  const overId = element.dataset['zoryId'] as NodeId;
  const over = project.nodes[overId];
  if (!over) return null;

  const container = over.kind === 'container' ? over : null;
  const parentId = container ? overId : over.parentId;
  if (!parentId) return null;

  const parent = project.nodes[parentId];
  if (!parent) return null;

  const parentElement = container
    ? element
    : frame.querySelector<HTMLElement>(`[data-zory-id="${CSS.escape(parentId)}"]`);
  if (!parentElement) return null;

  // The axis children flow along decides whether the insertion line is drawn
  // horizontally or vertically, and which coordinate orders the children.
  const flow = getComputedStyle(parentElement).flexDirection;
  const horizontal = flow === 'row' || flow === 'row-reverse';

  // Siblings in document order, minus the dragged node itself: a node is never
  // an insertion point relative to itself.
  const siblings = parent.children
    .filter((id) => id !== draggedId)
    .map((id) => {
      const node = frame.querySelector<HTMLElement>(`[data-zory-id="${CSS.escape(id)}"]`);
      return node ? { id, rect: rectIn(frame, node, zoom) } : null;
    })
    .filter((entry): entry is { id: NodeId; rect: Rect } => entry !== null);

  const parentRect = rectIn(frame, parentElement, zoom);
  const scale = zoom || 1;
  const frameRect = frame.getBoundingClientRect();
  const pointer = horizontal
    ? (clientX - frameRect.left) / scale
    : (clientY - frameRect.top) / scale;

  // Index is simply how many siblings the pointer has passed the middle of.
  let index = 0;
  for (const sibling of siblings) {
    const middle = horizontal
      ? sibling.rect.left + sibling.rect.width / 2
      : sibling.rect.top + sibling.rect.height / 2;
    if (pointer > middle) index += 1;
  }

  const before = siblings[index - 1];
  const after = siblings[index];

  // The line sits in the gap between the two elements it would separate, or
  // against the container's inner edge at either end.
  let position: number;
  if (before && after) {
    position = horizontal
      ? (before.rect.left + before.rect.width + after.rect.left) / 2
      : (before.rect.top + before.rect.height + after.rect.top) / 2;
  } else if (before) {
    position = horizontal
      ? before.rect.left + before.rect.width + 2
      : before.rect.top + before.rect.height + 2;
  } else if (after) {
    position = horizontal ? after.rect.left - 2 : after.rect.top - 2;
  } else {
    // Empty container: centre the marker so it reads as "into here".
    position = horizontal
      ? parentRect.left + parentRect.width / 2
      : parentRect.top + parentRect.height / 2;
  }

  const line: Rect = horizontal
    ? { top: parentRect.top, left: position, width: 2, height: parentRect.height }
    : { top: position, left: parentRect.left, width: parentRect.width, height: 2 };

  /*
   * `index` counted positions among siblings with the dragged node removed,
   * which is what MOVE_NODE expects when the node is moving within its current
   * parent. When it moves to a different parent no adjustment is needed
   * either, because it was never in that list.
   */
  return { parentId, index, line };
}

export function useCanvasDrag(
  frameRef: RefObject<HTMLElement | null>,
  project: Project | null,
  zoom: number,
  breakpoint: Breakpoint,
): {
  drag: CanvasDrag;
  /** Call from the canvas pointerdown handler to arm a possible drag. */
  arm: (event: React.PointerEvent, nodeId: NodeId) => void;
} {
  const [drag, setDrag] = useState<CanvasDrag>({
    nodeId: null,
    target: null,
    free: false,
    guides: { x: [], y: [] },
  });

  // Everything the window listeners need, kept on a ref so they can stay
  // registered for the life of the drag without being rebuilt each render.
  const pending = useRef<{
    nodeId: NodeId;
    startX: number;
    startY: number;
    dragging: boolean;
    target: DropTarget | null;
    /** Set for a freely placed element: its offsets when the drag began. */
    free: {
      startLeft: number;
      startTop: number;
      left: number;
      top: number;
      /*
       * Where the element actually sits on screen when its offset is
       * `startLeft`/`startTop`.
       *
       * `left` is measured from the parent's padding box, not its border box,
       * so reconstructing a screen position as `parentRect.left + left` is
       * wrong by however much padding the parent has — which silently put
       * every snap candidate out of range. Capturing the real origin once
       * removes the guesswork entirely.
       */
      originX: number;
      originY: number;
      width: number;
      height: number;
    } | null;
    /** Last drawn guides, so a re-render only happens when they change. */
    guideKey: string;
  } | null>(null);

  const live = useRef({ project, zoom, breakpoint });
  live.current = { project, zoom, breakpoint };

  const arm = useCallback((event: React.PointerEvent, nodeId: NodeId) => {
    // Left button only, and never a modifier-click: those already mean
    // "select the parent" and "extend selection".
    if (event.button !== 0 || event.altKey) return;
    pending.current = {
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      target: null,
      free: null,
      guideKey: '',
    };
  }, []);

  useEffect(() => {
    function onMove(event: PointerEvent): void {
      const state = pending.current;
      const frame = frameRef.current;
      const { project: current, zoom: currentZoom } = live.current;
      if (!state || !frame || !current) return;

      if (!state.dragging) {
        const moved = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
        if (moved < DRAG_THRESHOLD) return;
        state.dragging = true;

        /*
         * A placed element is moved, not reordered. Its current offsets are
         * read once here so the whole drag is a delta from a fixed origin —
         * reading them each frame would compound rounding and make the element
         * drift away from the cursor.
         */
        if (isFreelyPlaced(current, state.nodeId, live.current.breakpoint)) {
          const node = current.nodes[state.nodeId]!;
          const dragged = frame.querySelector<HTMLElement>(
            `[data-zory-id="${CSS.escape(state.nodeId)}"]`,
          );
          const rect = dragged ? rectIn(frame, dragged, currentZoom) : null;

          state.free = {
            startLeft: numeric(
              resolveStyleValue(node.styles, live.current.breakpoint, 'left').value,
              0,
            ),
            startTop: numeric(
              resolveStyleValue(node.styles, live.current.breakpoint, 'top').value,
              0,
            ),
            left: 0,
            top: 0,
            originX: rect?.left ?? 0,
            originY: rect?.top ?? 0,
            width: rect?.width ?? 0,
            height: rect?.height ?? 0,
          };
        }

        setDrag({
          nodeId: state.nodeId,
          target: null,
          free: state.free !== null,
          guides: { x: [], y: [] },
        });
      }

      /*
       * Free placement: the element follows the cursor via a transform written
       * straight to the node, and the graph is only touched on release. Running
       * a command per frame would fill the undo stack with hundreds of entries
       * and re-render the tree on every pointer move.
       */
      if (state.free) {
        const scale = currentZoom || 1;
        const rawLeft = state.free.startLeft + (event.clientX - state.startX) / scale;
        const rawTop = state.free.startTop + (event.clientY - state.startY) / scale;

        const element = frame.querySelector<HTMLElement>(
          `[data-zory-id="${CSS.escape(state.nodeId)}"]`,
        );

        /*
         * Snap against the neighbours, then move by the corrected amount.
         *
         * The element's own live rect cannot be used to measure with — it is
         * already displaced by the transform from the previous frame, so the
         * snap would chase itself. Its untransformed size is stable, and the
         * position comes from the offsets we are computing anyway.
         */
        let guides: { x: number[]; y: number[] } = { x: [], y: [] };
        let left = rawLeft;
        let top = rawTop;

        if (element && !event.altKey) {
          const candidates = snapCandidates(frame, current, state.nodeId, currentZoom);

          // Screen position implied by the current offsets, derived from the
          // origin captured at drag start rather than reconstructed.
          const screenX = state.free.originX + (rawLeft - state.free.startLeft);
          const screenY = state.free.originY + (rawTop - state.free.startTop);

          const snapX = snapAxis(screenX, state.free.width, candidates.x);
          const snapY = snapAxis(screenY, state.free.height, candidates.y);

          left = rawLeft + snapX.offset;
          top = rawTop + snapY.offset;
          guides = {
            x: snapX.guide === null ? [] : [snapX.guide],
            y: snapY.guide === null ? [] : [snapY.guide],
          };
        }

        state.free.left = left;
        state.free.top = top;

        if (element) {
          element.style.transform = `translate(${(left - state.free.startLeft) * scale}px, ${(top - state.free.startTop) * scale}px)`;
        }

        // Only re-render when the visible guides change, not every frame.
        const key = `${guides.x.join()}|${guides.y.join()}`;
        if (key !== state.guideKey) {
          state.guideKey = key;
          setDrag({ nodeId: state.nodeId, target: null, free: true, guides });
        }
        return;
      }

      const target = computeTarget(
        frame,
        current,
        state.nodeId,
        currentZoom,
        event.clientX,
        event.clientY,
      );

      const changed =
        target?.parentId !== state.target?.parentId || target?.index !== state.target?.index;
      state.target = target;
      if (changed) setDrag({ nodeId: state.nodeId, target, free: false, guides: { x: [], y: [] } });
    }

    function onUp(): void {
      const state = pending.current;
      pending.current = null;
      if (!state?.dragging) return;

      const frame = frameRef.current;
      setDrag({ nodeId: null, target: null, free: false, guides: { x: [], y: [] } });

      if (state.free) {
        // Drop the live transform before the graph re-renders, or the element
        // would briefly appear at double its offset.
        const element = frame?.querySelector<HTMLElement>(
          `[data-zory-id="${CSS.escape(state.nodeId)}"]`,
        );
        if (element) element.style.transform = '';

        useProjectStore.getState().run(
          [
            setStyle(state.nodeId, live.current.breakpoint, {
              left: `${Math.round(state.free.left)}px`,
              top: `${Math.round(state.free.top)}px`,
            }),
          ],
          { label: 'Move element', coalesceKey: `place:${state.nodeId}` },
        );
        return;
      }

      if (state.target) {
        // `run` validates; an impossible drop is simply refused and the graph
        // is left alone.
        reorder(state.nodeId, state.target.parentId, state.target.index);
      }
    }

    function onCancel(): void {
      pending.current = null;
      setDrag({ nodeId: null, target: null, free: false, guides: { x: [], y: [] } });
    }

    /*
     * Text selection is suppressed with `selectstart`, not by calling
     * preventDefault on pointermove. Chrome treats a prevented pointermove as
     * the application taking the gesture over and immediately fires
     * pointercancel, which aborted every drag after its first frame.
     */
    function onSelectStart(event: Event): void {
      if (pending.current?.dragging) event.preventDefault();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('selectstart', onSelectStart);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    // Escape aborts mid-drag, which is the expected escape hatch everywhere.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('selectstart', onSelectStart);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [frameRef]);

  return { drag, arm };
}
