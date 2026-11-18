/**
 * The inspector when several things are selected.
 *
 * Three groups, and the split between them is the honest part:
 *
 *   Arrange     Align and distribute move elements, which means writing
 *               coordinates. Zory only writes coordinates for elements
 *               explicitly in free-position mode, so these are offered only
 *               when the selection is free-positioned siblings — and the panel
 *               says why when it is not, rather than showing controls that do
 *               nothing.
 *   Size        Match width and height work in any layout, because a width is
 *               a width.
 *   Everything  Type, colour and spacing applied across the whole selection as
 *               one undo step. This is the part people actually use ten times
 *               a day.
 *
 * Geometry comes from the rendered DOM rather than from the graph. A width of
 * `auto` has no value in the graph and a very definite one on screen, and
 * aligning to what is not visible would be a tool nobody could predict.
 */

import { useCallback, useMemo } from 'react';
import type { Breakpoint, NodeId, StylePatch } from '@zory/core';
import { resolveStyleValue, setStyle } from '@zory/core';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { deleteSelection, editStyleAcross, shareOneParent } from '../state/actions';
import { measureNode } from '../canvas/useNodeRects';
import {
  ALIGN_LABEL,
  HORIZONTAL,
  VERTICAL,
  alignBoxes,
  distributeBoxes,
  matchSize,
  pxOf,
  type AlignEdge,
  type Axis,
  type Box,
  type Dimension,
} from '../canvas/align';
import { Button, ColorInput, CollapsibleSection, Field, Select } from '../../ui/controls';
import { DimensionInput } from './DimensionInput';
import { useThemeTokens } from './useThemeTokens';
import styles from './Inspector.module.css';

/** Reads the live geometry of a selection out of the canvas. */
function readBoxes(ids: NodeId[], breakpoint: Breakpoint): Box[] {
  const frame = document.querySelector<HTMLElement>('[data-testid="canvas-frame"]');
  const project = useProjectStore.getState().project;
  if (!frame || !project) return [];

  const zoom = useUiStore.getState().zoom;
  const boxes: Box[] = [];

  for (const id of ids) {
    const node = project.nodes[id];
    const rect = measureNode(frame, id, zoom);
    if (!node || !rect) continue;
    boxes.push({
      id,
      // Position from the graph, size from the screen. `left` is what a move
      // will write, so it has to be the value that is already there.
      left: pxOf(resolveStyleValue(node.styles, breakpoint, 'left').value),
      top: pxOf(resolveStyleValue(node.styles, breakpoint, 'top').value),
      width: rect.width,
      height: rect.height,
    });
  }

  return boxes;
}

export function MultiSelection(): React.ReactElement {
  const selectedIds = useUiStore((s) => s.selectedIds);
  const primaryId = useUiStore((s) => s.selectedId);
  const breakpoint = useUiStore((s) => s.breakpoint);
  const nodes = useProjectStore((s) => s.project?.nodes);
  const { tokens } = useThemeTokens();

  const ids = useMemo(
    () => selectedIds.filter((id) => nodes?.[id]),
    [selectedIds, nodes],
  );

  /** Free positioning is what makes align meaningful. */
  const freePositioned = useMemo(() => {
    if (!nodes) return false;
    return ids.every(
      (id) => resolveStyleValue(nodes[id]!.styles, breakpoint, 'position').value === 'absolute',
    );
  }, [ids, nodes, breakpoint]);

  const sameParent = useMemo(() => shareOneParent(ids), [ids]);
  const canArrange = freePositioned && sameParent && ids.length >= 2;

  const applyPositions = useCallback(
    (patch: Record<string, { left?: number; top?: number }>, label: string) => {
      const commands = Object.entries(patch).map(([nodeId, position]) => {
        const style: StylePatch = {};
        if (position.left !== undefined) style.left = `${Math.round(position.left)}px`;
        if (position.top !== undefined) style.top = `${Math.round(position.top)}px`;
        return setStyle(nodeId, breakpoint, style);
      });

      if (commands.length === 0) return;
      useProjectStore.getState().run(commands, { label });
    },
    [breakpoint],
  );

  const align = useCallback(
    (edge: AlignEdge) => {
      applyPositions(alignBoxes(readBoxes(ids, breakpoint), edge), ALIGN_LABEL[edge]);
    },
    [applyPositions, ids, breakpoint],
  );

  const distribute = useCallback(
    (axis: Axis) => {
      applyPositions(
        distributeBoxes(readBoxes(ids, breakpoint), axis),
        axis === 'x' ? 'Distribute horizontally' : 'Distribute vertically',
      );
    },
    [applyPositions, ids, breakpoint],
  );

  const match = useCallback(
    (dimension: Dimension) => {
      if (!primaryId) return;
      const patch = matchSize(readBoxes(ids, breakpoint), primaryId, dimension);
      const commands = Object.entries(patch).map(([nodeId, value]) =>
        setStyle(nodeId, breakpoint, { [dimension]: value } as StylePatch),
      );
      if (commands.length === 0) return;
      useProjectStore
        .getState()
        .run(commands, { label: dimension === 'width' ? 'Match width' : 'Match height' });
    },
    [ids, primaryId, breakpoint],
  );

  const across = useCallback(
    (patch: StylePatch, options: { coalesce?: boolean } = {}) => {
      editStyleAcross(ids, breakpoint, patch, options);
    },
    [ids, breakpoint],
  );

  return (
    <aside className={styles.panel} aria-label="Inspector">
      <div className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.kindLabel} style={{ marginLeft: 0 }}>
            {ids.length} selected
          </span>
        </div>
        <div className={`${styles.scope} ${breakpoint !== 'base' ? styles.scopeOverride : ''}`}>
          <span className={styles.scopeDot} />
          Changes apply to all {ids.length}
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={() => useUiStore.getState().select(primaryId)}>
            Keep only last
          </Button>
          <Button variant="ghost" onClick={() => deleteSelection(ids)}>
            Delete all
          </Button>
        </div>
      </div>

      <div className={styles.body}>
        <CollapsibleSection title="Arrange">
          {canArrange ? (
            <>
              <Field label="Align" wide>
                <div className={styles.alignGrid}>
                  {HORIZONTAL.map((edge) => (
                    <button
                      key={edge}
                      type="button"
                      className={styles.alignButton}
                      title={ALIGN_LABEL[edge]}
                      aria-label={ALIGN_LABEL[edge]}
                      onClick={() => align(edge)}
                    >
                      <AlignGlyph edge={edge} />
                    </button>
                  ))}
                  {VERTICAL.map((edge) => (
                    <button
                      key={edge}
                      type="button"
                      className={styles.alignButton}
                      title={ALIGN_LABEL[edge]}
                      aria-label={ALIGN_LABEL[edge]}
                      onClick={() => align(edge)}
                    >
                      <AlignGlyph edge={edge} />
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Distribute" wide>
                <div className={styles.actions}>
                  <Button
                    variant="outline"
                    disabled={ids.length < 3}
                    onClick={() => distribute('x')}
                  >
                    Horizontally
                  </Button>
                  <Button
                    variant="outline"
                    disabled={ids.length < 3}
                    onClick={() => distribute('y')}
                  >
                    Vertically
                  </Button>
                </div>
              </Field>
              {ids.length < 3 ? (
                <p className={styles.emptyBody} style={{ maxWidth: 'none' }}>
                  Distributing needs three elements — with two there is nothing between them to
                  space out.
                </p>
              ) : null}
            </>
          ) : (
            <p className={styles.emptyBody} style={{ maxWidth: 'none' }}>
              {!sameParent
                ? 'Aligning needs elements that share a parent, so there is one coordinate space to move them in.'
                : 'These elements are in normal flow, so their positions come from the layout rather than from coordinates. Set Placement to Free on each one to arrange them by hand — or match their sizes and spacing below, which works either way.'}
            </p>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Size">
          <Field label="Match" wide>
            <div className={styles.actions}>
              <Button variant="outline" onClick={() => match('width')}>
                Width
              </Button>
              <Button variant="outline" onClick={() => match('height')}>
                Height
              </Button>
            </div>
          </Field>
          <p className={styles.emptyBody} style={{ maxWidth: 'none' }}>
            Takes the size from the last element you clicked.
          </p>

          <Field label="Width" wide>
            <DimensionInput
              aria-label="Width for every selected element"
              value={undefined}
              placeholder="mixed"
              onChange={(value, options) => across({ width: value as never }, options)}
            />
          </Field>
          <Field label="Height" wide>
            <DimensionInput
              aria-label="Height for every selected element"
              value={undefined}
              placeholder="mixed"
              onChange={(value, options) => across({ height: value as never }, options)}
            />
          </Field>
        </CollapsibleSection>

        <CollapsibleSection title="Typography">
          <Field label="Size" wide>
            <DimensionInput
              aria-label="Font size for every selected element"
              value={undefined}
              placeholder="mixed"
              onChange={(value, options) => across({ fontSize: value as never }, options)}
            />
          </Field>
          <Field label="Weight" htmlFor="multi-weight">
            <Select
              id="multi-weight"
              value=""
              placeholder="mixed"
              onChange={(event) => across({ fontWeight: event.target.value as never })}
              options={[
                { value: '300', label: 'Light' },
                { value: '400', label: 'Regular' },
                { value: '500', label: 'Medium' },
                { value: '600', label: 'Semibold' },
                { value: '700', label: 'Bold' },
              ]}
            />
          </Field>
          <Field label="Align" htmlFor="multi-align">
            <Select
              id="multi-align"
              value=""
              placeholder="mixed"
              onChange={(event) => across({ textAlign: event.target.value as never })}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Centre' },
                { value: 'right', label: 'Right' },
              ]}
            />
          </Field>
        </CollapsibleSection>

        <CollapsibleSection title="Appearance">
          <Field label="Text">
            <ColorInput
              value=""
              tokens={tokens}
              placeholder="mixed"
              onChange={(value) => across({ color: value as never }, { coalesce: true })}
            />
          </Field>
          <Field label="Fill">
            <ColorInput
              value=""
              tokens={tokens}
              placeholder="mixed"
              onChange={(value) => across({ backgroundColor: value as never }, { coalesce: true })}
            />
          </Field>
          <Field label="Radius" wide>
            <DimensionInput
              aria-label="Corner radius for every selected element"
              value={undefined}
              placeholder="mixed"
              onChange={(value, options) => across({ borderRadius: value as never }, options)}
            />
          </Field>
        </CollapsibleSection>

        <CollapsibleSection title="Spacing">
          <Field label="Padding" wide>
            <DimensionInput
              aria-label="Padding for every selected element"
              value={undefined}
              placeholder="mixed"
              onChange={(value, options) =>
                across(
                  {
                    paddingTop: value as never,
                    paddingRight: value as never,
                    paddingBottom: value as never,
                    paddingLeft: value as never,
                  },
                  options,
                )
              }
            />
          </Field>
          <Field label="Gap" wide>
            <DimensionInput
              aria-label="Gap for every selected element"
              value={undefined}
              placeholder="mixed"
              onChange={(value, options) => across({ gap: value as never }, options)}
            />
          </Field>
        </CollapsibleSection>
      </div>
    </aside>
  );
}

/**
 * The align icons.
 *
 * Drawn rather than imported: six of them, each one two rectangles and a rule,
 * and a set that reads as one family matters more here than reusing a generic
 * icon component.
 */
function AlignGlyph({ edge }: { edge: AlignEdge }): React.ReactElement {
  const horizontal = HORIZONTAL.includes(edge);

  // Where the guide line sits, and where the two bars snap to.
  const line = { left: 2, centre: 8, right: 14, top: 2, middle: 8, bottom: 14 }[edge];

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {horizontal ? (
        <>
          <path d={`M${line} 1v14`} stroke="var(--select)" strokeWidth="1.2" />
          <rect
            x={edge === 'left' ? 3 : edge === 'right' ? 3 : 3}
            y="3"
            width={edge === 'centre' ? 10 : 10}
            height="3.5"
            rx="1"
            fill="currentColor"
            transform={edge === 'right' ? 'translate(0,0)' : undefined}
          />
          <rect
            x={edge === 'left' ? 3 : edge === 'right' ? 7 : 5}
            y="9"
            width={edge === 'left' ? 6 : edge === 'right' ? 6 : 6}
            height="3.5"
            rx="1"
            fill="currentColor"
          />
        </>
      ) : (
        <>
          <path d={`M1 ${line}h14`} stroke="var(--select)" strokeWidth="1.2" />
          <rect x="3" y="3" width="3.5" height="10" rx="1" fill="currentColor" />
          <rect
            x="9"
            y={edge === 'top' ? 3 : edge === 'bottom' ? 7 : 5}
            width="3.5"
            height="6"
            rx="1"
            fill="currentColor"
          />
        </>
      )}
    </svg>
  );
}
