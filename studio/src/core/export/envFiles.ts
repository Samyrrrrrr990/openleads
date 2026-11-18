/**
 * Environment files for an exported project.
 *
 * Two files, and the split is the whole point:
 *
 *   .env          real values, and gitignored. Never committed.
 *   .env.example  the same names with empty values, and committed. This is
 *                 how the next person knows what the project needs.
 *
 * The other rule enforced here is Vite's: any variable prefixed `VITE_` is
 * inlined into the client bundle and is therefore public. A Stripe secret key
 * or a Supabase service role key carrying that prefix would be published to
 * every visitor by a build that succeeded. Secrets are written without the
 * prefix and annotated as server-only, so the mistake has to be made
 * deliberately rather than by accident.
 */

import { INTEGRATIONS, type Integration } from '../integrations/registry';
import type { IntegrationValues } from '../integrations/store';

export interface ExportFile {
  path: string;
  content: string;
}

/** Only services. AI keys belong to the editor, not to the built site. */
function serviceIntegrations(values: IntegrationValues): Integration[] {
  return INTEGRATIONS.filter(
    (integration) =>
      integration.category === 'service' &&
      Object.values(values[integration.id] ?? {}).some((value) => value.trim() !== ''),
  );
}

function section(integration: Integration, values: IntegrationValues, withValues: boolean): string {
  const lines: string[] = [`# ${integration.name} — ${integration.summary}`, `# ${integration.docsUrl}`];

  for (const field of integration.fields) {
    const value = values[integration.id]?.[field.id] ?? '';
    if (withValues && value.trim() === '') continue;

    if (field.secret) {
      // Stated on the line above the variable, where it is read.
      lines.push(`# Server only. Never expose this in the browser.`);
    }
    lines.push(`${field.id}=${withValues ? value : ''}`);
  }

  return lines.join('\n');
}

/**
 * Builds `.env`, `.env.example` and a short note for the README.
 * Returns an empty list when no service is configured, so a plain design
 * export stays exactly as clean as it was.
 */
export function buildEnvFiles(values: IntegrationValues): ExportFile[] {
  const configured = serviceIntegrations(values);
  if (configured.length === 0) return [];

  const header = [
    '# Written by Zory from the services you connected.',
    '#',
    '# Anything named VITE_* is compiled into the browser bundle and is public.',
    '# Anything else is read only by server code and stays private.',
    '',
  ].join('\n');

  const real = `${header}${configured.map((i) => section(i, values, true)).join('\n\n')}\n`;
  const example = `${header}${configured.map((i) => section(i, values, false)).join('\n\n')}\n`;

  return [
    { path: '.env', content: real },
    { path: '.env.example', content: example },
  ];
}

/** True when any secret-marked field has a value, so callers can warn. */
export function hasServerSecrets(values: IntegrationValues): boolean {
  return serviceIntegrations(values).some((integration) =>
    integration.fields.some(
      (field) => field.secret && (values[integration.id]?.[field.id] ?? '').trim() !== '',
    ),
  );
}

/** A README section listing what was wired up, so the export explains itself. */
export function envReadmeSection(values: IntegrationValues): string {
  const configured = serviceIntegrations(values);
  if (configured.length === 0) return '';

  const rows = configured.map((integration) => `- **${integration.name}** — ${integration.summary}`);

  return [
    '',
    '## Services',
    '',
    'This project is wired to:',
    '',
    ...rows,
    '',
    'Real values are in `.env`, which is gitignored. `.env.example` lists the same',
    'names with blank values and is safe to commit.',
    '',
    'Variables named `VITE_*` are compiled into the browser bundle and are public by',
    'design. Everything else is read only by server code — keep it that way.',
    '',
  ].join('\n');
}
