/**
 * The editing surface.
 *
 * All pointer handling is delegated from this one element rather than attached
 * per node, so a thousand-node page costs the same as a ten-node page.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { VIEWPORT_WIDTH, ancestorsOf, findNode, nodeLabel, themeStyleObject } from '@zory/core';
import { NodeView } from '../../renderer/NodeView';
import { MotionStyles, PLAY_ATTRIBUTE } from '../../renderer/MotionStyles';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { editText, selectAndReveal, toggleSelection } from '../state/actions';
import { measureNode, nodeIdFromEvent, useNodeRects } from './useNodeRects';
import { useCanvasDrag } from './useCanvasDrag';
import { RESIZE_HANDLES, useCanvasResize } from './useCanvasResize';
import { shortcut } from '../chrome/platform';
import styles from './Canvas.module.css';

/** Gutter kept between the page frame and the panel edges. */
const STAGE_GUTTER = 64;

/**
 * Keeps the page frame inside the available width.
 *
 * A 1440px desktop frame does not fit a 1300px canvas column, and a page
 * clipped at its left edge is worse than a slightly scaled one. This picks a
 * fit zoom when the breakpoint or the window changes, but backs off the moment
 * the user sets a zoom of their own, so it never fights them.
 */
function useFitToWidth(
  viewportRef: React.RefObject<HTMLElement | null>,
  frameWidth: number,
): void {
  const setZoom = useUiStore((s) => s.setZoom);
  const [available, setAvailable] = useState(0);
  // The last zoom this hook applied. If the live zoom differs, the user has
  // taken over and we stop adjusting.
  const autoZoom = useRef<number | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setAvailable(width);
    });
    observer.observe(element);
    setAvailable(element.clientWidth);
    return () => observer.disconnect();
  }, [viewportRef]);

  useEffect(() => {
    if (available === 0) return;

    const current = useUiStore.getState().zoom;
    if (autoZoom.current !== null && Math.abs(current - autoZoom.current) > 0.001) return;

    const fit = Math.min(1, (available - STAGE_GUTTER) / frameWidth);
    // Snap to whole percents so the readout does not show 83.4%.
    const rounded = Math.max(0.25, Math.round(fit * 100) / 100);
    if (Math.abs(rounded - current) < 0.001) return;

    autoZoom.current = rounded;
    setZoom(rounded);
  }, [available, frameWidth, setZoom]);
}

export function Canvas(): React.ReactElement {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const project = useProjectStore((s) => s.project);
  const pageId = useUiStore((s) => s.pageId);
  const selectedId = useUiStore((s) => s.selectedId);
  const selectedIds = useUiStore((s) => s.selectedIds);
  const hoveredId = useUiStore((s) => s.hoveredId);
  const breakpoint = useUiStore((s) => s.breakpoint);
  const zoom = useUiStore((s) => s.zoom);
  const editingTextId = useUiStore((s) => s.editingTextId);
  const motionGeneration = useUiStore((s) => s.motionGeneration);
  const hover = useUiStore((s) => s.hover);
  const beginTextEdit = useUiStore((s) => s.beginTextEdit);
  const endTextEdit = useUiStore((s) => s.endTextEdit);

  const page = useMemo(
    () => project?.pages.find((p) => p.id === pageId) ?? project?.pages[0] ?? null,
    [project, pageId],
  );

  const { selectedRect, hoveredRect } = useNodeRects(
    frameRef,
    selectedId,
    hoveredId,
    zoom,
    project,
  );

  const { drag, arm } = useCanvasDrag(frameRef, project, zoom, breakpoint);
  const { resize, begin: beginResize } = useCanvasResize(frameRef, project, zoom, breakpoint);

  useFitToWidth(viewportRef, VIEWPORT_WIDTH[breakpoint]);

  const handleCommitText = useCallback((nodeId: string, text: string) => {
    editText(nodeId, text);
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const nodeId = nodeIdFromEvent(event);
      if (!nodeId) {
        selectAndReveal(null);
        return;
      }

      // Alt-click steps up to the parent, which is the quickest way to grab a
      // container that its children cover entirely.
      if (event.altKey && project) {
        const parentId = findNode(project, nodeId)?.parentId ?? null;
        selectAndReveal(parentId);
        return;
      }

      // Shift-click adds to the selection. Not armed for a drag: dragging a
      // set is a different interaction and half-implementing it would mean a
      // shift-click that sometimes moved one element out of a group.
      if (event.shiftKey) {
        // Without this the browser extends its own text selection across the
        // page as well, so shift-clicking three cards leaves a blue smear of
        // highlighted copy behind the outlines.
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        toggleSelection(nodeId);
        return;
      }

      selectAndReveal(nodeId);
      // Arming after selecting means a plain click still selects; the drag
      // only takes over once the pointer has actually travelled.
      arm(event, nodeId);
    },
    [project, arm],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const nodeId = nodeIdFromEvent(event);
      if (!nodeId || !project) return;
      // Same reason as the selection badge: a node inside an instance is not a
      // key in `nodes`, and a raw lookup here meant double-clicking the text of
      // a feature cell did nothing at all.
      const node = findNode(project, nodeId);
      if (!node) return;
      if (node.kind === 'image' || node.kind === 'divider' || node.kind === 'container') return;
      beginTextEdit(nodeId);
    },
    [project, beginTextEdit],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // During a drag the drop indicator is the feedback; a second hover
      // outline chasing the cursor underneath it is just noise.
      if (drag.nodeId) return;
      hover(nodeIdFromEvent(event));
    },
    [hover, drag.nodeId],
  );

  /*
   * The nodes whose motion is held at rest. The overlay measures these two, and
   * an element mid-animation measures where it currently is rather than where
   * it belongs — so the outline would be drawn somewhere the element is not.
   */
  const motionSuspended = useMemo(
    () => [selectedId, hoveredId].filter((id): id is string => Boolean(id)),
    [selectedId, hoveredId],
  );

  /*
   * `findNode`, not `project.nodes[id]`.
   *
   * A node inside an instance has no id of its own in the graph — it is one
   * definition node seen through one instance, addressed as both — so it is
   * not a key in `nodes` and a direct lookup returns undefined. That read used
   * to be unreachable, because nothing shipped instances and making one took
   * deliberate effort. Templates ship them now, so selecting a feature cell on
   * a freshly opened starter took this path immediately.
   */
  const selectedNode = useMemo(
    () => (project && selectedId ? (findNode(project, selectedId) ?? null) : null),
    [project, selectedId],
  );

  const breadcrumbs = useMemo(() => {
    if (!project || !selectedId || !selectedNode) return [];
    return [...ancestorsOf(project, selectedId).reverse(), selectedNode];
  }, [project, selectedId, selectedNode]);

  if (!project || !page) {
    return (
      <div className={styles.viewport}>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No page open</p>
        </div>
      </div>
    );
  }

  const frameWidth = VIEWPORT_WIDTH[breakpoint];
  const root = project.nodes[page.rootId];
  const isEmptyPage = !root || root.children.length === 0;

  return (
    <div className={styles.viewport} ref={viewportRef} data-testid="canvas-viewport">
      <div className={styles.stage}>
        <div
          className={styles.frameWrap}
          style={{ width: frameWidth, transform: `scale(${zoom})` }}
        >
          {/*
            The frame is a plain container: pointer handlers live here, and the
            rendered page inside knows nothing about the editor.
          */}
          <div
            ref={frameRef}
            className={`${styles.frame} ${drag.nodeId ? styles.frameDragging : ''}`}
            data-testid="canvas-frame"
            {...{ [PLAY_ATTRIBUTE]: String(motionGeneration) }}
            /*
             * The project's design tokens, declared on the frame.
             *
             * A node that follows a token stores `var(--color-accent)`, and
             * this is where that resolves. Declaring them here rather than on
             * the document keeps the editor's own chrome out of their scope —
             * a project whose accent is white must not repaint the inspector.
             */
            style={themeStyleObject(project.settings.theme) as React.CSSProperties}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => hover(null)}
            // The canvas is an editing surface; screen-reader users work
            // through the layers tree and inspector instead.
            role="presentation"
          >
            {isEmptyPage ? (
              <div className={styles.empty}>
                <p className={styles.emptyTitle}>This page is empty</p>
                <p className={styles.emptyBody}>
                  Add a section from the Insert panel to get started, or press {shortcut('K')} and
                  describe what you want.
                </p>
              </div>
            ) : (
              <>
                <MotionStyles
                  generation={motionGeneration}
                  rootId={page.rootId}
                  suspendedIds={motionSuspended}
                />
                <NodeView
                  nodeId={page.rootId}
                  breakpoint={breakpoint}
                  editingId={editingTextId}
                  onCommitText={handleCommitText}
                  onEndTextEdit={endTextEdit}
                />
              </>
            )}
          </div>

          <div className={styles.overlay} aria-hidden="true">
            {/* Alignment guides, drawn only while a free drag is snapped. */}
            {drag.guides.x.map((x) => (
              <div key={`gx-${x}`} className={styles.guideX} style={{ left: x }} />
            ))}
            {drag.guides.y.map((y) => (
              <div key={`gy-${y}`} className={styles.guideY} style={{ top: y }} />
            ))}

            {drag.target && (
              <div
                className={styles.dropLine}
                style={{
                  top: drag.target.line.top,
                  left: drag.target.line.left,
                  width: drag.target.line.width,
                  height: drag.target.line.height,
                }}
              />
            )}
            {/*
              Secondary selections.

              Measured on the spot rather than tracked in state: this only runs
              while more than one thing is selected, and adding N subscriptions
              to keep rects for a set that changes on every click would cost
              more than the measurement does.
            */}
            {selectedIds.length > 1 &&
              selectedIds
                .filter((id) => id !== selectedId)
                .map((id) => {
                  const rect = measureNode(frameRef.current, id, zoom);
                  if (!rect) return null;
                  return (
                    <div
                      key={`sel-${id}`}
                      className={`${styles.outline} ${styles.selectedSecondary}`}
                      style={{
                        top: rect.top,
                        left: rect.left,
                        width: rect.width,
                        height: rect.height,
                      }}
                    />
                  );
                })}

            {hoveredRect && hoveredId !== selectedId && (
              <div
                className={styles.outline}
                style={{
                  top: hoveredRect.top,
                  left: hoveredRect.left,
                  width: hoveredRect.width,
                  height: hoveredRect.height,
                }}
              />
            )}
            {selectedRect && selectedId && (
              <div
                className={`${styles.outline} ${styles.selected}`}
                style={{
                  top: selectedRect.top,
                  left: selectedRect.left,
                  width: selectedRect.width,
                  height: selectedRect.height,
                }}
              >
                {/*
                  Resize handles. Hidden while dragging, because a handle under
                  a moving cursor is something to catch on rather than aim at.
                */}
                {!drag.nodeId &&
                  RESIZE_HANDLES.map((handle) => (
                    <span
                      key={handle}
                      className={`${styles.handle} ${styles[`handle_${handle}`] ?? ''} ${
                        resize.handle === handle ? styles.handleActive : ''
                      }`}
                      onPointerDown={(event) => beginResize(event, selectedId, handle)}
                    />
                  ))}

                <span
                  className={`${styles.badge} ${selectedRect.top < 20 ? styles.badgeInside : ''}`}
                  data-testid="canvas-selection-badge"
                >
                  {selectedNode ? nodeLabel(selectedNode) : ''}
                  <span className={styles.badgeKind}>
                    {selectedIds.length > 1
                      ? `+${selectedIds.length - 1} more`
                      : (selectedNode?.kind ?? '')}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {breadcrumbs.length > 0 && (
        <nav className={styles.breadcrumb} aria-label="Selected element path">
          {breadcrumbs.map((node, index) => (
            <span key={node.id} style={{ display: 'contents' }}>
              {index > 0 && (
                <span className={styles.crumbSep} aria-hidden="true">
                  ▸
                </span>
              )}
              <button
                type="button"
                className={`${styles.crumb} ${node.id === selectedId ? styles.crumbActive : ''}`}
                onClick={() => selectAndReveal(node.id)}
                aria-current={node.id === selectedId ? 'true' : undefined}
              >
                {nodeLabel(node)}
              </button>
            </span>
          ))}
        </nav>
      )}
    </div>
  );
}
