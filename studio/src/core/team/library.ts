import type { AssetNode, ElementNode } from '@zory/core';

export interface SharedSection {
  id: string;
  name: string;
  kind: string;
  createdAt: number;
  updatedAt: number;
  nodes: ElementNode[];
  rootId: string;
  assets: AssetNode[];
  swatches: string[];
  sourceProject: string;
  sharedBy: string | null;
  sharedByName: string | null;
  nodeCount: number;
}
export async function listSharedSections(_workspaceId: string): Promise<SharedSection[]> {
  return [];
}
export async function getSharedSection(_workspaceId: string, _id: string): Promise<SharedSection | null> {
  return null;
}
export async function shareSection(..._args: unknown[]): Promise<void> {}
export async function unshareSection(_workspaceId: string, _sectionId: string): Promise<void> {}
