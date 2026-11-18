/**
 * Project repository: the only module that talks to storage.
 *
 * In OpenLeads, projects live in your workspace (the `sites` table), not in this
 * browser, so a site can belong to a lead, appear in the Sites list, and be
 * previewed at /s/<slug>/. Every save also sends the rendered static pages.
 *
 * Loads still run every project through `migrateProject`, so a graph written by
 * an older build is brought forward and repaired before it reaches the editor.
 * Deletion tombstones stay in IndexedDB: they only matter to this device.
 */

import type { Project, ProjectId, ProjectSummary } from '@zory/core';
import { migrateProject, newProjectId } from '@zory/core';
import { db } from './db';
import { deleteVersionsFor } from '../history/versions';
import { generateStaticSite } from '../export/staticHtml';

export interface SiteSummary {
  id: string;
  slug: string;
  name: string;
  lead_email: string | null;
  company: string;
  starter_id: string | null;
  page_count: number;
  node_count: number;
  created: number;
  updated: number;
  preview: string;
  url: string;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `OpenLeads answered ${res.status}`);
  return data;
}

/* The lead the next created project belongs to (set from `?lead=` on the dashboard). */
let pendingLead = '';
export function setPendingLead(email: string): void {
  pendingLead = email.trim().toLowerCase();
}

function plain(project: Project): Project {
  // Structured-clone through JSON so no Immer draft or proxy reaches the wire.
  return JSON.parse(JSON.stringify(project)) as Project;
}

function rendered(project: Project): Record<string, string> | undefined {
  try {
    return generateStaticSite(project);
  } catch {
    return undefined; // the editor's copy still saves; the preview catches up next time
  }
}

const summaries = new Map<string, SiteSummary>();

export async function listSites(): Promise<SiteSummary[]> {
  const { sites } = await call<{ sites: SiteSummary[] }>('/api/sites');
  sites.forEach((s) => summaries.set(s.id, s));
  return sites;
}

/** The workspace's record of a site: its slug, preview path and public link. */
export function siteInfo(id: string): SiteSummary | undefined {
  return summaries.get(id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const sites = await listSites();
  return sites.map((s) => ({
    id: s.id,
    name: s.name,
    createdAt: Math.round((s.created || 0) * 1000),
    updatedAt: Math.round((s.updated || 0) * 1000),
    pageCount: s.page_count,
    nodeCount: s.node_count,
    starterId: s.starter_id,
  }));
}

export async function loadProject(id: ProjectId): Promise<Project | null> {
  try {
    const site = await call<SiteSummary & { project: Project | null }>(
      `/api/sites/get?id=${encodeURIComponent(id)}`,
    );
    summaries.set(site.id, site);
    return site.project ? migrateProject(site.project) : null;
  } catch {
    return null;
  }
}

export async function saveProject(project: Project, starterId?: string | null): Promise<void> {
  const data = plain(project);
  const site = await call<SiteSummary>('/api/sites/save', {
    project: data,
    starterId: starterId ?? null,
    html: rendered(data),
  });
  summaries.set(site.id, site);
}

export async function createProjectRecord(project: Project, starterId: string | null): Promise<Project> {
  const data = plain(project);
  const site = await call<SiteSummary>('/api/sites/save', {
    project: data,
    starterId,
    lead: pendingLead,
    html: rendered(data),
  });
  summaries.set(site.id, site);
  pendingLead = '';
  return project;
}

export async function renameProject(id: ProjectId, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('A project needs a name.');
  await call('/api/sites/rename', { id, name: trimmed });
}

export async function duplicateProject(id: ProjectId): Promise<ProjectId | null> {
  const original = await loadProject(id);
  if (!original) return null;
  const now = Date.now();
  const copy: Project = { ...plain(original), id: newProjectId(), name: nextCopyName(original.name), createdAt: now, updatedAt: now };
  const lead = summaries.get(id)?.lead_email ?? '';
  await call('/api/sites/save', { project: copy, starterId: summaries.get(id)?.starter_id ?? null, lead, html: rendered(copy) });
  return copy.id;
}

export async function deleteProject(id: ProjectId): Promise<void> {
  await call('/api/sites/delete', { id });
  summaries.delete(id);
  await deleteVersionsFor(id);
  await db.deletions.put({ id, deletedAt: Date.now() });
}

export async function publishSite(id: ProjectId): Promise<{ folder: string; url: string; deployed: boolean }> {
  return call('/api/sites/publish', { id });
}

/** Every project this device has deleted, as `id → when`. */
export async function listDeletions(): Promise<Map<ProjectId, number>> {
  const records = await db.deletions.toArray();
  return new Map(records.map((record) => [record.id, record.deletedAt]));
}

export async function clearDeletion(id: ProjectId): Promise<void> {
  await db.deletions.delete(id);
}

/** "Site" → "Site copy" → "Site copy 2". */
export function nextCopyName(name: string): string {
  const match = /^(.*?) copy(?: (\d+))?$/.exec(name);
  if (!match) return `${name} copy`;
  const base = match[1] ?? name;
  const n = match[2] ? Number.parseInt(match[2], 10) : 1;
  return `${base} copy ${n + 1}`;
}
