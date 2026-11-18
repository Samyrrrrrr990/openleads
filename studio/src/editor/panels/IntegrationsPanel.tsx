/**
 * Connecting a project to third-party services.
 *
 * Two things share this panel because to a user they are one idea — "paste the
 * key" — even though they behave very differently underneath:
 *
 *   AI keys are used by Zory here, in this browser, to propose edits. This is
 *   what makes AI editing genuinely free: a personal Gemini key allows roughly
 *   thirty times the daily requests of the shared free account behind Zory's
 *   own proxy.
 *
 *   Service keys belong to the site being built, and are written into the
 *   exported project's .env rather than being used by the editor at all.
 *
 * No key is ever stored in the project. The project is exported as source and
 * uploaded when a user backs up, so anything kept there would be published by
 * two features that are both behaving correctly.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AI_INTEGRATIONS,
  SERVICE_INTEGRATIONS,
  type Integration,
} from '../../core/integrations/registry';
import {
  clearIntegration,
  getIntegrationValues,
  isConfigured,
  setField,
  subscribe,
} from '../../core/integrations/store';
import { activeKeyProviderLabel } from '../../core/intent/byokProvider';
import styles from './LeftPanel.module.css';

function useIntegrationValues(): Record<string, Record<string, string>> {
  const [values, setValues] = useState(getIntegrationValues);
  useEffect(() => subscribe(() => setValues({ ...getIntegrationValues() })), []);
  return values;
}

export function IntegrationsPanel(): React.ReactElement {
  const values = useIntegrationValues();
  const aiLabel = activeKeyProviderLabel();

  return (
    <div className={styles.integrations}>
      <p className={styles.sectionLabel}>AI editing</p>
      <p className={styles.integrationsIntro}>
        {aiLabel
          ? `Intent is using your ${aiLabel} key. It stays on this device.`
          : 'Add a key to use your own allowance instead of the shared one. Gemini is free and by far the most generous.'}
      </p>

      {AI_INTEGRATIONS.map((integration) => (
        <IntegrationCard key={integration.id} integration={integration} values={values} />
      ))}

      <p className={styles.sectionLabel} style={{ marginTop: 18 }}>
        Services for your site
      </p>
      <p className={styles.integrationsIntro}>
        Written into the exported project&rsquo;s <code>.env</code>. Never into a page, and never
        into the project file.
      </p>

      {SERVICE_INTEGRATIONS.map((integration) => (
        <IntegrationCard key={integration.id} integration={integration} values={values} />
      ))}

      <p className={styles.integrationsFoot}>
        Keys live in this browser only. They are not synced, not exported as part of the design,
        and not sent anywhere else.
      </p>
    </div>
  );
}

function IntegrationCard({
  integration,
  values,
}: {
  integration: Integration;
  values: Record<string, Record<string, string>>;
}): React.ReactElement {
  const configured = isConfigured(
    integration.id,
    integration.fields.map((field) => field.id),
  );
  const [open, setOpen] = useState(false);

  const onChange = useCallback(
    (fieldId: string, value: string) => setField(integration.id, fieldId, value),
    [integration.id],
  );

  return (
    <div className={styles.integration}>
      <button
        type="button"
        className={styles.integrationHead}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={styles.integrationName}>{integration.name}</span>
        {configured ? (
          <span className={styles.integrationOn}>Connected</span>
        ) : (
          integration.freeTier && (
            <span className={styles.integrationFree}>{integration.freeTier}</span>
          )
        )}
      </button>

      {open && (
        <div className={styles.integrationBody}>
          <p className={styles.integrationSummary}>{integration.summary}</p>

          {integration.fields.map((field) => (
            <label key={field.id} className={styles.integrationField}>
              <span className={styles.integrationLabel}>
                {field.label}
                {field.secret && <span className={styles.integrationSecret}>secret</span>}
              </span>
              <input
                // `password` keeps it out of shoulder-surfing range and stops
                // browsers offering to autofill it somewhere else.
                type={field.secret ? 'password' : 'text'}
                className={styles.integrationInput}
                placeholder={field.placeholder ?? ''}
                spellCheck={false}
                autoComplete="off"
                value={values[integration.id]?.[field.id] ?? ''}
                onChange={(event) => onChange(field.id, event.target.value)}
              />
              {field.hint && <span className={styles.integrationHint}>{field.hint}</span>}
            </label>
          ))}

          <div className={styles.integrationActions}>
            <a
              className={styles.integrationLink}
              href={integration.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Get a key
            </a>
            {configured && (
              <button
                type="button"
                className={styles.integrationClear}
                onClick={() => clearIntegration(integration.id)}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
