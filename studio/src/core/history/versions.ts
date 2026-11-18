/**
 * Version history.
 *
 * Undo is for the last few minutes. This is for last Tuesday — the case where
 * somebody wants the page back the way it was before an afternoon of changes,
 * and where walking undo backwards two hundred steps is not a plan.
 *
 * Two rules shape the whole thing:
 *
 * **Snapshots are throttled, not per-edit.** A version per keystroke is a
 * database nobody can read and a list nobody can scan. One every few minutes
 * of actual change, plus whatever a person saves deliberately, is what makes
 * the list useful — the entries are far enough apart to mean something.
 *
 * **Restoring takes a snapshot first.** Every "restore" is somebody's guess
 * that an older state was better, and a guess needs a way back. Without this,
 * restoring is the one action in Zory that destroys work.
 *
 * Retention comes from the plan. Free keeps none, which is why nothing is
 * written at all on Free rather than written and hidden — storing data for
 * somebody who cannot see it is a quota bill and a privacy question in
 * exchange for nothing.
 */

import type { Project, ProjectId } from '@zory/core';
import { migrateProject } from '@zory/core';
import { db, type VersionRecord } from '../persistence/db';

export interface VersionSummary {
  id: string;
  projectId: ProjectId;
  at: number;
  /** What was happening — an undo label, or what the person typed. */
  label: string;
  nodeCount: number;
  /** True when a person asked for it rather than the timer taking it. */
  manual: boolean;
}

/** Minimum gap between automatic snapshots. */
export const AUTO_INTERVAL_MS = 5 * 60_000;

/** Ceiling per project, whatever the retention window says. */
const MAX_PER_PROJECT = 200;

function newVersionId(): string {
  return `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function toSummary(record: VersionRecord): VersionSummary {
  return {
    id: record.id,
    projectId: record.projectId,
    at: record.at,
    label: record.label,
    nodeCount: record.nodeCount,
    manual: record.manual,
  };
}

export async function listVersions(projectId: ProjectId): Promise<VersionSummary[]> {
  const records = await db.versions.where('projectId').equals(projectId).toArray();
  return records.sort((a, b) => b.at - a.at).map(toSummary);
}

export async function getVersion(id: string): Promise<Project | null> {
  const record = await db.versions.get(id);
  if (!record) return null;
  // Migrated on the way out. A version can be older than any project still
  // open, so it is the one thing most likely to be from a previous schema.
  return migrateProject(record.data);
}

export interface SnapshotOptions {
  label: string;
  manual?: boolean;
  /** Retention in days. `0` means history is off for this account. */
  retentionDays: number;
}

/**
 * Records a version, if the plan keeps them and enough time has passed.
 *
 * Returns the summary it wrote, or `null` when it decided not to — which the
 * caller treats as ordinary rather than as a failure.
 */
export async function snapshot(
  project: Project,
  options: SnapshotOptions,
): Promise<VersionSummary | null> {
  if (options.retentionDays <= 0) return null;

  if (!options.manual) {
    const latest = await latestFor(project.id);
    if (latest && Date.now() - latest.at < AUTO_INTERVAL_MS) return null;
    // Nothing has changed since the last one: a row saying so is noise.
    if (latest && latest.at >= project.updatedAt) return null;
  }

  const record: VersionRecord = {
    id: newVersionId(),
    projectId: project.id,
    at: Date.now(),
    label: options.label.slice(0, 120),
    nodeCount: Object.keys(project.nodes).length,
    manual: options.manual === true,
    // Structured-clone through JSON so no Immer draft reaches Dexie.
    data: JSON.parse(JSON.stringify(project)) as Project,
  };

  await db.versions.put(record);
  await prune(project.id, options.retentionDays);
  return toSummary(record);
}

async function latestFor(projectId: ProjectId): Promise<VersionRecord | undefined> {
  const records = await db.versions.where('projectId').equals(projectId).toArray();
  return records.sort((a, b) => b.at - a.at)[0];
}

/**
 * Drops what the plan no longer keeps.
 *
 * A version a person deliberately saved survives the window — they named it,
 * so it is not the kind of thing to delete on a timer — but it still counts
 * against the ceiling.
 */
export async function prune(projectId: ProjectId, retentionDays: number): Promise<number> {
  const records = (await db.versions.where('projectId').equals(projectId).toArray()).sort(
    (a, b) => b.at - a.at,
  );

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const doomed: string[] = [];

  records.forEach((record, index) => {
    if (index >= MAX_PER_PROJECT) doomed.push(record.id);
    else if (!record.manual && record.at < cutoff) doomed.push(record.id);
  });

  if (doomed.length > 0) await db.versions.bulkDelete(doomed);
  return doomed.length;
}

export async function deleteVersion(id: string): Promise<void> {
  await db.versions.delete(id);
}

/** Everything for a project, for when the project itself is deleted. */
export async function deleteVersionsFor(projectId: ProjectId): Promise<void> {
  const records = await db.versions.where('projectId').equals(projectId).toArray();
  await db.versions.bulkDelete(records.map((record) => record.id));
}

/** A short, human gap: "4 minutes ago", "yesterday". */
export function describeAge(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
