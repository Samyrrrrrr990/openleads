/**
 * Pure read helpers over the project graph.
 *
 * Everything here is side-effect free so it can be shared by the canvas,
 * the inspector, Intent Mode and the export generator.
 */

import type {
  Breakpoint,
  ComponentDef,
  ElementNode,
  NodeId,
  NodeOverride,
  PageId,
  PageNode,
  Project,
  ResponsiveStyles,
  StyleProps,
} from './types';
import type { NodePath } from './types';
import { BREAKPOINTS, instancePath, isNodePath, parseNodePath } from './types';

/** The definition an instance node refers to, if it resolves. */
export function componentFor(project: Project, node: ElementNode): ComponentDef | undefined {
  if (node.kind !== 'instance' || !node.componentId) return undefined;
  return project.components?.[node.componentId];
}

/**
 * Lays one instance's overrides over one definition node.
 *
 * Nothing is copied at insert time, so this runs on the way out, every time.
 * That is the property the whole feature rests on: a value nobody has
 * overridden is *read* from the definition rather than remembered from it, so
 * improving the definition improves every instance that has not pinned it.
 *
 * The node reports the composite id it was reached by, so selection, the
 * inspector and the canvas can pass it around as an ordinary id and a write
 * addressed at it lands back on the right override.
 */
export function applyOverride(
  defNode: ElementNode,
  override: NodeOverride | undefined,
  id: NodeId,
  parentId: NodeId | null,
  children: NodeId[],
): ElementNode {
  const node: ElementNode = { ...defNode, id, parentId, children };
  if (!override) return node;

  if (override.text !== undefined) node.text = override.text;
  if (override.props) node.props = { ...defNode.props, ...override.props };
  if (override.styles) {
    const styles: ResponsiveStyles = {};
    for (const bp of BREAKPOINTS) {
      const merged = { ...defNode.styles[bp], ...override.styles[bp] };
      if (Object.keys(merged).length > 0) styles[bp] = merged;
    }
    node.styles = styles;
  }
  if (override.motion !== undefined) {
    if (override.motion === null) delete node.motion;
    else node.motion = override.motion;
  }
  return node;
}

/**
 * Resolves an id that may address a node inside a definition or an instance.
 *
 * Returns undefined rather than throwing for an unresolvable path, matching
 * `project.nodes[id]` for a missing plain id.
 */
export function findNode(project: Project, id: NodeId): ElementNode | undefined {
  if (!isNodePath(id)) return project.nodes[id];

  const path = parseNodePath(id);
  if (!path) return undefined;

  if (path.scope === 'component') {
    const def = project.components?.[path.ownerId];
    const defNode = def?.nodes[path.defNodeId];
    if (!def || !defNode) return undefined;
    return {
      ...defNode,
      parentId: defNode.parentId === null ? null : componentChildId(path.ownerId, defNode.parentId),
      children: defNode.children.map((child) => componentChildId(path.ownerId, child)),
    };
  }

  const instance = project.nodes[path.ownerId];
  if (!instance) return undefined;
  const def = componentFor(project, instance);
  const defNode = def?.nodes[path.defNodeId];
  if (!def || !defNode) return undefined;

  const parentId =
    path.defNodeId === def.rootId
      ? instance.id
      : defNode.parentId === null
        ? instance.id
        : instancePath(instance.id, defNode.parentId);

  return applyOverride(
    defNode,
    instance.overrides?.[path.defNodeId],
    id,
    parentId,
    defNode.children.map((child) => instancePath(instance.id, child)),
  );
}

/**
 * The raw definition node a path points at, with its own identity intact.
 *
 * `findNode` composes a fresh node for every call, which is right for reading
 * and wrong for subscribing to. This returns the stored object, so a renderer
 * can subscribe to it and re-render only when it actually changes.
 */
export function defNodeFor(
  project: Project | null | undefined,
  path: NodePath,
): ElementNode | null {
  if (!project) return null;
  if (path.scope === 'component') {
    return project.components?.[path.ownerId]?.nodes[path.defNodeId] ?? null;
  }
  const instance = project.nodes[path.ownerId];
  if (!instance) return null;
  const def = componentFor(project, instance);
  return def?.nodes[path.defNodeId] ?? null;
}

function componentChildId(componentId: string, defNodeId: NodeId): NodeId {
  return `${componentId}/${defNodeId}`;
}

/**
 * The children of a node as the canvas and layers tree should see them.
 *
 * An instance has no children of its own; what hangs beneath it is the
 * definition's root, addressed through this instance.
 */
export function childIdsOf(project: Project, id: NodeId): NodeId[] {
  const node = findNode(project, id);
  if (!node) return [];
  if (node.kind === 'instance') {
    const def = componentFor(project, node);
    return def ? [instancePath(node.id, def.rootId)] : [];
  }
  return node.children;
}

/** Throws when the id is missing — use only where absence is a real bug. */
export function getNode(project: Project, id: NodeId): ElementNode {
  const node = findNode(project, id);
  if (!node) throw new Error(`Zory: unknown node "${id}"`);
  return node;
}

export function findPage(project: Project, id: PageId): PageNode | undefined {
  return project.pages.find((page) => page.id === id);
}

/** Root node ids, one per page. Roots may never be deleted or moved. */
export function isPageRoot(project: Project, id: NodeId): boolean {
  return project.pages.some((page) => page.rootId === id);
}

/** Ancestors from the immediate parent up to the page root. */
export function ancestorsOf(project: Project, id: NodeId): ElementNode[] {
  const out: ElementNode[] = [];
  const seen = new Set<NodeId>([id]);
  let cursor = findNode(project, id)?.parentId ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = findNode(project, cursor);
    if (!node) break;
    out.push(node);
    cursor = node.parentId;
  }
  return out;
}

/** The node and all of its descendants, parents before children. */
export function subtreeIds(project: Project, rootId: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack: NodeId[] = [rootId];
  const seen = new Set<NodeId>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = findNode(project, id);
    if (!node) continue;
    out.push(id);
    // Push reversed so children come out in document order.
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]!);
    }
  }
  return out;
}

export function subtreeNodes(project: Project, rootId: NodeId): ElementNode[] {
  return subtreeIds(project, rootId)
    .map((id) => findNode(project, id))
    .filter((n): n is ElementNode => Boolean(n));
}

/** True when `maybeAncestor` is at or above `id` in the tree. */
export function isAncestorOf(project: Project, maybeAncestor: NodeId, id: NodeId): boolean {
  if (maybeAncestor === id) return true;
  return ancestorsOf(project, id).some((n) => n.id === maybeAncestor);
}

/**
 * Breakpoints that cascade into `breakpoint`, widest first.
 * mobile resolves through base → tablet → mobile.
 */
export function cascadeFor(breakpoint: Breakpoint): Breakpoint[] {
  const index = BREAKPOINTS.indexOf(breakpoint);
  return BREAKPOINTS.slice(0, index + 1);
}

/**
 * Flattens the override chain into the styles that actually apply at a
 * breakpoint. Base values are never mutated by an override.
 */
export function resolveStyles(styles: ResponsiveStyles, breakpoint: Breakpoint): StyleProps {
  const out: StyleProps = {};
  for (const bp of cascadeFor(breakpoint)) {
    Object.assign(out, styles[bp] ?? {});
  }
  return out;
}

/** The value in effect at a breakpoint, plus where it came from. */
export function resolveStyleValue<K extends keyof StyleProps>(
  styles: ResponsiveStyles,
  breakpoint: Breakpoint,
  key: K,
): { value: StyleProps[K]; source: Breakpoint | null } {
  const chain = cascadeFor(breakpoint);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const bp = chain[i]!;
    const value = styles[bp]?.[key];
    if (value !== undefined) return { value, source: bp };
  }
  return { value: undefined, source: null };
}

/** True when this breakpoint sets its own value for the property. */
export function hasOwnOverride(
  styles: ResponsiveStyles,
  breakpoint: Breakpoint,
  key: keyof StyleProps,
): boolean {
  return styles[breakpoint]?.[key] !== undefined;
}

/** Count of properties a breakpoint overrides. Drives inspector badges. */
export function overrideCount(styles: ResponsiveStyles, breakpoint: Breakpoint): number {
  if (breakpoint === 'base') return 0;
  return Object.keys(styles[breakpoint] ?? {}).length;
}

export function nodeCount(project: Project): number {
  return Object.keys(project.nodes).length;
}

/** A short, human label for a node — used in layers and Intent proposals. */
export function nodeLabel(node: ElementNode): string {
  if (node.name.trim()) return node.name;
  if (node.text?.trim()) return node.text.trim().slice(0, 32);
  return node.kind;
}
