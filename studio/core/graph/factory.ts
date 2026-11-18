/**
 * Project construction.
 *
 * `createProject` assembles a graph from a page blueprint so starters and the
 * blank project share exactly one code path.
 */

import type {
  ComponentDef,
  ComponentDefId,
  ElementNode,
  NodeId,
  PageNode,
  Project,
  ProjectSettings,
  ProjectTheme,
} from './types';
import { DEFAULT_BREAKPOINTS, SCHEMA_VERSION } from './types';
import { newComponentId, newPageId, newProjectId } from './ids';
import type { NodeBlueprint } from '../commands/factories';
import { materialise } from '../commands/factories';

export const NEUTRAL_THEME: ProjectTheme = {
  background: '#ffffff',
  surface: '#f7f8fa',
  text: '#14171c',
  textMuted: '#5c6675',
  accent: '#14171c',
  accentText: '#ffffff',
  border: '#e4e7ec',
  fontDisplay: "'Inter', system-ui, sans-serif",
  fontBody: "'Inter', system-ui, sans-serif",
};

export interface PageBlueprint {
  name: string;
  path: string;
  root: NodeBlueprint;
}

/**
 * A component a project ships with, declared before any id exists.
 *
 * `key` is how the pages refer to it — `{ kind: 'instance', componentKey }` —
 * and exists only during creation. Once the project is built the key is gone
 * and every reference is a minted `ComponentDefId`, so two projects from the
 * same starter share no ids and diverge freely.
 */
export interface ComponentBlueprint {
  key: string;
  name: string;
  root: NodeBlueprint;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  theme?: ProjectTheme;
  pages: PageBlueprint[];
  /**
   * Definitions the pages may instantiate.
   *
   * A starter that repeats a card six times should declare it once here and
   * place six instances, so editing the card in the finished project edits all
   * six. Nothing forces this — a template of plain nodes is still valid.
   */
  components?: ComponentBlueprint[];
  now?: number;
}

/** Every `componentKey` a blueprint tree refers to. */
function keysReferenced(blueprint: NodeBlueprint, into: Set<string> = new Set()): Set<string> {
  if (blueprint.componentKey) into.add(blueprint.componentKey);
  for (const child of blueprint.children ?? []) keysReferenced(child, into);
  return into;
}

export function createProject(input: CreateProjectInput): Project {
  const now = input.now ?? Date.now();
  const nodes: Record<string, ElementNode> = {};
  const pages: PageNode[] = [];

  // Components first: a page instantiating one needs the id that only exists
  // once the definition does.
  const components: Record<ComponentDefId, ComponentDef> = {};
  const context: { ids: Record<string, ComponentDefId>; slots: Record<string, Record<string, NodeId>> } =
    { ids: {}, slots: {} };

  for (const blueprint of input.components ?? []) {
    if (context.ids[blueprint.key]) throw new Error(`Zory: duplicate component key "${blueprint.key}"`);

    const id = newComponentId();
    const { nodes: defNodes, rootId, slots } = materialise(blueprint.root, null);
    components[id] = {
      id,
      name: blueprint.name,
      rootId,
      nodes: Object.fromEntries(defNodes.map((node) => [node.id, node])),
      createdAt: now,
      updatedAt: now,
    };
    context.ids[blueprint.key] = id;
    context.slots[blueprint.key] = slots;
  }

  /*
   * An instance whose definition is missing renders as nothing and exports as
   * nothing. That is right for a project somebody edited into that state, and
   * wrong for a typo in a starter, which would ship a template with a silent
   * hole in it. So a key that was never declared is an error at construction
   * rather than an absence at render.
   */
  for (const page of input.pages) {
    for (const key of keysReferenced(page.root)) {
      if (!context.ids[key]) {
        throw new Error(`Zory: page "${page.name}" instantiates undeclared component "${key}"`);
      }
    }
  }

  for (const page of input.pages) {
    const { nodes: pageNodes, rootId } = materialise(page.root, null, context);
    for (const node of pageNodes) nodes[node.id] = node;
    pages.push({ id: newPageId(), name: page.name, path: page.path, rootId });
  }

  const settings: ProjectSettings = {
    description: input.description ?? '',
    theme: input.theme ?? NEUTRAL_THEME,
    breakpoints: { ...DEFAULT_BREAKPOINTS },
  };

  return {
    id: newProjectId(),
    version: SCHEMA_VERSION,
    components,
    name: input.name,
    pages,
    nodes,
    assets: [],
    settings,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A blank project is not an empty page — it is a page with a sensible content
 * column already in place, so the first click has something to select.
 */
export function createBlankProject(name = 'Untitled project'): Project {
  return createProject({
    name,
    /*
     * Empty, not "A new Zory project."
     *
     * `settings.description` is not a note to the person building the site —
     * it is written straight into the exported `index.html` as the meta
     * description, which is the sentence a search engine shows under their
     * domain. Every blank project shipped with our name in it, on a page that
     * promises no attribution anywhere in the output.
     *
     * The export falls back to the project's own name when this is empty,
     * which is a truthful placeholder in a way that ours was not.
     */
    description: '',
    pages: [
      {
        name: 'Home',
        path: '/',
        root: {
          kind: 'container',
          name: 'Page',
          props: { tag: 'main' },
          styles: {
            base: {
              display: 'flex',
              flexDirection: 'column',
              minHeight: '100vh',
              backgroundColor: '#ffffff',
              fontFamily: "'Inter', system-ui, sans-serif",
              color: '#14171c',
            },
          },
          children: [
            {
              kind: 'container',
              name: 'Content',
              props: { tag: 'section' },
              styles: {
                base: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                  width: '100%',
                  maxWidth: '760px',
                  marginLeft: 'auto',
                  marginRight: 'auto',
                  paddingTop: '120px',
                  paddingRight: '32px',
                  paddingBottom: '120px',
                  paddingLeft: '32px',
                },
                mobile: { paddingTop: '72px', paddingBottom: '72px' },
              },
              children: [
                {
                  kind: 'heading',
                  name: 'Title',
                  text: 'A blank page, ready to shape',
                  props: { level: 1 },
                  styles: {
                    base: {
                      fontSize: '52px',
                      fontWeight: '600',
                      lineHeight: '1.08',
                      letterSpacing: '-0.03em',
                      color: '#14171c',
                    },
                    mobile: { fontSize: '34px' },
                  },
                },
                {
                  kind: 'text',
                  name: 'Intro',
                  text: 'Click anything on the canvas to select it, then edit it in the inspector. Press Cmd+K (or Ctrl+K) to describe a change in your own words.',
                  styles: {
                    base: {
                      fontSize: '18px',
                      lineHeight: '1.6',
                      color: '#5c6675',
                      maxWidth: '58ch',
                    },
                  },
                },
                {
                  kind: 'button',
                  name: 'Primary action',
                  text: 'Get started',
                  styles: {
                    base: {
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 'fit-content',
                      paddingTop: '12px',
                      paddingRight: '22px',
                      paddingBottom: '12px',
                      paddingLeft: '22px',
                      marginTop: '8px',
                      backgroundColor: '#14171c',
                      color: '#ffffff',
                      borderRadius: '8px',
                      fontSize: '15px',
                      fontWeight: '550',
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  });
}
