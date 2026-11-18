/**
 * The editor shell: loads a project, wires the panes together and owns the
 * overlays (Intent, preview, export).
 */

import { useEffect, useRef, useState } from 'react';
import { scheduleSync } from '../core/desktop/workspace';
import { Link, useParams } from 'react-router-dom';
import {
  VIEWPORT_WIDTH,
  type Breakpoint,
  SchemaTooNewError,
  limits,
  themeStyleObject,
} from '@zory/core';
import { loadProject } from '../core/persistence/repository';
import { NodeView } from '../renderer/NodeView';
import { configureHistory, selectUndoLabel, useProjectStore } from './state/projectStore';
import { useBillingStore } from '../core/billing/store';
import { useUiStore } from './state/uiStore';
import { pruneSelection } from './state/actions';
import { Canvas } from './canvas/Canvas';
import { Inspector } from './inspector/Inspector';
import { LeftPanel } from './panels/LeftPanel';
import { FirstRun } from './chrome/FirstRun';
import { TopBar } from './chrome/TopBar';
import { useEditorKeyboard, useSaveOnExit } from './chrome/useKeyboard';
import { IntentBar } from './intent/IntentBar';
import { ExportDialog } from './export/ExportDialog';
import { Button, IconButton, Segmented } from '../ui/controls';
import { CloseIcon, DesktopIcon, MobileIcon, TabletIcon, ZoryMark } from '../ui/icons';
import { useDialogFocus } from '../ui/useDialogFocus';
import styles from './EditorShell.module.css';

type LoadState = 'loading' | 'ready' | 'missing' | 'error';

export function EditorShell({ local = false }: { local?: boolean } = {}): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useProjectStore((s) => s.load);
  const close = useProjectStore((s) => s.close);
  const resetUi = useUiStore((s) => s.reset);

  useEditorKeyboard();
  useSaveOnExit();

  /*
   * Tell the store how long to keep versions.
   *
   * Wired here rather than imported by the store, because the store is what
   * Zory Local and the desktop app also drive and neither of those has an
   * account to read a plan from.
   */
  useEffect(() => {
    configureHistory({
      retentionDays: () => limits(useBillingStore.getState().entitlements).historyDays,
      label: () => selectUndoLabel(useProjectStore.getState()) ?? 'Autosaved',
    });
  }, []);

  useEffect(() => {
    // Zory Local loads the project itself, from the bridge, before rendering
    // this shell. There is nothing here to fetch.
    if (local) {
      setState('ready');
      return;
    }

    let cancelled = false;
    if (!id) {
      setState('missing');
      return;
    }

    setState('loading');
    loadProject(id)
      .then((project) => {
        if (cancelled) return;
        if (!project) {
          setState('missing');
          return;
        }
        load(project);
        resetUi(project.pages[0]?.id ?? null);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(
          error instanceof SchemaTooNewError
            ? error.message
            : 'This project could not be opened. It may have been damaged.',
        );
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [id, load, local, resetUi]);

  // Flush pending work and clear the store when leaving the editor. In local
  // mode the page above owns the project's lifetime, so it is left alone.
  useEffect(
    () => () => {
      void useProjectStore.getState().flush();
      if (!local) close();
    },
    [close, local],
  );

  // Keep selection from pointing at nodes that undo or Intent removed.
  useEffect(() => useProjectStore.subscribe(() => pruneSelection()), []);

  /*
   * Keep the linked folder current.
   *
   * Driven from here rather than from the Folder panel: that panel only exists
   * while its tab is open, so syncing from it would silently stop the moment
   * the user switched to Layers — which is most of the time.
   */
  useEffect(
    () =>
      useProjectStore.subscribe((state) => {
        if (state.project) scheduleSync(state.project);
      }),
    [],
  );

  if (state === 'loading') {
    return (
      <div className={styles.loading}>
        <span className={styles.loadingMark}>
          <ZoryMark size={26} />
        </span>
        <p className="sr-only">Opening project</p>
      </div>
    );
  }

  if (state === 'missing' || state === 'error') {
    return (
      <div className={styles.missing}>
        <h1 className={styles.missingTitle}>
          {state === 'missing' ? 'That project is not on this device' : 'Could not open this project'}
        </h1>
        <p className={styles.missingBody}>
          {errorMessage ??
            'Studio keeps sites in your OpenLeads workspace. This one may have been deleted, or the link belongs to another workspace.'}
        </p>
        <Link to="/app/projects">
          <Button variant="primary" size="large">
            Back to projects
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <TopBar />
      <div className={styles.body}>
        <LeftPanel />
        <Canvas />
        <Inspector />
        {/*
          Inside the body so it sits over the canvas rather than over the
          panels, and after them so it is last in the tab order — a guide
          should never come between somebody and the thing it is describing.
        */}
        <FirstRun />
      </div>

      <div className={styles.narrowNotice}>
        <h2 className={styles.missingTitle}>The editor needs a wider screen</h2>
        <p className={styles.missingBody}>
          Studio’s canvas, layers and inspector need at least 900px to work side by side. Open this
          project on a laptop or desktop.
        </p>
        <Link to="/app/projects">
          <Button variant="outline">Back to projects</Button>
        </Link>
      </div>

      <IntentBar />
      <PreviewOverlay />
      <ExportDialog />
    </div>
  );
}

const PREVIEW_VIEWPORTS: { value: Breakpoint; label: string; title: string; icon: React.ReactNode }[] =
  [
    { value: 'base', label: 'Desktop', title: 'Desktop', icon: <DesktopIcon size={13} /> },
    { value: 'tablet', label: 'Tablet', title: 'Tablet', icon: <TabletIcon size={13} /> },
    { value: 'mobile', label: 'Mobile', title: 'Mobile', icon: <MobileIcon size={13} /> },
  ];

/**
 * Preview renders the same node tree with all editor affordances removed —
 * no outlines, no hit testing, links live.
 */
function PreviewOverlay(): React.ReactElement | null {
  const open = useUiStore((s) => s.previewOpen);
  const setOpen = useUiStore((s) => s.setPreviewOpen);
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('base');
  const editorBreakpoint = useUiStore((s) => s.breakpoint);
  const pageId = useUiStore((s) => s.pageId);
  const project = useProjectStore((s) => s.project);
  const scrimRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setBreakpoint(editorBreakpoint);
  }, [open, editorBreakpoint]);

  /*
   * Preview carried `role="dialog"` and none of the behaviour that implies:
   * focus stayed on whatever opened it, Tab walked through the editor still
   * rendered behind the overlay, and Escape did nothing.
   */
  useDialogFocus(scrimRef, () => setOpen(false), { enabled: open });

  if (!open || !project) return null;
  const page = project.pages.find((p) => p.id === pageId) ?? project.pages[0];
  if (!page) return null;

  return (
    <div
      ref={scrimRef}
      className={styles.previewScrim}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Preview"
    >
      <div className={styles.previewBar}>
        <span className={styles.previewLabel}>
          <ZoryMark size={14} />
          Preview · {project.name}
        </span>
        <span className={styles.previewSpacer} />
        <Segmented
          label="Preview viewport"
          value={breakpoint}
          onChange={setBreakpoint}
          options={PREVIEW_VIEWPORTS}
        />
        <IconButton label="Close preview" onClick={() => setOpen(false)}>
          <CloseIcon />
        </IconButton>
      </div>
      <div className={styles.previewStage}>
        <div
          className={styles.previewFrame}
          style={
            {
              width: VIEWPORT_WIDTH[breakpoint],
              ...themeStyleObject(project.settings.theme),
            } as React.CSSProperties
          }
        >
          <NodeView nodeId={page.rootId} breakpoint={breakpoint} />
        </div>
      </div>
    </div>
  );
}
