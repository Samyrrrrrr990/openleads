/**
 * The inspector.
 *
 * Every control here writes through the command engine, so everything it does
 * is undoable, persisted and exported. There are no direct-to-DOM shortcuts.
 *
 * Fields edit the *currently selected breakpoint*. The scope strip at the top
 * says which one that is, and an amber dot marks any property this breakpoint
 * overrides.
 */

import { useCallback, useId, useMemo } from 'react';
import { shortcut } from '../chrome/platform';
import {
  BREAKPOINT_LABEL,
  type NodeKind,
  type StyleKey,
  isPageRoot,
  overrideCount,
  parseNodePath,
  resolveToken,
  setOverride,
  setStyle,
} from '@zory/core';
import { useProjectStore } from '../state/projectStore';
import { useResolvedNode } from '../state/useResolvedNode';
import { useUiStore } from '../state/uiStore';
import {
  componentiseSelected,
  duplicateSelected,
  editProp,
  editText,
  groupSelected,
  rename,
  ungroupSelected,
} from '../state/actions';
import {
  Button,
  ColorInput,
  CollapsibleSection,
  Field,
  Segmented,
  Select,
  TextArea,
  TextInput,
} from '../../ui/controls';
import {
  BoxIcon,
  ButtonIcon,
  DividerIcon,
  HeadingIcon,
  ImageIcon,
  InstanceIcon,
  LinkIcon,
  TextIcon,
} from '../../ui/icons';
import { MotionSection } from './MotionSection';
import { MultiSelection } from './MultiSelection';
import { useStyleField } from './useStyleField';
import { useThemeTokens } from './useThemeTokens';
import { DimensionInput } from './DimensionInput';
import styles from './Inspector.module.css';

const KIND_ICON: Record<NodeKind, React.ComponentType<{ size?: number }>> = {
  container: BoxIcon,
  instance: InstanceIcon,
  heading: HeadingIcon,
  text: TextIcon,
  button: ButtonIcon,
  link: LinkIcon,
  image: ImageIcon,
  divider: DividerIcon,
};

export function Inspector(): React.ReactElement {
  const selectedId = useUiStore((s) => s.selectedId);
  const selectionSize = useUiStore((s) => s.selectedIds.length);
  const breakpoint = useUiStore((s) => s.breakpoint);
  // Resolves ids that address a node inside a component or an instance too.
  const node = useResolvedNode(selectedId);
  const isRoot = useProjectStore((s) =>
    selectedId && s.project ? isPageRoot(s.project, selectedId) : false,
  );

  const overrides = node ? overrideCount(node.styles, breakpoint) : 0;
  const nameId = useId();

  const clearBreakpoint = useCallback(() => {
    if (!node || breakpoint === 'base') return;
    const patch: Record<string, null> = {};
    for (const key of Object.keys(node.styles[breakpoint] ?? {})) patch[key] = null;
    if (Object.keys(patch).length === 0) return;
    useProjectStore.getState().run(
      [{ type: 'SET_STYLE', nodeId: node.id, breakpoint, patch: patch as never }],
      { label: `Clear ${BREAKPOINT_LABEL[breakpoint].toLowerCase()} overrides` },
    );
  }, [node, breakpoint]);

  /*
   * More than one thing selected is a different panel, not a variant of this
   * one. Every field below reads and writes a single node; threading a set
   * through all of them would have made the common case worse to serve the
   * rarer one.
   */
  if (selectionSize > 1) return <MultiSelection />;

  if (!node) {
    return (
      <aside className={styles.panel} aria-label="Inspector">
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <BoxIcon size={16} />
          </span>
          <p className={styles.emptyTitle}>Nothing selected</p>
          <p className={styles.emptyBody}>
            Click an element on the canvas, or pick one from the layers list, to edit it here.
          </p>
        </div>
      </aside>
    );
  }

  const KindIcon = KIND_ICON[node.kind];

  return (
    <aside className={styles.panel} aria-label="Inspector">
      <div className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.kindIcon}>
            <KindIcon size={13} />
          </span>
          <label className="sr-only" htmlFor={nameId}>
            Layer name
          </label>
          <input
            id={nameId}
            className={styles.nameInput}
            value={node.name}
            spellCheck={false}
            onChange={(event) => rename(node.id, event.target.value || 'Element')}
          />
          <span className={styles.kindLabel}>{node.kind}</span>
        </div>

        <div
          className={`${styles.scope} ${breakpoint !== 'base' ? styles.scopeOverride : ''}`}
          data-testid="inspector-scope"
        >
          <span className={styles.scopeDot} />
          {breakpoint === 'base'
            ? 'Editing all breakpoints'
            : `Editing ${BREAKPOINT_LABEL[breakpoint].toLowerCase()} only`}
          {breakpoint !== 'base' && (
            <span className={styles.scopeCount}>
              {overrides === 0 ? 'no overrides' : `${overrides} override${overrides === 1 ? '' : 's'}`}
            </span>
          )}
        </div>

        {/*
          Arranging actions live here rather than only on the keyboard.
          Cmd+G is muscle memory for people who came from a design tool and
          invisible to everyone else.
        */}
        <div className={styles.actions}>
          <Button variant="ghost" onClick={() => groupSelected(node.id)} title={`Group · ${shortcut('G')}`}>
            Group
          </Button>
          {node.kind === 'container' && node.children.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => ungroupSelected(node.id)}
              title={`Ungroup · ${shortcut('⇧G')}`}
            >
              Ungroup
            </Button>
          )}
          <Button variant="ghost" onClick={() => duplicateSelected(node.id)}>
            Duplicate
          </Button>
          {/*
            Offered only where it would work: not on a page root, not on
            something that is already an instance, and not on a node being
            viewed through one.
          */}
          {node.kind !== 'instance' && !parseNodePath(node.id) && !isRoot && (
            <Button
              variant="ghost"
              onClick={() => componentiseSelected(node.id)}
              title="Reuse this anywhere, and keep every copy in step"
            >
              Make component
            </Button>
          )}
        </div>

        {breakpoint !== 'base' && overrides > 0 && (
          <Button variant="ghost" onClick={clearBreakpoint} style={{ alignSelf: 'flex-start' }}>
            Clear {BREAKPOINT_LABEL[breakpoint].toLowerCase()} overrides
          </Button>
        )}
      </div>

      <div className={styles.body}>
        <InstanceNote nodeId={node.id} />
        <ContentSection nodeId={node.id} />
        <LayoutSection nodeId={node.id} />
        <TypographySection nodeId={node.id} />
        <AppearanceSection nodeId={node.id} />
        <MotionSection nodeId={node.id} />
        <ResponsiveSection nodeId={node.id} />
      </div>
    </aside>
  );
}

/** Reads the selected node fresh so each section subscribes independently. */
function useSelectedNode(nodeId: string) {
  // Resolves ids addressing a node inside a component or an instance too,
  // without re-rendering every section on every unrelated command.
  const node = useResolvedNode(nodeId);
  const breakpoint = useUiStore((s) => s.breakpoint);
  return { node, breakpoint };
}

/**
 * Says when the selected node is part of an instance, and offers its pins back.
 *
 * The per-property dots cover styles. This covers the rest — text, props and
 * motion are pinned by the same mechanism but have no per-field slot to hang a
 * marker on, and "give this node back to the component" is a more useful thing
 * to be able to say than four separate undos.
 */
function InstanceNote({ nodeId }: { nodeId: string }): React.ReactElement | null {
  const path = useMemo(() => parseNodePath(nodeId), [nodeId]);

  const componentName = useProjectStore((s) => {
    if (!path || path.scope !== 'instance' || !s.project) return null;
    const instance = s.project.nodes[path.ownerId];
    if (!instance?.componentId) return null;
    return s.project.components?.[instance.componentId]?.name ?? null;
  });

  const hasPins = useProjectStore((s) => {
    if (!path || path.scope !== 'instance' || !s.project) return false;
    const override = s.project.nodes[path.ownerId]?.overrides?.[path.defNodeId];
    return override !== undefined && Object.keys(override).length > 0;
  });

  if (!path || path.scope !== 'instance' || !componentName) return null;

  return (
    <div className={styles.instanceNote}>
      <span className={styles.instanceOf}>
        Instance of <strong>{componentName}</strong>
      </span>
      {hasPins && (
        <Button
          variant="ghost"
          onClick={() =>
            useProjectStore
              .getState()
              .run([setOverride(path.ownerId, path.defNodeId, null)], {
                label: 'Reset to component',
              })
          }
        >
          Reset to component
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Content ---

function ContentSection({ nodeId }: { nodeId: string }): React.ReactElement | null {
  const { node } = useSelectedNode(nodeId);
  const textId = useId();
  const hrefId = useId();
  const altId = useId();
  const srcId = useId();
  const anchorId = useId();

  if (!node) return null;
  const hasText = node.kind !== 'image' && node.kind !== 'divider' && node.kind !== 'container';
  const isLink = node.kind === 'link';
  const isImage = node.kind === 'image';
  const isHeading = node.kind === 'heading';

  // No early return any more: the anchor field applies to every kind, so
  // there is always at least one thing in this section.

  return (
    <CollapsibleSection title="Content">
      {node.kind === 'container' && (
        <Field label="Tag" htmlFor={`${nodeId}-tag`}>
          <Select
            id={`${nodeId}-tag`}
            value={node.props.tag ?? 'div'}
            onChange={(event) => editProp(node.id, { tag: event.target.value as never })}
            options={[
              { value: 'div', label: 'div' },
              { value: 'header', label: 'header' },
              { value: 'nav', label: 'nav' },
              { value: 'main', label: 'main' },
              { value: 'section', label: 'section' },
              { value: 'article', label: 'article' },
              { value: 'aside', label: 'aside' },
              { value: 'footer', label: 'footer' },
            ]}
          />
        </Field>
      )}

      {hasText && (
        <TextArea
          id={textId}
          aria-label="Text content"
          value={node.text ?? ''}
          spellCheck
          onChange={(event) => editText(node.id, event.target.value)}
        />
      )}

      {isHeading && (
        <Field label="Level" htmlFor={`${nodeId}-level`}>
          <Select
            id={`${nodeId}-level`}
            value={String(node.props.level ?? 2)}
            onChange={(event) => editProp(node.id, { level: Number(event.target.value) as never })}
            options={[1, 2, 3, 4, 5, 6].map((level) => ({
              value: String(level),
              label: `Heading ${level}`,
            }))}
          />
        </Field>
      )}

      {isLink && (
        <>
          <Field label="Link" htmlFor={hrefId}>
            <TextInput
              id={hrefId}
              value={node.props.href ?? ''}
              placeholder="https:// or /page"
              spellCheck={false}
              onChange={(event) => editProp(node.id, { href: event.target.value })}
            />
          </Field>
          <Field label="Opens" htmlFor={`${nodeId}-target`}>
            <Select
              id={`${nodeId}-target`}
              value={node.props.target ?? '_self'}
              onChange={(event) => editProp(node.id, { target: event.target.value as never })}
              options={[
                { value: '_self', label: 'Same tab' },
                { value: '_blank', label: 'New tab' },
              ]}
            />
          </Field>
        </>
      )}

      {isImage && (
        <>
          <Field label="Source" htmlFor={srcId}>
            <TextInput
              id={srcId}
              value={node.props.src ?? ''}
              placeholder="https://…"
              spellCheck={false}
              onChange={(event) => editProp(node.id, { src: event.target.value })}
            />
          </Field>
          <Field label="Alt text" htmlFor={altId}>
            <TextInput
              id={altId}
              value={node.props.alt ?? ''}
              placeholder="Describe the image"
              onChange={(event) => editProp(node.id, { alt: event.target.value })}
            />
          </Field>
        </>
      )}

      {/*
        On every kind, because anything can be the target of an in-page link.

        Before this there was no way to write an element id at all, so a link
        to `#pricing` had nothing to find — including in three of Zory's own
        starters, whose navigation bars were built entirely from anchors that
        could not resolve.
      */}
      <Field label="Anchor" htmlFor={anchorId}>
        <TextInput
          id={anchorId}
          value={node.props.anchor ?? ''}
          placeholder="pricing"
          spellCheck={false}
          onChange={(event) => editProp(node.id, { anchor: event.target.value })}
        />
        <p className={styles.hint}>
          Link to this from anywhere with <code>#{node.props.anchor || 'pricing'}</code>.
        </p>
      </Field>
    </CollapsibleSection>
  );
}

// ----------------------------------------------------------------- Layout ---

const SPACING_KEYS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;
const MARGIN_KEYS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;

/**
 * In flow, or placed by hand.
 *
 * Switching to free placement is a real change to the document, not an editor
 * mode: the element becomes `position: absolute` with offsets, and its parent
 * becomes a positioning context. Both are written as one command so a single
 * undo puts the element back in flow.
 *
 * The starting offsets are measured from where the element already is, so it
 * does not jump the moment it is released from the layout.
 */
function PlacementControl({ nodeId }: { nodeId: string }): React.ReactElement | null {
  const { node, breakpoint } = useSelectedNode(nodeId);
  const parentId = node?.parentId ?? null;
  const position = useStyleField(node, breakpoint, 'position');
  const placed = position.value === 'absolute';

  const toggle = useCallback(() => {
    if (!node) return;

    if (placed) {
      // Back into flow: clear the placement entirely rather than leaving
      // orphaned offsets that would apply again if it were ever re-placed.
      useProjectStore.getState().run(
        [setStyle(node.id, breakpoint, { position: null, left: null, top: null, zIndex: null })],
        { label: 'Return to flow' },
      );
      return;
    }

    const frame = document.querySelector('[data-testid="canvas-frame"]');
    const element = frame?.querySelector<HTMLElement>(`[data-zory-id="${CSS.escape(node.id)}"]`);
    const parentElement = parentId
      ? frame?.querySelector<HTMLElement>(`[data-zory-id="${CSS.escape(parentId)}"]`)
      : null;

    let left = 0;
    let top = 0;
    if (element && parentElement) {
      const a = element.getBoundingClientRect();
      const b = parentElement.getBoundingClientRect();
      left = Math.round(a.left - b.left);
      top = Math.round(a.top - b.top);
    }

    const commands = [
      setStyle(node.id, breakpoint, {
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
      }),
    ];
    // Without a positioned ancestor the offsets would be measured against the
    // page, and the element would fly off as soon as it was placed.
    if (parentId) {
      commands.push(setStyle(parentId, breakpoint, { position: 'relative' }));
    }

    useProjectStore.getState().run(commands, { label: 'Place freely' });
  }, [node, parentId, placed, breakpoint]);

  if (!node || !node.parentId) return null;

  return (
    <Field
      label="Placement"
      overridden={position.marked}
      pinned={position.pinned}
      onUnpin={position.clear}
      htmlFor={`${nodeId}-placement`}
    >
      <Select
        id={`${nodeId}-placement`}
        value={placed ? 'absolute' : 'flow'}
        onChange={toggle}
        options={[
          { value: 'flow', label: 'In flow' },
          { value: 'absolute', label: 'Free — drag anywhere' },
        ]}
      />
    </Field>
  );
}

function LayoutSection({ nodeId }: { nodeId: string }): React.ReactElement | null {
  const { node, breakpoint } = useSelectedNode(nodeId);

  const display = useStyleField(node, breakpoint, 'display');
  const direction = useStyleField(node, breakpoint, 'flexDirection');
  const align = useStyleField(node, breakpoint, 'alignItems');
  const justify = useStyleField(node, breakpoint, 'justifyContent');
  const gap = useStyleField(node, breakpoint, 'gap');
  const columns = useStyleField(node, breakpoint, 'gridTemplateColumns');
  const width = useStyleField(node, breakpoint, 'width');
  const maxWidth = useStyleField(node, breakpoint, 'maxWidth');
  const minHeight = useStyleField(node, breakpoint, 'minHeight');

  if (!node) return null;
  const isFlex = display.value === 'flex' || display.value === 'inline-flex';
  const isGrid = display.value === 'grid';

  return (
    <CollapsibleSection title="Layout">
      <PlacementControl nodeId={nodeId} />

      <Field
        label="Display"
        overridden={display.marked}
        pinned={display.pinned}
        onUnpin={display.clear}
        htmlFor={`${nodeId}-display`}
      >
        <Select
          id={`${nodeId}-display`}
          value={(display.value as string) ?? ''}
          placeholder={display.inherited ? `${display.value ?? 'block'} (inherited)` : 'block'}
          onChange={(event) => display.set(event.target.value as never)}
          options={[
            { value: 'block', label: 'Block' },
            { value: 'flex', label: 'Flex' },
            { value: 'grid', label: 'Grid' },
            { value: 'inline-flex', label: 'Inline flex' },
            { value: 'inline-block', label: 'Inline block' },
            { value: 'none', label: 'Hidden' },
          ]}
        />
      </Field>

      {isFlex && (
        <>
          <Field
            label="Direction"
            overridden={direction.marked}
            pinned={direction.pinned}
            onUnpin={direction.clear}
          >
            <Segmented
              label="Flex direction"
              full
              value={(direction.value as string | null) ?? 'row'}
              onChange={(value) => direction.set(value as never)}
              options={[
                { value: 'row', label: 'Row' },
                { value: 'column', label: 'Column' },
              ]}
            />
          </Field>
          <Field
            label="Align"
            overridden={align.marked}
            pinned={align.pinned}
            onUnpin={align.clear}
            htmlFor={`${nodeId}-align`}
          >
            <Select
              id={`${nodeId}-align`}
              value={(align.value as string) ?? ''}
              placeholder={align.inherited ? `${align.value} (inherited)` : 'stretch'}
              onChange={(event) => align.set(event.target.value as never)}
              options={[
                { value: 'flex-start', label: 'Start' },
                { value: 'center', label: 'Centre' },
                { value: 'flex-end', label: 'End' },
                { value: 'stretch', label: 'Stretch' },
                { value: 'baseline', label: 'Baseline' },
              ]}
            />
          </Field>
          <Field
            label="Justify"
            overridden={justify.marked}
            pinned={justify.pinned}
            onUnpin={justify.clear}
            htmlFor={`${nodeId}-justify`}
          >
            <Select
              id={`${nodeId}-justify`}
              value={(justify.value as string) ?? ''}
              placeholder={justify.inherited ? `${justify.value} (inherited)` : 'start'}
              onChange={(event) => justify.set(event.target.value as never)}
              options={[
                { value: 'flex-start', label: 'Start' },
                { value: 'center', label: 'Centre' },
                { value: 'flex-end', label: 'End' },
                { value: 'space-between', label: 'Space between' },
                { value: 'space-around', label: 'Space around' },
                { value: 'space-evenly', label: 'Space evenly' },
              ]}
            />
          </Field>
        </>
      )}

      {isGrid && (
        <Field
          label="Columns"
          overridden={columns.marked}
          pinned={columns.pinned}
          onUnpin={columns.clear}
        >
          <DimensionInput
            aria-label="Grid template columns"
            value={columns.overridden ? (columns.value as string) : undefined}
            inheritedValue={columns.value as string}
            placeholder="1fr 1fr"
            onChange={(value, options) => columns.set(value as never, options)}
          />
        </Field>
      )}

      {(isFlex || isGrid) && (
        <Field label="Gap" overridden={gap.marked} pinned={gap.pinned} onUnpin={gap.clear}>
          <DimensionInput
            aria-label="Gap"
            value={gap.overridden ? (gap.value as string) : undefined}
            inheritedValue={gap.value as string}
            placeholder="0"
            onChange={(value, options) => gap.set(value as never, options)}
          />
        </Field>
      )}

      <SpacingGroup nodeId={nodeId} label="Padding" keys={SPACING_KEYS} />
      <SpacingGroup nodeId={nodeId} label="Margin" keys={MARGIN_KEYS} />

      <Field label="Width" overridden={width.marked} pinned={width.pinned} onUnpin={width.clear}>
        <DimensionInput
          aria-label="Width"
          value={width.overridden ? (width.value as string) : undefined}
          inheritedValue={width.value as string}
          placeholder="auto"
          onChange={(value, options) => width.set(value as never, options)}
        />
      </Field>
      <Field
        label="Max width"
        overridden={maxWidth.marked}
        pinned={maxWidth.pinned}
        onUnpin={maxWidth.clear}
      >
        <DimensionInput
          aria-label="Max width"
          value={maxWidth.overridden ? (maxWidth.value as string) : undefined}
          inheritedValue={maxWidth.value as string}
          placeholder="none"
          onChange={(value, options) => maxWidth.set(value as never, options)}
        />
      </Field>
      <Field
        label="Min height"
        overridden={minHeight.marked}
        pinned={minHeight.pinned}
        onUnpin={minHeight.clear}
      >
        <DimensionInput
          aria-label="Min height"
          value={minHeight.overridden ? (minHeight.value as string) : undefined}
          inheritedValue={minHeight.value as string}
          placeholder="auto"
          onChange={(value, options) => minHeight.set(value as never, options)}
        />
      </Field>
    </CollapsibleSection>
  );
}

const SIDE_LABELS = ['T', 'R', 'B', 'L'];

function SpacingGroup({
  nodeId,
  label,
  keys,
}: {
  nodeId: string;
  label: string;
  keys: readonly StyleKey[];
}): React.ReactElement | null {
  const { node, breakpoint } = useSelectedNode(nodeId);
  const top = useStyleField(node, breakpoint, keys[0]!);
  const right = useStyleField(node, breakpoint, keys[1]!);
  const bottom = useStyleField(node, breakpoint, keys[2]!);
  const left = useStyleField(node, breakpoint, keys[3]!);
  const fields = useMemo(() => [top, right, bottom, left], [top, right, bottom, left]);

  if (!node) return null;
  const anyMarked = fields.some((field) => field.marked);

  return (
    <div>
      <Field label={label} overridden={anyMarked}>
        <div className={styles.spacingLabels} aria-hidden="true">
          {SIDE_LABELS.map((side) => (
            <span key={side} className={styles.spacingLabel}>
              {side}
            </span>
          ))}
        </div>
      </Field>
      <div className={styles.spacingGrid} style={{ marginLeft: 71, marginTop: 2 }}>
        {fields.map((field, index) => (
          <DimensionInput
            key={keys[index]}
            aria-label={`${label} ${['top', 'right', 'bottom', 'left'][index]}`}
            value={field.overridden ? (field.value as string) : undefined}
            inheritedValue={field.value as string}
            placeholder="0"
            onChange={(value, options) => field.set(value as never, options)}
          />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Typography ---

function TypographySection({ nodeId }: { nodeId: string }): React.ReactElement | null {
  const { node, breakpoint } = useSelectedNode(nodeId);

  const fontFamily = useStyleField(node, breakpoint, 'fontFamily');
  const fontSize = useStyleField(node, breakpoint, 'fontSize');
  const fontWeight = useStyleField(node, breakpoint, 'fontWeight');
  const lineHeight = useStyleField(node, breakpoint, 'lineHeight');
  const letterSpacing = useStyleField(node, breakpoint, 'letterSpacing');
  const textAlign = useStyleField(node, breakpoint, 'textAlign');
  const textTransform = useStyleField(node, breakpoint, 'textTransform');

  if (!node) return null;
  if (node.kind === 'image' || node.kind === 'divider') return null;

  return (
    <CollapsibleSection title="Typography" defaultOpen={node.kind !== 'container'}>
      <Field
        label="Font"
        overridden={fontFamily.marked}
        pinned={fontFamily.pinned}
        onUnpin={fontFamily.clear}
      >
        <DimensionInput
          aria-label="Font family"
          value={fontFamily.overridden ? (fontFamily.value as string) : undefined}
          inheritedValue={fontFamily.value as string}
          placeholder="inherit"
          onChange={(value, options) => fontFamily.set(value as never, options)}
        />
      </Field>
      <Field
        label="Size"
        overridden={fontSize.marked}
        pinned={fontSize.pinned}
        onUnpin={fontSize.clear}
      >
        <DimensionInput
          aria-label="Font size"
          value={fontSize.overridden ? (fontSize.value as string) : undefined}
          inheritedValue={fontSize.value as string}
          placeholder="16px"
          onChange={(value, options) => fontSize.set(value as never, options)}
        />
      </Field>
      <Field
        label="Weight"
        overridden={fontWeight.marked}
        pinned={fontWeight.pinned}
        onUnpin={fontWeight.clear}
        htmlFor={`${nodeId}-weight`}
      >
        <Select
          id={`${nodeId}-weight`}
          value={(fontWeight.value as string) ?? ''}
          placeholder={fontWeight.inherited ? `${fontWeight.value} (inherited)` : 'Regular'}
          onChange={(event) => fontWeight.set(event.target.value as never)}
          options={[
            { value: '300', label: 'Light · 300' },
            { value: '400', label: 'Regular · 400' },
            { value: '500', label: 'Medium · 500' },
            { value: '550', label: 'Semibold · 550' },
            { value: '600', label: 'Semibold · 600' },
            { value: '700', label: 'Bold · 700' },
            { value: '800', label: 'Extrabold · 800' },
          ]}
        />
      </Field>
      <Field
        label="Line height"
        overridden={lineHeight.marked}
        pinned={lineHeight.pinned}
        onUnpin={lineHeight.clear}
      >
        <DimensionInput
          aria-label="Line height"
          value={lineHeight.overridden ? (lineHeight.value as string) : undefined}
          inheritedValue={lineHeight.value as string}
          placeholder="1.5"
          onChange={(value, options) => lineHeight.set(value as never, options)}
        />
      </Field>
      <Field
        label="Tracking"
        overridden={letterSpacing.marked}
        pinned={letterSpacing.pinned}
        onUnpin={letterSpacing.clear}
      >
        <DimensionInput
          aria-label="Letter spacing"
          value={letterSpacing.overridden ? (letterSpacing.value as string) : undefined}
          inheritedValue={letterSpacing.value as string}
          placeholder="0"
          onChange={(value, options) => letterSpacing.set(value as never, options)}
        />
      </Field>
      <Field
        label="Align"
        overridden={textAlign.marked}
        pinned={textAlign.pinned}
        onUnpin={textAlign.clear}
      >
        <Segmented
          label="Text align"
          full
          value={(textAlign.value as string | null) ?? null}
          onChange={(value) => textAlign.set(value as never)}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Centre' },
            { value: 'right', label: 'Right' },
          ]}
        />
      </Field>
      <Field
        label="Case"
        overridden={textTransform.marked}
        pinned={textTransform.pinned}
        onUnpin={textTransform.clear}
        htmlFor={`${nodeId}-transform`}
      >
        <Select
          id={`${nodeId}-transform`}
          value={(textTransform.value as string) ?? ''}
          placeholder="As typed"
          onChange={(event) => textTransform.set(event.target.value as never)}
          options={[
            { value: 'none', label: 'As typed' },
            { value: 'uppercase', label: 'UPPERCASE' },
            { value: 'lowercase', label: 'lowercase' },
            { value: 'capitalize', label: 'Capitalise' },
          ]}
        />
      </Field>
    </CollapsibleSection>
  );
}

// ------------------------------------------------------------- Appearance ---

function AppearanceSection({ nodeId }: { nodeId: string }): React.ReactElement | null {
  const { node, breakpoint } = useSelectedNode(nodeId);

  const color = useStyleField(node, breakpoint, 'color');
  const background = useStyleField(node, breakpoint, 'backgroundColor');
  const borderWidth = useStyleField(node, breakpoint, 'borderWidth');
  const borderStyle = useStyleField(node, breakpoint, 'borderStyle');
  const borderColor = useStyleField(node, breakpoint, 'borderColor');
  const borderRadius = useStyleField(node, breakpoint, 'borderRadius');
  const boxShadow = useStyleField(node, breakpoint, 'boxShadow');
  const opacity = useStyleField(node, breakpoint, 'opacity');
  const objectFit = useStyleField(node, breakpoint, 'objectFit');
  const { tokens, theme } = useThemeTokens();

  if (!node) return null;

  return (
    <CollapsibleSection title="Appearance">
      {node.kind !== 'image' && node.kind !== 'divider' && (
        <Field label="Text" overridden={color.marked} pinned={color.pinned} onUnpin={color.clear}>
          <ColorInput
            value={(color.value as string) ?? ''}
            resolved={theme ? resolveToken(color.value as string, theme) : undefined}
            tokens={tokens}
            placeholder={color.inherited ? 'inherited' : 'inherit'}
            onChange={(value) => color.set(value as never, { coalesce: true })}
          />
        </Field>
      )}
      <Field
        label="Fill"
        overridden={background.marked}
        pinned={background.pinned}
        onUnpin={background.clear}
      >
        <ColorInput
          value={(background.value as string) ?? ''}
          resolved={theme ? resolveToken(background.value as string, theme) : undefined}
          tokens={tokens}
          placeholder="none"
          onChange={(value) => background.set(value as never, { coalesce: true })}
        />
      </Field>

      <Field label="Border" overridden={borderWidth.marked || borderStyle.marked}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <DimensionInput
            aria-label="Border width"
            value={borderWidth.overridden ? (borderWidth.value as string) : undefined}
            inheritedValue={borderWidth.value as string}
            placeholder="0"
            onChange={(value, options) => borderWidth.set(value as never, options)}
          />
          <Select
            aria-label="Border style"
            value={(borderStyle.value as string) ?? ''}
            placeholder="none"
            onChange={(event) => borderStyle.set(event.target.value as never)}
            options={[
              { value: 'solid', label: 'Solid' },
              { value: 'dashed', label: 'Dashed' },
              { value: 'dotted', label: 'Dotted' },
              { value: 'none', label: 'None' },
            ]}
          />
        </div>
      </Field>
      <Field
        label="Border fill"
        overridden={borderColor.marked}
        pinned={borderColor.pinned}
        onUnpin={borderColor.clear}
      >
        <ColorInput
          value={(borderColor.value as string) ?? ''}
          resolved={theme ? resolveToken(borderColor.value as string, theme) : undefined}
          tokens={tokens}
          placeholder="none"
          onChange={(value) => borderColor.set(value as never, { coalesce: true })}
        />
      </Field>
      <Field
        label="Radius"
        overridden={borderRadius.marked}
        pinned={borderRadius.pinned}
        onUnpin={borderRadius.clear}
      >
        <DimensionInput
          aria-label="Border radius"
          value={borderRadius.overridden ? (borderRadius.value as string) : undefined}
          inheritedValue={borderRadius.value as string}
          placeholder="0"
          onChange={(value, options) => borderRadius.set(value as never, options)}
        />
      </Field>
      <Field
        label="Shadow"
        overridden={boxShadow.marked}
        pinned={boxShadow.pinned}
        onUnpin={boxShadow.clear}
      >
        <DimensionInput
          aria-label="Box shadow"
          value={boxShadow.overridden ? (boxShadow.value as string) : undefined}
          inheritedValue={boxShadow.value as string}
          placeholder="none"
          onChange={(value, options) => boxShadow.set(value as never, options)}
        />
      </Field>
      <Field
        label="Opacity"
        overridden={opacity.marked}
        pinned={opacity.pinned}
        onUnpin={opacity.clear}
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          aria-label="Opacity"
          value={typeof opacity.value === 'number' ? opacity.value : 1}
          style={{ width: '100%', accentColor: 'var(--select)' }}
          onChange={(event) => opacity.set(Number(event.target.value) as never, { coalesce: true })}
        />
      </Field>

      {node.kind === 'image' && (
        <Field
          label="Fit"
          overridden={objectFit.marked}
          pinned={objectFit.pinned}
          onUnpin={objectFit.clear}
          htmlFor={`${nodeId}-fit`}
        >
          <Select
            id={`${nodeId}-fit`}
            value={(objectFit.value as string) ?? ''}
            placeholder="fill"
            onChange={(event) => objectFit.set(event.target.value as never)}
            options={[
              { value: 'cover', label: 'Cover' },
              { value: 'contain', label: 'Contain' },
              { value: 'fill', label: 'Fill' },
              { value: 'none', label: 'None' },
            ]}
          />
        </Field>
      )}
    </CollapsibleSection>
  );
}

// ------------------------------------------------------------- Responsive ---

function ResponsiveSection({ nodeId }: { nodeId: string }): React.ReactElement | null {
  const node = useResolvedNode(nodeId);
  const breakpoint = useUiStore((s) => s.breakpoint);
  const setBreakpoint = useUiStore((s) => s.setBreakpoint);
  const display = useStyleField(node, breakpoint, 'display');

  if (!node) return null;

  const counts = {
    base: Object.keys(node.styles.base ?? {}).length,
    tablet: overrideCount(node.styles, 'tablet'),
    mobile: overrideCount(node.styles, 'mobile'),
  };

  const hidden = display.value === 'none';

  return (
    <CollapsibleSection title="Responsive">
      <Field label="Editing" wide>
        <Segmented
          label="Breakpoint being edited"
          full
          value={breakpoint}
          onChange={(value) => setBreakpoint(value)}
          options={[
            { value: 'base' as const, label: `Desktop${counts.base ? ` · ${counts.base}` : ''}` },
            { value: 'tablet' as const, label: `Tablet${counts.tablet ? ` · ${counts.tablet}` : ''}` },
            { value: 'mobile' as const, label: `Mobile${counts.mobile ? ` · ${counts.mobile}` : ''}` },
          ]}
        />
      </Field>

      <Field
        label="Visible"
        overridden={display.marked}
        pinned={display.pinned}
        onUnpin={display.clear}
      >
        <Segmented
          label="Visibility at this breakpoint"
          full
          value={hidden ? 'hidden' : 'shown'}
          onChange={(value) => {
            if (value === 'hidden') display.set('none' as never);
            else if (display.overridden) display.clear();
            else display.set('block' as never);
          }}
          options={[
            { value: 'shown', label: 'Shown' },
            { value: 'hidden', label: 'Hidden' },
          ]}
        />
      </Field>

      <p className={styles.emptyBody} style={{ maxWidth: 'none', marginTop: 2 }}>
        {breakpoint === 'base'
          ? 'Changes here apply everywhere unless a narrower breakpoint overrides them.'
          : `Changes here apply at ${BREAKPOINT_LABEL[breakpoint].toLowerCase()} and below. Desktop values stay as they are.`}
      </p>
    </CollapsibleSection>
  );
}
