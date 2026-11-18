/**
 * Measuring rendered nodes for the selection overlay.
 *
 * Rects are returned in the frame's own unscaled coordinate space. The overlay
 * lives inside the same scaled wrapper as the page, so zooming and scrolling
 * need no recomputation at all — only genuine layout changes do.
 */

import { useCallback, useEffect, useState, type RefObject } from 'react';

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function measureNode(
  frame: HTMLElement | null,
  nodeId: string | null,
  zoom: number,
): Rect | null {
  if (!frame || !nodeId) return null;
  const element = frame.querySelector<HTMLElement>(`[data-zory-id="${CSS.escape(nodeId)}"]`);
  if (!element) return null;

  const elementRect = element.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  const scale = zoom || 1;

  return {
    top: (elementRect.top - frameRect.top) / scale,
    left: (elementRect.left - frameRect.left) / scale,
    width: elementRect.width / scale,
    height: elementRect.height / scale,
  };
}

/**
 * Tracks rects for the selected and hovered nodes.
 *
 * `revision` should change whenever the graph does, so the overlay follows an
 * element that just grew or moved.
 */
export function useNodeRects(
  frameRef: RefObject<HTMLElement | null>,
  selectedId: string | null,
  hoveredId: string | null,
  zoom: number,
  revision: unknown,
): { selectedRect: Rect | null; hoveredRect: Rect | null; remeasure: () => void } {
  const [selectedRect, setSelectedRect] = useState<Rect | null>(null);
  const [hoveredRect, setHoveredRect] = useState<Rect | null>(null);

  const remeasure = useCallback(() => {
    const frame = frameRef.current;
    setSelectedRect(measureNode(frame, selectedId, zoom));
    setHoveredRect(hoveredId === selectedId ? null : measureNode(frame, hoveredId, zoom));
  }, [frameRef, selectedId, hoveredId, zoom]);

  // Measure after paint so the DOM reflects the change that triggered this.
  useEffect(() => {
    const raf = requestAnimationFrame(remeasure);
    return () => cancelAnimationFrame(raf);
  }, [remeasure, revision]);

  // Follow layout changes: web fonts landing, images decoding, text reflowing.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') return;

    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(remeasure);
    });

    observer.observe(frame);
    for (const child of frame.querySelectorAll('[data-zory-id]')) observer.observe(child);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [frameRef, remeasure, revision]);

  return { selectedRect, hoveredRect, remeasure };
}

/** Resolves a pointer event target to the graph node it belongs to. */
export function nodeIdFromEvent(event: { target: EventTarget | null }): string | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const owner = target.closest<HTMLElement>('[data-zory-id]');
  return owner?.dataset.zoryId ?? null;
}
