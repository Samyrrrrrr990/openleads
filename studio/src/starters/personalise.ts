/**
 * Opening a template as your business rather than as the demo's.
 *
 * A starter is a finished site for a company that does not exist. That is the
 * right thing for it to be — placeholder copy teaches nobody anything — but it
 * means the first minute in the editor is spent doing the same three things
 * every time: changing the name, changing the colours, changing the type. They
 * are the three decisions somebody already made before they arrived, and
 * asking for them at the moment of creation is cheaper than making them hunt
 * for where each one lives.
 *
 * Everything here is pure and goes through `createProject`, the same
 * constructor the blank project and every starter use. There is no second path
 * into the graph and this is not the place to invent one — which is also what
 * lets the picker render a live preview by simply calling this again.
 *
 * What it deliberately does not do is rewrite the copy. A template's words are
 * written for a fictional business and substituting a name into them would
 * produce sentences nobody wrote and everybody would have to repair. The name
 * lands on the wordmark, which is identity, and the copy stays the template's
 * until the owner edits it.
 */

import type { ElementNode, Project, ProjectTheme, StyleProps } from '@zory/core';
import { THEME_TOKENS, createProject, tokenOf } from '@zory/core';
import type { Starter } from './index';
import { BRAND_NODE } from './patterns';
import { FACES } from './catalogue/kit';

/** The palettes offered alongside the one the template was designed in. */
export type PaletteId = 'designed' | 'paper' | 'ink' | 'slate' | 'bone';

/** The typeface pairings offered. `designed` keeps the template's own. */
export type FaceId = 'designed' | keyof typeof FACES;

export interface StarterChoices {
  /** The business name. Blank keeps the template's. */
  name?: string;
  palette?: PaletteId;
  face?: FaceId;
}

interface Palette {
  label: string;
  note: string;
  /** The seven colours. `null` means "keep whatever the template had". */
  colours: Omit<ProjectTheme, 'fontDisplay' | 'fontBody'> | null;
}

/**
 * Four alternates and the original.
 *
 * Four rather than twelve. This is a decision made in about two seconds on the
 * way into the editor, where the palette can be changed properly in the Design
 * panel against the real page — so the job here is to offer a different
 * register, not a colour picker.
 */
export const PALETTES: Record<PaletteId, Palette> = {
  designed: {
    label: 'As designed',
    note: 'The palette the template was drawn in.',
    colours: null,
  },
  paper: {
    label: 'Paper',
    note: 'Warm off-white, soft ink, a muted red signal.',
    colours: {
      background: '#faf8f4',
      surface: '#f0ece4',
      text: '#221f1b',
      textMuted: '#6c655b',
      accent: '#9c4a34',
      accentText: '#faf8f4',
      border: '#e2dccf',
    },
  },
  ink: {
    label: 'Ink',
    note: 'Near-black ground with a single cool signal.',
    colours: {
      background: '#0d0f13',
      surface: '#161a20',
      text: '#eef1f5',
      textMuted: '#909aa8',
      accent: '#5b9dff',
      accentText: '#0d0f13',
      border: '#242a33',
    },
  },
  slate: {
    label: 'Slate',
    note: 'Cool white, blue-grey type, a green signal.',
    colours: {
      background: '#ffffff',
      surface: '#f3f6f8',
      text: '#16212b',
      textMuted: '#5d7183',
      accent: '#2f7d5f',
      accentText: '#ffffff',
      border: '#dde5ea',
    },
  },
  bone: {
    label: 'Bone',
    note: 'Pale sand and charcoal, no colour at all.',
    colours: {
      background: '#f6f5f2',
      surface: '#eceae4',
      text: '#1c1c1a',
      textMuted: '#6e6c66',
      accent: '#1c1c1a',
      accentText: '#f6f5f2',
      border: '#dedbd3',
    },
  },
};

export const PALETTE_ORDER: PaletteId[] = ['designed', 'paper', 'ink', 'slate', 'bone'];

export const FACE_LABEL: Record<FaceId, string> = {
  designed: 'As designed',
  grotesque: 'Grotesque',
  geometric: 'Geometric',
  editorial: 'Editorial',
  literary: 'Literary',
  technical: 'Technical',
  condensed: 'Condensed',
};

export const FACE_ORDER: FaceId[] = [
  'designed',
  'grotesque',
  'geometric',
  'editorial',
  'literary',
  'technical',
  'condensed',
];

/** Swatches for a palette tile, given the template it would be applied to. */
export function paletteSwatches(starter: Starter, palette: PaletteId): [string, string, string] {
  const colours = PALETTES[palette].colours;
  if (!colours) return starter.swatches;
  return [colours.background, colours.text, colours.accent];
}

/** The theme a set of choices produces for a template. */
export function themeFor(starter: Starter, choices: StarterChoices): ProjectTheme {
  const colours = PALETTES[choices.palette ?? 'designed'].colours;
  const face = choices.face && choices.face !== 'designed' ? FACES[choices.face] : null;

  return {
    ...starter.theme,
    ...(colours ?? {}),
    ...(face ? { fontDisplay: face.display, fontBody: face.body } : {}),
  };
}

/** Whether a set of choices would change anything at all. */
export function isUntouched(choices: StarterChoices): boolean {
  return (
    !choices.name?.trim() &&
    (choices.palette ?? 'designed') === 'designed' &&
    (choices.face ?? 'designed') === 'designed'
  );
}

/**
 * Writes the business name onto every wordmark.
 *
 * Mutates the freshly built project rather than returning a copy, because it
 * has not been handed to anybody yet — no store holds it, no history records
 * it, and nothing can be observing it. Doing this as SET_TEXT commands would
 * put an undoable edit at the top of the history of a project that has not
 * been edited, which reads as a mistake rather than as a choice.
 */
function renameBrand(project: Project, name: string): void {
  for (const node of Object.values(project.nodes)) {
    if (node.name === BRAND_NODE && node.text !== undefined) node.text = name;
  }

  // Definitions too: a template is free to put its wordmark inside a component.
  for (const def of Object.values(project.components)) {
    for (const node of Object.values(def.nodes)) {
      if (node.name === BRAND_NODE && node.text !== undefined) node.text = name;
    }
  }
}

/** The style keys that carry a colour and can therefore be remapped. */
const COLOUR_KEYS = ['color', 'backgroundColor', 'borderColor'] as const;

/**
 * Repoints colours a template wrote as literals at the new palette.
 *
 * Almost every colour in a template is a theme reference, which is what makes
 * a palette reach the whole page. A handful are not: a section that wanted its
 * template's surface colour sometimes says so directly. Those would keep the
 * old palette's value while everything around them changed, which reads as the
 * picker being broken rather than as the template being unusual.
 *
 * The mapping is only ever from one of the template's *own* theme values to
 * the same slot in the new one. A colour the template invented — a literal
 * that is not in its theme at all — is deliberately left alone: there is
 * nothing to map it to, and guessing at the nearest slot would recolour
 * something whose whole point was to be different.
 */
function recolourLiterals(project: Project, from: ProjectTheme): void {
  const to = project.settings.theme;

  const mapping = new Map<string, string>();
  for (const token of THEME_TOKENS) {
    const before = from[token];
    const after = to[token];
    // Fonts live in the same record; only the colours are remapped here.
    if (typeof before === 'string' && before.startsWith('#') && before !== after) {
      mapping.set(before.toLowerCase(), after);
    }
  }
  if (mapping.size === 0) return;

  const repoint = (node: ElementNode): void => {
    for (const patch of Object.values(node.styles) as StyleProps[]) {
      for (const key of COLOUR_KEYS) {
        const value = patch[key];
        if (!value || tokenOf(value)) continue;
        const mapped = mapping.get(value.toLowerCase());
        if (mapped) patch[key] = mapped;
      }
    }
  };

  for (const node of Object.values(project.nodes)) repoint(node);
  for (const def of Object.values(project.components)) {
    for (const node of Object.values(def.nodes)) repoint(node);
  }
}

/** A project from a template, opened as somebody's own. */
export function personalisedProject(starter: Starter, choices: StarterChoices): Project {
  const name = choices.name?.trim();

  const project = createProject({
    name: name || starter.name,
    description: starter.description,
    theme: themeFor(starter, choices),
    pages: starter.pages,
    components: starter.components,
  });

  if (name) renameBrand(project, name);
  recolourLiterals(project, starter.theme);
  return project;
}
