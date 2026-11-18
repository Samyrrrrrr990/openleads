/**
 * Renders one graph node.
 *
 * Two properties make the canvas feel immediate:
 *
 * 1. Each view subscribes to exactly one node, so editing a heading wakes one
 *    component rather than the tree.
 * 2. The component is memoised on its id, so a parent re-rendering does not
 *    cascade into every descendant.
 *
 * No interaction handlers live here. The canvas listens once at its root and
 * resolves targets from `data-zory-id`, which keeps listener count flat no
 * matter how large the page grows.
 */

import { createElement, memo, type CSSProperties, type ReactNode } from 'react';
import type { AssetNode, Breakpoint, ElementNode } from '@zory/core';
import { instancePath } from '@zory/core';
import { useProjectStore } from '../editor/state/projectStore';
import { useInstanceRootId, useResolvedNode } from '../editor/state/useResolvedNode';
import { resolveSrc, tagFor, toCssProperties } from './resolve';
import { InlineText } from './InlineText';

export interface NodeViewProps {
  nodeId: string;
  breakpoint: Breakpoint;
  /** When set, this node is being edited inline on the canvas. */
  editingId?: string | null;
  /** Canvas passes this so text edits reach the command engine. */
  onCommitText?: (nodeId: string, text: string) => void;
  onEndTextEdit?: () => void;
}

function NodeViewInner({
  nodeId,
  breakpoint,
  editingId,
  onCommitText,
  onEndTextEdit,
}: NodeViewProps): ReactNode {
  const node = useResolvedNode(nodeId);
  const instanceRootId = useInstanceRootId(nodeId);
  const assets = useProjectStore((s) => s.project?.assets);

  if (!node) return null;

  const style = toCssProperties(node.styles, breakpoint);
  const tag = tagFor(node);
  const isEditing = editingId === nodeId;

  // Void elements: no children, no text.
  if (node.kind === 'image') {
    const src = resolveSrc(node.props.src, assets ?? []);
    return (
      <img
        data-zory-id={node.id}
        /*
         * No `src` at all when there is nothing to point at, rather than
         * `src=""`.
         *
         * An empty string is not "no image" to a browser: it resolves against
         * the current document, so every sourceless placeholder fetches the
         * page again. On a template with nine plates that is nine extra
         * requests for the canvas and nine for anybody's exported site.
         * Omitting the attribute makes no request and shows the alt text,
         * which is the honest placeholder anyway.
         */
        {...(src ? { src } : {})}
        alt={node.props.alt ?? ''}
        style={style}
        draggable={false}
      />
    );
  }

  if (node.kind === 'divider') {
    return <hr data-zory-id={node.id} style={style} />;
  }

  /*
   * An instance holds no children of its own. What hangs beneath it is the
   * definition's root, addressed through this instance so that everything
   * below inherits the right override scope.
   */
  const childIds =
    node.kind === 'instance'
      ? instanceRootId
        ? [instancePath(node.id, instanceRootId)]
        : []
      : node.children;

  const children = renderChildren(childIds, breakpoint, editingId, onCommitText, onEndTextEdit);

  if (isEditing && onCommitText && onEndTextEdit) {
    return (
      <InlineText
        nodeId={node.id}
        tag={tag}
        text={node.text ?? ''}
        style={style}
        onCommit={onCommitText}
        onEnd={onEndTextEdit}
      />
    );
  }

  return createElement(
    tag,
    {
      'data-zory-id': node.id,
      style,
      ...extraAttributes(node, style),
    },
    node.text !== undefined && node.text !== '' ? node.text : null,
    children,
  );
}

function renderChildren(
  childIds: readonly string[],
  breakpoint: Breakpoint,
  editingId: string | null | undefined,
  onCommitText: NodeViewProps['onCommitText'],
  onEndTextEdit: NodeViewProps['onEndTextEdit'],
): ReactNode {
  if (childIds.length === 0) return null;
  return childIds.map((childId) => (
    <NodeView
      key={childId}
      nodeId={childId}
      breakpoint={breakpoint}
      editingId={editingId}
      onCommitText={onCommitText}
      onEndTextEdit={onEndTextEdit}
    />
  ));
}

/**
 * Attributes beyond styling. Links keep their href so the preview behaves like
 * the real page; buttons declare `type` so they never submit a stray form.
 */
function extraAttributes(node: ElementNode, style: CSSProperties): Record<string, unknown> {
  /*
   * The author's `id`, so `#pricing` in a link finds the section.
   *
   * Distinct from `data-zory-id`, which is the editor's handle on the node
   * and is not somebody's to choose. This one is theirs and is the same
   * attribute the export writes, so an anchor that works on the canvas works
   * in the shipped site.
   */
  const anchor = node.props.anchor ? { id: node.props.anchor } : {};

  switch (node.kind) {
    case 'link': {
      const rel = node.props.target === '_blank' ? 'noopener noreferrer' : undefined;
      return {
        ...anchor,
        href: node.props.href ?? '#',
        ...(node.props.target ? { target: node.props.target } : {}),
        ...(rel ? { rel } : {}),
      };
    }
    case 'button':
      return { ...anchor, type: 'button' };
    case 'container':
      // A flex/grid container with no children still needs to hold its shape.
      return node.children.length === 0 && !style.minHeight ? anchor : anchor;
    default:
      return anchor;
  }
}

/** Assets rarely change, so identity comparison on the array is enough. */
function propsAreEqual(a: NodeViewProps, b: NodeViewProps): boolean {
  return (
    a.nodeId === b.nodeId &&
    a.breakpoint === b.breakpoint &&
    a.editingId === b.editingId &&
    a.onCommitText === b.onCommitText &&
    a.onEndTextEdit === b.onEndTextEdit
  );
}

export const NodeView = memo(NodeViewInner, propsAreEqual);

export type { AssetNode };
