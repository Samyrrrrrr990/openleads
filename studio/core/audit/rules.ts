/**
 * Auditing a project graph.
 *
 * The point of holding an interface as data is that questions can be asked of
 * it. "Is any text too small to read", "does every image have alt text",
 * "is this heading order skipping a level" are all answerable from the graph
 * without rendering anything, without a browser, and in a few milliseconds.
 *
 * That makes them answerable in CI, which is the difference between a design
 * system that is documented and one that holds.
 *
 * Two rules about the rules:
 *
 *   every finding names the node   "contrast is low" is not actionable;
 *                                  "Hero subtitle is 11px" is.
 *   nothing here is a matter of    A rule somebody would reasonably disagree
 *   taste                          with is a rule they will disable, and a
 *                                  disabled audit checks nothing.
 */

import type { Breakpoint, ElementNode, Project, StyleProps } from '../graph/types';
import { BREAKPOINTS } from '../graph/types';

export type Severity = 'error' | 'warning';

export interface Finding {
  rule: string;
  severity: Severity;
  nodeId: string;
  /** The node's name, so a report reads without a second lookup. */
  nodeName: string;
  message: string;
  /** Which breakpoint the problem is on, when it is specific to one. */
  breakpoint?: Breakpoint;
}

export interface AuditResult {
  findings: Finding[];
  errors: number;
  warnings: number;
  /** How many nodes were looked at, so an empty result is distinguishable. */
  checked: number;
}

/** The smallest text that is still comfortably readable on a phone. */
const MIN_FONT_PX = 12;

/** Below this, a tap target is hard to hit accurately. */
const MIN_TAP_PX = 44;

function pxOf(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?[\d.]+)px$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** The style that actually applies at a breakpoint, after the cascade. */
export function resolvedStyle(node: ElementNode, breakpoint: Breakpoint): StyleProps {
  const chain: Breakpoint[] = BREAKPOINTS.slice(0, BREAKPOINTS.indexOf(breakpoint) + 1);
  return chain.reduce<StyleProps>((out, level) => ({ ...out, ...(node.styles[level] ?? {}) }), {});
}

/* ------------------------------------------------------------------ rules -- */

function textTooSmall(node: ElementNode, findings: Finding[]): void {
  for (const breakpoint of BREAKPOINTS) {
    const size = pxOf(resolvedStyle(node, breakpoint).fontSize);
    if (size === null || size >= MIN_FONT_PX) continue;

    findings.push({
      rule: 'text-too-small',
      severity: 'warning',
      nodeId: node.id,
      nodeName: node.name,
      breakpoint,
      message: `${size}px is below ${MIN_FONT_PX}px and hard to read on a phone.`,
    });
  }
}

function imageWithoutAlt(node: ElementNode, findings: Finding[]): void {
  if (node.kind !== 'image') return;

  const alt = node.props.alt;
  // An empty alt is a legitimate choice for decoration, so only a missing one
  // is a finding. A screen reader announces the filename otherwise.
  if (typeof alt === 'string') return;

  findings.push({
    rule: 'image-without-alt',
    severity: 'error',
    nodeId: node.id,
    nodeName: node.name,
    message: 'This image has no alt text, so a screen reader reads its filename.',
  });
}

function linkWithoutHref(node: ElementNode, findings: Finding[]): void {
  if (node.kind !== 'link') return;
  const href = typeof node.props.href === 'string' ? node.props.href.trim() : '';
  if (href !== '' && href !== '#') return;

  findings.push({
    rule: 'link-without-destination',
    severity: 'warning',
    nodeId: node.id,
    nodeName: node.name,
    message: 'This link goes nowhere. It reads as a link and does nothing when clicked.',
  });
}

function emptyText(node: ElementNode, findings: Finding[]): void {
  if (node.kind !== 'heading' && node.kind !== 'text' && node.kind !== 'button') return;
  if ((node.text ?? '').trim() !== '') return;

  findings.push({
    rule: 'empty-text',
    severity: 'warning',
    nodeId: node.id,
    nodeName: node.name,
    message: `This ${node.kind} has no text, so it takes up space and says nothing.`,
  });
}

function tapTargetTooSmall(node: ElementNode, findings: Finding[]): void {
  if (node.kind !== 'button' && node.kind !== 'link') return;

  const style = resolvedStyle(node, 'mobile');
  const height = pxOf(style.height) ?? pxOf(style.minHeight);
  if (height === null || height >= MIN_TAP_PX) return;

  findings.push({
    rule: 'tap-target-too-small',
    severity: 'warning',
    nodeId: node.id,
    nodeName: node.name,
    breakpoint: 'mobile',
    message: `${height}px tall is under the ${MIN_TAP_PX}px that is comfortable to tap.`,
  });
}

/**
 * Headings that skip a level.
 *
 * Checked per page in document order, because heading structure is how
 * somebody using a screen reader navigates a page. Going from h1 to h3 is not
 * a style choice; it removes a rung from the ladder.
 */
function headingOrder(project: Project, findings: Finding[]): void {
  for (const page of project.pages) {
    let previous = 0;

    const walk = (nodeId: string): void => {
      const node = project.nodes[nodeId];
      if (!node) return;

      if (node.kind === 'heading') {
        const level = typeof node.props.level === 'number' ? node.props.level : 1;
        if (previous !== 0 && level > previous + 1) {
          findings.push({
            rule: 'heading-level-skipped',
            severity: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: `Jumps from h${previous} to h${level}, which removes a rung from the outline.`,
          });
        }
        previous = level;
      }

      for (const child of node.children) walk(child);
    };

    walk(page.rootId);
  }
}

/** Exactly one h1 per page: the page's own title. */
function headingCount(project: Project, findings: Finding[]): void {
  for (const page of project.pages) {
    const found: ElementNode[] = [];

    const walk = (nodeId: string): void => {
      const node = project.nodes[nodeId];
      if (!node) return;
      if (node.kind === 'heading' && node.props.level === 1) found.push(node);
      for (const child of node.children) walk(child);
    };
    walk(page.rootId);

    if (found.length > 1) {
      for (const node of found.slice(1)) {
        findings.push({
          rule: 'multiple-h1',
          severity: 'warning',
          nodeId: node.id,
          nodeName: node.name,
          message: `${page.name} has ${found.length} level-1 headings. A page has one title.`,
        });
      }
    }
  }
}

/* ----------------------------------------------------------------- runner -- */

export const RULES = [
  'text-too-small',
  'image-without-alt',
  'link-without-destination',
  'empty-text',
  'tap-target-too-small',
  'heading-level-skipped',
  'multiple-h1',
] as const;

export type RuleName = (typeof RULES)[number];

export function audit(project: Project, options: { skip?: RuleName[] } = {}): AuditResult {
  const skip = new Set<string>(options.skip ?? []);
  const findings: Finding[] = [];
  let checked = 0;

  for (const node of Object.values(project.nodes)) {
    checked += 1;
    textTooSmall(node, findings);
    imageWithoutAlt(node, findings);
    linkWithoutHref(node, findings);
    emptyText(node, findings);
    tapTargetTooSmall(node, findings);
  }

  headingOrder(project, findings);
  headingCount(project, findings);

  const kept = findings.filter((finding) => !skip.has(finding.rule));

  return {
    findings: kept,
    errors: kept.filter((finding) => finding.severity === 'error').length,
    warnings: kept.filter((finding) => finding.severity === 'warning').length,
    checked,
  };
}
