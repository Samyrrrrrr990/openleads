import type { Project } from '@zory/core';

export interface SharedProject {
  id: string;
  name: string;
  updatedAt: number;
  nodeCount: number;
  updatedBy: string | null;
  updatedByName: string | null;
}
export async function listShared(_workspaceId: string): Promise<SharedProject[]> {
  return [];
}
export async function pullShared(_workspaceId: string, _projectId: string): Promise<Project | null> {
  return null;
}
export async function pushShared(_workspaceId: string, _project: Project, _by?: unknown): Promise<void> {}
