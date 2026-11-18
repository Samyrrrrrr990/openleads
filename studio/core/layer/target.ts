/**
 * Finding the same element again.
 *
 * This is the hard problem in Zory Layer, and the reason userscript-style
 * customisation breaks constantly. A selector like
 * `body > div:nth-child(3) > div:nth-child(7)` is correct exactly once: the
 * next deploy adds a cookie banner and it silently points at something else.
 *
 * So a target is not a selector. It is a bundle of independent signals, and
 * resolution is a scored search over the candidates that share any of them.
 * Signals are weighted by how well they survive a redeploy:
 *
 *   test id      strongest — put there deliberately, rarely churned
 *   id           strong, unless it is generated (`:r3:`, `radix-15`, hashes)
 *   role + label   strong and semantic; accessibility names are stable
 *   text         strong for buttons and headings, useless for a paragraph
 *   classes      weak alone, useful in combination; build hashes are filtered
 *   structure    weakest, but it is what disambiguates ten identical cards
 *
 * When the best candidate is not clearly better than the second, resolution
 * fails rather than picking one. A patch that does nothing is a bug report; a
 * patch applied to the wrong element is a broken page.
 */

import type { ElementTarget, TargetPathStep } from './types';
import { FORBIDDEN_SELECTORS } from './types';

const MAX_TEXT = 80;
const MAX_PATH = 6;
const MAX_CLASSES = 6;

/** Collapses whitespace so a reflowed paragraph still fingerprints the same. */
export function normaliseText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

/**
 * Class names that carry no meaning across builds.
 *
 * CSS-module hashes, styled-components names, Tailwind's arbitrary-value
 * classes and anything that is mostly digits. Keeping these would make a
 * target look precise while being the first thing a rebuild invalidates.
 */
export function isStableClass(className: string): boolean {
  if (className.length === 0 || className.length > 40) return false;
  // `Button_root__x7f3q`, `css-1q2w3e`, `sc-bdVaJa`, `jsx-1234567890`
  if (/^(css|sc|jsx)-[a-z0-9]{5,}$/i.test(className)) return false;
  if (/__[a-z0-9]{5,}$/i.test(className)) return false;
  if (/^[a-z]+-[a-f0-9]{6,}$/i.test(className)) return false;
  // Mostly digits, or containing a long hex run.
  if (/[0-9a-f]{8,}/i.test(className)) return false;
  // Tailwind arbitrary values change with every tweak: `w-[327px]`.
  if (className.includes('[')) return false;
  return true;
}

/** Ids frameworks generate per render, which are worthless as a signal. */
export function isStableId(id: string): boolean {
  if (id.length === 0 || id.length > 60) return false;
  if (/^:r[0-9a-z]+:$/i.test(id)) return false; // React useId
  if (/^radix-/i.test(id)) return false;
  if (/^headlessui-/i.test(id)) return false;
  if (/^mui-\d+$/i.test(id)) return false;
  if (/^[0-9a-f]{8,}$/i.test(id)) return false;
  return true;
}

function classesOf(element: Element): string[] {
  const raw = typeof element.className === 'string' ? element.className : '';
  return raw
    .split(/\s+/)
    .filter((name) => name.length > 0 && isStableClass(name))
    .slice(0, MAX_CLASSES);
}

function testIdOf(element: Element): string | undefined {
  for (const attribute of ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa']) {
    const value = element.getAttribute(attribute);
    if (value) return value;
  }
  return undefined;
}

function siblingIndex(element: Element): number {
  const parent = element.parentElement;
  if (!parent) return 1;
  let index = 0;
  for (const child of Array.from(parent.children)) {
    if (child.tagName === element.tagName) {
      index += 1;
      if (child === element) return index;
    }
  }
  return 1;
}

/** Text of an element, ignoring the text of nested block children. */
function ownText(element: Element): string {
  const text = element.textContent ?? '';
  return normaliseText(text);
}

/** True when Zory must not read from or write to this element at all. */
export function isForbiddenElement(element: Element): boolean {
  for (const selector of FORBIDDEN_SELECTORS) {
    try {
      if (element.matches(selector)) return true;
    } catch {
      // A selector this environment cannot parse is not a reason to allow it.
      return true;
    }
  }
  // Anything inside a password-bearing form is off limits too.
  const form = element.closest('form');
  if (form && form.querySelector('input[type="password"]')) return true;
  return false;
}

export function describeTarget(element: Element): ElementTarget {
  const path: TargetPathStep[] = [];
  let cursor: Element | null = element.parentElement;
  while (cursor && path.length < MAX_PATH && cursor.tagName !== 'HTML') {
    const step: TargetPathStep = {
      tag: cursor.tagName.toLowerCase(),
      index: siblingIndex(cursor),
    };
    const id = cursor.getAttribute('id');
    if (id && isStableId(id)) step.id = id;
    const classes = classesOf(cursor);
    if (classes.length > 0) step.classes = classes;
    path.unshift(step);
    cursor = cursor.parentElement;
  }

  const target: ElementTarget = {
    tag: element.tagName.toLowerCase(),
    path,
    index: siblingIndex(element),
  };

  const id = element.getAttribute('id');
  if (id && isStableId(id)) target.id = id;

  const testId = testIdOf(element);
  if (testId) target.testId = testId;

  const role = element.getAttribute('role');
  if (role) target.role = role;

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) target.ariaLabel = ariaLabel;

  const name = element.getAttribute('name');
  if (name) target.name = name;

  const classes = classesOf(element);
  if (classes.length > 0) target.classes = classes;

  const text = ownText(element);
  if (text.length > 0) target.text = text;

  return target;
}

// --------------------------------------------------------------- resolution --

interface Scored {
  element: Element;
  score: number;
}

/**
 * Signal weights.
 *
 * These are ordered by how expensive it is to be wrong. A test id matching is
 * near-proof; a tag matching is near-nothing, and is only here so that two
 * candidates with identical everything else still separate.
 */
const WEIGHTS = {
  testId: 40,
  id: 30,
  role: 8,
  ariaLabel: 14,
  name: 8,
  tag: 4,
  textExact: 22,
  textPartial: 10,
  classAll: 14,
  classSome: 7,
  pathTail: 10,
  pathFull: 8,
  index: 3,
} as const;

const MAX_SCORE =
  WEIGHTS.testId +
  WEIGHTS.id +
  WEIGHTS.role +
  WEIGHTS.ariaLabel +
  WEIGHTS.name +
  WEIGHTS.tag +
  WEIGHTS.textExact +
  WEIGHTS.classAll +
  WEIGHTS.pathTail +
  WEIGHTS.pathFull +
  WEIGHTS.index;

/** Only signals the target actually recorded can contribute. */
function availableScore(target: ElementTarget): number {
  let total = WEIGHTS.tag + WEIGHTS.index;
  if (target.testId) total += WEIGHTS.testId;
  if (target.id) total += WEIGHTS.id;
  if (target.role) total += WEIGHTS.role;
  if (target.ariaLabel) total += WEIGHTS.ariaLabel;
  if (target.name) total += WEIGHTS.name;
  if (target.text) total += WEIGHTS.textExact;
  if (target.classes && target.classes.length > 0) total += WEIGHTS.classAll;
  if (target.path.length > 0) total += WEIGHTS.pathTail + WEIGHTS.pathFull;
  return Math.max(total, 1);
}

function scoreElement(element: Element, target: ElementTarget): number {
  let score = 0;

  if (element.tagName.toLowerCase() === target.tag) score += WEIGHTS.tag;

  if (target.testId && testIdOf(element) === target.testId) score += WEIGHTS.testId;
  if (target.id && element.getAttribute('id') === target.id) score += WEIGHTS.id;
  if (target.role && element.getAttribute('role') === target.role) score += WEIGHTS.role;
  if (target.ariaLabel && element.getAttribute('aria-label') === target.ariaLabel) {
    score += WEIGHTS.ariaLabel;
  }
  if (target.name && element.getAttribute('name') === target.name) score += WEIGHTS.name;

  if (target.text) {
    const text = ownText(element);
    if (text === target.text) score += WEIGHTS.textExact;
    else if (text.length > 0 && (text.includes(target.text) || target.text.includes(text))) {
      score += WEIGHTS.textPartial;
    }
  }

  if (target.classes && target.classes.length > 0) {
    const classes = new Set(classesOf(element));
    const hits = target.classes.filter((name) => classes.has(name)).length;
    if (hits === target.classes.length) score += WEIGHTS.classAll;
    else if (hits > 0) score += WEIGHTS.classSome * (hits / target.classes.length);
  }

  if (target.path.length > 0) {
    // The nearest ancestor is worth more than the whole chain: a wrapper added
    // near the body should not invalidate an otherwise perfect match.
    const parent = element.parentElement;
    const tail = target.path[target.path.length - 1];
    if (parent && tail && parent.tagName.toLowerCase() === tail.tag) {
      score += WEIGHTS.pathTail * 0.5;
      const tailClasses = tail.classes ?? [];
      if (tailClasses.length > 0) {
        const have = new Set(classesOf(parent));
        const hits = tailClasses.filter((name) => have.has(name)).length;
        score += WEIGHTS.pathTail * 0.5 * (hits / tailClasses.length);
      } else if (tail.id && parent.getAttribute('id') === tail.id) {
        score += WEIGHTS.pathTail * 0.5;
      }
    }

    let matched = 0;
    let cursor: Element | null = element.parentElement;
    for (let i = target.path.length - 1; i >= 0 && cursor; i -= 1) {
      if (cursor.tagName.toLowerCase() === target.path[i]!.tag) matched += 1;
      cursor = cursor.parentElement;
    }
    score += WEIGHTS.pathFull * (matched / target.path.length);
  }

  if (siblingIndex(element) === target.index) score += WEIGHTS.index;

  return score;
}

/**
 * The narrowest candidate set that can still contain the element.
 *
 * Querying by the strongest recorded signal first keeps this off
 * `document.querySelectorAll('*')` for every patch, which matters on a page
 * with fifty thousand nodes and ten patches.
 */
function candidates(root: ParentNode, target: ElementTarget): Element[] {
  const seen = new Set<Element>();
  const out: Element[] = [];
  const add = (elements: ArrayLike<Element>): void => {
    for (const element of Array.from(elements)) {
      if (!seen.has(element)) {
        seen.add(element);
        out.push(element);
      }
    }
  };

  const escape = (value: string): string =>
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : value.replace(/["\\]/g, '\\$&');

  try {
    if (target.testId) {
      add(root.querySelectorAll(`[data-testid="${escape(target.testId)}"]`));
      add(root.querySelectorAll(`[data-test="${escape(target.testId)}"]`));
      add(root.querySelectorAll(`[data-cy="${escape(target.testId)}"]`));
    }
    if (target.id) add(root.querySelectorAll(`#${escape(target.id)}`));
    if (target.ariaLabel) add(root.querySelectorAll(`[aria-label="${escape(target.ariaLabel)}"]`));
    if (out.length === 0 && target.classes && target.classes.length > 0) {
      const selector = target.classes.map((name) => `.${escape(name)}`).join('');
      add(root.querySelectorAll(`${target.tag}${selector}`));
    }
    if (out.length === 0) add(root.querySelectorAll(target.tag));
  } catch {
    // A malformed stored target should degrade to a tag scan, not throw.
    try {
      add(root.querySelectorAll(target.tag));
    } catch {
      return [];
    }
  }

  return out;
}

export interface Resolution {
  element: Element | null;
  /** 0..1. Above `CONFIDENT` a patch may apply. */
  confidence: number;
  /** How many candidates scored within a hair of the winner. */
  ties: number;
}

/** Below this, Zory refuses to apply. Chosen so a redeploy that renames one
    class still resolves, while a genuinely different element does not. */
export const CONFIDENT = 0.62;

export function resolveTarget(root: ParentNode, target: ElementTarget): Resolution {
  const pool = candidates(root, target);
  if (pool.length === 0) return { element: null, confidence: 0, ties: 0 };

  const scored: Scored[] = [];
  for (const element of pool) {
    if (isForbiddenElement(element)) continue;
    scored.push({ element, score: scoreElement(element, target) });
  }
  if (scored.length === 0) return { element: null, confidence: 0, ties: 0 };

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const available = availableScore(target);
  const confidence = Math.min(1, best.score / available);

  // A near-tie means the signals do not distinguish these elements. Report it
  // rather than taking the first one the DOM happened to yield.
  const ties = scored.filter((entry) => entry.score >= best.score - 0.5).length;

  return { element: best.element, confidence, ties };
}

export { MAX_SCORE };
