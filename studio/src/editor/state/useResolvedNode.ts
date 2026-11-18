/**
 * Reading a node that may live inside a component definition.
 *
 * An id can address a node in the page, a node inside a definition, or a
 * definition node seen through one instance. `findNode` resolves all three,
 * but it *composes* a fresh object for the last two — so using it directly as
 * a zustand selector would compare unequal on every store change and re-render
 * the subscriber on every command.
 *
 * What is subscribed to here are the stored pieces, whose identity Immer
 * preserves across unrelated edits. They are composed afterwards, in a memo,
 * so a node only changes when something it is actually made of changed.
 */

import { useMemo } from 'react';
import type { ElementNode } from '@zory/core';
import { applyOverride, componentPath, defNodeFor, instancePath, parseNodePath } from '@zory/core';
import { useProjectStore } from './projectStore';

export function useResolvedNode(nodeId: string | null): ElementNode | null {
  const path = useMemo(() => (nodeId ? parseNodePath(nodeId) : null), [nodeId]);

  const ownNode = useProjectStore((s) =>
    path || !nodeId ? null : (s.project?.nodes[nodeId] ?? null),
  );
  const defNode = useProjectStore((s) => (path ? defNodeFor(s.project, path) : null));
  const override = useProjectStore((s) =>
    path?.scope === 'instance'
      ? (s.project?.nodes[path.ownerId]?.overrides?.[path.defNodeId] ?? null)
      : null,
  );

  return useMemo(() => {
    if (ownNode) return ownNode;
    if (!path || !defNode || !nodeId) return null;
    if (path.scope === 'component') {
      return {
        ...defNode,
        id: nodeId,
        children: defNode.children.map((child) => componentPath(path.ownerId, child)),
      };
    }
    return applyOverride(
      defNode,
      override ?? undefined,
      nodeId,
      null,
      defNode.children.map((child) => instancePath(path.ownerId, child)),
    );
  }, [ownNode, path, defNode, override, nodeId]);
}

/**
 * The definition root to render beneath an instance node.
 *
 * `null` for anything that is not an instance, and for an instance whose
 * definition has gone.
 */
export function useInstanceRootId(nodeId: string | null): string | null {
  return useProjectStore((s) => {
    if (!nodeId || parseNodePath(nodeId)) return null;
    const own = s.project?.nodes[nodeId];
    if (!own || own.kind !== 'instance' || !own.componentId) return null;
    return s.project?.components?.[own.componentId]?.rootId ?? null;
  });
}
