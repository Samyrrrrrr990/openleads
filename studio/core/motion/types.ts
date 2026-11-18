/**
 * Zory Motion.
 *
 * Motion is data on a node, not animation code in a component. That is the
 * only decision here that matters: because a node carries a description of how
 * it moves rather than a keyframe block, the same description can be previewed
 * on the canvas, written into an exported stylesheet, read back out of one,
 * undone, and reasoned about by AI — none of which is possible once motion has
 * become a hand-written `@keyframes` somewhere in a file.
 *
 * The vocabulary is deliberately small. Everything expressible here compiles
 * to plain CSS transitions, plain CSS keyframes, and — for scroll triggers
 * only — an IntersectionObserver in a file the exported project owns outright.
 * There is no animation library, no timeline runtime, and nothing that has to
 * stay installed for an exported page to move.
 */

/**
 * Named easings.
 *
 * `spring` and `snap` are cubic-bezier approximations with overshoot rather
 * than real spring physics. That is a deliberate trade: a physical spring
 * needs a JS integrator on every frame, and the overshoot is the part users
 * can actually perceive.
 */
export type EasingName = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'spring' | 'snap';

export const EASING_CSS: Record<EasingName, string> = {
  linear: 'linear',
  ease: 'ease',
  'ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
  'ease-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
  'ease-in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  snap: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)',
};

export const EASING_LABEL: Record<EasingName, string> = {
  linear: 'Linear',
  ease: 'Ease',
  'ease-in': 'Ease in',
  'ease-out': 'Ease out',
  'ease-in-out': 'Ease in out',
  spring: 'Spring',
  snap: 'Snap',
};

export const EASING_NAMES: readonly EasingName[] = [
  'ease-out',
  'ease-in-out',
  'ease-in',
  'ease',
  'linear',
  'spring',
  'snap',
];

/** How an element arrives. Directional effects use `distance`. */
export type EntranceEffect =
  | 'fade'
  | 'rise'
  | 'fall'
  | 'slide-left'
  | 'slide-right'
  | 'scale'
  | 'blur';

export const ENTRANCE_LABEL: Record<EntranceEffect, string> = {
  fade: 'Fade',
  rise: 'Rise',
  fall: 'Fall',
  'slide-left': 'Slide from left',
  'slide-right': 'Slide from right',
  scale: 'Scale',
  blur: 'Blur',
};

export const ENTRANCE_EFFECTS: readonly EntranceEffect[] = [
  'fade',
  'rise',
  'fall',
  'slide-left',
  'slide-right',
  'scale',
  'blur',
];

/** Directional effects that read `distance`. */
export function usesDistance(effect: EntranceEffect): boolean {
  return effect === 'rise' || effect === 'fall' || effect === 'slide-left' || effect === 'slide-right';
}

export interface EntranceMotion {
  effect: EntranceEffect;
  /** Milliseconds. */
  duration: number;
  /** Milliseconds before it starts. */
  delay: number;
  easing: EasingName;
  /**
   * `load` runs as soon as the element is in the document. `scroll` waits
   * until it has entered the viewport, which needs an observer — see
   * `needsReveal`.
   */
  trigger: 'load' | 'scroll';
  /** Travel in px for directional effects. Ignored otherwise. */
  distance?: number;
  /**
   * Milliseconds added per child, so a list arrives in sequence. Only
   * meaningful on a node that has children; 0 means all at once.
   */
  stagger?: number;
}

/**
 * What changes while a pointer is over the element.
 *
 * Kept as a handful of named affordances rather than an arbitrary style patch:
 * a hover state that can set any property is a second styling system, and it
 * would compete with the breakpoint cascade for ownership of the same values.
 */
export interface HoverMotion {
  /** px the element rises. Positive lifts. */
  lift?: number;
  /** 1 is unchanged. */
  scale?: number;
  opacity?: number;
  backgroundColor?: string;
  color?: string;
  borderColor?: string;
  boxShadow?: string;
  duration: number;
  easing: EasingName;
}

/** The press affordance. One value, because more than one reads as a toy. */
export interface PressMotion {
  scale: number;
}

export interface NodeMotion {
  entrance?: EntranceMotion;
  hover?: HoverMotion;
  press?: PressMotion;
}

export const DEFAULT_ENTRANCE: EntranceMotion = {
  effect: 'rise',
  duration: 600,
  delay: 0,
  easing: 'ease-out',
  trigger: 'scroll',
  distance: 24,
  stagger: 0,
};

export const DEFAULT_HOVER: HoverMotion = {
  lift: 2,
  duration: 180,
  easing: 'ease-out',
};

export const DEFAULT_PRESS: PressMotion = { scale: 0.98 };

/** True when this node's motion needs the reveal observer in an export. */
export function needsReveal(motion: NodeMotion | undefined): boolean {
  return motion?.entrance?.trigger === 'scroll';
}

/** True when there is nothing to emit. */
export function isEmptyMotion(motion: NodeMotion | undefined): boolean {
  if (!motion) return true;
  return !motion.entrance && !motion.hover && !motion.press;
}

// ------------------------------------------------------------------ bounds --

export const MOTION_LIMITS = {
  duration: { min: 0, max: 4000 },
  delay: { min: 0, max: 4000 },
  stagger: { min: 0, max: 1000 },
  distance: { min: 0, max: 400 },
  scale: { min: 0.5, max: 1.5 },
  lift: { min: -64, max: 64 },
  opacity: { min: 0, max: 1 },
} as const;

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
