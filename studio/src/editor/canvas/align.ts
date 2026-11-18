/**
 * Align, distribute and match size.
 *
 * Pure geometry: boxes in, style patches out. Nothing here touches the DOM or
 * the store, which is what makes it testable — the arithmetic in a distribute
 * is exactly the kind of thing that is right in the demo and wrong for three
 * elements of unequal width.
 *
 * The scope is deliberate. Aligning by moving elements means writing
 * coordinates, and Zory only writes coordinates for elements that are
 * explicitly in free-position mode. In normal flow the equivalent operations
 * are different ones — matching a size, or equalising a parent's gap — and
 * pretending otherwise would turn a responsive layout into a pile of `left`
 * values the first time somebody clicked "align left".
 */

export interface Box {
  id: string;
  /** Current `left`, in px, relative to the offset parent. */
  left: number;
  /** Current `top`, in px. */
  top: number;
  /** Measured width. */
  width: number;
  /** Measured height. */
  height: number;
}

export type AlignEdge = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';
export type Axis = 'x' | 'y';
export type Dimension = 'width' | 'height';

/** A patch of position properties, in px, keyed by node id. */
export type PositionPatch = Record<string, { left?: number; top?: number }>;

export const HORIZONTAL: readonly AlignEdge[] = ['left', 'centre', 'right'];
export const VERTICAL: readonly AlignEdge[] = ['top', 'middle', 'bottom'];

export const ALIGN_LABEL: Record<AlignEdge, string> = {
  left: 'Align left',
  centre: 'Align centre',
  right: 'Align right',
  top: 'Align top',
  middle: 'Align middle',
  bottom: 'Align bottom',
};

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The rectangle containing every box. */
export function boundsOf(boxes: Box[]): Bounds {
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  return { left, top, right, bottom };
}

/**
 * Aligns every box to one edge of the selection's bounding box.
 *
 * The bounding box rather than the first or the largest element: aligning to
 * "whichever one I happened to click first" is a rule nobody can predict, and
 * every design tool that tried it gets bug reports about it forever.
 *
 * Boxes already on the edge are left out of the patch entirely, so a no-op
 * align does not produce an undo step.
 */
export function alignBoxes(boxes: Box[], edge: AlignEdge): PositionPatch {
  if (boxes.length < 2) return {};
  const bounds = boundsOf(boxes);
  const patch: PositionPatch = {};

  for (const box of boxes) {
    let next: { left?: number; top?: number } = {};

    switch (edge) {
      case 'left':
        next = { left: bounds.left };
        break;
      case 'right':
        next = { left: bounds.right - box.width };
        break;
      case 'centre':
        next = { left: Math.round((bounds.left + bounds.right) / 2 - box.width / 2) };
        break;
      case 'top':
        next = { top: bounds.top };
        break;
      case 'bottom':
        next = { top: bounds.bottom - box.height };
        break;
      case 'middle':
        next = { top: Math.round((bounds.top + bounds.bottom) / 2 - box.height / 2) };
        break;
    }

    const moved =
      (next.left !== undefined && Math.round(next.left) !== Math.round(box.left)) ||
      (next.top !== undefined && Math.round(next.top) !== Math.round(box.top));
    if (moved) patch[box.id] = next;
  }

  return patch;
}

/**
 * Spreads boxes so the *gaps between them* are equal.
 *
 * Not their centres — that is the other reasonable reading of "distribute" and
 * it is the wrong one when the elements are different sizes, because equal
 * centre spacing leaves visibly unequal space. The outermost two never move:
 * they define the span being divided.
 */
export function distributeBoxes(boxes: Box[], axis: Axis): PositionPatch {
  if (boxes.length < 3) return {};

  const size = (box: Box): number => (axis === 'x' ? box.width : box.height);
  const start = (box: Box): number => (axis === 'x' ? box.left : box.top);

  const ordered = [...boxes].sort((a, b) => start(a) - start(b));
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;

  const span = start(last) + size(last) - start(first);
  const occupied = ordered.reduce((total, box) => total + size(box), 0);
  const gap = (span - occupied) / (ordered.length - 1);

  const patch: PositionPatch = {};
  let cursor = start(first) + size(first) + gap;

  for (const box of ordered.slice(1, -1)) {
    const value = Math.round(cursor);
    if (value !== Math.round(start(box))) {
      patch[box.id] = axis === 'x' ? { left: value } : { top: value };
    }
    cursor += size(box) + gap;
  }

  return patch;
}

/**
 * The size every box should take, from the last one selected.
 *
 * The *last* rather than the largest, because the last one is the one under
 * the cursor — the person just clicked it, so it is the one they are thinking
 * of as the reference.
 */
export function matchSize(boxes: Box[], primaryId: string, dimension: Dimension): Record<string, string> {
  const primary = boxes.find((box) => box.id === primaryId) ?? boxes[boxes.length - 1];
  if (!primary || boxes.length < 2) return {};

  const target = Math.round(dimension === 'width' ? primary.width : primary.height);
  const patch: Record<string, string> = {};

  for (const box of boxes) {
    if (box.id === primary.id) continue;
    const current = Math.round(dimension === 'width' ? box.width : box.height);
    if (current !== target) patch[box.id] = `${target}px`;
  }

  return patch;
}

/** Parses `"24px"` to 24. Anything else — `auto`, `50%`, absent — is 0. */
export function pxOf(value: string | undefined): number {
  if (!value) return 0;
  const match = /^(-?[\d.]+)px$/.exec(value.trim());
  return match ? Number(match[1]) : 0;
}
