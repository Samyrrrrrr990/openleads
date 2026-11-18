/**
 * Zory commands.
 *
 * Every persistent mutation to a project is expressed as one of these. They
 * are deterministic and JSON-serialisable: applying the same command to the
 * same project always produces the same result, which is what makes undo,
 * Intent proposals and the command ledger possible.
 *
 * Ids for new nodes are assigned by the command *factories* (see
 * `factories.ts`), never inside `applyCommand`, so that a command carries its
 * full effect and can be replayed.
 */

import type {
  AssetNode,
  Breakpoint,
  ComponentDef,
  ComponentDefId,
  ElementNode,
  NodeId,
  NodeOverride,
  NodeProps,
  ProjectTheme,
  StylePatch,
} from '../graph/types';
import type { NodeMotion } from '../motion/types';

export interface SetTextCommand {
  type: 'SET_TEXT';
  nodeId: NodeId;
  text: string;
}

export interface SetStyleCommand {
  type: 'SET_STYLE';
  nodeId: NodeId;
  breakpoint: Breakpoint;
  /** `null` for a property removes that breakpoint's override. */
  patch: StylePatch;
}

export interface SetPropCommand {
  type: 'SET_PROP';
  nodeId: NodeId;
  patch: Partial<Record<keyof NodeProps, NodeProps[keyof NodeProps] | null>>;
}

export interface RenameNodeCommand {
  type: 'RENAME_NODE';
  nodeId: NodeId;
  name: string;
}

/**
 * Inserts a whole subtree. `nodes` is the flattened subtree including
 * `rootId`; this shape lets the same command serve as the inverse of a delete.
 */
export interface InsertNodeCommand {
  type: 'INSERT_NODE';
  nodes: ElementNode[];
  rootId: NodeId;
  parentId: NodeId;
  index: number;
}

export interface DeleteNodeCommand {
  type: 'DELETE_NODE';
  nodeId: NodeId;
}

export interface MoveNodeCommand {
  type: 'MOVE_NODE';
  nodeId: NodeId;
  parentId: NodeId;
  index: number;
}

/**
 * `idMap` maps every source node id in the subtree to its clone's id. Assigned
 * up front by the factory to keep the command deterministic.
 */
export interface DuplicateNodeCommand {
  type: 'DUPLICATE_NODE';
  nodeId: NodeId;
  idMap: Record<NodeId, NodeId>;
}

/**
 * Replaces a node's motion outright rather than patching it.
 *
 * Motion is three small objects, not a long property list, so a whole-value
 * set is simpler to invert and impossible to get half-applied. `null` clears
 * it and returns the node to not moving.
 */
export interface SetMotionCommand {
  type: 'SET_MOTION';
  nodeId: NodeId;
  motion: NodeMotion | null;
}

/**
 * Changes a project's design tokens.
 *
 * Theme values are referenced by nodes as `var(--zory-accent)` and friends, so
 * one command here is what makes a colour change land everywhere it is used
 * instead of on the elements someone remembered to select.
 */
export interface SetThemeCommand {
  type: 'SET_THEME';
  patch: Partial<ProjectTheme>;
}

export interface SetProjectNameCommand {
  type: 'SET_PROJECT_NAME';
  name: string;
}

export interface AddAssetCommand {
  type: 'ADD_ASSET';
  asset: AssetNode;
}

export interface RemoveAssetCommand {
  type: 'REMOVE_ASSET';
  assetId: string;
}

/**
 * Defines a reusable component. Does not touch any page — inserting an
 * instance is an ordinary `INSERT_NODE` of a node whose kind is `instance`.
 */
export interface CreateComponentCommand {
  type: 'CREATE_COMPONENT';
  def: ComponentDef;
}

/**
 * Removes a definition. Carries the whole definition so it can be inverted
 * without the project it came from, the way `DELETE_NODE` carries its subtree.
 */
export interface DeleteComponentCommand {
  type: 'DELETE_COMPONENT';
  componentId: ComponentDefId;
  def: ComponentDef;
}

/**
 * Replaces one node's local edits inside one instance, wholesale.
 *
 * Wholesale rather than per-field because this is what every mutation
 * addressed at an instance inverts to. A per-field inverse would have to
 * express "there was no pin here before", and restoring the record that was
 * actually there says that exactly, with no new vocabulary and no way to get
 * it subtly wrong. `null` means the node had no overrides at all.
 */
export interface SetOverrideCommand {
  type: 'SET_OVERRIDE';
  /** The instance node. */
  nodeId: NodeId;
  /** The node inside the definition whose pins these are. */
  defNodeId: NodeId;
  override: NodeOverride | null;
}

export type ZoryCommand =
  | SetTextCommand
  | SetStyleCommand
  | SetPropCommand
  | SetMotionCommand
  | SetThemeCommand
  | RenameNodeCommand
  | InsertNodeCommand
  | DeleteNodeCommand
  | MoveNodeCommand
  | DuplicateNodeCommand
  | SetProjectNameCommand
  | AddAssetCommand
  | RemoveAssetCommand
  | CreateComponentCommand
  | DeleteComponentCommand
  | SetOverrideCommand;

export type ZoryCommandType = ZoryCommand['type'];

/** Result of validating a command against a project. */
export type ValidationResult = { ok: true } | { ok: false; reason: string };
