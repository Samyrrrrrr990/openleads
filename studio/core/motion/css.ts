/**
 * Motion → CSS.
 *
 * One generator serves both the canvas and the export, which is what keeps
 * the preview honest: the editor is not simulating the animation, it is
 * running the same rules that will ship. The only difference is the selector —
 * the canvas targets `[data-zory-id]`, an export targets a class name.
 *
 * Everything here is ordinary CSS. Reduced motion is handled once, at the
 * bottom of every stylesheet, by turning animation and transition off rather
 * than by shipping a second set of rules.
 */

import type { EntranceMotion, HoverMotion, NodeMotion, PressMotion } from './types';
import { EASING_CSS, clampNumber, MOTION_LIMITS, usesDistance } from './types';

/** The transform an entrance starts from. */
function fromTransform(effect: EntranceMotion['effect'], distance: number): string | null {
  switch (effect) {
    case 'rise':
      return `translate3d(0, ${distance}px, 0)`;
    case 'fall':
      return `translate3d(0, ${-distance}px, 0)`;
    case 'slide-left':
      return `translate3d(${-distance}px, 0, 0)`;
    case 'slide-right':
      return `translate3d(${distance}px, 0, 0)`;
    case 'scale':
      return 'scale3d(0.94, 0.94, 1)';
    case 'fade':
    case 'blur':
      return null;
  }
}

/**
 * A stable keyframe name for a given effect and distance.
 *
 * Naming by shape rather than by node means twenty cards that rise 24px share
 * one `@keyframes` block instead of writing twenty identical ones.
 *
 * The prefix is `enter-`, not `zory-`, and that is not cosmetic: these names
 * are written into exported stylesheets, and Zory is sold on the promise that
 * you can delete every mention of it from an export and still have a project
 * that runs. A brand name in a keyframe would quietly make that false.
 */
export function keyframeName(entrance: EntranceMotion): string {
  const distance = usesDistance(entrance.effect)
    ? Math.round(clampNumber(entrance.distance ?? 24, MOTION_LIMITS.distance.min, MOTION_LIMITS.distance.max))
    : 0;
  return `enter-${entrance.effect}${distance ? `-${distance}` : ''}`;
}

export function keyframeBlock(entrance: EntranceMotion): string {
  const distance = clampNumber(
    entrance.distance ?? 24,
    MOTION_LIMITS.distance.min,
    MOTION_LIMITS.distance.max,
  );
  const transform = fromTransform(entrance.effect, distance);
  const from: string[] = ['opacity: 0;'];
  if (transform) from.push(`transform: ${transform};`);
  if (entrance.effect === 'blur') from.push('filter: blur(10px);');

  const to: string[] = ['opacity: 1;'];
  if (transform) to.push('transform: none;');
  if (entrance.effect === 'blur') to.push('filter: blur(0);');

  return [
    `@keyframes ${keyframeName(entrance)} {`,
    `  from { ${from.join(' ')} }`,
    `  to { ${to.join(' ')} }`,
    '}',
  ].join('\n');
}

function ms(value: number, limit: { min: number; max: number }): string {
  return `${Math.round(clampNumber(value, limit.min, limit.max))}ms`;
}

/** The `animation` shorthand for an entrance, without the trigger gate. */
export function animationShorthand(entrance: EntranceMotion): string {
  return [
    keyframeName(entrance),
    ms(entrance.duration, MOTION_LIMITS.duration),
    EASING_CSS[entrance.easing] ?? EASING_CSS['ease-out'],
    ms(entrance.delay, MOTION_LIMITS.delay),
    'both',
  ].join(' ');
}

function hoverDeclarations(hover: HoverMotion): string[] {
  const out: string[] = [];
  const parts: string[] = [];
  if (hover.lift !== undefined && hover.lift !== 0) {
    parts.push(`translate3d(0, ${-clampNumber(hover.lift, MOTION_LIMITS.lift.min, MOTION_LIMITS.lift.max)}px, 0)`);
  }
  if (hover.scale !== undefined && hover.scale !== 1) {
    const scale = clampNumber(hover.scale, MOTION_LIMITS.scale.min, MOTION_LIMITS.scale.max);
    parts.push(`scale3d(${scale}, ${scale}, 1)`);
  }
  if (parts.length > 0) out.push(`transform: ${parts.join(' ')};`);
  if (hover.opacity !== undefined) {
    out.push(`opacity: ${clampNumber(hover.opacity, MOTION_LIMITS.opacity.min, MOTION_LIMITS.opacity.max)};`);
  }
  if (hover.backgroundColor) out.push(`background-color: ${hover.backgroundColor};`);
  if (hover.color) out.push(`color: ${hover.color};`);
  if (hover.borderColor) out.push(`border-color: ${hover.borderColor};`);
  if (hover.boxShadow) out.push(`box-shadow: ${hover.boxShadow};`);
  return out;
}

/** The properties a hover state touches, so the transition names only those. */
function hoverTransition(hover: HoverMotion): string {
  const properties: string[] = [];
  if ((hover.lift !== undefined && hover.lift !== 0) || (hover.scale !== undefined && hover.scale !== 1)) {
    properties.push('transform');
  }
  if (hover.opacity !== undefined) properties.push('opacity');
  if (hover.backgroundColor) properties.push('background-color');
  if (hover.color) properties.push('color');
  if (hover.borderColor) properties.push('border-color');
  if (hover.boxShadow) properties.push('box-shadow');
  if (properties.length === 0) return '';

  const duration = ms(hover.duration, MOTION_LIMITS.duration);
  const easing = EASING_CSS[hover.easing] ?? EASING_CSS['ease-out'];
  return properties.map((property) => `${property} ${duration} ${easing}`).join(', ');
}

function pressDeclarations(press: PressMotion): string[] {
  const scale = clampNumber(press.scale, MOTION_LIMITS.scale.min, MOTION_LIMITS.scale.max);
  return [`transform: scale3d(${scale}, ${scale}, 1);`];
}

export interface MotionRules {
  /** `@keyframes` blocks this node needs, keyed by name for de-duplication. */
  keyframes: Record<string, string>;
  /** Complete rules, already selector-qualified. */
  rules: string[];
}

export interface MotionCssOptions {
  /**
   * The selector for the node itself, e.g. `.hero` or `[data-zory-id="n_1"]`.
   */
  selector: string;
  /**
   * Selector for a direct child, used by stagger. Receives the 1-based index.
   * Defaults to `${selector} > :nth-child(n)`.
   */
  childSelector?: (index: number) => string;
  /**
   * How many children to write stagger rules for. Writing one rule per child
   * is bounded on purpose — a 400-item list would otherwise produce 400 rules.
   */
  childCount?: number;
  /**
   * Gate applied to a scroll-triggered entrance. The canvas plays entrances on
   * demand and an export waits for the reveal observer, so the attribute that
   * unlocks the animation differs.
   */
  revealAttribute?: string;
}

const MAX_STAGGER_CHILDREN = 24;

/**
 * Builds every rule one node's motion needs.
 *
 * Scroll entrances are written twice: a resting state that holds the element
 * at its "from" frame, and the animation itself behind the reveal gate. That
 * split is what stops an element flashing at full opacity for one frame before
 * the observer catches it.
 */
export function motionRules(motion: NodeMotion, options: MotionCssOptions): MotionRules {
  const { selector } = options;
  const revealAttribute = options.revealAttribute ?? 'data-zory-visible';
  const keyframes: Record<string, string> = {};
  const rules: string[] = [];

  const entrance = motion.entrance;
  if (entrance) {
    keyframes[keyframeName(entrance)] = keyframeBlock(entrance);
    const shorthand = animationShorthand(entrance);

    if (entrance.trigger === 'load') {
      rules.push(`${selector} {\n  animation: ${shorthand};\n}`);
    } else {
      // Held at the first frame until the observer marks it visible.
      rules.push(`${selector} {\n  opacity: 0;\n}`);
      rules.push(`${selector}[${revealAttribute}] {\n  animation: ${shorthand};\n}`);
    }

    const stagger = clampNumber(entrance.stagger ?? 0, MOTION_LIMITS.stagger.min, MOTION_LIMITS.stagger.max);
    if (stagger > 0 && (options.childCount ?? 0) > 0) {
      const count = Math.min(options.childCount ?? 0, MAX_STAGGER_CHILDREN);
      const child = options.childSelector ?? ((index: number) => `${selector} > :nth-child(${index})`);
      const base = clampNumber(entrance.delay, MOTION_LIMITS.delay.min, MOTION_LIMITS.delay.max);

      // The parent stops animating itself once its children carry the arrival,
      // otherwise the group fades in and then each child fades in again.
      rules.length = 0;
      keyframes[keyframeName(entrance)] = keyframeBlock(entrance);

      for (let index = 1; index <= count; index += 1) {
        const delay = Math.round(base + stagger * (index - 1));
        const shifted = [
          keyframeName(entrance),
          ms(entrance.duration, MOTION_LIMITS.duration),
          EASING_CSS[entrance.easing] ?? EASING_CSS['ease-out'],
          `${delay}ms`,
          'both',
        ].join(' ');

        if (entrance.trigger === 'load') {
          rules.push(`${child(index)} {\n  animation: ${shifted};\n}`);
        } else {
          rules.push(`${child(index)} {\n  opacity: 0;\n}`);
          rules.push(`${selector}[${revealAttribute}] > :nth-child(${index}) {\n  animation: ${shifted};\n}`);
        }
      }
    }
  }

  const hover = motion.hover;
  if (hover) {
    const declarations = hoverDeclarations(hover);
    if (declarations.length > 0) {
      const transition = hoverTransition(hover);
      if (transition) rules.push(`${selector} {\n  transition: ${transition};\n}`);
      rules.push(`${selector}:hover {\n  ${declarations.join('\n  ')}\n}`);
    }
  }

  const press = motion.press;
  if (press && press.scale !== 1) {
    rules.push(`${selector}:active {\n  ${pressDeclarations(press).join('\n  ')}\n}`);
  }

  return { keyframes, rules };
}

/**
 * The reduced-motion block for a set of selectors.
 *
 * `animation-duration: 0.01ms` rather than `animation: none` on purpose:
 * `none` cancels the fill, so an element whose resting state is `opacity: 0`
 * would never become visible for someone who has asked for less motion.
 */
export function reducedMotionBlock(selectors: string[]): string {
  if (selectors.length === 0) return '';
  return `@media (prefers-reduced-motion: reduce) {
  ${selectors.join(',\n  ')} {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
    transition-duration: 0.01ms !important;
  }
}`;
}
