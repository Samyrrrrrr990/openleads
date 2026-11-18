/**
 * Editor top bar.
 *
 * Left: identity and save state. Centre: which viewport you are looking at.
 * Right: the actions that leave the editor — preview, Intent, export.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Breakpoint } from '@zory/core';
import {
  selectCanRedo,
  selectCanUndo,
  selectRedoLabel,
  selectUndoLabel,
  useProjectStore,
} from '../state/projectStore';
import { useUiStore, ZOOM_MAX, ZOOM_MIN } from '../state/uiStore';
import { renameProjectTo } from '../state/actions';
import { isAuthConfigured } from '../../core/auth/config';
import { Button, IconButton, Segmented } from '../../ui/controls';
import { shortcut } from './platform';
import {
  DesktopIcon,
  DownloadIcon,
  MobileIcon,
  PlayIcon,
  RedoIcon,
  SettingsIcon,
  SparkIcon,
  TabletIcon,
  UndoIcon,
  ZoryMark,
} from '../../ui/icons';
import styles from './TopBar.module.css';
import { SiteActions } from './SiteActions';

const VIEWPORTS: { value: Breakpoint; label: string; title: string; icon: React.ReactNode }[] = [
  { value: 'base', label: 'Desktop', title: 'Desktop, 1', icon: <DesktopIcon size={13} /> },
  { value: 'tablet', label: 'Tablet', title: 'Tablet, 2', icon: <TabletIcon size={13} /> },
  { value: 'mobile', label: 'Mobile', title: 'Mobile, 3', icon: <MobileIcon size={13} /> },
];

export function TopBar(): React.ReactElement {
  const name = useProjectStore((s) => s.project?.name ?? '');
  const canUndo = useProjectStore(selectCanUndo);
  const canRedo = useProjectStore(selectCanRedo);
  const undoWhat = useProjectStore(selectUndoLabel);
  const redoWhat = useProjectStore(selectRedoLabel);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);

  const breakpoint = useUiStore((s) => s.breakpoint);
  const setBreakpoint = useUiStore((s) => s.setBreakpoint);
  const zoom = useUiStore((s) => s.zoom);
  const zoomBy = useUiStore((s) => s.zoomBy);
  const resetZoom = useUiStore((s) => s.resetZoom);
  const setIntentOpen = useUiStore((s) => s.setIntentOpen);
  const setExportOpen = useUiStore((s) => s.setExportOpen);
  const setPreviewOpen = useUiStore((s) => s.setPreviewOpen);

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <Link to="/app/projects" className={styles.home} aria-label="All projects" title="All projects">
          <ZoryMark size={16} />
        </Link>
        <ProjectNameField name={name} />
        <SaveIndicator />
      </div>

      <div className={styles.center}>
        {/* Naming the change makes undo a decision rather than a gamble. */}
        <IconButton
          label={undoWhat ? `Undo ${undoWhat}, ${shortcut('Z')}` : `Undo, ${shortcut('Z')}`}
          onClick={() => undo()}
          disabled={!canUndo}
        >
          <UndoIcon />
        </IconButton>
        <IconButton
          label={
            redoWhat
              ? `Redo ${redoWhat}, ${shortcut('Z', { shift: true })}`
              : `Redo, ${shortcut('Z', { shift: true })}`
          }
          onClick={() => redo()}
          disabled={!canRedo}
        >
          <RedoIcon />
        </IconButton>

        <span className={styles.divider} />

        <Segmented
          label="Viewport"
          value={breakpoint}
          onChange={setBreakpoint}
          options={VIEWPORTS}
        />

        <span className={styles.divider} />

        <div className={styles.zoom}>
          <IconButton label="Zoom out" onClick={() => zoomBy(-1)} disabled={zoom <= ZOOM_MIN}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3.5 7h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </IconButton>
          <button
            type="button"
            className={styles.zoomValue}
            onClick={resetZoom}
            title="Reset zoom to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconButton label="Zoom in" onClick={() => zoomBy(1)} disabled={zoom >= ZOOM_MAX}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M7 3.5v7M3.5 7h7"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </IconButton>
        </div>
      </div>

      <div className={styles.right}>
        <button type="button" className={styles.intentButton} onClick={() => setIntentOpen(true)}>
          <SparkIcon size={13} />
          Intent
          <span className={styles.intentKbd}>{shortcut('K')}</span>
        </button>
        <IconButton label="Preview" onClick={() => setPreviewOpen(true)}>
          <PlayIcon />
        </IconButton>
        {/*
          Reaching settings from inside the editor used to mean going back to
          the dashboard, which itself did not link there either.
        */}
        <SiteActions />
        <Button variant="primary" onClick={() => setExportOpen(true)}>
          <DownloadIcon size={13} />
          Export
        </Button>
      </div>
    </header>
  );
}

function ProjectNameField({ name }: { name: string }): React.ReactElement {
  const [draft, setDraft] = useState(name);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(name);
  }, [name, focused]);

  return (
    <>
      <label className="sr-only" htmlFor="project-name">
        Project name
      </label>
      <input
        id="project-name"
        className={styles.nameField}
        value={draft}
        size={Math.max(8, Math.min(28, draft.length + 1))}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          setFocused(false);
          const next = event.target.value.trim();
          if (next === '' || next === name) {
            setDraft(name);
            return;
          }
          renameProjectTo(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(name);
            event.currentTarget.blur();
          }
        }}
      />
    </>
  );
}

const SAVE_COPY: Record<string, { label: string; className: string }> = {
  saved: { label: 'Saved locally', className: 'saveSaved' },
  unsaved: { label: 'Unsaved changes', className: 'saveUnsaved' },
  saving: { label: 'Saving', className: 'saveSaving' },
  error: { label: 'Could not save', className: 'saveError' },
};

function SaveIndicator(): React.ReactElement {
  const saveState = useProjectStore((s) => s.saveState);
  const saveError = useProjectStore((s) => s.saveError);
  const copy = SAVE_COPY[saveState] ?? SAVE_COPY.saved!;

  return (
    <span
      className={`${styles.save} ${styles[copy.className]}`}
      // Save state changes on its own, so announce it politely rather than
      // leaving it as a silent visual.
      role="status"
      aria-live="polite"
      title={saveError ?? undefined}
    >
      <span className={styles.saveDot} />
      {copy.label}
    </span>
  );
}
