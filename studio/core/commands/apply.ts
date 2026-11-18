/**
 * Command application and inversion.
 *
 * `applyCommand` is a pure function over the project graph — it uses Immer so
 * untouched branches keep their identity, which is what lets the canvas
 * re-render only the nodes that actually changed.
 *
 * Inverses are computed against the *pre-apply* project. Undo therefore never
 * has to guess what a command overwrote.
 */

import { produce } from 'immer';
import type {
  Breakpoint,
  ElementNode,
  NodeId,
  NodeProps,
  NodeOverride,
  Project,
  ProjectTheme,
  ResponsiveStyles,
  StyleProps,
} from '../graph/types';
import { isNodePath, parseNodePath } from '../graph/types';
import { getNode, subtreeNodes } from '../graph/selectors';
import type { DeleteNodeCommand, InsertNodeCommand, ZoryCommand } from './types';

/** Removes `id` from its parent's child list. No-op when it has no parent. */
function detach(draft: Project, id: NodeId): void {
  const node = draft.nodes[id];
  if (!node?.parentId) return;
  const parent = draft.nodes[node.parentId];
  if (!parent) return;
  const at = parent.children.indexOf(id);
  if (at >= 0) parent.children.splice(at, 1);
}

/**
 * Applies a patch where `null` deletes the key and `undefined` is ignored.
 * Empty breakpoint buckets are pruned so serialised projects stay tidy and
 * `overrideCount` stays honest.
 */
function patchStyles(
  node: { styles: ResponsiveStyles },
  breakpoint: Breakpoint,
  patch: Record<string, unknown>,
): void {
  node.styles[breakpoint] ??= {};
  const bucket = node.styles[breakpoint] as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete bucket[key];
    else if (value !== undefined) bucket[key] = value;
  }
  if (Object.keys(bucket).length === 0) delete node.styles[breakpoint];
}

/**
 * The four fields a content mutation can write, on either an ordinary node or
 * an instance's override record.
 *
 * `ElementNode` and `NodeOverride` deliberately name these the same, which is
 * what lets `SET_TEXT`, `SET_STYLE`, `SET_PROP` and `SET_MOTION` address a
 * node inside an instance without gaining an instance-aware twin each.
 */
interface MutableSurface {
  text?: string;
  props?: NodeProps;
  styles?: ResponsiveStyles;
  motion?: unknown;
}

/**
 * Resolves where a mutation addressed at `nodeId` should land.
 *
 * A plain id writes to the node. `c_x/n_y` writes to the definition, and so
 * changes every instance that has not pinned that value. `n_i/n_y` writes to
 * that one instance's overrides, pinning it there and leaving the definition
 * and every other instance untouched.
 *
 * Override records are created on demand: a write is what makes a pin exist.
 */
function surfaceFor(draft: Project, nodeId: NodeId): MutableSurface | null {
  if (!isNodePath(nodeId)) return draft.nodes[nodeId] ?? null;

  const path = parseNodePath(nodeId);
  if (!path) return null;

  if (path.scope === 'component') {
    return draft.components?.[path.ownerId]?.nodes[path.defNodeId] ?? null;
  }

  const instance = draft.nodes[path.ownerId];
  if (!instance || instance.kind !== 'instance' || !instance.componentId) return null;
  const def = draft.components?.[instance.componentId];
  if (!def?.nodes[path.defNodeId]) return null;

  instance.overrides ??= {};
  instance.overrides[path.defNodeId] ??= {};
  return instance.overrides[path.defNodeId] as NodeOverride;
}

export function applyCommand(project: Project, command: ZoryCommand): Project {
  return produce(project, (draft) => {
    switch (command.type) {
      case 'SET_TEXT': {
        const target = surfaceFor(draft, command.nodeId);
        if (target) target.text = command.text;
        break;
      }

      case 'SET_STYLE': {
        const target = surfaceFor(draft, command.nodeId);
        if (!target) break;
        target.styles ??= {};
        patchStyles(
          target as { styles: ResponsiveStyles },
          command.breakpoint,
          command.patch as Record<string, unknown>,
        );
        break;
      }

      case 'SET_PROP': {
        const target = surfaceFor(draft, command.nodeId);
        if (!target) break;
        target.props ??= {};
        const props = target.props as Record<string, unknown>;
        for (const [key, value] of Object.entries(command.patch)) {
          if (value === null) delete props[key];
          else if (value !== undefined) props[key] = value;
        }
        break;
      }

      case 'SET_MOTION': {
        const target = surfaceFor(draft, command.nodeId);
        if (!target) break;
        /*
         * On an override, null is a value rather than an absence: "this
         * instance does not move", as distinct from "follow the definition",
         * which is what leaving it out means.
         */
        if (command.motion === null) {
          if (isNodePath(command.nodeId) && parseNodePath(command.nodeId)?.scope === 'instance') {
            target.motion = null;
          } else {
            delete target.motion;
          }
        } else {
          target.motion = structuredClone(command.motion);
        }
        break;
      }

      case 'SET_THEME': {
        for (const [key, value] of Object.entries(command.patch)) {
          if (value === undefined) continue;
          (draft.settings.theme as Record<string, unknown>)[key] = value;
        }
        break;
      }

      case 'RENAME_NODE': {
        const node = draft.nodes[command.nodeId];
        if (node) node.name = command.name;
        break;
      }

      case 'SET_PROJECT_NAME': {
        draft.name = command.name;
        break;
      }

      case 'INSERT_NODE': {
        for (const node of command.nodes) {
          // Structured-clone so the command stays reusable after insertion.
          draft.nodes[node.id] = structuredClone(node);
        }
        const root = draft.nodes[command.rootId];
        const parent = draft.nodes[command.parentId];
        if (!root || !parent) break;
        root.parentId = command.parentId;
        parent.children.splice(command.index, 0, command.rootId);
        break;
      }

      case 'DELETE_NODE': {
        const doomed = subtreeNodes(project, command.nodeId).map((n) => n.id);
        detach(draft, command.nodeId);
        for (const id of doomed) delete draft.nodes[id];
        break;
      }

      case 'MOVE_NODE': {
        const node = draft.nodes[command.nodeId];
        const parent = draft.nodes[command.parentId];
        if (!node || !parent) break;
        detach(draft, command.nodeId);
        node.parentId = command.parentId;
        parent.children.splice(command.index, 0, command.nodeId);
        break;
      }

      case 'DUPLICATE_NODE': {
        const source = project.nodes[command.nodeId];
        if (!source?.parentId) break;
        const parent = draft.nodes[source.parentId];
        if (!parent) break;

        for (const node of subtreeNodes(project, command.nodeId)) {
          const cloneId = command.idMap[node.id];
          if (!cloneId) continue;
          const clone = structuredClone(node) as ElementNode;
          clone.id = cloneId;
          clone.parentId = node.parentId ? (command.idMap[node.parentId] ?? node.parentId) : null;
          clone.children = node.children.map((child) => command.idMap[child] ?? child);
          draft.nodes[cloneId] = clone;
        }

        const cloneRootId = command.idMap[command.nodeId];
        const cloneRoot = cloneRootId ? draft.nodes[cloneRootId] : undefined;
        if (!cloneRootId || !cloneRoot) break;
        cloneRoot.parentId = source.parentId;
        cloneRoot.name = `${source.name} copy`;
        parent.children.splice(parent.children.indexOf(command.nodeId) + 1, 0, cloneRootId);
        break;
      }

      case 'ADD_ASSET': {
        draft.assets.push(structuredClone(command.asset));
        break;
      }

      case 'REMOVE_ASSET': {
        const at = draft.assets.findIndex((asset) => asset.id === command.assetId);
        if (at >= 0) draft.assets.splice(at, 1);
        break;
      }

      case 'CREATE_COMPONENT': {
        draft.components ??= {};
        draft.components[command.def.id] = structuredClone(command.def);
        break;
      }

      case 'DELETE_COMPONENT': {
        if (draft.components) delete draft.components[command.componentId];
        break;
      }

      case 'SET_OVERRIDE': {
        const instance = draft.nodes[command.nodeId];
        if (!instance) break;
        if (command.override === null) {
          if (instance.overrides) {
            delete instance.overrides[command.defNodeId];
            if (Object.keys(instance.overrides).length === 0) delete instance.overrides;
          }
        } else {
          instance.overrides ??= {};
          instance.overrides[command.defNodeId] = structuredClone(command.override);
        }
        break;
      }

      default: {
        const exhaustive: never = command;
        throw new Error(`Zory: cannot apply unknown command ${JSON.stringify(exhaustive)}`);
      }
    }
  });
}

/**
 * Builds the command that undoes `command`, evaluated against the project as
 * it stands *before* the command runs.
 */
/**
 * The command that restores an instance's pins for one definition node.
 *
 * Every mutation aimed at a node inside an instance inverts to this. Inverting
 * them field by field would mean reading the *resolved* node — definition
 * merged with pins — and writing what it said back as a pin. Undo would then
 * leave the node pinned to a value it had only inherited, quietly cutting it
 * off from the definition. Restoring the record that was actually there says
 * "there was no pin here" precisely, and is the whole reason `SET_OVERRIDE`
 * exists.
 */
function invertToOverride(project: Project, nodeId: NodeId): ZoryCommand | null {
  const path = parseNodePath(nodeId);
  if (!path || path.scope !== 'instance') return null;
  const instance = project.nodes[path.ownerId];
  if (!instance) return null;
  const before = instance.overrides?.[path.defNodeId];
  return {
    type: 'SET_OVERRIDE',
    nodeId: path.ownerId,
    defNodeId: path.defNodeId,
    override: before ? structuredClone(before) : null,
  };
}

export function invertCommand(project: Project, command: ZoryCommand): ZoryCommand {
  if ('nodeId' in command && typeof command.nodeId === 'string' && command.type !== 'SET_OVERRIDE') {
    const asOverride = invertToOverride(project, command.nodeId);
    if (asOverride) return asOverride;
  }

  switch (command.type) {
    case 'SET_TEXT': {
      const node = getNode(project, command.nodeId);
      return { type: 'SET_TEXT', nodeId: command.nodeId, text: node.text ?? '' };
    }

    case 'SET_STYLE': {
      const node = getNode(project, command.nodeId);
      const before = node.styles[command.breakpoint] ?? {};
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(command.patch)) {
        const previous = (before as Record<string, unknown>)[key];
        // `null` restores "no override at this breakpoint".
        patch[key] = previous === undefined ? null : previous;
      }
      return {
        type: 'SET_STYLE',
        nodeId: command.nodeId,
        breakpoint: command.breakpoint,
        patch: patch as InvertedStylePatch,
      };
    }

    case 'SET_PROP': {
      const node = getNode(project, command.nodeId);
      const before = node.props as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(command.patch)) {
        const previous = before[key];
        patch[key] = previous === undefined ? null : previous;
      }
      return { type: 'SET_PROP', nodeId: command.nodeId, patch: patch as NodePropPatch };
    }

    case 'SET_MOTION': {
      const node = getNode(project, command.nodeId);
      return {
        type: 'SET_MOTION',
        nodeId: command.nodeId,
        motion: node.motion ? structuredClone(node.motion) : null,
      };
    }

    case 'SET_THEME': {
      const before = project.settings.theme as unknown as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(command.patch)) patch[key] = before[key];
      return { type: 'SET_THEME', patch: patch as Partial<ProjectTheme> };
    }

    case 'RENAME_NODE': {
      const node = getNode(project, command.nodeId);
      return { type: 'RENAME_NODE', nodeId: command.nodeId, name: node.name };
    }

    case 'SET_PROJECT_NAME':
      return { type: 'SET_PROJECT_NAME', name: project.name };

    case 'INSERT_NODE':
      return { type: 'DELETE_NODE', nodeId: command.rootId };

    case 'DELETE_NODE': {
      const node = getNode(project, command.nodeId);
      const parentId = node.parentId;
      if (!parentId) throw new Error('Zory: cannot invert deletion of a root node');
      const parent = getNode(project, parentId);
      const restore: InsertNodeCommand = {
        type: 'INSERT_NODE',
        nodes: subtreeNodes(project, command.nodeId).map((n) => structuredClone(n)),
        rootId: command.nodeId,
        parentId,
        index: parent.children.indexOf(command.nodeId),
      };
      return restore;
    }

    case 'MOVE_NODE': {
      const node = getNode(project, command.nodeId);
      const parentId = node.parentId;
      if (!parentId) throw new Error('Zory: cannot invert a move of a root node');
      const parent = getNode(project, parentId);
      return {
        type: 'MOVE_NODE',
        nodeId: command.nodeId,
        parentId,
        index: parent.children.indexOf(command.nodeId),
      };
    }

    case 'DUPLICATE_NODE': {
      const cloneId = command.idMap[command.nodeId];
      if (!cloneId) throw new Error('Zory: duplicate command is missing its root mapping');
      const remove: DeleteNodeCommand = { type: 'DELETE_NODE', nodeId: cloneId };
      return remove;
    }

    case 'ADD_ASSET':
      return { type: 'REMOVE_ASSET', assetId: command.asset.id };

    case 'REMOVE_ASSET': {
      const asset = project.assets.find((a) => a.id === command.assetId);
      if (!asset) throw new Error(`Zory: cannot invert removal of unknown asset "${command.assetId}"`);
      return { type: 'ADD_ASSET', asset: structuredClone(asset) };
    }

    case 'CREATE_COMPONENT':
      return { type: 'DELETE_COMPONENT', componentId: command.def.id, def: command.def };

    case 'DELETE_COMPONENT':
      return { type: 'CREATE_COMPONENT', def: structuredClone(command.def) };

    case 'SET_OVERRIDE': {
      const instance = project.nodes[command.nodeId];
      const before = instance?.overrides?.[command.defNodeId];
      return {
        type: 'SET_OVERRIDE',
        nodeId: command.nodeId,
        defNodeId: command.defNodeId,
        override: before ? structuredClone(before) : null,
      };
    }

    default: {
      const exhaustive: never = command;
      throw new Error(`Zory: cannot invert unknown command ${JSON.stringify(exhaustive)}`);
    }
  }
}

type InvertedStylePatch = { [K in keyof StyleProps]?: StyleProps[K] | null };
type NodePropPatch = Partial<Record<keyof NodeProps, NodeProps[keyof NodeProps] | null>>;

export interface ExecutionResult {
  next: Project;
  inverse: ZoryCommand;
}

/** Applies a command and returns both the new project and its undo command. */
export function executeCommand(project: Project, command: ZoryCommand): ExecutionResult {
  const inverse = invertCommand(project, command);
  const next = applyCommand(project, command);
  return { next, inverse };
}

/** Applies a batch atomically, returning inverses in undo order (reversed). */
export function executeBatch(
  project: Project,
  commands: ZoryCommand[],
): { next: Project; inverses: ZoryCommand[] } {
  let cursor = project;
  const inverses: ZoryCommand[] = [];
  for (const command of commands) {
    const result = executeCommand(cursor, command);
    cursor = result.next;
    inverses.unshift(result.inverse);
  }
  return { next: cursor, inverses };
}
