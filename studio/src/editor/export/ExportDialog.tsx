/**
 * Export dialog.
 *
 * Shows the actual generated source before downloading it. This is the
 * product's central claim — that you get real code, not a black box — so the
 * dialog proves it rather than asserting it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { generateExport, type ExportedFile } from '../../core/export/generate';
import { buildZip, downloadBlob } from '../../core/export/zip';
import { track } from '../../core/analytics/analytics';
import { getIntegrationValues } from '../../core/integrations/store';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { GitHubPush } from './GitHubPush';
import { Button, IconButton } from '../../ui/controls';
import { useDialogFocus } from '../../ui/useDialogFocus';
import { CloseIcon, DownloadIcon } from '../../ui/icons';
import styles from './ExportDialog.module.css';

/** Stable identity for the empty case, so effects do not re-run needlessly. */
const EMPTY_FILES: ExportedFile[] = [];

export function ExportDialog(): React.ReactElement | null {
  const open = useUiStore((s) => s.exportOpen);
  const setOpen = useUiStore((s) => s.setExportOpen);
  const project = useProjectStore((s) => s.project);

  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Generation is pure and fast, but it should not run while the dialog is
  // closed — this only recomputes when it is open and the project changes.
  const generated = useMemo(() => {
    if (!open || !project) return null;
    try {
      // Credentials come from this device, never from the project document.
      return generateExport(project, getIntegrationValues());
    } catch (caught) {
      return { error: caught instanceof Error ? caught.message : 'Could not generate the export.' };
    }
  }, [open, project]);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  /*
   * Focus, Tab cycling, Escape and focus return, from the shared hook.
   *
   * This dialog previously moved focus in and handed it back but trapped
   * neither Tab nor Escape, so the keyboard walked straight out into the
   * editor behind it and Escape did nothing at all.
   */
  useDialogFocus(dialogRef, () => setOpen(false), { enabled: open });

  // Memoised so the selection effect below does not re-run on every render.
  const files = useMemo(
    () => (generated && 'files' in generated ? generated.files : EMPTY_FILES),
    [generated],
  );

  // Default to the most interesting file rather than the first alphabetically.
  useEffect(() => {
    if (!open || files.length === 0) return;
    setSelected((current) => {
      if (current && files.some((file) => file.path === current)) return current;
      return (
        files.find((file) => file.path.startsWith('src/pages/') && file.path.endsWith('.tsx'))?.path ??
        files[0]!.path
      );
    });
  }, [open, files]);

  if (!open || !project) return null;

  if (generated && 'error' in generated) {
    return (
      <Scrim onClose={() => setOpen(false)}>
        <div className={styles.dialog} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Export">
          <div className={styles.head}>
            <span className={styles.title}>Export failed</span>
            <span className={styles.spacer} />
            <IconButton label="Close" onClick={() => setOpen(false)}>
              <CloseIcon />
            </IconButton>
          </div>
          <p className={styles.warning}>{generated.error}</p>
        </div>
      </Scrim>
    );
  }

  const active = files.find((file) => file.path === selected) ?? null;
  const grouped = groupFiles(files);
  const totalBytes = files.reduce((sum, file) => sum + byteLength(file), 0);

  const download = async (): Promise<void> => {
    if (!generated || !('files' in generated)) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await buildZip(generated);
      downloadBlob(blob, `${generated.slug}.zip`);
      // Counted after the archive exists, so a failed build is not an export.
      // File count only — never a name, a path or any of the generated source.
      track('export_clicked', { files: generated.files.length });
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not build the archive.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Scrim onClose={() => setOpen(false)}>
      <div className={styles.dialog} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Export project">
        <div className={styles.head}>
          <div>
            <div className={styles.title}>Export {project.name}</div>
            <div className={styles.subtitle}>React + TypeScript + Vite · runs without Zory</div>
          </div>
          <span className={styles.spacer} />
          <IconButton label="Close export" onClick={() => setOpen(false)}>
            <CloseIcon />
          </IconButton>
        </div>

        {generated && 'warnings' in generated && generated.warnings.length > 0 && (
          <p className={styles.warning}>{generated.warnings.join(' ')}</p>
        )}
        {error && <p className={styles.warning}>{error}</p>}

        <div className={styles.body}>
          <nav className={styles.tree} aria-label="Generated files">
            {grouped.map(([group, groupFilesList]) => (
              <div key={group}>
                <p className={styles.treeGroup}>{group}</p>
                {groupFilesList.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    className={`${styles.treeItem} ${file.path === selected ? styles.treeItemActive : ''}`}
                    onClick={() => setSelected(file.path)}
                    aria-current={file.path === selected ? 'true' : undefined}
                  >
                    <span className={styles.treeName}>{fileName(file.path)}</span>
                    <span className={styles.treeSize}>{formatBytes(byteLength(file))}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className={styles.preview}>
            <div className={styles.previewHead}>{active?.path ?? ''}</div>
            {active && typeof active.content === 'string' ? (
              <pre
                className={styles.code}
                tabIndex={0}
                role="region"
                aria-label={`Contents of ${active.path}`}
              >
                <code>{active.content}</code>
              </pre>
            ) : (
              <div className={styles.binary}>
                <span>Binary file · {active ? formatBytes(byteLength(active)) : ''}</span>
              </div>
            )}
          </div>

          <GitHubPush
            files={files}
            projectName={project.name}
            slug={generated && 'slug' in generated ? generated.slug : 'zory-site'}
          />
        </div>

        <div className={styles.foot}>
          <span className={styles.footNote}>
            <span className={styles.stat}>
              <span className={styles.statValue}>{files.length}</span> files
            </span>
            {' · '}
            <span className={styles.stat}>
              <span className={styles.statValue}>{formatBytes(totalBytes)}</span> uncompressed
            </span>
            <br />
            Unzip, then <code>npm install &amp;&amp; npm run dev</code>.
          </span>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="large" disabled={busy} onClick={() => void download()}>
            <DownloadIcon size={13} />
            {busy ? 'Packaging…' : 'Download .zip'}
          </Button>
        </div>
      </div>
    </Scrim>
  );
}

function Scrim({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div
      className={styles.scrim}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

function byteLength(file: ExportedFile): number {
  return typeof file.content === 'string'
    ? new TextEncoder().encode(file.content).length
    : file.content.byteLength;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Groups by directory, with the project root first. */
function groupFiles(files: ExportedFile[]): [string, ExportedFile[]][] {
  const groups = new Map<string, ExportedFile[]>();
  for (const file of files) {
    const slash = file.path.lastIndexOf('/');
    const dir = slash === -1 ? 'Project root' : file.path.slice(0, slash);
    const bucket = groups.get(dir);
    if (bucket) bucket.push(file);
    else groups.set(dir, [file]);
  }

  return [...groups.entries()].sort(([a], [b]) => {
    if (a === 'Project root') return -1;
    if (b === 'Project root') return 1;
    return a.localeCompare(b);
  });
}
