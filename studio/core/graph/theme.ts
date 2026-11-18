/**
 * A project's design tokens.
 *
 * The theme has existed since the first version of Zory, and until now it was
 * decoration: starters read it while building their nodes, then every node
 * held a literal `#0e1116` and the theme was never consulted again. Changing
 * the accent colour changed nothing, which is the difference between having a
 * theme and having a design system.
 *
 * Tokens are now CSS custom properties. A node that should follow the accent
 * stores `var(--zory-accent)` in its styles, the canvas declares those
 * properties on the page root, and the export writes them into `:root`. One
 * `SET_THEME` command then changes every element that referenced the token and
 * nothing that did not — which is the behaviour people expect from the word.
 *
 * The literal value stays available. An element that should be exactly this
 * blue and not the project's blue simply holds the hex, and no future theme
 * change touches it. That choice belongs to the person, not to the tool.
 */

import type { ProjectTheme } from './types';

export type ThemeToken = keyof ProjectTheme;

export const COLOUR_TOKENS: readonly ThemeToken[] = [
  'background',
  'surface',
  'text',
  'textMuted',
  'accent',
  'accentText',
  'border',
];

export const FONT_TOKENS: readonly ThemeToken[] = ['fontDisplay', 'fontBody'];

export const THEME_TOKENS: readonly ThemeToken[] = [...COLOUR_TOKENS, ...FONT_TOKENS];

export const TOKEN_LABEL: Record<ThemeToken, string> = {
  background: 'Background',
  surface: 'Surface',
  text: 'Text',
  textMuted: 'Muted text',
  accent: 'Accent',
  accentText: 'On accent',
  border: 'Border',
  fontDisplay: 'Display font',
  fontBody: 'Body font',
};

export const TOKEN_HINT: Record<ThemeToken, string> = {
  background: 'The page itself.',
  surface: 'Cards, panels, anything raised off the page.',
  text: 'Body and headings at full contrast.',
  textMuted: 'Secondary copy, captions, labels.',
  accent: 'Buttons, links, the one thing that carries state.',
  accentText: 'Text sitting on the accent.',
  border: 'Hairlines and dividers.',
  fontDisplay: 'Headings.',
  fontBody: 'Everything else.',
};

/**
 * The custom property a token is published as.
 *
 * Named the way a person would name them — `--color-accent`, `--font-display`
 * — and deliberately not `--zory-accent`. These land in an exported project's
 * `:root`, and Zory is sold on being deletable from an export; a brand prefix
 * on every colour in the stylesheet would make that a lie in the most visible
 * place possible.
 *
 * The families are spelled out rather than derived so that renaming a token in
 * the type does not silently rename a custom property that people's exported
 * projects already depend on.
 */
const VAR_NAME: Record<ThemeToken, string> = {
  background: '--color-background',
  surface: '--color-surface',
  text: '--color-text',
  textMuted: '--color-text-muted',
  accent: '--color-accent',
  accentText: '--color-accent-text',
  border: '--color-border',
  fontDisplay: '--font-display',
  fontBody: '--font-body',
};

const TOKEN_BY_VAR: Record<string, ThemeToken> = Object.fromEntries(
  (Object.entries(VAR_NAME) as [ThemeToken, string][]).map(([token, name]) => [name, token]),
) as Record<string, ThemeToken>;

export function themeVarName(token: ThemeToken): string {
  return VAR_NAME[token];
}

/** The value a style property holds to follow a token. */
export function themeVarRef(token: ThemeToken): string {
  return `var(${themeVarName(token)})`;
}

const REF = /^var\(\s*(--[a-z-]+)\s*(?:,[^)]*)?\)$/;

/** The token a value refers to, or `null` if it is a literal. */
export function tokenOf(value: string | undefined): ThemeToken | null {
  if (!value) return null;
  const match = REF.exec(value.trim());
  if (!match) return null;
  return TOKEN_BY_VAR[match[1]!] ?? null;
}

/** Declarations for every token, without the surrounding rule. */
export function themeDeclarations(theme: ProjectTheme, indent = '  '): string {
  return THEME_TOKENS.map((token) => `${indent}${themeVarName(token)}: ${theme[token]};`).join('\n');
}

/** The `:root` rule an exported project gets. */
export function themeRootRule(theme: ProjectTheme): string {
  return `:root {\n${themeDeclarations(theme)}\n}`;
}

/**
 * The same tokens as a React inline style object.
 *
 * Custom properties are legal in a style object but not in `CSSProperties`, so
 * this returns a plain record the caller can spread and cast once.
 */
export function themeStyleObject(theme: ProjectTheme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of THEME_TOKENS) out[themeVarName(token)] = theme[token];
  return out;
}

/**
 * Resolves a value for display.
 *
 * A colour input has to show a swatch, and a swatch cannot show `var(...)`.
 * This gives the literal behind a token so controls can render the real
 * colour while still storing the reference.
 */
export function resolveToken(value: string | undefined, theme: ProjectTheme): string | undefined {
  const token = tokenOf(value);
  return token ? theme[token] : value;
}
