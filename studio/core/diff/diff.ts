/**
 * What changed about an interface.
 *
 * `git diff` answers "which characters changed". That is a real question and
 * not the one a reviewer has. Looking at forty lines of altered JSX and CSS
 * modules, the thing you are trying to work out is: *did the page change, and
 * how*. Everyone reconstructs that by hand, badly, which is why interface
 * regressions are usually found by a person opening the site.
 *
 * Because Zory holds the interface as data with stable ids, that question is
 * directly answerable. A node that moved is a node whose parent or position
 * changed — not a block of text that disappeared from one file and appeared in
 * another and has to be matched up by eye.
 *
 * Two decisions worth stating:
 *
 *   **Ids, not shapes.** Nodes are compared by id, which is what makes "this
 *   moved" expressible at all. Rename a node, restyle it and drag it across
 *   the page, and this still reports one node with three changes rather than a
 *   deletion and an unrelated addition.
 *
 *   **Stored overrides, not resolved values.** Styles are compared as written,
 *   per breakpoint. Editing `base` also changes what mobile resolves to, and
 *   reporting that as "mobile changed too" would triple every diff and bury
 *   the edit somebody actually made. A reviewer wants the edit.
 */

import type {
  Breakpoint,
  ElementNode,
  NodeProps,
  Project,
  ProjectTheme,
  StyleProps,
} from '../graph/types';
import { BREAKPOINTS } from '../graph/types';

export type ChangeKind =
  | 'page-added'
  | 'page-removed'
  | 'page-renamed'
  | 'node-added'
  | 'node-removed'
  | 'node-renamed'
  | 'node-moved'
  | 'text'
  | 'style'
  | 'prop'
  | 'motion'
  | 'theme';

/** Everything except a style tweak is structural, and reviewed differently. */
const STRUCTURAL: ReadonlySet<ChangeKind> = new Set<ChangeKind>([
  'page-added',
  'page-removed',
  'node-added',
  'node-removed',
  'node-moved',
]);

export interface Change {
  kind: ChangeKind;
  /** Node id, page id, or `theme`. */
  id: string;
  /** Human-facing name, so a report reads without a second lookup. */
  name: string;
  /** Which page this is on, where that is knowable. */
  page?: string;
  /** Set only when the change is specific to one breakpoint. */
  breakpoint?: Breakpoint;
  /** Which property moved, for style, prop and theme changes. */
  property?: string;
  before?: string;
  after?: string;
  /** One line, complete on its own. */
  summary: string;
}

export interface InterfaceDiff {
  changes: Change[];
  added: number;
  removed: number;
  moved: number;
  restyled: number;
  /** Nothing differs. Worth asking directly rather than checking a length. */
  identical: boolean;
}

/* ------------------------------------------------------------------ util -- */

/** Values are CSS strings or a number (`opacity`); normalise for comparison. */
function show(value: unknown): string {
  if (value === undefined || value === null) return '—';
  return String(value);
}

/** Long text makes a diff unreadable; the ends are what identify it. */
function clip(value: string, max = 60): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Which page each node sits on.
 *
 * Walked from the page roots rather than read off the nodes, because a node
 * knows its parent but not which tree it ultimately belongs to. Nodes that are
 * unreachable from any root — orphans a damaged project can contain — simply
 * do not appear here, and their changes are reported without a page.
 */
function pageOfNode(project: Project): Map<string, string> {
  const owner = new Map<string, string>();

  for (const page of project.pages) {
    // Iterative rather than recursive: a deep tree should not depend on the
    // call stack, and a cyclic one must not hang. `seen` guards both.
    const stack = [page.rootId];
    const seen = new Set<string>();

    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);

      const node = project.nodes[id];
      if (!node) continue;
      owner.set(id, page.name);
      stack.push(...node.children);
    }
  }

  return owner;
}

/** Where a node sits among its siblings, for detecting reorders. */
function indexInParent(project: Project, node: ElementNode): number {
  if (node.parentId === null) return 0;
  return project.nodes[node.parentId]?.children.indexOf(node.id) ?? -1;
}

/* ------------------------------------------------------------------ diff -- */

function diffPages(before: Project, after: Project, changes: Change[]): void {
  const was = new Map(before.pages.map((page) => [page.id, page]));
  const is = new Map(after.pages.map((page) => [page.id, page]));

  for (const page of after.pages) {
    if (!was.has(page.id)) {
      changes.push({
        kind: 'page-added',
        id: page.id,
        name: page.name,
        summary: `Page “${page.name}” added at ${page.path}`,
      });
    }
  }

  for (const page of before.pages) {
    if (!is.has(page.id)) {
      changes.push({
        kind: 'page-removed',
        id: page.id,
        name: page.name,
        summary: `Page “${page.name}” removed`,
      });
    }
  }

  for (const page of after.pages) {
    const old = was.get(page.id);
    if (!old) continue;

    if (old.name !== page.name) {
      changes.push({
        kind: 'page-renamed',
        id: page.id,
        name: page.name,
        property: 'name',
        before: old.name,
        after: page.name,
        summary: `Page renamed: “${old.name}” → “${page.name}”`,
      });
    }

    if (old.path !== page.path) {
      changes.push({
        kind: 'page-renamed',
        id: page.id,
        name: page.name,
        property: 'path',
        before: old.path,
        after: page.path,
        // Called out rather than folded into a rename: a path change breaks
        // every inbound link, which is a different conversation.
        summary: `Route changed: ${old.path} → ${page.path}`,
      });
    }
  }
}

function diffStyles(
  node: ElementNode,
  old: ElementNode,
  page: string | undefined,
  changes: Change[],
): void {
  for (const breakpoint of BREAKPOINTS) {
    const wasStyles: StyleProps = old.styles[breakpoint] ?? {};
    const isStyles: StyleProps = node.styles[breakpoint] ?? {};

    const keys = new Set([...Object.keys(wasStyles), ...Object.keys(isStyles)]);
    for (const key of keys) {
      const from = wasStyles[key as keyof StyleProps];
      const to = isStyles[key as keyof StyleProps];
      if (from === to) continue;

      const where = breakpoint === 'base' ? '' : ` at ${breakpoint}`;
      changes.push({
        kind: 'style',
        id: node.id,
        name: node.name,
        ...(page ? { page } : {}),
        breakpoint,
        property: key,
        before: show(from),
        after: show(to),
        summary: `${node.name}${where}: ${key} ${show(from)} → ${show(to)}`,
      });
    }
  }
}

function diffProps(
  node: ElementNode,
  old: ElementNode,
  page: string | undefined,
  changes: Change[],
): void {
  const keys = new Set([...Object.keys(old.props), ...Object.keys(node.props)]);

  for (const key of keys) {
    const from = old.props[key as keyof NodeProps];
    const to = node.props[key as keyof NodeProps];
    if (from === to) continue;

    changes.push({
      kind: 'prop',
      id: node.id,
      name: node.name,
      ...(page ? { page } : {}),
      property: key,
      before: show(from),
      after: show(to),
      summary: `${node.name}: ${key} ${show(from)} → ${show(to)}`,
    });
  }
}

function diffNodes(before: Project, after: Project, changes: Change[]): void {
  const pages = pageOfNode(after);
  const oldPages = pageOfNode(before);

  for (const node of Object.values(after.nodes)) {
    const old = before.nodes[node.id];
    const page = pages.get(node.id);

    if (!old) {
      changes.push({
        kind: 'node-added',
        id: node.id,
        name: node.name,
        ...(page ? { page } : {}),
        summary: `${node.name} added${page ? ` on ${page}` : ''}`,
      });
      continue;
    }

    if (old.name !== node.name) {
      changes.push({
        kind: 'node-renamed',
        id: node.id,
        name: node.name,
        ...(page ? { page } : {}),
        property: 'name',
        before: old.name,
        after: node.name,
        summary: `Renamed: “${old.name}” → “${node.name}”`,
      });
    }

    /*
     * Moved covers two different edits that look the same to a reviewer:
     * reparenting, and reordering among siblings. Both change where the thing
     * appears on the page, which is the only reason anyone is reading this.
     */
    const reparented = old.parentId !== node.parentId;
    const reordered = indexInParent(before, old) !== indexInParent(after, node);
    if (reparented || reordered) {
      const from = old.parentId ? before.nodes[old.parentId]?.name : null;
      const to = node.parentId ? after.nodes[node.parentId]?.name : null;
      changes.push({
        kind: 'node-moved',
        id: node.id,
        name: node.name,
        ...(page ? { page } : {}),
        summary: reparented
          ? `${node.name} moved from ${from ?? 'the page root'} to ${to ?? 'the page root'}`
          : `${node.name} reordered inside ${to ?? 'the page root'}`,
      });
    }

    if (old.text !== node.text) {
      changes.push({
        kind: 'text',
        id: node.id,
        name: node.name,
        ...(page ? { page } : {}),
        before: show(old.text),
        after: show(node.text),
        summary: `${node.name}: “${clip(old.text ?? '')}” → “${clip(node.text ?? '')}”`,
      });
    }

    diffStyles(node, old, page, changes);
    diffProps(node, old, page, changes);

    // Motion compiles to keyframes rather than to declarations, so it is not
    // part of the style cascade and is compared whole.
    if (JSON.stringify(old.motion ?? null) !== JSON.stringify(node.motion ?? null)) {
      changes.push({
        kind: 'motion',
        id: node.id,
        name: node.name,
        ...(page ? { page } : {}),
        summary: node.motion
          ? `${node.name}: motion ${old.motion ? 'changed' : 'added'}`
          : `${node.name}: motion removed`,
      });
    }
  }

  for (const node of Object.values(before.nodes)) {
    if (after.nodes[node.id]) continue;
    const page = oldPages.get(node.id);
    changes.push({
      kind: 'node-removed',
      id: node.id,
      name: node.name,
      ...(page ? { page } : {}),
      summary: `${node.name} removed${page ? ` from ${page}` : ''}`,
    });
  }
}

function diffTheme(before: Project, after: Project, changes: Change[]): void {
  const was = before.settings.theme;
  const is = after.settings.theme;

  for (const key of Object.keys(is) as (keyof ProjectTheme)[]) {
    if (was[key] === is[key]) continue;
    changes.push({
      kind: 'theme',
      id: 'theme',
      name: 'Theme',
      property: key,
      before: show(was[key]),
      after: show(is[key]),
      // Flagged prominently by callers: one theme token moves every page at
      // once, which is the highest-blast-radius edit in the whole system.
      summary: `Theme: ${key} ${show(was[key])} → ${show(is[key])}`,
    });
  }
}

/**
 * Every difference between two versions of a project.
 *
 * Ordered structurally first — added, removed, moved — because that is the
 * order a reviewer wants: what appeared, what vanished, what shifted, and only
 * then what was restyled. Within each kind, ordering follows the graph, which
 * is stable between runs.
 */
export function diffProjects(before: Project, after: Project): InterfaceDiff {
  const changes: Change[] = [];

  diffPages(before, after, changes);
  diffNodes(before, after, changes);
  diffTheme(before, after, changes);

  const rank: Record<ChangeKind, number> = {
    'page-added': 0,
    'page-removed': 1,
    'page-renamed': 2,
    'node-added': 3,
    'node-removed': 4,
    'node-moved': 5,
    text: 6,
    'node-renamed': 7,
    prop: 8,
    theme: 9,
    style: 10,
    motion: 11,
  };
  changes.sort((a, b) => rank[a.kind] - rank[b.kind]);

  return {
    changes,
    added: changes.filter((c) => c.kind === 'node-added' || c.kind === 'page-added').length,
    removed: changes.filter((c) => c.kind === 'node-removed' || c.kind === 'page-removed').length,
    moved: changes.filter((c) => c.kind === 'node-moved').length,
    restyled: changes.filter((c) => c.kind === 'style' || c.kind === 'theme').length,
    identical: changes.length === 0,
  };
}

/** True for the changes that alter what exists, rather than how it looks. */
export function isStructural(change: Change): boolean {
  return STRUCTURAL.has(change.kind);
}

/**
 * One sentence for the top of a pull request.
 *
 * Deliberately not a count of every property: "412 changes" tells a reviewer
 * nothing and reads as noise. What they need first is whether anything
 * appeared or vanished, and whether the theme moved — because that one is
 * never local.
 */
export function summarise(diff: InterfaceDiff): string {
  if (diff.identical) return 'No interface changes.';

  const parts: string[] = [];
  if (diff.added > 0) parts.push(`${diff.added} added`);
  if (diff.removed > 0) parts.push(`${diff.removed} removed`);
  if (diff.moved > 0) parts.push(`${diff.moved} moved`);
  if (diff.restyled > 0) parts.push(`${diff.restyled} restyled`);

  const themed = diff.changes.some((change) => change.kind === 'theme');
  return `${parts.join(', ')}${themed ? ' · theme changed, so every page is affected' : ''}`;
}

/**
 * The diff as Markdown, for a pull request comment.
 *
 * Grouped by page, because that is how somebody checks the work — they open a
 * page and look at it. A flat list sorted by change type would be easier to
 * generate and useless to act on.
 */
export function toMarkdown(diff: InterfaceDiff, limit = 50): string {
  if (diff.identical) return '### Interface\n\nNo interface changes.';

  const lines = ['### Interface', '', summarise(diff), ''];

  const byPage = new Map<string, Change[]>();
  for (const change of diff.changes) {
    const key = change.page ?? 'Project';
    const list = byPage.get(key) ?? [];
    list.push(change);
    byPage.set(key, list);
  }

  for (const [page, changes] of byPage) {
    lines.push(`**${page}**`, '');
    for (const change of changes.slice(0, limit)) {
      lines.push(`- ${isStructural(change) ? '**' : ''}${change.summary}${isStructural(change) ? '**' : ''}`);
    }
    if (changes.length > limit) lines.push(`- _and ${changes.length - limit} more_`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
