/**
 * CSS generation.
 *
 * Base styles become plain rules; tablet and mobile overrides become
 * `max-width` media queries emitted widest-first, so the cascade in the
 * exported stylesheet matches the cascade in the editor exactly.
 */

import type { Breakpoint, Project, ProjectTheme, StyleProps } from '@zory/core';
import { themeRootRule } from '@zory/core';

/** camelCase → kebab-case, for writing real CSS property names. */
export function cssProperty(key: string): string {
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/** Properties that take a bare number in CSS. */
const UNITLESS = new Set(['opacity', 'lineHeight', 'fontWeight', 'zIndex', 'flexGrow', 'flexShrink']);

export function cssValue(key: string, value: string | number): string {
  if (typeof value === 'number' && !UNITLESS.has(key)) return `${value}px`;
  return String(value);
}

export function declarations(styles: StyleProps, indent = '  '): string {
  return Object.entries(styles)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${indent}${cssProperty(key)}: ${cssValue(key, value as string | number)};`)
    .join('\n');
}

export interface RuleSet {
  className: string;
  styles: StyleProps;
}

/**
 * Assembles one CSS module file.
 *
 * `max-width` queries must run widest-first for the narrower one to win, so
 * tablet is always emitted before mobile.
 */
/*
 * Rules carry the id of the node they came from, written into the stylesheet
 * as a comment.
 *
 * This is what makes the round trip possible. Zory generated this file, so if
 * it also records which node each rule belongs to, an edit made in a code
 * editor can be read straight back into the project — no parsing of arbitrary
 * CSS, no guessing which selector maps to which element, no ambiguity when two
 * elements happen to share a class name.
 *
 * It is a comment, so it costs nothing at runtime and a person deleting it
 * only loses the round trip for that rule, not correctness.
 */
export function buildStylesheet(
  rules: { className: string; nodeId?: string; byBreakpoint: Partial<Record<Breakpoint, StyleProps>> }[],
  breakpoints: Project['settings']['breakpoints'],
  header: string,
): string {
  const out: string[] = [`/* ${header} */`, ''];

  for (const rule of rules) {
    const base = rule.byBreakpoint.base;
    if (base && Object.keys(base).length > 0) {
      if (rule.nodeId) out.push(`/* zory:${rule.nodeId} */`);
      out.push(`.${rule.className} {`, declarations(base), '}', '');
    }
  }

  for (const [breakpoint, maxWidth] of [
    ['tablet', breakpoints.tablet],
    ['mobile', breakpoints.mobile],
  ] as const) {
    const queryRules = rules.filter(
      (rule) => Object.keys(rule.byBreakpoint[breakpoint] ?? {}).length > 0,
    );
    if (queryRules.length === 0) continue;

    out.push(`@media (max-width: ${maxWidth}px) {`);
    for (const rule of queryRules) {
      if (rule.nodeId) out.push(`  /* zory:${rule.nodeId} */`);
      out.push(`  .${rule.className} {`, declarations(rule.byBreakpoint[breakpoint]!, '    '), '  }', '');
    }
    // Trim the trailing blank line inside the block.
    if (out[out.length - 1] === '') out.pop();
    out.push('}', '');
  }

  return `${out.join('\n').trimEnd()}\n`;
}

/** The reset shipped with every export. Small, explicit, and easy to delete. */
/**
 * The baseline stylesheet, with the project's design tokens on top.
 *
 * Tokens are written into `:root` so that an element which followed a token in
 * Zory keeps following it here: `color: var(--zory-text)` resolves against
 * this rule, and changing one line restyles everything that referenced it —
 * which is the whole reason a theme is worth exporting rather than flattening
 * into literals on the way out.
 */
export function globalCss(theme?: ProjectTheme): string {
  if (!theme) return GLOBAL_CSS;
  return `${themeRootRule(theme)}\n\n${GLOBAL_CSS}`;
}

export const GLOBAL_CSS = `/* Baseline. Everything else lives in the CSS module next to its component. */

*,
*::before,
*::after {
  box-sizing: border-box;
}

* {
  margin: 0;
}

html {
  -webkit-text-size-adjust: 100%;
}

body {
  min-height: 100vh;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

img,
picture,
video,
canvas,
svg {
  display: block;
  max-width: 100%;
}

input,
button,
textarea,
select {
  font: inherit;
  color: inherit;
}

button {
  background: none;
  border: none;
  cursor: pointer;
}

a {
  color: inherit;
  text-decoration: none;
}

h1,
h2,
h3,
h4,
h5,
h6,
p {
  overflow-wrap: break-word;
}

:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;
