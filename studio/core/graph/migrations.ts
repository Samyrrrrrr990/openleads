/**
 * Schema migration and repair.
 *
 * Projects live in the user's browser indefinitely, so a project written by an
 * older build of Zory must keep opening. Every incompatible schema change adds
 * a step here; `migrateProject` walks a stored project up to SCHEMA_VERSION.
 *
 * `repairProject` runs afterwards on every load. It is deliberately forgiving:
 * a graph with a dangling child reference should open with that reference
 * dropped rather than crash the editor.
 */

import type { ElementNode, Project } from './types';
import { DEFAULT_BREAKPOINTS, SCHEMA_VERSION } from './types';
import { newNodeId } from './ids';
import { validateMotion } from '../commands/validate';

/** A single version step: takes the previous shape, returns the next. */
type Migration = (project: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version being migrated *from*. To add version 2, write
 * `1: (p) => ({ ...p, version: 2, /* new fields *\/ })`.
 */
const MIGRATIONS: Record<number, Migration> = {
  /*
   * 1 → 2: nodes gained optional `motion`.
   *
   * Purely additive, so there is nothing to move. The step is written out
   * anyway: an empty migration that says "nothing needed here" is the
   * difference between a considered decision and a version bump somebody
   * forgot to handle.
   */
  1: (project) => ({ ...project, version: 2 }),
  /*
   * 2 → 3: projects gained `components`, and nodes gained the `instance` kind
   * that refers to them.
   *
   * Not purely additive the way 1 → 2 was: `components` is a required field,
   * and every existing project predates it. Without this step the fallback
   * below would stamp the version forward and leave `components` undefined,
   * which reads as "this project has no definitions" everywhere it is touched
   * and throws in the one place it is iterated.
   */
  2: (project) => ({ ...project, version: 3, components: project.components ?? {} }),
};

export class SchemaTooNewError extends Error {
  constructor(public readonly found: number) {
    super(
      `This project was created with a newer version of Zory (schema ${found}, this build reads ${SCHEMA_VERSION}).`,
    );
    this.name = 'SchemaTooNewError';
  }
}

export function migrateProject(stored: unknown): Project {
  if (typeof stored !== 'object' || stored === null) {
    throw new Error('Zory: stored project is not an object');
  }

  let current = stored as Record<string, unknown>;
  let version = typeof current.version === 'number' ? current.version : 0;

  if (version > SCHEMA_VERSION) throw new SchemaTooNewError(version);

  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      // No step registered: the shape is compatible, just stamp it forward.
      current = { ...current, version: version + 1 };
      version += 1;
      continue;
    }
    current = step(current);
    const next = typeof current.version === 'number' ? current.version : version + 1;
    if (next <= version) throw new Error(`Zory: migration from ${version} did not advance the version`);
    version = next;
  }

  return repairProject(current as unknown as Project);
}

/**
 * Brings a project back to a well-formed state: no dangling child ids, no
 * orphaned nodes, every page rooted in a real container.
 */
export function repairProject(input: Project): Project {
  const project: Project = {
    ...input,
    version: SCHEMA_VERSION,
    nodes: { ...input.nodes },
    pages: [...(input.pages ?? [])],
    assets: [...(input.assets ?? [])],
    // A project written before schema 3, or one hand-edited since, has none.
    components: { ...(input.components ?? {}) },
    settings: {
      description: input.settings?.description ?? '',
      theme: input.settings?.theme ?? fallbackTheme(),
      breakpoints: input.settings?.breakpoints ?? { ...DEFAULT_BREAKPOINTS },
    },
  };

  // Normalise node shape.
  for (const [id, raw] of Object.entries(project.nodes)) {
    if (!raw || typeof raw !== 'object') {
      delete project.nodes[id];
      continue;
    }
    const node: ElementNode = {
      ...raw,
      id,
      children: Array.isArray(raw.children) ? raw.children : [],
      props: raw.props ?? {},
      styles: raw.styles ?? {},
      name: raw.name ?? raw.kind ?? 'Element',
      parentId: raw.parentId ?? null,
    };
    // Motion that no longer validates is dropped rather than carried: a
    // stored project should open, and a broken animation is not worth
    // refusing to open it for.
    if (node.motion && !validateMotion(node.motion).ok) delete node.motion;
    project.nodes[id] = node;
  }

  // Ensure every page has a real root container.
  if (project.pages.length === 0) {
    const rootId = newNodeId();
    project.nodes[rootId] = emptyRoot(rootId);
    project.pages.push({ id: `p_${rootId}`, name: 'Home', path: '/', rootId });
  }

  for (const page of project.pages) {
    if (!project.nodes[page.rootId]) {
      const rootId = newNodeId();
      project.nodes[rootId] = emptyRoot(rootId);
      page.rootId = rootId;
    } else {
      project.nodes[page.rootId]!.parentId = null;
    }
  }

  // Drop child references that point at missing nodes and de-duplicate.
  for (const node of Object.values(project.nodes)) {
    const seen = new Set<string>();
    node.children = node.children.filter((childId) => {
      if (seen.has(childId) || !project.nodes[childId] || childId === node.id) return false;
      seen.add(childId);
      return true;
    });
  }

  // Re-derive parentId from the authoritative children arrays.
  const parentOf = new Map<string, string>();
  for (const node of Object.values(project.nodes)) {
    for (const childId of node.children) parentOf.set(childId, node.id);
  }

  const rootIds = new Set(project.pages.map((page) => page.rootId));
  for (const node of Object.values(project.nodes)) {
    if (rootIds.has(node.id)) {
      node.parentId = null;
      continue;
    }
    node.parentId = parentOf.get(node.id) ?? null;
  }

  // Drop anything no longer reachable from a page root.
  const reachable = new Set<string>();
  const stack = [...rootIds];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const childId of project.nodes[id]?.children ?? []) stack.push(childId);
  }
  for (const id of Object.keys(project.nodes)) {
    if (!reachable.has(id)) delete project.nodes[id];
  }

  return project;
}

function emptyRoot(id: string): ElementNode {
  return {
    id,
    kind: 'container',
    name: 'Page',
    parentId: null,
    children: [],
    props: { tag: 'main' },
    styles: { base: { display: 'flex', flexDirection: 'column', minHeight: '100vh' } },
  };
}

function fallbackTheme(): Project['settings']['theme'] {
  return {
    background: '#ffffff',
    surface: '#f6f7f9',
    text: '#111318',
    textMuted: '#5b6472',
    accent: '#1a1a1a',
    accentText: '#ffffff',
    border: '#e3e6ea',
    fontDisplay: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
  };
}
