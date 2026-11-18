/**
 * The section library.
 *
 * A section is a subtree somebody decided to keep. Saving one detaches it from
 * its project; inserting it attaches a fresh copy to another. Both directions
 * go through the ordinary command path, so a section is not a privileged kind
 * of object — INSERT_NODE does not know it came from a library.
 *
 * The interesting part is assets. A hero with a photograph is not portable if
 * the photograph stays behind, so a saved section carries the assets its nodes
 * reference, and inserting one adds any the destination does not already have.
 * Assets are content-addressed by id, so re-inserting the same section twice
 * does not duplicate its image.
 */

import type { AssetNode, ElementNode, NodeId, Project, ZoryCommand } from '@zory/core';
import { insertionPointFor, remapSubtree, subtreeNodes } from '@zory/core';
import { ASSET_PREFIX } from '../../renderer/resolve';
import { db, type SectionRecord } from '../persistence/db';

export type { SectionRecord };

export interface SectionSummary {
  id: string;
  name: string;
  kind: string;
  updatedAt: number;
  nodeCount: number;
  swatches: string[];
  sourceProject: string;
}

function newSectionId(): string {
  return `sec_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/** Assets referenced anywhere in a subtree, in the order they appear. */
function referencedAssets(nodes: ElementNode[], project: Project): AssetNode[] {
  const wanted = new Set<string>();
  for (const node of nodes) {
    const src = node.props.src;
    if (src?.startsWith(ASSET_PREFIX)) wanted.add(src.slice(ASSET_PREFIX.length));
  }
  return project.assets.filter((asset) => wanted.has(asset.id));
}

/**
 * Three colours that say what this section looks like.
 *
 * Read off the subtree rather than off the project theme, because a section
 * saved from an inverted footer should not preview as the page it came from.
 */
function swatchesOf(nodes: ElementNode[]): string[] {
  const seen: string[] = [];
  for (const node of nodes) {
    for (const bucket of [node.styles.base, node.styles.tablet, node.styles.mobile]) {
      for (const key of ['backgroundColor', 'color', 'borderColor'] as const) {
        const value = bucket?.[key];
        if (typeof value === 'string' && value.startsWith('#') && !seen.includes(value)) {
          seen.push(value);
        }
      }
    }
    if (seen.length >= 3) break;
  }
  return seen.slice(0, 3);
}

export function toSummary(record: SectionRecord): SectionSummary {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    updatedAt: record.updatedAt,
    nodeCount: record.nodeCount,
    swatches: record.swatches,
    sourceProject: record.sourceProject,
  };
}

export async function listSections(): Promise<SectionSummary[]> {
  const records = await db.sections.orderBy('updatedAt').reverse().toArray();
  return records.map(toSummary);
}

export async function countSections(): Promise<number> {
  return db.sections.count();
}

export async function getSection(id: string): Promise<SectionRecord | undefined> {
  return db.sections.get(id);
}

export interface SaveSectionInput {
  project: Project;
  nodeId: NodeId;
  name: string;
  kind?: string;
}

/**
 * Keeps a subtree.
 *
 * The stored nodes are serialised through JSON so that no Immer draft, and no
 * reference into the live project, survives into the database. A section that
 * shared structure with the project it came from would change when that
 * project changed, which is the opposite of the point.
 */
export async function saveSection({
  project,
  nodeId,
  name,
  kind = 'Section',
}: SaveSectionInput): Promise<SectionSummary> {
  const nodes = subtreeNodes(project, nodeId);
  if (nodes.length === 0) throw new Error('That element no longer exists.');

  const detached = JSON.parse(JSON.stringify(nodes)) as ElementNode[];
  // The root has no parent once it is out of a project.
  const root = detached.find((node) => node.id === nodeId);
  if (root) root.parentId = null;

  const now = Date.now();
  const record: SectionRecord = {
    id: newSectionId(),
    name: name.trim() || 'Section',
    kind: kind.trim() || 'Section',
    createdAt: now,
    updatedAt: now,
    nodes: detached,
    rootId: nodeId,
    assets: JSON.parse(JSON.stringify(referencedAssets(detached, project))) as AssetNode[],
    swatches: swatchesOf(detached),
    sourceProject: project.name,
    nodeCount: detached.length,
  };

  await db.sections.put(record);
  return toSummary(record);
}

export async function renameSection(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('A section needs a name.');
  const record = await db.sections.get(id);
  if (!record) return;
  await db.sections.put({ ...record, name: trimmed, updatedAt: Date.now() });
}

export async function deleteSection(id: string): Promise<void> {
  await db.sections.delete(id);
}

export interface InsertPlan {
  commands: ZoryCommand[];
  /** Id the inserted root will have, so the caller can select it. */
  rootId: NodeId;
  /** Assets that came along, for the confirmation message. */
  addedAssets: number;
}

/**
 * Builds the commands that put a saved section into a project.
 *
 * Returns commands rather than applying them: they go through the same
 * validation and the same undo step as anything else, and the caller decides
 * where in the page they land.
 */
export function planInsert(
  project: Project,
  section: SectionRecord,
  selectedId: NodeId | null,
  pageRootId: NodeId,
): InsertPlan {
  const { nodes, rootId } = remapSubtree(section.nodes, section.rootId);
  const { parentId, index } = insertionPointFor(project, selectedId, pageRootId);

  const existing = new Set(project.assets.map((asset) => asset.id));
  const missing = section.assets.filter((asset) => !existing.has(asset.id));

  const commands: ZoryCommand[] = [
    ...missing.map((asset) => ({ type: 'ADD_ASSET' as const, asset })),
    { type: 'INSERT_NODE', nodes, rootId, parentId, index },
  ];

  return { commands, rootId, addedAssets: missing.length };
}
