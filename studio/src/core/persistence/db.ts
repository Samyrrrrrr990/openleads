/**
 * Local project storage.
 *
 * Everything lives in the user's browser. There is no account, no sync and no
 * server — a project is a row in IndexedDB and nothing else.
 */

import Dexie, { type EntityTable } from 'dexie';
import type { AssetNode, ElementNode, Project, ProjectId } from '@zory/core';

export interface ProjectRecord {
  id: ProjectId;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Which starter this began as, for the dashboard. `null` for blank. */
  starterId: string | null;
  /** Denormalised so the dashboard never has to walk the graph. */
  pageCount: number;
  nodeCount: number;
  schemaVersion: number;
  /** The full project graph. */
  data: Project;
}

/**
 * A saved section.
 *
 * Detached from any project: a flattened subtree, the assets it refers to, and
 * enough of the theme to explain why it looks the way it does. Inserting it
 * elsewhere goes through INSERT_NODE and ADD_ASSET like every other edit, so a
 * section is not a privileged object — it is a subtree somebody kept.
 */
export interface SectionRecord {
  id: string;
  name: string;
  /** User's own grouping: Hero, Footer, Pricing. Free text, not an enum. */
  kind: string;
  createdAt: number;
  updatedAt: number;
  /** Flattened subtree, including the root. */
  nodes: ElementNode[];
  rootId: string;
  /** Only the assets this subtree actually references. */
  assets: AssetNode[];
  /** Up to three colours, for the panel's preview chip. */
  swatches: string[];
  /** Name of the project it was saved from, for the user's memory. */
  sourceProject: string;
  /** Node count, denormalised so the list never walks the subtree. */
  nodeCount: number;
}

/**
 * A saved template: a whole project kept as a starting point.
 *
 * Stored as its own row rather than as a project marked "template", so
 * creating from one is a copy and can never mutate the original.
 */
export interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  nodeCount: number;
  swatches: string[];
  /** The full project graph, with its own id already stripped. */
  data: Project;
}

/**
 * One saved state of a project.
 *
 * The whole graph, not a diff. A diff would be smaller and would mean a
 * restore had to replay every step between here and now correctly — and a
 * restore that is subtly wrong is worse than one that costs a few hundred
 * kilobytes.
 */
export interface VersionRecord {
  id: string;
  projectId: ProjectId;
  at: number;
  label: string;
  nodeCount: number;
  /** True when a person asked for it rather than the timer taking it. */
  manual: boolean;
  data: Project;
}

/**
 * A tombstone: proof that a project was deleted here, and when.
 *
 * Without this, deletion cannot be expressed to the cloud. Sync compares two
 * lists, and a project present remotely but absent locally is indistinguishable
 * from a project that has never been downloaded — so the honest reading is
 * "restore it", and a deleted project comes back on the next sync. Recording
 * the deletion turns that ambiguity into a fact: absent *because deleted at
 * time T*, which sync can act on.
 *
 * Kept indefinitely rather than pruned on a timer. A row is an id and a number;
 * the storage saved by expiring them is not worth the failure mode, which is a
 * project quietly returning from the dead on a device that had not synced in a
 * while.
 */
export interface DeletionRecord {
  id: ProjectId;
  deletedAt: number;
}

class ZoryDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, 'id'>;
  sections!: EntityTable<SectionRecord, 'id'>;
  templates!: EntityTable<TemplateRecord, 'id'>;
  versions!: EntityTable<VersionRecord, 'id'>;
  deletions!: EntityTable<DeletionRecord, 'id'>;

  constructor() {
    super('zory');
    this.version(1).stores({
      projects: 'id, updatedAt, createdAt, name',
    });
    /*
     * Version 2 adds the library.
     *
     * Dexie applies versions in order, so an existing database gains the two
     * new stores and keeps every project row exactly as it was. Declaring the
     * projects store again is required — a version describes the whole schema,
     * not a delta.
     */
    this.version(2).stores({
      projects: 'id, updatedAt, createdAt, name',
      sections: 'id, updatedAt, name, kind',
      templates: 'id, updatedAt, name',
    });
    /*
     * Version 3 adds saved versions.
     *
     * Indexed on `projectId` because every query is "the history of this
     * project" — without it, listing a project's versions would read every
     * version of every project the browser has ever held.
     */
    this.version(3).stores({
      projects: 'id, updatedAt, createdAt, name',
      sections: 'id, updatedAt, name, kind',
      templates: 'id, updatedAt, name',
      versions: 'id, projectId, at',
    });
    /*
     * Version 4 adds deletion tombstones.
     *
     * Existing databases gain an empty store, which is the correct starting
     * point: nothing deleted before this build can be proven to have been
     * deleted, so sync keeps treating those as "not downloaded yet" rather
     * than inventing a deletion it cannot evidence.
     */
    this.version(4).stores({
      projects: 'id, updatedAt, createdAt, name',
      sections: 'id, updatedAt, name, kind',
      templates: 'id, updatedAt, name',
      versions: 'id, projectId, at',
      deletions: 'id, deletedAt',
    });
  }
}

export const db = new ZoryDatabase();
