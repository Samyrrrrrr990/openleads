/**
 * Motion in the exported project.
 *
 * The same generator the canvas uses, pointed at class names instead of node
 * ids. What comes out is ordinary CSS in the section's own module: keyframes,
 * an `animation` shorthand, a `:hover` rule and a `:active` rule.
 *
 * Scroll-triggered entrances need one thing CSS cannot do on its own, which is
 * to know when an element has come into view. That is `reveal.ts` below: about
 * thirty lines of plain TypeScript written into the project, with no Zory in
 * its name, its imports or its behaviour. Delete it and the entrances become
 * on-load animations; delete the `data-reveal` attributes too and they stop.
 */

import type { ElementNode, NodeMotion, Project } from '@zory/core';
import { isEmptyMotion, motionRules, needsReveal, reducedMotionBlock } from '@zory/core';

/** Attribute the reveal module looks for. */
export const REVEAL_ATTRIBUTE = 'data-reveal';
/** Attribute it sets once the element has been seen. */
export const VISIBLE_ATTRIBUTE = 'data-visible';

export interface MotionCss {
  /** Appended to the section stylesheet, or empty. */
  css: string;
  /** True when any node here needs the reveal observer. */
  usesReveal: boolean;
}

/**
 * Builds the motion block for one component's stylesheet.
 *
 * `classNames` only contains nodes that earned a class. A node with motion and
 * no styles still needs one, which is why `collectStyleRules` includes motion
 * in what counts as "has something to write".
 */
export function motionCssFor(
  project: Project,
  ids: string[],
  classNames: Map<string, string>,
): MotionCss {
  const keyframes: Record<string, string> = {};
  const rules: string[] = [];
  const selectors: string[] = [];
  let usesReveal = false;

  for (const id of ids) {
    const node: ElementNode | undefined = project.nodes[id];
    const className = classNames.get(id);
    if (!node || !className || isEmptyMotion(node.motion)) continue;

    const motion = node.motion as NodeMotion;
    if (needsReveal(motion)) usesReveal = true;

    const built = motionRules(motion, {
      selector: `.${className}`,
      childCount: node.children.length,
      revealAttribute: VISIBLE_ATTRIBUTE,
    });

    Object.assign(keyframes, built.keyframes);
    rules.push(...built.rules);
    selectors.push(`.${className}`);
  }

  if (rules.length === 0) return { css: '', usesReveal: false };

  const css = [
    '',
    '/* Motion */',
    '',
    ...Object.values(keyframes),
    '',
    ...rules,
    '',
    reducedMotionBlock(selectors),
    '',
  ].join('\n');

  return { css, usesReveal };
}

/** True when this node should carry the reveal attribute in the markup. */
export function nodeNeedsReveal(node: ElementNode): boolean {
  return needsReveal(node.motion);
}

/**
 * The reveal module written into the exported project.
 *
 * Three properties worth keeping if you edit it:
 *
 *   - it disconnects, so a single-page app that unmounts a route does not
 *     accumulate observers;
 *   - it unobserves each element once seen, because an entrance that replays
 *     every time you scroll past is a distraction rather than a feature;
 *   - when the visitor has asked for reduced motion, or the browser has no
 *     IntersectionObserver, everything is revealed immediately. Content being
 *     visible always wins over content being animated.
 */
export const REVEAL_TS = `/**
 * Reveals elements as they scroll into view.
 *
 * Elements marked with \`${REVEAL_ATTRIBUTE}\` start at their animation's first
 * frame and are given \`${VISIBLE_ATTRIBUTE}\` when they enter the viewport,
 * which is what the CSS in each component's stylesheet waits for.
 */

const REVEAL = '[${REVEAL_ATTRIBUTE}]';
const VISIBLE = '${VISIBLE_ATTRIBUTE}';

function show(element: Element): void {
  element.setAttribute(VISIBLE, '');
}

export function observeReveals(root: ParentNode = document): () => void {
  const targets = Array.from(root.querySelectorAll(REVEAL));

  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // No observer, or no appetite for motion: show everything at once. Content
  // being visible matters more than content being animated.
  if (reducedMotion || typeof IntersectionObserver === 'undefined') {
    targets.forEach(show);
    return () => {};
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        show(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  );

  targets.forEach((target) => observer.observe(target));
  return () => observer.disconnect();
}
`;
