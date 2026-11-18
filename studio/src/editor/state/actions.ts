/**
 * Editor actions that span both stores.
 *
 * Anything needing to change the graph *and* the selection lives here, so the
 * two stores stay independent of each other. Components call these instead of
 * poking at store internals.
 */

import type {
  Breakpoint,
  NodeBlueprint,
  NodeId,
  NodeProps,
  StylePatch,
  ZoryCommand,
} from '@zory/core';
import {
  componentFromSubtree,
  createComponent,
  findNode,
  instanceBlueprint,
  isAncestorOf,
  isPageRoot,
  parseNodePath,
  subtreeIds,
  deleteNode,
  duplicateNode as duplicateNodeCommand,
  insertNode,
  insertionPointFor,
  moveNode,
  renameNode,
  setStyle,
  setText,
} from '@zory/core';
import { useProjectStore, type RunResult } from './projectStore';
import { useUiStore } from './uiStore';

/** A prop patch where `null` clears the property. */
export type NodePropPatch = Partial<Record<keyof NodeProps, NodeProps[keyof NodeProps] | null>>;

export function editText(nodeId: NodeId, text: string): RunResult {
  return useProjectStore.getState().run([setText(nodeId, text)], {
    label: 'Edit text',
    // Coalesce a typing burst on one node into a single undo step.
    coalesceKey: `SET_TEXT:${nodeId}`,
  });
}

export function editStyle(
  nodeId: NodeId,
  breakpoint: Breakpoint,
  patch: StylePatch,
  options: { coalesce?: boolean } = {},
): RunResult {
  const keys = Object.keys(patch).sort().join(',');
  return useProjectStore.getState().run([setStyle(nodeId, breakpoint, patch)], {
    coalesceKey: options.coalesce === false ? null : `SET_STYLE:${nodeId}:${breakpoint}:${keys}`,
  });
}

export function editProp(nodeId: NodeId, patch: NodePropPatch): RunResult {
  return useProjectStore.getState().run([{ type: 'SET_PROP', nodeId, patch }]);
}

export function rename(nodeId: NodeId, name: string): RunResult {
  return useProjectStore.getState().run([renameNode(nodeId, name)]);
}

export function renameProjectTo(name: string): RunResult {
  return useProjectStore.getState().run([{ type: 'SET_PROJECT_NAME', name }], {
    label: 'Rename project',
    coalesceKey: 'SET_PROJECT_NAME',
  });
}

/**
 * Deletes a node and moves the selection somewhere sensible — the next
 * sibling, or the parent when there is none. Selection is never left dangling.
 */
export function deleteSelected(nodeId: NodeId): RunResult {
  const { project, run } = useProjectStore.getState();
  if (!project) return { ok: false, reason: 'No project is open.' };

  const node = findNode(project, nodeId);
  if (!node) return { ok: false, reason: 'That element no longer exists.' };
  if (isPageRoot(project, nodeId)) return { ok: false, reason: 'The page itself cannot be deleted.' };

  const parentId = node.parentId;
  const siblings = parentId ? (findNode(project, parentId)?.children ?? []) : [];
  const position = siblings.indexOf(nodeId);
  const nextSelection = siblings[position + 1] ?? siblings[position - 1] ?? parentId ?? null;

  const result = run([{ type: 'DELETE_NODE', nodeId }], { label: 'Delete element' });
  if (result.ok) {
    const ui = useUiStore.getState();
    ui.select(nextSelection);
    if (ui.hoveredId === nodeId) ui.hover(null);
    if (ui.editingTextId === nodeId) ui.endTextEdit();
  }
  return result;
}

/** Duplicates a node and selects the copy, which is what users expect. */
export function duplicateSelected(nodeId: NodeId): RunResult {
  const { project, run } = useProjectStore.getState();
  if (!project) return { ok: false, reason: 'No project is open.' };
  if (isPageRoot(project, nodeId)) return { ok: false, reason: 'The page itself cannot be duplicated.' };

  const command = duplicateNodeCommand(project, nodeId);
  const result = run([command], { label: 'Duplicate element' });
  if (result.ok) {
    const cloneId = command.idMap[nodeId];
    if (cloneId) useUiStore.getState().select(cloneId);
  }
  return result;
}

/** Inserts a blueprint relative to the current selection and selects it. */
export function insertBlueprint(blueprint: NodeBlueprint): RunResult {
  const { project, run } = useProjectStore.getState();
  if (!project) return { ok: false, reason: 'No project is open.' };

  const ui = useUiStore.getState();
  const page = project.pages.find((p) => p.id === ui.pageId) ?? project.pages[0];
  if (!page) return { ok: false, reason: 'This project has no pages.' };

  const { parentId, index } = insertionPointFor(project, ui.selectedId, page.rootId);
  const command = insertNode(blueprint, parentId, index);
  const result = run([command], { label: `Add ${blueprint.name}` });
  if (result.ok) {
    ui.select(command.rootId);
    ui.expand([parentId]);
  }
  return result;
}

/**
 * Turns the selected subtree into a reusable component, in place.
 *
 * Composed from commands that already exist — define, insert the instance
 * where the node is, delete the original — rather than one COMPONENTISE
 * command. Same argument as `groupSelected`: this is not a new kind of change
 * to a project, and expressing it as ordinary ones means it undoes, exports
 * and round-trips with no special handling. All three land in one history
 * entry, so a single undo takes it back.
 */
export function componentiseSelected(nodeId: NodeId, name?: string): RunResult {
  const { project, run } = useProjectStore.getState();
  if (!project) return { ok: false, reason: 'No project is open.' };
  if (isPageRoot(project, nodeId)) {
    return { ok: false, reason: 'A page cannot become a component.' };
  }
  if (parseNodePath(nodeId)) {
    return { ok: false, reason: 'That is already part of a component.' };
  }

  const node = findNode(project, nodeId);
  if (!node) return { ok: false, reason: 'That element no longer exists.' };
  if (node.kind === 'instance') return { ok: false, reason: 'That is already an instance.' };

  const parentId = node.parentId;
  if (!parentId) return { ok: false, reason: 'That element cannot become a component.' };
  const index = findNode(project, parentId)?.children.indexOf(nodeId) ?? -1;
  if (index < 0) return { ok: false, reason: 'That element is not attached to the page.' };

  const def = componentFromSubtree(project, nodeId, name?.trim() || node.name || 'Component');
  const insert = insertNode(instanceBlueprint(def.id, def.name), parentId, index);

  /*
   * Order matters and is checked by the batch validator as it goes: the
   * instance is inserted at the original's index, which pushes the original to
   * index + 1, and the delete then removes it by id. The instance ends up
   * exactly where the subtree was.
   */
  const result = run([createComponent(def), insert, deleteNode(nodeId)], {
    label: `Create component ${def.name}`,
  });
  if (result.ok) useUiStore.getState().select(insert.rootId);
  return result;
}

/** Adds an instance of an existing component next to the selection. */
export function insertInstance(componentId: string): RunResult {
  const { project } = useProjectStore.getState();
  if (!project) return { ok: false, reason: 'No project is open.' };
  const def = project.components?.[componentId];
  if (!def) return { ok: false, reason: 'That component no longer exists.' };
  return insertBlueprint(instanceBlueprint(def.id, def.name));
}

/**
 * Wraps the selection in a new container, in place.
 *
 * Composed from the commands that already exist — insert the wrapper where the
 * node is, then move the node inside it — rather than adding a GROUP command.
 * That is the cheaper design and the more honest one: grouping is not a new
 * kind of change to a project, it is two ordinary ones, and expressing it that
 * way means it undoes, exports and round-trips with no special handling.
 *
 * Both commands land in a single history entry, so one undo takes it back.
 */
export function groupSelected(nodeId: NodeId): RunResult {
  const { project, run } = useProjectStore.getState();
  if (!project) return { ok: false, reason: 'No project is open.' };

  const node = findNode(project, nodeId);
  if (!node) return { ok: false, reason: 'That element no longer exists.' };
  if (isPageRoot(project, nodeId)) return { ok: false, reason: 'A page cannot be grouped.' };

  const parentId = node.parentId;
  if (!parentId) return { ok: false, reason: 'That element has nothing to group inside.' };

  const parent = findNode(project, parentId);
  const index = parent?.children.indexOf(nodeId) ?? 0;

  /*
   * The wrapper inherits nothing.
   *
   * A group that copied the child's padding, background or width would move
   * the page the moment it was created, and a "group" that changes the layout
   * is not a group. It is a transparent box: display block, no styles.
   */
  const wrap = insertNode(
    { kind: 'container', name: 'Group', props: { tag: 'div' }, styles: {}, children: [] },
    parentId,
    index,
  );

  const result = run([wrap, moveNode(nodeId, wrap.rootId, 0)], { label: 'Group' });
  if (result.ok) {
    useUiStore.getState().select(wrap.rootId);
    useUiStore.getState().expand([parentId, wrap.rootId]);
  }
  return result;
}

/**
 * Dissolves a container, leaving its children where they were.
 *
 * Children move out one at a time in order, then the empty container is
 * deleted — again, existing commands only. Styles on the container are lost,
 * which is the correct behaviour and worth being clear about: ungrouping a box
 * that had padding removes that padding, because the box is gone.
 */
export function ungroupSelected(nodeId: NodeId): RunResult {
  const { project, run } = useProjectStore.getState();
  if (!project) return { ok: false, reason: 'No project is open.' };

  const node = findNode(project, nodeId);
  if (!node) return { ok: false, reason: 'That element no longer exists.' };
  if (isPageRoot(project, nodeId)) return { ok: false, reason: 'A page cannot be ungrouped.' };
  if (node.kind !== 'container') return { ok: false, reason: 'Only a container can be ungrouped.' };
  if (node.children.length === 0) return { ok: false, reason: 'That container is empty.' };

  const parentId = node.parentId;
  if (!parentId) return { ok: false, reason: 'That element has no parent to move into.' };

  const parent = findNode(project, parentId);
  const at = parent?.children.indexOf(nodeId) ?? 0;

  const commands: ZoryCommand[] = node.children.map((childId, offset) =>
    moveNode(childId, parentId, at + offset),
  );
  commands.push(deleteNode(nodeId));

  const first = node.children[0];
  const result = run(commands, { label: 'Ungroup' });
  if (result.ok && first) useUiStore.getState().select(first);
  return result;
}

export function reorder(nodeId: NodeId, parentId: NodeId, index: number): RunResult {
  return useProjectStore.getState().run([moveNode(nodeId, parentId, index)], { label: 'Move element' });
}

/**
 * Adds or removes a node from the selection, and keeps it legal.
 *
 * Two rules, both about not producing a selection nothing can act on:
 * a page root is never part of a multi-selection, and neither is an ancestor
 * of something already selected — moving a parent and its child together
 * means applying the same change twice to the child.
 */
export function toggleSelection(nodeId: NodeId): void {
  const project = useProjectStore.getState().project;
  const ui = useUiStore.getState();
  if (!project) return;

  if (isPageRoot(project, nodeId)) {
    ui.select(nodeId);
    return;
  }

  if (ui.selectedIds.includes(nodeId)) {
    ui.toggleSelected(nodeId);
    return;
  }

  const next = ui.selectedIds.filter(
    (id) => !isPageRoot(project, id) && !isAncestorOf(project, id, nodeId) && !isAncestorOf(project, nodeId, id),
  );
  ui.selectMany([...next, nodeId]);
}

/** Selects a node and reveals it in the layers tree. */
export function selectAndReveal(nodeId: NodeId | null): void {
  const ui = useUiStore.getState();
  ui.select(nodeId);
  if (!nodeId) return;

  const project = useProjectStore.getState().project;
  if (!project) return;

  const ancestors: NodeId[] = [];
  let cursor = findNode(project, nodeId)?.parentId ?? null;
  const guard = new Set<NodeId>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    ancestors.push(cursor);
    cursor = findNode(project, cursor)?.parentId ?? null;
  }
  ui.expand(ancestors);
}

/** Clears selection state that points at nodes which no longer exist. */
export function pruneSelection(): void {
  const project = useProjectStore.getState().project;
  const ui = useUiStore.getState();
  if (!project) return;
  if (ui.selectedId && !project.nodes[ui.selectedId]) ui.select(null);
  if (ui.hoveredId && !project.nodes[ui.hoveredId]) ui.hover(null);
  if (ui.editingTextId && !project.nodes[ui.editingTextId]) ui.endTextEdit();
}

/** Ids of the node and everything under it — used to guard reparenting. */
export function descendantsOf(nodeId: NodeId): NodeId[] {
  const project = useProjectStore.getState().project;
  return project ? subtreeIds(project, nodeId) : [];
}


// ---- Multi-selection ---------------------------------------------------------

/**
 * The selected nodes, in document order, filtered to what can be acted on.
 *
 * Document order rather than click order, because "distribute" and "align"
 * both read as spatial operations and a user who clicked right-to-left still
 * expects left-to-right behaviour.
 */
export function selectedNodes(): NodeId[] {
  const project = useProjectStore.getState().project;
  const ui = useUiStore.getState();
  if (!project) return [];
  return ui.selectedIds.filter((id) => project.nodes[id] && !isPageRoot(project, id));
}

/** True when every selection shares one parent — required by align. */
export function shareOneParent(ids: NodeId[]): boolean {
  const project = useProjectStore.getState().project;
  if (!project || ids.length < 2) return false;
  const parents = new Set(ids.map((id) => project.nodes[id]?.parentId ?? null));
  return parents.size === 1 && !parents.has(null);
}

/**
 * Applies one style patch to every selected node, as a single undo step.
 *
 * The batch is what matters. Setting a size across six elements should be one
 * thing to undo, not six, and running them through `run` together is what
 * makes it so.
 */
export function editStyleAcross(
  nodeIds: NodeId[],
  breakpoint: Breakpoint,
  patch: StylePatch,
  options: { coalesce?: boolean; label?: string } = {},
): RunResult {
  if (nodeIds.length === 0) return { ok: false, reason: 'Nothing is selected.' };

  const keys = Object.keys(patch).sort().join(',');
  return useProjectStore.getState().run(
    nodeIds.map((nodeId) => setStyle(nodeId, breakpoint, patch)),
    {
      ...(options.label ? { label: options.label } : {}),
      coalesceKey:
        options.coalesce === false ? null : `SET_STYLE:${nodeIds.join(',')}:${breakpoint}:${keys}`,
    },
  );
}

/** Deletes everything selected, as one step, and clears the selection. */
export function deleteSelection(nodeIds: NodeId[]): RunResult {
  const project = useProjectStore.getState().project;
  if (!project || nodeIds.length === 0) return { ok: false, reason: 'Nothing is selected.' };

  const removable = nodeIds.filter((id) => project.nodes[id] && !isPageRoot(project, id));
  if (removable.length === 0) return { ok: false, reason: 'A page cannot be deleted.' };

  const result = useProjectStore.getState().run(
    removable.map((nodeId) => deleteNode(nodeId)),
    { label: removable.length === 1 ? 'Delete element' : `Delete ${removable.length} elements` },
  );
  if (result.ok) useUiStore.getState().select(null);
  return result;
}
