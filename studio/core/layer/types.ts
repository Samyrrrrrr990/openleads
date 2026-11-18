/**
 * Zory Layer: patching software somebody else shipped.
 *
 * A Layer patch is the same idea as a Studio command — a small, typed,
 * serialisable description of one change — pointed at a page Zory did not
 * build. The difference is that Studio owns its nodes and Layer does not, so
 * every patch carries a *target*: a description of the element rich enough to
 * find it again on a page that has been redeployed since.
 *
 * Two rules run through this whole subsystem:
 *
 *   1. Never store executable code. A patch is data. There is no `eval`, no
 *      injected script, no stored snippet. That is what makes a shared Zory
 *      safe to install from someone you do not know.
 *   2. Never guess. If the target cannot be found with confidence, the patch
 *      does not apply and says so. Editing a random element that happened to
 *      look similar is worse than doing nothing.
 */

export type LayerCommandType =
  | 'SET_TEXT'
  | 'SET_STYLE'
  | 'SET_ATTRIBUTE'
  | 'HIDE_ELEMENT'
  | 'SHOW_ELEMENT'
  | 'MOVE_ELEMENT';

export interface LayerSetText {
  type: 'SET_TEXT';
  text: string;
}

/**
 * Style overrides, as CSS property names in camelCase.
 *
 * Restricted to an allowlist (see `isAllowedStyleProperty`). The list is not
 * about what looks good — it is about what cannot be used to disguise the page
 * as something else, so `position: fixed`, `content` and anything that can
 * load a URL are absent.
 */
export interface LayerSetStyle {
  type: 'SET_STYLE';
  styles: Record<string, string>;
}

export interface LayerSetAttribute {
  type: 'SET_ATTRIBUTE';
  name: string;
  /** `null` removes the attribute. */
  value: string | null;
}

export interface LayerHideElement {
  type: 'HIDE_ELEMENT';
}

export interface LayerShowElement {
  type: 'SHOW_ELEMENT';
}

export interface LayerMoveElement {
  type: 'MOVE_ELEMENT';
  /** One position among its siblings. Repeat the patch to move further. */
  direction: 'up' | 'down';
}

export type ZoryLayerCommand =
  | LayerSetText
  | LayerSetStyle
  | LayerSetAttribute
  | LayerHideElement
  | LayerShowElement
  | LayerMoveElement;

/** One step of structural ancestry, nearest ancestor last. */
export interface TargetPathStep {
  tag: string;
  /** 1-based position among siblings sharing this tag. */
  index: number;
  id?: string;
  classes?: string[];
}

/**
 * Everything known about an element at the moment it was targeted.
 *
 * Nothing here is authoritative on its own. `resolveTarget` scores all of it
 * together, because every individual signal breaks: ids get generated, class
 * names get hashed by a build, text changes with the content, and structural
 * position changes the moment a banner is added at the top of the page.
 */
export interface ElementTarget {
  tag: string;
  id?: string;
  /** `data-testid`, `data-test`, `data-cy` — the most stable signal there is. */
  testId?: string;
  role?: string;
  ariaLabel?: string;
  name?: string;
  /** Classes with build-generated noise filtered out. */
  classes?: string[];
  /** First ~80 characters of normalised text, as a fingerprint. */
  text?: string;
  path: TargetPathStep[];
  /** 1-based position among same-tag siblings, as a last-resort tiebreak. */
  index: number;
}

export type RouteMatch = 'exact' | 'prefix' | 'origin';

export interface PatchScope {
  /** `https://example.com` — never includes a path. */
  origin: string;
  /** Pathname the patch was made on. Absent means the whole origin. */
  route?: string;
  routeMatch: RouteMatch;
}

export interface ZoryPatch {
  id: string;
  scope: PatchScope;
  target: ElementTarget;
  command: ZoryLayerCommand;
  createdAt: number;
  updatedAt: number;
  /** Kept but not applied. Turning a patch off must not lose it. */
  disabled?: boolean;
  /** Human label for the patch list. */
  label?: string;
}

/**
 * A shareable bundle of patches.
 *
 * This is the object model behind a "Zory" — someone's focus mode for a site
 * they use every day. It carries no code and no permissions beyond the origins
 * its patches already name.
 */
export interface ZoryPackage {
  /** Schema version of the package format itself. */
  version: 1;
  id: string;
  name: string;
  description?: string;
  /** Origins the package touches, derived from its patches. */
  origins: string[];
  patches: ZoryPatch[];
  author?: string;
  createdAt: number;
  updatedAt: number;
}

// ------------------------------------------------------------------ safety --

/**
 * Style properties a patch may set.
 *
 * The exclusions are the interesting part. `position` is absent because a
 * fixed overlay can cover a page's real controls; `content` is absent because
 * it can fabricate text that is not in the DOM; anything taking a `url()` is
 * absent because it turns a data-only patch into a network request.
 */
export const ALLOWED_STYLE_PROPERTIES: readonly string[] = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'textDecoration',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'width',
  'maxWidth',
  'minWidth',
  'height',
  'maxHeight',
  'minHeight',
  'display',
  'flexDirection',
  'alignItems',
  'justifyContent',
  'flexWrap',
  'gap',
  'gridTemplateColumns',
  'borderWidth',
  'borderStyle',
  'borderColor',
  'borderRadius',
  'boxShadow',
  'opacity',
  'overflow',
  'order',
];

const STYLE_SET = new Set(ALLOWED_STYLE_PROPERTIES);

export function isAllowedStyleProperty(property: string): boolean {
  return STYLE_SET.has(property);
}

/**
 * Values that may be written into a style declaration.
 *
 * Rejects anything that can fetch (`url(`), anything that can execute
 * (`expression(`, `javascript:`) and anything that tries to end the
 * declaration early to smuggle a second one in.
 */
export function isSafeStyleValue(value: string): boolean {
  if (value.length > 200) return false;
  const lowered = value.toLowerCase();
  if (lowered.includes('url(')) return false;
  if (lowered.includes('expression(')) return false;
  if (lowered.includes('javascript:')) return false;
  if (lowered.includes('</')) return false;
  if (/[;{}]/.test(value)) return false;
  return true;
}

/**
 * Attributes a patch may write.
 *
 * Deliberately tiny. Everything that loads, navigates or executes is missing,
 * and `on*` handlers are impossible by construction rather than by filtering.
 */
export const ALLOWED_ATTRIBUTES: readonly string[] = [
  'title',
  'aria-label',
  'alt',
  'placeholder',
  'lang',
  'dir',
];

const ATTRIBUTE_SET = new Set(ALLOWED_ATTRIBUTES);

export function isAllowedAttribute(name: string): boolean {
  return ATTRIBUTE_SET.has(name.toLowerCase());
}

/**
 * Elements Zory Layer will not touch, in any way, ever.
 *
 * Password and payment inputs are the obvious ones. Forms carrying
 * authentication are here too: a patch that reorders a login form is a patch
 * that can move a submit button under a cursor.
 */
export const FORBIDDEN_SELECTORS: readonly string[] = [
  'input[type="password"]',
  'input[type="hidden"]',
  'input[autocomplete*="cc-"]',
  'input[autocomplete*="password"]',
  'input[name*="card" i]',
  'input[name*="cvc" i]',
  'input[name*="cvv" i]',
  'input[name*="ssn" i]',
  'input[id*="card" i]',
  'iframe',
  'script',
  'style',
  'link',
  'meta',
  'head',
  'html',
];

export type PatchFailure =
  | { reason: 'not-found' }
  | { reason: 'ambiguous'; matches: number }
  | { reason: 'low-confidence'; confidence: number }
  | { reason: 'forbidden' }
  | { reason: 'invalid'; detail: string };

export type PatchOutcome = { ok: true; confidence: number } | ({ ok: false } & PatchFailure);

/** Explains a failure in the user's language. */
export function describeFailure(failure: PatchFailure): string {
  switch (failure.reason) {
    case 'not-found':
      return 'This element is no longer on the page.';
    case 'ambiguous':
      return `${failure.matches} elements look like this one, so Zory did not guess.`;
    case 'low-confidence':
      return 'The page changed too much to be sure this is the same element.';
    case 'forbidden':
      return 'Zory does not modify password, payment or embedded content.';
    case 'invalid':
      return failure.detail;
  }
}
