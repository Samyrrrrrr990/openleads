/**
 * Light, dark, system.
 *
 * A three-way segmented control rather than a sun/moon that flips. A flipping
 * icon has to answer "does this show the current mode or the one I would get",
 * and every product answers it differently, so nobody trusts it. Three labelled
 * options answer nothing because there is nothing to guess.
 *
 * `system` is a real option, not a default hiding behind the other two: the
 * person whose laptop turns dark at sunset wants Zory to turn with it.
 */

import { useEffect, useState } from 'react';
import {
  THEME_LABEL,
  THEME_ORDER,
  getChoice,
  setChoice,
  subscribe,
  type ThemeChoice,
} from '../core/theme/theme';
import styles from './ThemeToggle.module.css';

const ICON: Record<ThemeChoice, React.ReactElement> = {
  light: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.2v1.6M8 13.2v1.6M14.8 8h-1.6M2.8 8H1.2M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1M12.8 12.8l-1.1-1.1M4.3 4.3L3.2 3.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  ),
  dark: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.8 5.8 0 1 0 7 7Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  ),
  system: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.6 13.4h4.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
};

export function ThemeToggle({ compact = false }: { compact?: boolean }): React.ReactElement {
  const [choice, setLocal] = useState<ThemeChoice>(getChoice);

  useEffect(() => subscribe((next) => setLocal(next)), []);

  return (
    <div
      className={`${styles.group} ${compact ? styles.compact : ''}`}
      role="radiogroup"
      aria-label="Colour theme"
    >
      {THEME_ORDER.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={choice === option}
          aria-label={`${THEME_LABEL[option]} theme`}
          title={THEME_LABEL[option]}
          tabIndex={choice === option ? 0 : -1}
          className={`${styles.option} ${choice === option ? styles.active : ''}`}
          onClick={() => setChoice(option)}
          onKeyDown={(event) => {
            const index = THEME_ORDER.indexOf(choice);
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              setChoice(THEME_ORDER[(index + 1) % THEME_ORDER.length]!);
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              setChoice(THEME_ORDER[(index + THEME_ORDER.length - 1) % THEME_ORDER.length]!);
            }
          }}
        >
          {ICON[option]}
          {compact ? null : <span className={styles.label}>{THEME_LABEL[option]}</span>}
        </button>
      ))}
    </div>
  );
}
