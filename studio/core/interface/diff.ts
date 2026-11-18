/**
 * What changed about a repository's interface.
 *
 * The point of the whole exercise. `git diff` answers "which characters
 * changed", which is not the question a reviewer has — they want to know
 * whether the page changed and how, and today they answer it by pulling the
 * branch and looking, or by not answering it at all.
 *
 * This produces the same `InterfaceDiff` that `diffProjects` produces, on
 * purpose. The markdown renderer, the summary line, the structural/cosmetic
 * split and the pull-request comment that edits itself in place are all
 * written already and all tested; emitting a different shape would mean a
 * second renderer that drifts from the first.
 *
 * ## Elements have no ids, so they are matched by path
 *
 * A `Project` node carries a stable id, which is what lets its diff say "this
 * moved". An element read out of somebody's JSX has no such thing — it is a
 * position in a tree. So each element gets a path key built from its ancestry
 * and its index among same-named siblings: `main/section[0]/h1[0]`.
 *
 * That is weaker than an id and the weakness is worth stating: inserting a
 * `<div>` above a section renumbers everything below it, and a run of pure
 * renumbering reads as a set of changes rather than as one insertion. It is
 * still far better than line-based matching, because it survives reformatting,
 * reindenting, prop reordering and anything else that moves characters without
 * moving the interface.
 *
 * ## It refuses to be confident about what it could not read
 *
 * The most dangerous output this could produce is "no interface changes" about
 * a pull request that changed everything inside a `.map()`. Coverage travels
 * with the diff so a caller can say so, and a subtree that neither side read
 * is never reported as unchanged — it is not reported at all.
 */

import type { Change, InterfaceDiff } from '../diff/diff';
import type { ComponentNode, ElementRef, InterfaceMap, TokenSet } from './types';

/* ------------------------------------------------------------------ util -- */

/**
 * Whether the reader genuinely could not see this element's contents.
 *
 * `external` does not count: the element itself was read in full. See the note
 * on `SkipReason.external`, and the comment where this is used.
 */
function unread(element: ElementRef): boolean {
  return element.skipped !== undefined && element.skipped !== 'external';
}

function show(value: unknown): string {
  if (value === undefined || value === null) return '—';
  return String(value);
}

function clip(value: string, max = 60): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Every element in a component, keyed by its path.
 *
 * The index counts only same-named siblings, so adding a `<p>` does not
 * renumber the `<section>`s beside it — a small thing that removes a large
 * amount of noise from an ordinary diff.
 */
function byPath(root: ElementRef | null): Map<string, ElementRef> {
  const out = new Map<string, ElementRef>();
  if (!root) return out;

  const visit = (element: ElementRef, prefix: string): void => {
    const path = prefix === '' ? element.name : `${prefix}/${element.name}`;
    // Disambiguate repeats of the same tag under one parent.
    let key = path;
    let n = 1;
    while (out.has(key)) key = `${path}[${n++}]`;
    out.set(key, element);

    for (const child of element.children) visit(child, key);
  };

  visit(root, '');
  return out;
}

/** Props as a plain record, so two sets can be compared key by key. */
function propsOf(element: ElementRef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const prop of element.props) out[prop.name] = prop.value ?? '(dynamic)';
  return out;
}

/** Which route renders a component, for naming a change somewhere a person goes. */
function routeOf(map: InterfaceMap): Map<string, string> {
  const out = new Map<string, string>();

  for (const route of map.routes) {
    if (!route.componentId) continue;

    // Walk the component graph so a shared component is attributed to a page.
    const stack = [route.componentId];
    const seen = new Set<string>();

    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      // First route wins: a component on three pages is named by one of them
      // rather than reported three times.
      if (!out.has(id)) out.set(id, route.path);

      const component = map.components[id];
      if (component) stack.push(...component.uses);
    }
  }

  return out;
}

/* ------------------------------------------------------------------ diff -- */

function diffTokens(before: TokenSet, after: TokenSet, changes: Change[]): void {
  // `other` included: an unclassifiable token is still a token, and a change
  // to `--radius` moves every rounded corner in the product.
  const buckets: (keyof TokenSet)[] = ['colors', 'spacing', 'fontSizes', 'fonts', 'other'];

  for (const bucket of buckets) {
    const keys = new Set([...Object.keys(before[bucket]), ...Object.keys(after[bucket])]);

    for (const key of keys) {
      const from = before[bucket][key];
      const to = after[bucket][key];
      if (from === to) continue;

      changes.push({
        kind: 'theme',
        id: `${bucket}.${key}`,
        name: 'Theme',
        property: key,
        before: show(from),
        after: show(to),
        // The highest-blast-radius change there is, and the one a per-file
        // diff can never surface: one token moves every page at once.
        summary: `Theme: ${key} ${show(from)} → ${show(to)}`,
      });
    }
  }
}

function diffRoutes(before: InterfaceMap, after: InterfaceMap, changes: Change[]): void {
  const was = new Map(before.routes.map((route) => [route.path, route]));
  const is = new Map(after.routes.map((route) => [route.path, route]));

  for (const route of after.routes) {
    if (was.has(route.path)) continue;
    changes.push({
      kind: 'page-added',
      id: route.path,
      name: route.path,
      summary: `Route ${route.path} added (${route.source.file})`,
    });
  }

  for (const route of before.routes) {
    if (is.has(route.path)) continue;
    changes.push({
      kind: 'page-removed',
      id: route.path,
      name: route.path,
      // A removed route is a 404 for anybody holding the link.
      summary: `Route ${route.path} removed`,
    });
  }
}

function diffElements(
  component: ComponentNode,
  old: ComponentNode,
  route: string | undefined,
  changes: Change[],
): void {
  const wasElements = byPath(old.root);
  const isElements = byPath(component.root);
  const where = route ? { page: route } : {};

  for (const [path, element] of isElements) {
    const previous = wasElements.get(path);

    if (!previous) {
      changes.push({
        kind: 'node-added',
        id: `${component.id}:${path}`,
        name: element.name,
        ...where,
        summary: `<${element.name}> added in ${component.name}`,
      });
      continue;
    }

    /*
     * Neither side could read this, so there is nothing to compare and nothing
     * to claim. Reporting it as unchanged would be the exact failure this
     * module exists to avoid.
     *
     * `external` is deliberately **not** in that category, and getting this
     * wrong cost a real missed change. An external component — `<Link>`,
     * `<Button>`, anything from a package — has been read: its props, its
     * children and its text are all right there in the JSX, and only the
     * component's own definition is out of reach. Treating it as unread meant
     * that rewriting the copy inside a `<Link>` produced no change at all,
     * which is the single worst thing this tool can do.
     */
    if (unread(element) && unread(previous)) continue;

    if ((previous.text ?? '') !== (element.text ?? '')) {
      changes.push({
        kind: 'text',
        id: `${component.id}:${path}`,
        name: element.name,
        ...where,
        before: show(previous.text),
        after: show(element.text),
        summary: `${component.name}: “${clip(previous.text ?? '')}” → “${clip(element.text ?? '')}”`,
      });
    }

    const wasProps = propsOf(previous);
    const isProps = propsOf(element);
    for (const key of new Set([...Object.keys(wasProps), ...Object.keys(isProps)])) {
      const from = wasProps[key];
      const to = isProps[key];
      if (from === to) continue;

      changes.push({
        kind: 'prop',
        id: `${component.id}:${path}`,
        name: element.name,
        ...where,
        property: key,
        before: show(from),
        after: show(to),
        summary: `<${element.name}> ${key}: ${show(from)} → ${show(to)}`,
      });
    }
  }

  for (const [path, element] of wasElements) {
    if (isElements.has(path)) continue;
    changes.push({
      kind: 'node-removed',
      id: `${component.id}:${path}`,
      name: element.name,
      ...where,
      summary: `<${element.name}> removed from ${component.name}`,
    });
  }
}

function diffComponents(before: InterfaceMap, after: InterfaceMap, changes: Change[]): void {
  const routes = routeOf(after);
  const oldRoutes = routeOf(before);

  for (const component of Object.values(after.components)) {
    const old = before.components[component.id];
    const route = routes.get(component.id);

    if (!old) {
      changes.push({
        kind: 'node-added',
        id: component.id,
        name: component.name,
        ...(route ? { page: route } : {}),
        summary: `Component ${component.name} added (${component.source.file})`,
      });
      continue;
    }

    diffElements(component, old, route, changes);
  }

  for (const component of Object.values(before.components)) {
    if (after.components[component.id]) continue;
    const route = oldRoutes.get(component.id);
    changes.push({
      kind: 'node-removed',
      id: component.id,
      name: component.name,
      ...(route ? { page: route } : {}),
      summary: `Component ${component.name} removed`,
    });
  }
}

/**
 * Every difference between two readings of a repository.
 *
 * Ordered structurally first — what appeared, what vanished, what moved — then
 * content, then cosmetics, because that is the order a reviewer wants and the
 * order `toMarkdown` renders in.
 */
export function diffInterfaces(before: InterfaceMap, after: InterfaceMap): InterfaceDiff {
  const changes: Change[] = [];

  diffRoutes(before, after, changes);
  diffComponents(before, after, changes);
  diffTokens(before.tokens, after.tokens, changes);

  const rank: Record<string, number> = {
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
  changes.sort((a, b) => (rank[a.kind] ?? 99) - (rank[b.kind] ?? 99));

  return {
    changes,
    added: changes.filter((c) => c.kind === 'node-added' || c.kind === 'page-added').length,
    removed: changes.filter((c) => c.kind === 'node-removed' || c.kind === 'page-removed').length,
    moved: changes.filter((c) => c.kind === 'node-moved').length,
    restyled: changes.filter((c) => c.kind === 'theme' || c.kind === 'prop').length,
    identical: changes.length === 0,
  };
}

/**
 * Whether a diff of these two maps can be trusted to be complete.
 *
 * A pull request that changed only what neither side could read produces an
 * empty diff, and "no interface changes" is then a false statement rather than
 * a missing one. Callers must say so instead of publishing a clean result.
 */
export function diffIsComplete(before: InterfaceMap, after: InterfaceMap, floor = 0.7): boolean {
  return before.coverage.confidence >= floor && after.coverage.confidence >= floor;
}
