/**
 * Light, dark, or whatever the machine says.
 *
 * Three states rather than two. "System" is not a fallback for having no
 * preference, it is a preference: somebody whose laptop flips at sunset wants
 * Zory to flip with it, and collapsing that to a stored boolean the first time
 * they touch a toggle is how products lose that.
 *
 * The choice is written to `<html data-theme>` and to localStorage. There is a
 * matching inline script in `index.html` that applies it before first paint,
 * because a dark-mode user seeing a white flash on every page load is the one
 * bug that makes theming feel bolted on.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

/** What the page is actually showing, once `system` has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'zory.theme';

export const THEME_LABEL: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

export const THEME_ORDER: readonly ThemeChoice[] = ['light', 'dark', 'system'];

function isChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function readChoice(): ThemeChoice {
  if (typeof localStorage === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isChoice(stored) ? stored : 'system';
  } catch {
    // Private mode. The default is the honest answer.
    return 'system';
  }
}

export function systemTheme(): ResolvedTheme {
  if (typeof matchMedia !== 'function') return 'dark';
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolve(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice;
}

/**
 * Writes the choice to the document.
 *
 * `system` removes the attribute rather than writing the resolved value, so
 * the CSS media query stays in charge and the page keeps following the machine
 * without any JavaScript running again.
 */
export function apply(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);

  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // The attribute is set either way; it just will not survive a reload.
  }
}

/**
 * Suppresses transitions for one frame while the palette swaps.
 *
 * Without it, every bordered surface on the page runs its own colour
 * transition at its own duration and the switch reads as a smear rather than
 * as a change. Two frames, then the styles come back.
 */
export function applyWithoutTransition(choice: ThemeChoice): void {
  if (typeof document === 'undefined') {
    apply(choice);
    return;
  }

  const style = document.createElement('style');
  style.textContent = '*, *::before, *::after { transition: none !important; }';
  document.head.append(style);

  apply(choice);

  // Read a layout property to force the styles to flush before removing it.
  void document.body.offsetHeight;
  requestAnimationFrame(() => style.remove());
}

type Listener = (choice: ThemeChoice, resolved: ResolvedTheme) => void;
const listeners = new Set<Listener>();
let current: ThemeChoice = 'system';
let started = false;

export function getChoice(): ThemeChoice {
  return current;
}

export function setChoice(choice: ThemeChoice): void {
  current = choice;
  applyWithoutTransition(choice);
  for (const listener of listeners) listener(choice, resolve(choice));
}

/** Cycles light → dark → system, for a single-button toggle. */
export function cycleChoice(): ThemeChoice {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]!;
  setChoice(next);
  return next;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Starts tracking. Safe to call more than once.
 *
 * The media-query listener only matters while the choice is `system`, but it
 * stays attached: adding and removing it on every toggle is more moving parts
 * than one comparison per system change is worth.
 */
export function startTheme(): void {
  if (started) return;
  started = true;

  current = readChoice();
  apply(current);

  if (typeof matchMedia !== 'function') return;
  const query = matchMedia('(prefers-color-scheme: light)');
  query.addEventListener('change', () => {
    if (current !== 'system') return;
    for (const listener of listeners) listener(current, systemTheme());
  });
}
