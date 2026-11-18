/**
 * Turning graph nodes into something renderable.
 *
 * Shared by the canvas, the preview and the export generator so all three
 * agree on what a node means.
 */

import type { CSSProperties } from 'react';
import type { AssetNode, Breakpoint, ElementNode, ResponsiveStyles, StyleProps } from '@zory/core';
import { resolveStyles } from '@zory/core';

/** Assets are referenced as `asset:<id>`; anything else is a plain URL. */
export const ASSET_PREFIX = 'asset:';

export function resolveSrc(src: string | undefined, assets: AssetNode[]): string {
  if (!src) return '';
  if (!src.startsWith(ASSET_PREFIX)) return src;
  const id = src.slice(ASSET_PREFIX.length);
  return assets.find((asset) => asset.id === id)?.src ?? '';
}

/**
 * The style object for a node at a breakpoint. Keys already match React's
 * camelCase CSS properties, so this is a cascade flatten and nothing more.
 */
export function toCssProperties(styles: ResponsiveStyles, breakpoint: Breakpoint): CSSProperties {
  return resolveStyles(styles, breakpoint) as CSSProperties;
}

/** The HTML element a node renders as. */
export function tagFor(node: ElementNode): string {
  switch (node.kind) {
    case 'container':
      return node.props.tag ?? 'div';
    case 'heading':
      return `h${node.props.level ?? 2}`;
    case 'text':
      return 'p';
    case 'button':
      return 'button';
    case 'link':
      return 'a';
    case 'image':
      return 'img';
    case 'divider':
      return 'hr';
    case 'instance':
      // Transparent in the DOM: what renders beneath it is the definition.
      return 'div';
    default: {
      const exhaustive: never = node.kind;
      throw new Error(`Zory: unknown node kind ${String(exhaustive)}`);
    }
  }
}

/**
 * A node is invisible at this breakpoint when the cascade resolves display to
 * none. Used by the layers panel to mark hidden nodes.
 */
export function isHiddenAt(styles: ResponsiveStyles, breakpoint: Breakpoint): boolean {
  return (resolveStyles(styles, breakpoint) as StyleProps).display === 'none';
}
