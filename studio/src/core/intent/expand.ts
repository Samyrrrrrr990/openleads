/**
 * Turning a model's proposals into real commands.
 *
 * Two of Zory's commands carry generated identity: INSERT_NODE contains whole
 * nodes with fresh ids, and DUPLICATE_NODE carries a map from every source id
 * to its clone's id. Neither can be written by a model without handing it the
 * ability to invent ids — which means colliding with a live node, orphaning a
 * subtree, or overwriting something that already exists.
 *
 * So the model does not write them. It writes a *request* with no ids in it —
 * "insert a card here", "duplicate that" — and this module builds the actual
 * command from known-good material. The dangerous half is constructed locally
 * every time.
 *
 * Everything that only references existing ids passes through untouched, and
 * validation still runs afterwards on all of it. This narrows what a model can
 * express; it does not replace the check on what it did express.
 */

import type { Project, ZoryCommand } from '@zory/core';
import { duplicateNode, insertNode } from '@zory/core';
import { findBlock } from './blocks';
import { IntentError } from './types';

/** Shape the model is asked to emit for an insertion. */
interface InsertBlockRequest {
  type: 'INSERT_BLOCK';
  block: string;
  parentId: string;
  index?: number;
  text?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Expands proposals in place, preserving order.
 *
 * Throws IntentError for a request that cannot be honoured, because a silently
 * dropped insertion is worse than a refusal — the user would approve a change
 * that is quietly missing the thing they asked for.
 */
export function expandProposals(project: Project, raw: unknown[]): ZoryCommand[] {
  const out: ZoryCommand[] = [];

  /*
   * Nodes inserted earlier in this same batch, so a later command can target
   * them. Without it the model could not build anything with structure: adding
   * a grid and then three cards inside it needs the grid's id, and that id does
   * not exist until the grid is expanded.
   */
  const inserted = new Map<string, string>();

  for (const item of raw) {
    if (!isRecord(item) || typeof item['type'] !== 'string') {
      throw new IntentError('The model returned something that is not a command.');
    }

    const type = item['type'];

    if (type === 'INSERT_BLOCK') {
      const request = item as unknown as InsertBlockRequest;
      const block = findBlock(String(request.block ?? ''));
      if (!block) {
        throw new IntentError(`Studio has no "${String(request.block)}" block to insert.`);
      }

      // A parent named in this batch resolves to the node just created.
      const parentId = inserted.get(request.parentId) ?? request.parentId;
      const parent = project.nodes[parentId];

      /*
       * A parent created earlier in this batch does not exist in `project`
       * yet, so its absence here is expected rather than an error. Validation
       * runs against the projected state and will catch a genuinely bad
       * parent.
       */
      if (!parent && !inserted.has(request.parentId)) {
        throw new IntentError('That change refers to an element that does not exist.');
      }

      const index =
        typeof request.index === 'number' && Number.isFinite(request.index)
          ? Math.max(0, Math.floor(request.index))
          : (parent?.children.length ?? 0);

      const command = insertNode(
        block.build(typeof request.text === 'string' ? request.text : undefined),
        parentId,
        index,
      );

      // Remember it under the block name too, so "insert a card into the grid
      // I just made" resolves without the model knowing any id.
      inserted.set(block.id, command.rootId);
      inserted.set(command.rootId, command.rootId);
      out.push(command);
      continue;
    }

    if (type === 'DUPLICATE_NODE' && !isRecord(item['idMap'])) {
      // The model asked to duplicate but cannot produce the id map. Build it.
      const nodeId = String(item['nodeId'] ?? '');
      if (!project.nodes[nodeId]) {
        throw new IntentError('That change refers to an element that does not exist.');
      }
      out.push(duplicateNode(project, nodeId));
      continue;
    }

    out.push(item as unknown as ZoryCommand);
  }

  return out;
}
