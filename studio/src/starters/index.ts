/**
 * The starter catalogue.
 *
 * Starters are ordinary projects built from the same blueprint DSL a user's
 * own edits produce — there is no privileged path. Each one is meant to be
 * exportable and shippable after editing, not filler.
 */

import type { Project, ProjectTheme, PageBlueprint, ComponentBlueprint } from '@zory/core';
import type { TemplateDef } from './catalogue/kit';
import { collectComponents } from './catalogue/kit';
import { createProject, createBlankProject } from '@zory/core';
import { cadencePages, cadenceTheme } from './cadence';
import { fontainePages, fontaineTheme } from './fontaine';
import { harborlinePages, harborlineTheme } from './harborline';
import { SAAS_TEMPLATES } from './catalogue/saas';
import { PORTFOLIO_TEMPLATES } from './catalogue/portfolio';
import { MODERN_TEMPLATES } from './catalogue/modern';
import { PREMIUM_TEMPLATES } from './catalogue/premium';
import { LOCAL_TEMPLATES } from './catalogue/local';

/**
 * How the dashboard groups templates.
 *
 * Three groups, because with two dozen tiles on one page the eye has nowhere
 * to start. Deliberately coarse: a taxonomy with nine buckets needs learning,
 * and somebody choosing a starting point is not there to learn a taxonomy.
 */
export type TemplateCategory = 'product' | 'portfolio' | 'local' | 'other';

export const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  product: 'Products and apps',
  portfolio: 'Portfolios and studios',
  local: 'Local businesses',
  other: 'Everything else',
};

export interface Starter {
  id: string;
  name: string;
  /** What kind of site this is, in the user's words. */
  kind: string;
  category: TemplateCategory;
  description: string;
  theme: ProjectTheme;
  pages: PageBlueprint[];
  /**
   * Definitions the pages instantiate.
   *
   * A template repeats things — a feature cell, a work row, a figure — and
   * repeating them as instances rather than copies is what makes the finished
   * project editable in one place instead of six.
   */
  components?: ComponentBlueprint[];
  /** Swatches for the dashboard preview, most dominant first. */
  swatches: [string, string, string];
  /**
   * Which plan opens it.
   *
   * The catalogue is the reason to pay. Free gets six — two per category, so
   * every kind of site is represented and nobody is choosing between three
   * variations of the same page — and Pro gets all of them.
   *
   * Seven rather than three because a free plan has to be genuinely good: the
   * point is that somebody finishes something real and then wants the rest,
   * not that they bounce off an empty shelf.
   */
  tier: StarterTier;
}

export type StarterTier = 'free' | 'pro';

/**
 * The seven the free plan opens with.
 *
 * Two per category, so every kind of site is represented rather than three
 * variations of a landing page — somebody building a portfolio on the free
 * plan should not be choosing between four SaaS templates.
 *
 * Local businesses get one rather than two. The category has to be represented
 * — a restaurant owner opening Zory and finding nothing for them is the whole
 * argument for adding it — but doubling its free weight would widen the free
 * plan twice over for one category, and what Pro is worth is a decision that
 * should be made deliberately rather than as a side effect of the catalogue
 * growing.
 *
 * Named here rather than marked on each template, so the whole free tier is
 * one list to read and one line to change. Everything not in it is Pro: a
 * template added tomorrow is premium unless somebody decides otherwise, which
 * is the safe default, because the alternative widens the free plan a little
 * every time the catalogue grows.
 */
const FREE_TEMPLATES: ReadonlySet<string> = new Set([
  'cadence', // product — also the demo starter, so it cannot be behind a wall
  'northwind', // product
  'fontaine', // portfolio
  'vesper', // portfolio
  'hearth', // local — a restaurant, and free since before the category existed
  'bloom', // other
  'field-notes', // other
]);

/** Applies the tier rule to a catalogue file's worth of templates. */
function catalogued(defs: TemplateDef[]): Starter[] {
  return defs.map((def) => ({
    ...def,
    /*
     * Components are collected here rather than declared in each template file.
     * A pattern that repeats hands its definition back through `page`, and this
     * is where those arrive at the project. A template author writes sections
     * and never thinks about it, which is the point.
     */
    components: def.components ?? collectComponents(def.pages),
    tier: def.tier ?? (FREE_TEMPLATES.has(def.id) ? 'free' : 'pro'),
  }));
}

export const STARTERS: Starter[] = [
  {
    id: 'cadence',
    name: 'Cadence',
    kind: 'SaaS product',
    category: 'product',
    description:
      'A product marketing page for a developer tool. Cool and technical, with a compact rhythm and a single blue signal.',
    theme: cadenceTheme,
    pages: cadencePages,
    swatches: ['#ffffff', '#0e1116', '#2f6feb'],
    tier: 'free',
  },
  {
    id: 'fontaine',
    name: 'Ilse Fontaine',
    kind: 'Portfolio',
    category: 'portfolio',
    description:
      'A designer’s portfolio set as editorial print. Warm paper, an oversized serif, and an index of work instead of a card grid.',
    theme: fontaineTheme,
    pages: fontainePages,
    swatches: ['#f2efe8', '#171512', '#6c665c'],
    tier: 'free',
  },
  {
    id: 'harborline',
    name: 'Harborline',
    kind: 'Consulting firm',
    category: 'other',
    description:
      'An institutional site for a consultancy. Deep ink-green, ivory type and a denser setting that reads as long-established.',
    theme: harborlineTheme,
    pages: harborlinePages,
    swatches: ['#10201c', '#f0ede4', '#c2a05a'],
    tier: 'pro',
  },
  /*
   * The catalogue.
   *
   * The three above were written a node at a time and stay that way: each one
   * is making a distinct argument and the hand-setting shows. Everything below
   * is composed from `patterns.ts`, which is what makes twenty of them
   * maintainable rather than twenty places for a bug to hide.
   *
   * Order matters — this is the order they appear in the dashboard, so it runs
   * product, then portfolio, then everything else, rather than by the order
   * they happened to be written.
   */
  ...catalogued(SAAS_TEMPLATES),
  ...catalogued(PORTFOLIO_TEMPLATES),
  ...catalogued(LOCAL_TEMPLATES),
  ...catalogued(MODERN_TEMPLATES),
  ...catalogued(PREMIUM_TEMPLATES),
];

/** Templates this account can open, given what it pays for. */
export function startersFor(canUsePremium: boolean): Starter[] {
  return canUsePremium ? STARTERS : STARTERS.filter((starter) => starter.tier === 'free');
}

export function findStarter(id: string): Starter | undefined {
  return STARTERS.find((starter) => starter.id === id);
}

/**
 * Builds a project from a starter id. `null` produces a blank project so the
 * dashboard has one code path for "create".
 */
export function buildProject(starterId: string | null, name?: string): Project {
  if (starterId === null) return createBlankProject(name ?? 'Untitled project');

  const starter = findStarter(starterId);
  if (!starter) throw new Error(`Zory: unknown starter "${starterId}"`);

  return createProject({
    name: name ?? starter.name,
    description: starter.description,
    theme: starter.theme,
    pages: starter.pages,
    components: starter.components,
  });
}
