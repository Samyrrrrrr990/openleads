/**
 * Version history, in the editor.
 *
 * A list of states with a way back to each. Deliberately not a timeline, not a
 * diff view and not a branching tree: the question people bring here is "put it
 * back the way it was this morning", and everything beyond a list answering
 * that is a feature that makes the answer harder to find.
 *
 * Restoring always snapshots the current state first. Every restore is a guess
 * that an older version was better, and a guess needs a way back — without it
 * this would be the one control in Zory that destroys work.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { limits } from '@zory/core';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { useBillingStore } from '../../core/billing/store';
import {
  deleteVersion,
  describeAge,
  getVersion,
  listVersions,
  snapshot,
  type VersionSummary,
} from '../../core/history/versions';
import { Button, TextInput } from '../../ui/controls';
import { TrashIcon, UndoIcon } from '../../ui/icons';
import styles from './LeftPanel.module.css';

export function HistoryPanel(): React.ReactElement {
  const project = useProjectStore((s) => s.project);
  const entitlements = useBillingStore((s) => s.entitlements);
  const retentionDays = limits(entitlements).historyDays;

  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const projectId = project?.id ?? null;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setVersions(await listVersions(projectId));
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    const current = useProjectStore.getState().project;
    if (!current) return;

    await snapshot(current, {
      label: label.trim() || 'Saved version',
      manual: true,
      retentionDays,
    });
    setLabel('');
    setNaming(false);
    setStatus('Version saved.');
    await refresh();
  }, [label, refresh, retentionDays]);

  const restore = useCallback(
    async (version: VersionSummary) => {
      const current = useProjectStore.getState().project;
      if (!current) return;

      // The way back. Taken before anything is replaced, and marked manual so
      // retention never quietly removes the escape hatch from a restore.
      await snapshot(current, {
        label: `Before restoring “${version.label}”`,
        manual: true,
        retentionDays: Math.max(retentionDays, 1),
      });

      const restored = await getVersion(version.id);
      if (!restored) {
        setStatus('That version could not be read.');
        return;
      }

      // Same id, so this stays the same project — a restore is a change to a
      // project, not a new one.
      useProjectStore.getState().load({ ...restored, id: current.id, updatedAt: Date.now() });
      useUiStore.getState().reset(restored.pages[0]?.id ?? null);
      await useProjectStore.getState().flush();

      setConfirming(null);
      setStatus(`Restored “${version.label}”. The state before it is at the top of this list.`);
      await refresh();
    },
    [refresh, retentionDays],
  );

  if (retentionDays <= 0) {
    return (
      <div className={styles.integrations}>
        <p className={styles.sectionLabel}>Version history</p>
        <p className={styles.integrationsIntro}>
          Undo covers the last few minutes. Version history covers last Tuesday — a list of states
          this project has been in, with a way back to each.
        </p>
        <p className={styles.integrationsIntro}>
          It is on Pro and above. Nothing is recorded on Free, rather than recorded and hidden.
        </p>
        <Link to="/pricing">
          <Button variant="outline">See plans</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.integrations}>
      <p className={styles.sectionLabel}>Version history</p>

      {naming ? (
        <div className={styles.libraryForm}>
          <TextInput
            autoFocus
            value={label}
            placeholder="What is this version?"
            aria-label="Version name"
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
              if (event.key === 'Escape') setNaming(false);
            }}
          />
          <div className={styles.libraryFormActions}>
            <Button variant="primary" onClick={() => void save()}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.integrationsIntro}>
            Zory saves a version every few minutes while you work, and keeps them for{' '}
            {retentionDays} days. Ones you name are kept regardless.
          </p>
          <Button variant="outline" onClick={() => setNaming(true)}>
            Save a version now
          </Button>
        </>
      )}

      <p className={styles.sectionLabel} style={{ marginTop: 18 }}>
        Versions
        {versions && versions.length > 0 ? (
          <span className={styles.sectionCount}>{versions.length}</span>
        ) : null}
      </p>

      {versions === null ? (
        <p className={styles.integrationsIntro}>Loading…</p>
      ) : versions.length === 0 ? (
        <p className={styles.integrationsIntro}>
          Nothing saved yet. The first automatic version appears after a few minutes of editing.
        </p>
      ) : (
        <ul className={styles.versionList}>
          {versions.map((version) => (
            <li key={version.id} className={styles.versionItem}>
              <div className={styles.versionMeta}>
                <span className={styles.versionLabel}>
                  {version.label}
                  {version.manual ? <span className={styles.versionPin}>named</span> : null}
                </span>
                <span className={styles.versionAge}>
                  {describeAge(version.at)} · {version.nodeCount} elements
                </span>
              </div>

              {confirming === version.id ? (
                <div className={styles.versionConfirm}>
                  <Button variant="primary" onClick={() => void restore(version)}>
                    Restore
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className={styles.versionActions}>
                  <button
                    type="button"
                    className={styles.versionButton}
                    aria-label={`Restore ${version.label}`}
                    title="Restore this version"
                    onClick={() => setConfirming(version.id)}
                  >
                    <UndoIcon size={11} />
                  </button>
                  <button
                    type="button"
                    className={styles.versionButton}
                    aria-label={`Delete ${version.label}`}
                    title="Delete this version"
                    onClick={() => {
                      void deleteVersion(version.id).then(refresh);
                    }}
                  >
                    <TrashIcon size={11} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {status ? (
        <p className={styles.integrationsFoot} role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
