/**
 * The section library, in the editor.
 *
 * Saving is deliberately a two-step: pick the element, name what it is. A
 * library of things called "Section 4" is a library nobody opens twice.
 *
 * Insertion lands where the Insert palette would land — inside the selection
 * if it can hold children, after it otherwise — so there is one rule for where
 * new things go rather than two.
 *
 * ## Two libraries, one panel
 *
 * **Yours** is IndexedDB and works with no account at all. **Your team's** is
 * a Firestore collection under the workspace, readable and writable by its
 * members, and it is the thing Team and Agency have been sold on since the
 * pricing page went up — "a shared section and template library" was in the
 * plan table, in the comparison and in Team's four bullets, and no code
 * anywhere implemented it.
 *
 * Publishing is a copy, never a reference. Sharing a section snapshots it, so
 * changing the project it came from afterwards does not silently rewrite what
 * a colleague inserts next week.
 *
 * A shared section is not a privileged kind of object: it comes back as the
 * same `SectionRecord` the local library stores, goes through the same
 * `planInsert`, and lands as the same commands in the same undo step.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { nodeLabel } from '@zory/core';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { insertInstance, selectAndReveal } from '../state/actions';
import {
  deleteSection,
  getSection,
  listSections,
  planInsert,
  saveSection,
  type SectionSummary,
} from '../../core/library/sections';
import {
  getSharedSection,
  listSharedSections,
  shareSection,
  unshareSection,
  type SharedSection,
} from '../../core/team/library';
import { useAuthStore } from '../../core/auth/authStore';
import { useTeamStore } from '../../core/team/store';
import { useBillingStore } from '../../core/billing/store';
import { checkFeature, limits, withinLimit } from '@zory/core';
import { Button, TextInput } from '../../ui/controls';
import { UpgradeNote } from '../../ui/UpgradeNote';
import { PlusIcon, TrashIcon, UsersIcon } from '../../ui/icons';
import styles from './LeftPanel.module.css';

export function LibraryPanel(): React.ReactElement {
  const [sections, setSections] = useState<SectionSummary[] | null>(null);
  const [shared, setShared] = useState<SharedSection[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const workspace = useTeamStore((s) => s.workspace);
  const user = useAuthStore((s) => s.user);

  const selectedId = useUiStore((s) => s.selectedId);
  const pageId = useUiStore((s) => s.pageId);
  const selectedName = useProjectStore((s) =>
    selectedId ? (s.project?.nodes[selectedId] ?? null) : null,
  );
  const entitlements = useBillingStore((s) => s.entitlements);

  const refresh = useCallback(async () => {
    setSections(await listSections());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cap = limits(entitlements).librarySections;
  const atCap = sections !== null && !withinLimit(cap, sections.length);

  /*
   * The shared library is two conditions, not one.
   *
   * A plan that includes `shared-library`, *and* a workspace to share into.
   * Somebody on Agency who has not opened their team yet has the entitlement
   * and nowhere to put anything, and the panel has to say which of the two is
   * missing rather than showing an empty list.
   */
  const teamGate = checkFeature(entitlements, 'shared-library');
  const canShare = teamGate === null && workspace !== null;

  const refreshShared = useCallback(async () => {
    if (!canShare || !workspace) {
      setShared(null);
      return;
    }
    try {
      setShared(await listSharedSections(workspace.id));
    } catch {
      // Cloud storage not provisioned, or offline. The local library is
      // unaffected, and an error banner over somebody's own sections would be
      // about the wrong thing.
      setShared([]);
    }
  }, [canShare, workspace]);

  useEffect(() => {
    void refreshShared();
  }, [refreshShared]);

  /** Publishes one of your saved sections to the workspace. */
  const publish = useCallback(
    async (id: string, label: string) => {
      if (!workspace || !user) return;
      try {
        const record = await getSection(id);
        if (!record) return;
        await shareSection(workspace.id, record, {
          uid: user.uid,
          name: user.displayName ?? user.email ?? null,
        });
        setStatus(`${label} is in your team's library.`);
        await refreshShared();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not share that.');
      }
    },
    [refreshShared, user, workspace],
  );

  /** Inserts one of the team's, which lands as the same commands as your own. */
  const insertShared = useCallback(
    async (id: string) => {
      if (!workspace) return;
      const project = useProjectStore.getState().project;
      const record = await getSharedSection(workspace.id, id);
      if (!project || !record) return;

      const page = project.pages.find((p) => p.id === pageId) ?? project.pages[0];
      if (!page) return;

      const plan = planInsert(project, record, selectedId, page.rootId);
      const result = useProjectStore.getState().run(plan.commands, { label: `Insert ${record.name}` });
      if (!result.ok) {
        setStatus(result.reason);
        return;
      }
      selectAndReveal(plan.rootId);
      setStatus(
        plan.addedAssets > 0
          ? `Inserted ${record.name} and ${plan.addedAssets} image${plan.addedAssets === 1 ? '' : 's'}.`
          : `Inserted ${record.name}.`,
      );
    },
    [pageId, selectedId, workspace],
  );

  const withdraw = useCallback(
    async (id: string, label: string) => {
      if (!workspace) return;
      try {
        await unshareSection(workspace.id, id);
        setStatus(`Removed ${label} from your team's library.`);
        await refreshShared();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not remove that.');
      }
    },
    [refreshShared, workspace],
  );

  const commitSave = useCallback(async () => {
    const project = useProjectStore.getState().project;
    if (!project || !selectedId) return;
    try {
      const saved = await saveSection({ project, nodeId: selectedId, name });
      setStatus(`Saved ${saved.name}.`);
      setSaving(false);
      setName('');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save that.');
    }
  }, [name, refresh, selectedId]);

  const insert = useCallback(
    async (id: string) => {
      const project = useProjectStore.getState().project;
      const section = await getSection(id);
      if (!project || !section) return;

      const page = project.pages.find((p) => p.id === pageId) ?? project.pages[0];
      if (!page) return;

      const plan = planInsert(project, section, selectedId, page.rootId);
      const result = useProjectStore.getState().run(plan.commands, { label: `Insert ${section.name}` });
      if (!result.ok) {
        setStatus(result.reason);
        return;
      }
      selectAndReveal(plan.rootId);
      setStatus(
        plan.addedAssets > 0
          ? `Inserted ${section.name} and ${plan.addedAssets} image${plan.addedAssets === 1 ? '' : 's'}.`
          : `Inserted ${section.name}.`,
      );
    },
    [pageId, selectedId],
  );

  const remove = useCallback(
    async (id: string, label: string) => {
      await deleteSection(id);
      setStatus(`Removed ${label}.`);
      await refresh();
    },
    [refresh],
  );

  return (
    <div className={styles.integrations}>
      <ComponentList />

      <p className={styles.sectionLabel}>Save to library</p>

      {saving ? (
        <div className={styles.libraryForm}>
          <TextInput
            autoFocus
            value={name}
            placeholder={selectedName ? nodeLabel(selectedName) : 'Section name'}
            aria-label="Section name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commitSave();
              if (event.key === 'Escape') setSaving(false);
            }}
          />
          <div className={styles.libraryFormActions}>
            <Button variant="primary" onClick={() => void commitSave()}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setSaving(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.integrationsIntro}>
            {selectedName
              ? `Keep ${nodeLabel(selectedName)} and everything inside it, ready to drop into any project.`
              : 'Select a section on the canvas to keep it for later.'}
          </p>
          <Button
            variant="outline"
            disabled={!selectedId || atCap}
            onClick={() => {
              setName(selectedName ? nodeLabel(selectedName) : '');
              setSaving(true);
              setStatus(null);
            }}
          >
            <PlusIcon size={11} />
            Save selection
          </Button>
          {atCap ? (
            <p className={styles.integrationsFoot}>
              Your plan keeps {cap} saved sections. Remove one, or upgrade for an unlimited library.
            </p>
          ) : null}
        </>
      )}

      <p className={styles.sectionLabel} style={{ marginTop: 18 }}>
        Library
        {sections && sections.length > 0 ? (
          <span className={styles.sectionCount}>{sections.length}</span>
        ) : null}
      </p>

      {sections === null ? (
        <p className={styles.integrationsIntro}>Loading…</p>
      ) : sections.length === 0 ? (
        <p className={styles.integrationsIntro}>
          Nothing saved yet. A hero you like, a footer you keep rebuilding — save it once and it is
          one click away in every project.
        </p>
      ) : (
        <ul className={styles.libraryList}>
          {sections.map((section) => (
            <li key={section.id} className={styles.libraryItem}>
              <button
                type="button"
                className={styles.libraryInsert}
                onClick={() => void insert(section.id)}
                title={`Insert ${section.name}`}
                /*
                 * Named explicitly. Without this the accessible name is the
                 * button's contents — swatches, a count and the project it
                 * came from — which announces as "Cadence hero 12 elements
                 * Cadence" and says nothing about what the button does.
                 */
                aria-label={`Insert ${section.name}`}
              >
                <span className={styles.librarySwatches} aria-hidden="true">
                  {(section.swatches.length > 0 ? section.swatches : ['#2a2a2a']).map(
                    (colour, index) => (
                      <span
                        key={`${colour}-${index}`}
                        className={styles.librarySwatch}
                        style={{ background: colour }}
                      />
                    ),
                  )}
                </span>
                <span className={styles.libraryMeta}>
                  <span className={styles.libraryName}>{section.name}</span>
                  <span className={styles.libraryKind}>
                    {section.nodeCount} element{section.nodeCount === 1 ? '' : 's'} ·{' '}
                    {section.sourceProject}
                  </span>
                </span>
              </button>
              {canShare ? (
                <button
                  type="button"
                  className={styles.libraryRemove}
                  aria-label={`Share ${section.name} with your team`}
                  title="Share with your team"
                  onClick={() => void publish(section.id, section.name)}
                >
                  <UsersIcon size={11} />
                </button>
              ) : null}
              <button
                type="button"
                className={styles.libraryRemove}
                aria-label={`Remove ${section.name} from the library`}
                onClick={() => void remove(section.id, section.name)}
              >
                <TrashIcon size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ------------------------------------------------ the team's -- */}
      <p className={styles.sectionLabel} style={{ marginTop: 18 }}>
        Your team
        {shared && shared.length > 0 ? (
          <span className={styles.sectionCount}>{shared.length}</span>
        ) : null}
      </p>

      {teamGate ? (
        <UpgradeNote
          feature="shared-library"
          title="One library for the whole team"
          body="Publish a hero once and everybody inserts the same one. Sections stay in step across every project your team builds."
          compact
        />
      ) : !workspace ? (
        <p className={styles.integrationsIntro}>
          Your plan includes a shared library. Open Settings to create your workspace and invite
          the people who should see it.
        </p>
      ) : shared === null ? (
        <p className={styles.integrationsIntro}>Loading…</p>
      ) : shared.length === 0 ? (
        <p className={styles.integrationsIntro}>
          Nothing shared yet. Press the people icon on any of your saved sections and everybody in{' '}
          {workspace.name} can insert it.
        </p>
      ) : (
        <ul className={styles.libraryList}>
          {shared.map((section) => (
            <li key={section.id} className={styles.libraryItem}>
              <button
                type="button"
                className={styles.libraryInsert}
                onClick={() => void insertShared(section.id)}
                title={`Insert ${section.name}`}
                aria-label={`Insert ${section.name} from your team's library`}
              >
                <span className={styles.librarySwatches} aria-hidden="true">
                  {(section.swatches.length > 0 ? section.swatches : ['#2a2a2a']).map(
                    (colour, index) => (
                      <span
                        key={`${colour}-${index}`}
                        className={styles.librarySwatch}
                        style={{ background: colour }}
                      />
                    ),
                  )}
                </span>
                <span className={styles.libraryMeta}>
                  <span className={styles.libraryName}>{section.name}</span>
                  <span className={styles.libraryKind}>
                    {section.nodeCount} element{section.nodeCount === 1 ? '' : 's'} ·{' '}
                    {section.sharedByName ?? 'a teammate'}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={styles.libraryRemove}
                aria-label={`Remove ${section.name} from your team's library`}
                onClick={() => void withdraw(section.id, section.name)}
              >
                <TrashIcon size={11} />
              </button>
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

/**
 * The components defined in this project.
 *
 * Distinct from the section library above, and the difference is the whole
 * point: a saved section is a copy taken once, while every instance of a
 * component is still reading from one definition. Inserting from here means a
 * later improvement reaches what you inserted.
 */
function ComponentList(): React.ReactElement | null {
  const components = useProjectStore((s) => s.project?.components);

  const entries = useMemo(
    () => Object.values(components ?? {}).sort((a, b) => a.name.localeCompare(b.name)),
    [components],
  );

  if (entries.length === 0) return null;

  return (
    <>
      <p className={styles.sectionLabel}>Components</p>
      <p className={styles.integrationsIntro}>
        Every instance follows its component. Edit one, and the copies you have
        not changed by hand follow along.
      </p>
      <ul className={styles.libraryList}>
        {entries.map((def) => (
          <li key={def.id} className={styles.libraryItem}>
            <button
              type="button"
              className={styles.libraryInsert}
              onClick={() => insertInstance(def.id)}
              aria-label={`Insert an instance of ${def.name}`}
              title={`Insert an instance of ${def.name}`}
            >
              <span className={styles.libraryMeta}>
                <span className={styles.libraryName}>{def.name}</span>
                <span className={styles.libraryKind}>
                  {Object.keys(def.nodes).length} element
                  {Object.keys(def.nodes).length === 1 ? '' : 's'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
