/**
 * Auditing an interface read from somebody else's source.
 *
 * The same idea as `audit/rules.ts` and a different input. That one asks its
 * questions of a `Project`, where every style is resolved through a known
 * cascade; this asks them of a repository, where the only reliable facts are
 * the elements, their props and how they nest.
 *
 * So the rule set is narrower on purpose. There is no `text-too-small` here,
 * because a font size lives in CSS or in a utility class and the honest answer
 * from source alone is "unknown" — and a rule that guesses is a rule teams
 * disable, which takes the working rules down with it.
 *
 * What is left is the set that is *statically certain*: an image with no `alt`
 * attribute has no `alt` attribute, whatever the stylesheet says. Every rule
 * here is a WCAG failure a reviewer would accept without argument.
 *
 * ## Resolving through the component graph
 *
 * Heading order is the reason this bothers to expand routes rather than
 * checking each component alone. A component that starts at `h2` is not a
 * skip — its parent almost certainly rendered the `h1` — so a per-component
 * check produces exactly the false positives that make an audit ignorable.
 * Expanding a route through the components it renders is what makes "this page
 * goes h1 → h3" a claim worth making.
 *
 * ## It never reports on what it could not read
 *
 * An element inside a `.map()` or behind a ternary was skipped by the reader,
 * and a rule must not conclude anything from its absence. Silence about an
 * unread subtree is correct; a finding about one is a fabrication.
 */

import type { Severity } from '../audit/rules';
import type { ComponentId, ElementRef, InterfaceMap, SourceRef } from './types';
import { walk } from './types';

/**
 * A problem found in a repository's interface.
 *
 * `Severity` is the one from `audit/rules.ts`, not a second spelling of it: a
 * finding from a repository and a finding from a project mean the same thing
 * by "error", and a caller rendering both should not have to reconcile two.
 */
export interface InterfaceFinding {
  rule: string;
  severity: Severity;
  /** Where to go and look. The whole point of carrying source refs. */
  source: SourceRef;
  /** The element, so the message reads without a second lookup. */
  element: string;
  message: string;
  /** The route this was found on, when it was reached through one. */
  route?: string;
}

export interface InterfaceAuditResult {
  findings: InterfaceFinding[];
  errors: number;
  warnings: number;
  /** Elements actually examined, so an empty result is distinguishable. */
  checked: number;
}

/** Rule names match `audit/rules.ts` where the rule is the same question. */
export const INTERFACE_RULES = [
  'image-without-alt',
  'link-without-destination',
  'button-without-label',
  'heading-level-skipped',
  'multiple-h1',
  'click-without-keyboard',
] as const;

export type InterfaceRuleName = (typeof INTERFACE_RULES)[number];

/* ------------------------------------------------------------- helpers -- */

function prop(element: ElementRef, name: string): { present: boolean; value?: string } {
  const found = element.props.find((candidate) => candidate.name === name);
  if (!found) return { present: false };
  return found.value === undefined ? { present: true } : { present: true, value: found.value };
}

/** Heading level, or null for anything that is not a heading. */
function headingLevel(name: string): number | null {
  const match = /^h([1-6])$/.exec(name);
  return match ? Number(match[1]) : null;
}

/** True when the reader could not see inside this element. */
function unread(element: ElementRef): boolean {
  return element.skipped !== undefined;
}

/**
 * Whether an element has an accessible name from something other than text.
 *
 * A dynamic value counts. `aria-label={t('close')}` is a label; we simply
 * cannot read what it says, and refusing to accept it would flag every
 * internationalised button in the repository.
 */
function hasLabelProp(element: ElementRef): boolean {
  return element.props.some(
    (candidate) =>
      candidate.name === 'aria-label' ||
      candidate.name === 'aria-labelledby' ||
      candidate.name === 'title',
  );
}

/** Any readable text in this subtree, which is what a screen reader announces. */
function hasText(element: ElementRef): boolean {
  return walk(element).some((node) => (node.text ?? '').trim() !== '');
}

/**
 * Whether everything inside an element was actually read.
 *
 * This guard is the difference between a rule people keep and a rule people
 * disable, and it was learned the hard way: the first version of
 * `button-without-label` was run against two real repositories and was wrong
 * both times. In `shadcn-ui/taxonomy` and in `vercel/commerce` the offending
 * markup was
 *
 *     <button>{pending ? <LoadingDots /> : "Proceed to Checkout"}</button>
 *
 * — a button whose label sits behind a conditional, which is one of the most
 * common shapes in React. The reader correctly recorded the conditional as
 * unread; the rule then concluded from its absence that there was no label,
 * which is exactly the fabrication this module's header forbids.
 *
 * So: a rule that reasons about what is *missing* from a subtree may only fire
 * when the whole subtree was read. Rules that reason about an element's own
 * props — `alt`, `href`, `role` — are unaffected, because a prop cannot hide
 * inside a child.
 */
function fullyRead(element: ElementRef): boolean {
  return walk(element).every((node) => node.skipped === undefined);
}

/**
 * A route's elements, expanded through the components it renders.
 *
 * Depth- and visit-limited: a component that renders itself is legal React and
 * must not be an infinite expansion here. A component reached twice is expanded
 * once — the second occurrence is the same markup and would only double every
 * finding.
 */
function expandRoute(map: InterfaceMap, entry: ComponentId, maxDepth = 8): ElementRef[] {
  const out: ElementRef[] = [];
  const seen = new Set<ComponentId>();

  const visit = (id: ComponentId, depth: number): void => {
    if (depth > maxDepth || seen.has(id)) return;
    seen.add(id);

    const component = map.components[id];
    if (!component?.root) return;

    for (const element of walk(component.root)) {
      out.push(element);
      if (element.componentId) visit(element.componentId, depth + 1);
    }
  };

  visit(entry, 0);
  return out;
}

/* --------------------------------------------------------------- rules -- */

function elementRules(
  element: ElementRef,
  route: string | undefined,
  findings: InterfaceFinding[],
): void {
  if (unread(element)) return;

  const at = (rule: string, severity: Severity, message: string): void => {
    findings.push({
      rule,
      severity,
      source: element.source,
      element: element.name,
      message,
      ...(route ? { route } : {}),
    });
  };

  if (element.name === 'img' && !prop(element, 'alt').present) {
    /*
     * `alt=""` is deliberately *not* a finding. An empty alt is the correct
     * markup for a decorative image, and flagging it would push people to
     * write a description for a spacer.
     */
    at('image-without-alt', 'error', 'has no alt attribute, so a screen reader announces its filename.');
  }

  if (element.name === 'a') {
    const href = prop(element, 'href');
    if (!href.present) {
      at('link-without-destination', 'error', 'is a link with no href, so it is not reachable by keyboard.');
    } else if (href.value === '#' || href.value === '') {
      at('link-without-destination', 'error', `points at "${href.value}", which goes nowhere.`);
    }
  }

  /*
   * Only when the whole button was read — see `fullyRead`. A label behind a
   * ternary is a label; not being able to see it is our limitation, not the
   * repository's bug.
   */
  if (
    element.name === 'button' &&
    !hasText(element) &&
    !hasLabelProp(element) &&
    fullyRead(element)
  ) {
    // The icon-button failure: renders an SVG, announces nothing at all.
    at('button-without-label', 'error', 'has no text and no aria-label, so it announces nothing.');
  }

  /*
   * A handler on something that is not focusable.
   *
   * Only flagged on plain containers: a `<div onClick>` cannot be reached by
   * keyboard unless it has been given a role and a tab stop. A component with
   * an `onClick` prop is passing a callback down and is not this bug.
   */
  const clickable = element.props.some((candidate) => candidate.name === 'onClick');
  if (clickable && (element.name === 'div' || element.name === 'span')) {
    const focusable = prop(element, 'tabIndex').present && prop(element, 'role').present;
    if (!focusable) {
      at(
        'click-without-keyboard',
        'warning',
        'handles a click but has no role and no tabIndex, so a keyboard cannot reach it.',
      );
    }
  }
}

/**
 * Heading order across everything one route renders.
 *
 * Only a *skip* is reported — h1 followed by h3 — never a route that begins at
 * h2. Beginning at h2 usually means a layout rendered the h1 somewhere this
 * expansion did not reach, and reporting it would be a false positive on a
 * perfectly ordinary page.
 */
function headingRules(
  elements: ElementRef[],
  route: string | undefined,
  findings: InterfaceFinding[],
): void {
  /*
   * Walked in document order, tracking whether anything unread sat between two
   * headings.
   *
   * The same trap as the button rule. Given
   *
   *     <h1/>  {showDetail && <h2/>}  <h3/>
   *
   * a naive pass sees h1 followed by h3 and reports a skip that does not exist
   * at runtime. An unread element between two headings makes the claim unsafe,
   * so the comparison is dropped rather than guessed at.
   */
  const headings: { element: ElementRef; level: number; gapBefore: boolean }[] = [];
  let gap = false;

  for (const element of elements) {
    if (unread(element)) {
      gap = true;
      continue;
    }
    const level = headingLevel(element.name);
    if (level === null) continue;
    headings.push({ element, level, gapBefore: gap });
    gap = false;
  }

  let previous: number | null = null;
  for (const { element, level, gapBefore } of headings) {
    if (previous !== null && level > previous + 1 && !gapBefore) {
      findings.push({
        rule: 'heading-level-skipped',
        severity: 'warning',
        source: element.source,
        element: element.name,
        message: `follows an h${previous}, skipping a level.`,
        ...(route ? { route } : {}),
      });
    }
    previous = level;
  }

  const h1s = headings.filter((heading) => heading.level === 1);
  if (h1s.length > 1) {
    for (const extra of h1s.slice(1)) {
      findings.push({
        rule: 'multiple-h1',
        severity: 'warning',
        source: extra.element.source,
        element: 'h1',
        message: `is a second h1${route ? ` on ${route}` : ''}; a page should have one.`,
        ...(route ? { route } : {}),
      });
    }
  }
}

/* --------------------------------------------------------------- entry -- */

/**
 * Audits a repository's interface.
 *
 * Routes are audited as expanded trees; components no route reaches are
 * audited on their own, so a shared component still gets its per-element rules
 * even when nothing in the map shows where it ends up.
 */
export function auditInterface(
  map: InterfaceMap,
  options: { skip?: InterfaceRuleName[] } = {},
): InterfaceAuditResult {
  const skip = new Set<string>(options.skip ?? []);
  const findings: InterfaceFinding[] = [];
  let checked = 0;

  const covered = new Set<ComponentId>();

  for (const route of map.routes) {
    if (!route.componentId) continue;

    const elements = expandRoute(map, route.componentId);
    checked += elements.length;

    for (const element of elements) {
      if (element.componentId) covered.add(element.componentId);
      elementRules(element, route.path, findings);
    }
    covered.add(route.componentId);

    headingRules(elements, route.path, findings);
  }

  /*
   * Everything a route did not reach.
   *
   * Per-element rules only: heading order is a property of a page, and a
   * component examined outside any page has no page to be wrong about.
   */
  for (const component of Object.values(map.components)) {
    if (covered.has(component.id) || !component.root) continue;
    const elements = walk(component.root);
    checked += elements.length;
    for (const element of elements) elementRules(element, undefined, findings);
  }

  const kept = findings.filter((finding) => !skip.has(finding.rule));
  return {
    findings: kept,
    errors: kept.filter((finding) => finding.severity === 'error').length,
    warnings: kept.filter((finding) => finding.severity === 'warning').length,
    checked,
  };
}
