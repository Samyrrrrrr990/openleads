/**
 * Binds one style property to the breakpoint currently being edited.
 *
 * The distinction that matters: a field shows the value *in effect* (which may
 * cascade down from a wider breakpoint) but writes only to the breakpoint the
 * user is on. `overridden` says whether this breakpoint sets its own value, so
 * the inspector can mark it and offer to clear it.
 *
 * `pinned` is the same idea across a different axis. Inside an instance a
 * value either follows the component or has been set here. It cannot be read
 * off the node: the node handed to this hook is already the definition merged
 * with its overrides, so by then a pinned value and an inherited one look
 * identical. The override record has to be consulted directly.
 */

import { useCallback, useMemo } from 'react';
import type { Breakpoint, ElementNode, StyleKey, StyleProps } from '@zory/core';
import { hasOwnOverride, parseNodePath, resolveStyleValue } from '@zory/core';
import { editStyle } from '../state/actions';
import { useProjectStore } from '../state/projectStore';

export interface StyleField<K extends StyleKey> {
  /** Value in effect at this breakpoint, from anywhere in the cascade. */
  value: StyleProps[K];
  /** Which breakpoint supplied it — `null` when nothing sets it. */
  source: Breakpoint | null;
  /** True when this breakpoint sets its own value. */
  overridden: boolean;
  /**
   * Whether to show the override marker. At the base breakpoint almost
   * everything is "set here", so a dot on every row would say nothing — the
   * marker only earns its place at tablet and mobile.
   */
  marked: boolean;
  /** True when the value is inherited from a wider breakpoint. */
  inherited: boolean;
  /**
   * True when this node sits inside an instance and this property has been set
   * on that instance, so it no longer follows the component. Always false
   * outside an instance.
   */
  pinned: boolean;
  set: (value: StyleProps[K], options?: { coalesce?: boolean }) => void;
  clear: () => void;
}

export function useStyleField<K extends StyleKey>(
  node: ElementNode | null,
  breakpoint: Breakpoint,
  key: K,
): StyleField<K> {
  const resolved = useMemo(
    () => (node ? resolveStyleValue(node.styles, breakpoint, key) : { value: undefined, source: null }),
    [node, breakpoint, key],
  );

  const overridden = node ? hasOwnOverride(node.styles, breakpoint, key) : false;

  const pinned = useProjectStore((s) => {
    if (!node || !s.project) return false;
    const path = parseNodePath(node.id);
    if (!path || path.scope !== 'instance') return false;
    const override = s.project.nodes[path.ownerId]?.overrides?.[path.defNodeId];
    return override?.styles?.[breakpoint]?.[key] !== undefined;
  });

  const set = useCallback(
    (value: StyleProps[K], options: { coalesce?: boolean } = {}) => {
      if (!node) return;
      // An empty string means "no value" — clear rather than write `""`.
      const next = value === '' ? null : value;
      editStyle(node.id, breakpoint, { [key]: next } as never, {
        coalesce: options.coalesce ?? false,
      });
    },
    [node, breakpoint, key],
  );

  const clear = useCallback(() => {
    if (!node) return;
    editStyle(node.id, breakpoint, { [key]: null } as never, { coalesce: false });
  }, [node, breakpoint, key]);

  return {
    value: resolved.value as StyleProps[K],
    source: resolved.source,
    overridden,
    pinned,
    // A pin is worth marking at every breakpoint, base included — unlike a
    // breakpoint override, where nearly everything is "set here" at base and a
    // dot on every row would say nothing.
    marked: pinned || (overridden && breakpoint !== 'base'),
    inherited: resolved.source !== null && resolved.source !== breakpoint,
    set,
    clear,
  };
}
