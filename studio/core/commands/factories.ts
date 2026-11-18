/**
 * Command factories.
 *
 * Ids are minted here rather than inside `applyCommand`, so a command fully
 * describes its own effect and can be replayed, serialised or previewed in an
 * Intent proposal before anything is mutated.
 */

import type {
  Breakpoint,
  ComponentDef,
  ComponentDefId,
  ElementNode,
  NodeId,
  NodeKind,
  NodeOverride,
  Project,
  StylePatch,
} from '../graph/types';
import type { ProjectTheme } from '../graph/types';
import type { NodeMotion } from '../motion/types';
import { getNode, subtreeIds, subtreeNodes } from '../graph/selectors';
import { newComponentId, newNodeId } from '../graph/ids';
import type {
  DuplicateNodeCommand,
  InsertNodeCommand,
  MoveNodeCommand,
  ZoryCommand,
} from './types';

export const setText = (nodeId: NodeId, text: string): ZoryCommand => ({
  type: 'SET_TEXT',
  nodeId,
  text,
});

export const setStyle = (
  nodeId: NodeId,
  breakpoint: Breakpoint,
  patch: StylePatch,
): ZoryCommand => ({ type: 'SET_STYLE', nodeId, breakpoint, patch });

export const setMotion = (nodeId: NodeId, motion: NodeMotion | null): ZoryCommand => ({
  type: 'SET_MOTION',
  nodeId,
  motion,
});

export const setTheme = (patch: Partial<ProjectTheme>): ZoryCommand => ({
  type: 'SET_THEME',
  patch,
});

export const renameNode = (nodeId: NodeId, name: string): ZoryCommand => ({
  type: 'RENAME_NODE',
  nodeId,
  name,
});

export const deleteNode = (nodeId: NodeId): ZoryCommand => ({ type: 'DELETE_NODE', nodeId });

export function duplicateNode(project: Project, nodeId: NodeId): DuplicateNodeCommand {
  const idMap: Record<NodeId, NodeId> = {};
  for (const id of subtreeIds(project, nodeId)) idMap[id] = newNodeId();
  return { type: 'DUPLICATE_NODE', nodeId, idMap };
}

export function moveNode(nodeId: NodeId, parentId: NodeId, index: number): MoveNodeCommand {
  return { type: 'MOVE_NODE', nodeId, parentId, index };
}

/** Blueprint for a new node before ids are assigned. */
export interface NodeBlueprint {
  kind: NodeKind;
  name: string;
  text?: string;
  props?: ElementNode['props'];
  styles?: ElementNode['styles'];
  /*
   * Motion travels with the blueprint so a starter can ship animated. Without
   * it `materialise` produced resting nodes and every template was static no
   * matter what its author intended.
   */
  motion?: NodeMotion;
  /** Set only for `kind: 'instance'`: the definition being referred to. */
  componentId?: ComponentDefId;
  /**
   * Set only for `kind: 'instance'`: the *key* of a component declared in the
   * same blueprint, resolved to a minted id when the project is created.
   *
   * A starter is written before any id exists, so it cannot name a
   * `ComponentDefId` — and it must not invent a fixed one, because two projects
   * opened from the same starter have to be independent graphs. A key is the
   * indirection that lets a template say "an instance of the feature cell I
   * also declared" without either problem. Ignored when `componentId` is
   * already set, which is the editor's path.
   */
  componentKey?: string;
  /**
   * Names this node inside the component definition it belongs to, so an
   * instance elsewhere in the blueprint can pin a value on it.
   *
   * The same problem as `componentKey`, one level down: overrides key on the
   * definition's node ids, and a template is written before those exist. A slot
   * is an author-chosen handle — `'title'`, `'body'` — rather than the node's
   * `name`, which is user-facing and free to repeat.
   *
   * Creation-time only. By the time the project exists every override is keyed
   * by the definition node id it named, which is what makes it survive the
   * definition being restructured around it.
   */
  slot?: string;
  /**
   * Set only for `kind: 'instance'`: values pinned on this instance, keyed by
   * the slots of the definition it refers to.
   *
   * This is how a template places six cells that share one definition and
   * differ in their words: the structure is defined once, and what differs is a
   * pin. Editing the definition still moves all six.
   */
  overrides?: Record<string, NodeOverride>;
  children?: NodeBlueprint[];
}

/**
 * What a blueprint needs to resolve its component references: the id minted for
 * each key, and the node id minted for each slot within it.
 */
export interface ComponentContext {
  ids: Readonly<Record<string, ComponentDefId>>;
  slots: Readonly<Record<string, Readonly<Record<string, NodeId>>>>;
}

const NO_COMPONENTS: ComponentContext = { ids: {}, slots: {} };

/** Rekeys slot-keyed overrides onto the definition node ids they name. */
function resolveOverrides(
  bp: NodeBlueprint,
  context: ComponentContext,
): Record<NodeId, NodeOverride> | undefined {
  if (!bp.overrides || !bp.componentKey) return undefined;
  const slots = context.slots[bp.componentKey] ?? {};
  const out: Record<NodeId, NodeOverride> = {};

  for (const [slot, override] of Object.entries(bp.overrides)) {
    // An override naming a slot the definition does not have would silently do
    // nothing, and the instance would render the definition's placeholder copy
    // — a template that looks finished and is not. Loud is better.
    const defNodeId = slots[slot];
    if (!defNodeId) throw new Error(`Zory: component "${bp.componentKey}" has no slot "${slot}"`);
    out[defNodeId] = structuredClone(override);
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Flattens a blueprint tree into concrete nodes with freshly minted ids.
 *
 * Returns the slot map alongside, so a caller materialising a component
 * definition can tell instances which node each of its slots became.
 */
export function materialise(
  blueprint: NodeBlueprint,
  parentId: NodeId | null,
  context: ComponentContext = NO_COMPONENTS,
): { nodes: ElementNode[]; rootId: NodeId; slots: Record<string, NodeId> } {
  const nodes: ElementNode[] = [];
  const slots: Record<string, NodeId> = {};

  const walk = (bp: NodeBlueprint, parent: NodeId | null): NodeId => {
    const id = newNodeId();
    const childIds = (bp.children ?? []).map((child) => walk(child, id));
    const componentId = bp.componentId ?? (bp.componentKey ? context.ids[bp.componentKey] : undefined);
    const overrides = resolveOverrides(bp, context);

    if (bp.slot) {
      if (slots[bp.slot]) throw new Error(`Zory: duplicate slot "${bp.slot}"`);
      slots[bp.slot] = id;
    }

    nodes.push({
      id,
      kind: bp.kind,
      name: bp.name,
      parentId: parent,
      children: childIds,
      ...(bp.text !== undefined ? { text: bp.text } : {}),
      ...(bp.motion ? { motion: structuredClone(bp.motion) } : {}),
      ...(componentId ? { componentId } : {}),
      ...(overrides ? { overrides } : {}),
      props: bp.props ? structuredClone(bp.props) : {},
      styles: bp.styles ? structuredClone(bp.styles) : {},
    });
    return id;
  };

  const rootId = walk(blueprint, parentId);
  return { nodes, rootId, slots };
}

export function insertNode(
  blueprint: NodeBlueprint,
  parentId: NodeId,
  index: number,
): InsertNodeCommand {
  const { nodes, rootId } = materialise(blueprint, parentId);
  return { type: 'INSERT_NODE', nodes, rootId, parentId, index };
}

/**
 * Works out where a new node should land given the current selection: inside
 * the selection when it can hold children, otherwise directly after it.
 */
/**
 * Clones a detached subtree under fresh ids.
 *
 * `duplicateNode` does this inside one project, where every id is already
 * known. This is the other case: a subtree that arrived from somewhere else —
 * a saved section, a template, a paste from another project — where the ids in
 * it may collide with ids already in the destination, or may not.
 *
 * Rather than checking, everything is remapped. Two copies of the same saved
 * section inserted into one page have to end up as two independent subtrees,
 * and that is only true if new ids are minted every time.
 */
export function remapSubtree(
  nodes: ElementNode[],
  rootId: NodeId,
): { nodes: ElementNode[]; rootId: NodeId } {
  const idMap = new Map<NodeId, NodeId>();
  for (const node of nodes) idMap.set(node.id, newNodeId());

  const remapped = nodes.map((node) => ({
    ...structuredClone(node),
    id: idMap.get(node.id)!,
    parentId: node.parentId ? (idMap.get(node.parentId) ?? null) : null,
    children: node.children.map((childId) => idMap.get(childId) ?? childId).filter(Boolean),
  }));

  return { nodes: remapped, rootId: idMap.get(rootId)! };
}

export const createComponent = (def: ComponentDef): ZoryCommand => ({
  type: 'CREATE_COMPONENT',
  def,
});

export const deleteComponent = (def: ComponentDef): ZoryCommand => ({
  type: 'DELETE_COMPONENT',
  componentId: def.id,
  def,
});

export const setOverride = (
  nodeId: NodeId,
  defNodeId: NodeId,
  override: NodeOverride | null,
): ZoryCommand => ({ type: 'SET_OVERRIDE', nodeId, defNodeId, override });

/** A blueprint for an instance node. Insert it with `insertNode`. */
export function instanceBlueprint(componentId: ComponentDefId, name: string): NodeBlueprint {
  return { kind: 'instance', name, componentId };
}

/**
 * Lifts a page subtree into a definition.
 *
 * Ids are remapped, so the definition is independent of the subtree it was
 * taken from: deleting that subtree afterwards cannot reach into the
 * definition, and two definitions made from the same section do not collide.
 */
export function componentFromSubtree(
  project: Project,
  nodeId: NodeId,
  name: string,
  now = Date.now(),
): ComponentDef {
  const source = subtreeNodes(project, nodeId);
  const { nodes, rootId } = remapSubtree(source, nodeId);
  const map: Record<NodeId, ElementNode> = {};
  for (const node of nodes) map[node.id] = node;
  // The definition's root has no parent; it hangs from whatever instances it.
  const root = map[rootId];
  if (root) root.parentId = null;
  return { id: newComponentId(), name, rootId, nodes: map, createdAt: now, updatedAt: now };
}

export function insertionPointFor(
  project: Project,
  selectedId: NodeId | null,
  fallbackParentId: NodeId,
): { parentId: NodeId; index: number } {
  if (!selectedId) {
    const parent = getNode(project, fallbackParentId);
    return { parentId: fallbackParentId, index: parent.children.length };
  }

  const selected = getNode(project, selectedId);
  if (selected.kind === 'container') {
    return { parentId: selectedId, index: selected.children.length };
  }

  const parentId = selected.parentId ?? fallbackParentId;
  const parent = getNode(project, parentId);
  return { parentId, index: parent.children.indexOf(selectedId) + 1 };
}
