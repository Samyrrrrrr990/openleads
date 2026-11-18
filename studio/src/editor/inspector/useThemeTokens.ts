/**
 * The project's colours, in the shape a colour field wants.
 *
 * Lives here rather than in `ui/controls` on purpose: the control should not
 * know that Zory has a project graph. It takes a list of choices; this is what
 * turns the graph into that list.
 */

import { useMemo } from 'react';
import type { ProjectTheme } from '@zory/core';
import { COLOUR_TOKENS, TOKEN_LABEL, themeVarRef } from '@zory/core';
import type { ColorToken } from '../../ui/controls';
import { useProjectStore } from '../state/projectStore';

export function useThemeTokens(): { tokens: ColorToken[]; theme: ProjectTheme | null } {
  const theme = useProjectStore((s) => s.project?.settings.theme ?? null);

  const tokens = useMemo<ColorToken[]>(() => {
    if (!theme) return [];
    return COLOUR_TOKENS.map((token) => ({
      value: themeVarRef(token),
      resolved: theme[token],
      label: TOKEN_LABEL[token],
    }));
  }, [theme]);

  return { tokens, theme };
}
