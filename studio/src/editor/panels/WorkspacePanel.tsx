/**
 * The linked folder, and the handoff to a code editor.
 *
 * Desktop only. In a browser this panel does not exist, because the capability
 * it exposes does not: a web page cannot hold a folder open and keep writing
 * to it. Rather than showing a disabled tab the web build hides it entirely
 * and the marketing site explains what the desktop app adds.
 */

import { useCallback, useEffect, useState } from 'react';
import { desktop, shortenPath } from '../../core/desktop/bridge';
import {
  flush,
  linkedFolder,
  markExternalChange,
  lastWriteTime,
  scheduleSync,
  setLinkedFolder,
  subscribeWorkspace,
  syncState,
} from '../../core/desktop/workspace';
import { useProjectStore } from '../state/projectStore';
import { generateExport } from '../../core/export/generate';
import { getIntegrationValues } from '../../core/integrations/store';
import { describeRoundTrip, readStylesheets } from '../../core/desktop/roundTrip';
import { Button } from '../../ui/controls';
import styles from './LeftPanel.module.css';

const STATE_LABEL: Record<string, string> = {
  idle: 'Waiting for a change',
  writing: 'Writing…',
  synced: 'In sync',
  error: 'Could not write',
  external: 'Changed outside Studio',
};

export function WorkspacePanel(): React.ReactElement {
  const project = useProjectStore((s) => s.project);
  const [, force] = useState(0);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [pullState, setPullState] = useState<string | null>(null);

  useEffect(() => subscribeWorkspace(() => force((n) => n + 1)), []);

  const api = desktop();
  const projectId = project?.id ?? null;
  const folder = projectId ? linkedFolder(projectId) : null;
  const status = syncState();

  /* Watch for edits made in VS Code or by an agent. */
  useEffect(() => {
    if (!api || !folder) return;
    void api.watch(folder);
    return api.onFileChanged((change) => {
      // Zory writes this folder too, so ignore the echo of its own writes.
      if (change.at - lastWriteTime() < 1500) return;
      markExternalChange(change.path);
    });
  }, [api, folder]);

  const link = useCallback(async () => {
    if (!api || !project) return;
    const chosen = await api.pickFolder();
    if (!chosen) return;
    setLinkedFolder(project.id, chosen);
    scheduleSync(project);
    await flush();
  }, [api, project]);

  const unlink = useCallback(async () => {
    if (!api || !project || !folder) return;
    await api.forgetFolder(folder);
    setLinkedFolder(project.id, null);
  }, [api, project, folder]);

  /**
   * Read edits made in a code editor back into the project.
   *
   * Which files to read comes from the generator rather than from a directory
   * walk: Zory only reads back what it wrote, so a file someone added
   * themselves is never opened, let alone parsed.
   *
   * The result goes through `run`, so it validates like any other command and
   * one undo reverses the whole read-back.
   */
  const pull = useCallback(async () => {
    if (!api || !project || !folder) return;
    setPullState('Reading…');

    const generated = generateExport(project, getIntegrationValues(), { markers: true });
    const onDisk: { path: string; content: string }[] = [];

    for (const file of generated.files) {
      // Stylesheets carry style edits, components carry copy edits.
      if (!file.path.endsWith('.css') && !file.path.endsWith('.tsx')) continue;
      const content = await api.readFile(folder, file.path);
      if (content !== null) onDisk.push({ path: file.path, content });
    }

    const result = readStylesheets(project, onDisk);
    if (result.commands.length === 0) {
      setPullState('Nothing to bring back');
      return;
    }

    const outcome = useProjectStore
      .getState()
      .run(result.commands, { label: 'Read changes from editor' });

    setPullState(outcome.ok ? `Applied ${describeRoundTrip(result)}` : outcome.reason);
  }, [api, project, folder]);

  const openIn = useCallback(
    async (target: 'vscode' | 'cursor' | 'terminal') => {
      if (!api || !folder) return;
      setLaunchError(null);
      const result = await api.openIn(folder, target);
      if (!result.ok) setLaunchError(result.reason ?? 'Could not open that editor.');
    },
    [api, folder],
  );

  if (!project) return <p className={styles.panelEmpty}>No project open.</p>;

  if (!folder) {
    return (
      <div className={styles.integrations}>
        <p className={styles.sectionLabel}>Local folder</p>
        <p className={styles.integrationsIntro}>
          Link a folder and Studio keeps it filled with the real React and TypeScript for this
          project, rewritten as you edit. Open it in your editor, run it, commit it — it is an
          ordinary project with no Studio runtime in it.
        </p>
        <Button variant="primary" onClick={() => void link()}>
          Choose a folder
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.integrations}>
      <p className={styles.sectionLabel}>Local folder</p>

      <div className={styles.workspacePath} title={folder}>
        {shortenPath(folder)}
      </div>

      <div className={`${styles.workspaceStatus} ${styles[`workspace_${status.state}`] ?? ''}`}>
        <span className={styles.workspaceDot} />
        {STATE_LABEL[status.state] ?? status.state}
        {status.detail && <span className={styles.workspaceDetail}>{status.detail}</span>}
      </div>

      {status.state === 'external' && (
        <p className={styles.workspaceWarn}>
          Something changed this folder outside Studio. Bring those edits back into the design, or
          keep editing here and they will be rewritten.
        </p>
      )}

      <button type="button" className={styles.workspacePull} onClick={() => void pull()}>
        Read changes from my editor
      </button>
      {pullState && <p className={styles.workspaceDetail}>{pullState}</p>}

      <p className={styles.sectionLabel} style={{ marginTop: 16 }}>
        Open in
      </p>
      <div className={styles.workspaceButtons}>
        <button type="button" className={styles.workspaceButton} onClick={() => void openIn('vscode')}>
          VS Code
        </button>
        <button type="button" className={styles.workspaceButton} onClick={() => void openIn('cursor')}>
          Cursor
        </button>
        <button
          type="button"
          className={styles.workspaceButton}
          onClick={() => void openIn('terminal')}
        >
          Terminal
        </button>
      </div>

      {launchError && <p className={styles.workspaceWarn}>{launchError}</p>}

      <p className={styles.integrationsIntro} style={{ marginTop: 14 }}>
        For Claude Code, open the terminal here and run <code>claude</code>. Studio writes a{' '}
        <code>CLAUDE.md</code> into the folder describing the project and which files it owns, so
        an agent knows what it can safely change.
      </p>

      <div className={styles.integrationActions}>
        <button
          type="button"
          className={styles.integrationLink}
          onClick={() => void api?.revealFolder(folder)}
        >
          Reveal in Finder
        </button>
        <button type="button" className={styles.integrationClear} onClick={() => void unlink()}>
          Unlink
        </button>
      </div>
    </div>
  );
}
