/**
 * Platform handling for keyboard shortcuts.
 *
 * Two separate questions, deliberately answered differently:
 *
 * 1. "Did the user press the command modifier?" — accept Meta *or* Control.
 *    Sniffing the platform to pick one is fragile (user agents lie, remote
 *    desktops and external keyboards cross the wires) and the failure mode is
 *    a dead shortcut. Neither Ctrl+Z on macOS nor Win+Z on Windows means
 *    anything else, so accepting both costs nothing.
 *
 * 2. "What should the hint say?" — this is cosmetic, so a best guess is fine.
 *    `userAgentData.platform` is authoritative where present; `navigator.platform`
 *    is the fallback and reports the real OS even when the UA string is spoofed.
 */

/** True when the event carries the primary command modifier. */
export function hasCommandModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

interface UserAgentData {
  platform?: string;
}

function detectApple(): boolean {
  if (typeof navigator === 'undefined') return false;

  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  if (data?.platform) return /mac/i.test(data.platform);

  // `navigator.platform` still reports "MacIntel" when the UA string claims
  // another OS, which makes it the better source for this question.
  if (navigator.platform) return /mac|iphone|ipad|ipod/i.test(navigator.platform);

  return /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
}

export const IS_APPLE = detectApple();

/** "⌘" on Apple platforms, "Ctrl" elsewhere. For labels only. */
export const MOD_KEY_LABEL = IS_APPLE ? '⌘' : 'Ctrl';
export const SHIFT_LABEL = IS_APPLE ? '⇧' : 'Shift';

/** Formats a shortcut hint, e.g. `shortcut('Z', { shift: true })` → "⇧⌘Z". */
export function shortcut(key: string, options: { shift?: boolean } = {}): string {
  const shift = options.shift ? SHIFT_LABEL : '';
  return IS_APPLE ? `${shift}${MOD_KEY_LABEL}${key}` : `${MOD_KEY_LABEL}+${shift ? 'Shift+' : ''}${key}`;
}
