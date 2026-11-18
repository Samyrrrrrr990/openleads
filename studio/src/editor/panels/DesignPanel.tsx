/**
 * The project's design system.
 *
 * Nine tokens, and a count of how many elements follow each one. That count is
 * the whole point of the panel: it turns "change the accent" from an act of
 * faith into a statement about what will move, and it makes the difference
 * between a token and a literal visible without anybody explaining it.
 *
 * Changing a token is one `SET_THEME` command, so it undoes in one step and
 * exports as one line in `:root`.
 */

import { useCallback, useMemo } from 'react';
import type { ProjectTheme, ThemeToken } from '@zory/core';
import {
  BREAKPOINTS,
  COLOUR_TOKENS,
  FONT_TOKENS,
  TOKEN_HINT,
  TOKEN_LABEL,
  setTheme,
  themeVarName,
  themeVarRef,
  tokenOf,
} from '@zory/core';
import { useProjectStore } from '../state/projectStore';
import { ColorInput, Field, TextInput } from '../../ui/controls';
import styles from './LeftPanel.module.css';

/** Style properties that can hold a colour token. */
const COLOUR_PROPERTIES = ['color', 'backgroundColor', 'borderColor'] as const;

export function DesignPanel(): React.ReactElement {
  const project = useProjectStore((s) => s.project);

  const write = useCallback((patch: Partial<ProjectTheme>, coalesce: boolean) => {
    useProjectStore.getState().run([setTheme(patch)], {
      coalesceKey: coalesce ? `SET_THEME:${Object.keys(patch).join(',')}` : null,
    });
  }, []);

  /** How many nodes reference each token today. */
  const usage = useMemo(() => {
    const counts: Partial<Record<ThemeToken, number>> = {};
    if (!project) return counts;

    for (const node of Object.values(project.nodes)) {
      const seen = new Set<ThemeToken>();
      for (const breakpoint of BREAKPOINTS) {
        const bucket = node.styles[breakpoint];
        if (!bucket) continue;
        for (const property of COLOUR_PROPERTIES) {
          const token = tokenOf(bucket[property]);
          if (token) seen.add(token);
        }
        const family = bucket.fontFamily;
        const fontToken = tokenOf(family);
        if (fontToken) seen.add(fontToken);
      }
      for (const token of seen) counts[token] = (counts[token] ?? 0) + 1;
    }
    return counts;
  }, [project]);

  if (!project) return <div className={styles.integrations} />;

  const theme = project.settings.theme;

  return (
    <div className={styles.integrations}>
      <p className={styles.sectionLabel}>Colour</p>
      <p className={styles.integrationsIntro}>
        Elements that follow a token change when the token does. Elements holding a literal colour
        never move — pick a swatch under any colour field to make one follow.
      </p>

      {COLOUR_TOKENS.map((token) => (
        <div key={token} className={styles.tokenRow}>
          <Field label={TOKEN_LABEL[token]} htmlFor={`token-${token}`} wide>
            <ColorInput
              id={`token-${token}`}
              value={theme[token]}
              onChange={(value) => write({ [token]: value } as Partial<ProjectTheme>, true)}
            />
          </Field>
          <p className={styles.tokenMeta}>
            <code className={styles.tokenVar}>{themeVarName(token)}</code>
            <span className={styles.tokenUsage}>{describeUsage(usage[token] ?? 0)}</span>
          </p>
        </div>
      ))}

      <p className={styles.sectionLabel} style={{ marginTop: 18 }}>
        Type
      </p>

      {FONT_TOKENS.map((token) => (
        <div key={token} className={styles.tokenRow}>
          <Field label={TOKEN_LABEL[token]} htmlFor={`token-${token}`} wide>
            <TextInput
              id={`token-${token}`}
              defaultValue={theme[token]}
              spellCheck={false}
              onBlur={(event) =>
                write({ [token]: event.currentTarget.value } as Partial<ProjectTheme>, false)
              }
            />
          </Field>
          <p className={styles.tokenMeta}>
            <code className={styles.tokenVar}>{themeVarName(token)}</code>
            <span className={styles.tokenUsage}>{TOKEN_HINT[token]}</span>
          </p>
        </div>
      ))}

      <p className={styles.integrationsFoot}>
        These export as custom properties in <code>:root</code>, named{' '}
        <code>{themeVarRef('accent')}</code> and so on. Ordinary CSS — nothing to install and
        nothing to keep.
      </p>
    </div>
  );
}

function describeUsage(count: number): string {
  if (count === 0) return 'Nothing follows this yet';
  return `${count} element${count === 1 ? '' : 's'} follow${count === 1 ? 's' : ''} this`;
}
