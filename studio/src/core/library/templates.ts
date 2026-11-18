/**
 * Templates.
 *
 * A starter is a template Zory ships. A template is a starter somebody made.
 * They are the same object to the dashboard, which is the point of putting
 * them behind one type: the difference between "official" and "mine" is where
 * it came from, not what it is.
 *
 * A template stores a whole project, not a reference to one. Creating from a
 * template is a copy, so editing the new project can never reach back and
 * change the template — the failure mode of every "save as template" feature
 * that stores a pointer.
 */

import type { Project } from '@zory/core';
import { newProjectId } from '@zory/core';
import { db, type TemplateRecord } from '../persistence/db';
import { bandsFromBlueprint, bandsFromProject, type Band } from './preview';
import { STARTERS, buildProject, type TemplateCategory } from '../../starters';

export interface TemplateSummary {
  id: string;
  /**
   * Whether this account can open it.
   *
   * Premium templates are listed for everybody and openable by subscribers.
   * Hiding them would be the obvious implementation and the wrong one: the
   * catalogue is the reason to pay, and a reason to pay that nobody can see is
   * not one. A locked tile is an argument; an absent tile is nothing.
   */
  locked?: boolean;
  name: string;
  description: string;
  /** `zory` for the ones we ship, `personal` for the user's own. */
  origin: 'zory' | 'personal';
  /**
   * What kind of site this is, in the user's words: "Analytics SaaS",
   * "Photographer". With two dozen tiles on screen this is the line somebody
   * actually reads to choose one, so it beats repeating "Zory template"
   * twenty-three times.
   */
  kind: string;
  /** Which dashboard group this belongs in. */
  category: TemplateCategory;
  pageCount: number;
  nodeCount: number;
  swatches: string[];
  /**
   * The template's own first page, reduced to a handful of bands.
   *
   * The dashboard draws the tile from this rather than from a fixed shape, so
   * a portfolio does not look like a pricing page in a different colour. See
   * `preview.ts` for why that mattered enough to compute.
   */
  bands: Band[];
  /**
   * Four colours rather than three.
   *
   * `swatches` is background, text and accent, which was enough for a flat
   * rectangle. A tile with structure needs a line colour too, or every rule in
   * it has to be faked out of the text colour at an opacity that is wrong on
   * half the themes.
   */
  surface: string;
  border: string;
  updatedAt: number;
}

function newTemplateId(): string {
  return `tpl_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function toSummary(record: TemplateRecord): TemplateSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    origin: 'personal',
    // A saved template is whatever the user made; naming its genre for them
    // would be a guess, and a wrong one is worse than a plain label.
    kind: 'Your template',
    category: 'other',
    pageCount: record.pageCount,
    nodeCount: record.nodeCount,
    swatches: record.swatches,
    bands: bandsFromProject(record.data),
    surface: record.data.settings.theme.surface,
    border: record.data.settings.theme.border,
    updatedAt: record.updatedAt,
  };
}

/** Three colours from the project theme, for the dashboard card. */
function swatchesOf(project: Project): string[] {
  const { theme } = project.settings;
  return [theme.background, theme.text, theme.accent];
}

/** Everything the dashboard can start from, ours first. */
/**
 * Every template, with the premium ones marked rather than removed.
 *
 * `canUsePremium` comes from the caller's entitlements. It decides what is
 * *openable*, never what is listed — see `TemplateSummary.locked`.
 */
export async function listTemplates(canUsePremium = true): Promise<TemplateSummary[]> {
  const personal = (await db.templates.orderBy('updatedAt').reverse().toArray()).map(toSummary);

  const official: TemplateSummary[] = STARTERS.map((starter) => ({
    id: starter.id,
    name: starter.name,
    description: starter.description,
    origin: 'zory',
    kind: starter.kind,
    category: starter.category,
    pageCount: starter.pages.length,
    nodeCount: 0,
    swatches: [...starter.swatches],
    bands: starter.pages[0] ? bandsFromBlueprint(starter.pages[0].root) : [],
    surface: starter.theme.surface,
    border: starter.theme.border,
    updatedAt: 0,
    locked: !canUsePremium && starter.tier !== 'free',
  }));

  return [...official, ...personal];
}

export async function countTemplates(): Promise<number> {
  return db.templates.count();
}

export async function saveTemplate(project: Project, description = ''): Promise<TemplateSummary> {
  const now = Date.now();
  const record: TemplateRecord = {
    id: newTemplateId(),
    name: project.name,
    description: description.trim() || project.settings.description,
    createdAt: now,
    updatedAt: now,
    pageCount: project.pages.length,
    nodeCount: Object.keys(project.nodes).length,
    swatches: swatchesOf(project),
    // JSON round trip so nothing live from the editor reaches the database.
    data: JSON.parse(JSON.stringify(project)) as Project,
  };
  await db.templates.put(record);
  return toSummary(record);
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.templates.delete(id);
}

export async function renameTemplate(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('A template needs a name.');
  const record = await db.templates.get(id);
  if (!record) return;
  await db.templates.put({ ...record, name: trimmed, updatedAt: Date.now() });
}

/**
 * A new project from a template.
 *
 * Node ids are kept as they are: they only have to be unique within a project,
 * and preserving them means a linked workspace folder keeps its round-trip
 * markers pointing at the right rules.
 */
/**
 * Whether a template may be opened on this plan.
 *
 * Checked here as well as where the tile is drawn, because a gate that lives
 * only in a render is a gate a stale prop walks past — and this one decides
 * what somebody gets for twenty dollars.
 */
export function templateIsOpenable(id: string, canUsePremium: boolean): boolean {
  const starter = STARTERS.find((candidate) => candidate.id === id);
  if (!starter) return true; // A personal template. Always yours to open.
  return canUsePremium || starter.tier === 'free';
}

export async function projectFromTemplate(
  summary: Pick<TemplateSummary, 'id' | 'origin'>,
  name?: string,
): Promise<Project> {
  if (summary.origin === 'zory') return buildProject(summary.id, name);

  const record = await db.templates.get(summary.id);
  if (!record) throw new Error('That template is no longer here.');

  const now = Date.now();
  return {
    ...(JSON.parse(JSON.stringify(record.data)) as Project),
    id: newProjectId(),
    name: name ?? record.name,
    createdAt: now,
    updatedAt: now,
  };
}
