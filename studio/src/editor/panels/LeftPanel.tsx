/**
 * The left rail: layers, pages, insert and assets.
 *
 * The layers tree is the keyboard-accessible counterpart to canvas selection —
 * everything reachable by clicking the canvas is reachable here too, which is
 * what makes the editor usable without a pointer.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { AssetNode, ElementNode, NodeKind } from '@zory/core';
import { instancePath, nodeLabel, newAssetId } from '@zory/core';
import { ImageImportError, prepareImage } from '../../core/assets/prepareImage';
import { useProjectStore } from '../state/projectStore';
import { useInstanceRootId, useResolvedNode } from '../state/useResolvedNode';
import { useUiStore, type LeftPanel as PanelId } from '../state/uiStore';
import {
  descendantsOf,
  insertBlueprint,
  reorder,
  selectAndReveal,
  toggleSelection,
} from '../state/actions';
import { isHiddenAt } from '../../renderer/resolve';
import {
  BoxIcon,
  ButtonIcon,
  ChevronRightIcon,
  DividerIcon,
  EyeOffIcon,
  HeadingIcon,
  ImageIcon,
  InstanceIcon,
  LinkIcon,
  PagesIcon,
  TextIcon,
} from '../../ui/icons';
import { isDesktop } from '../../core/desktop/bridge';
import { IntegrationsPanel } from './IntegrationsPanel';
import { DesignPanel } from './DesignPanel';
import { HistoryPanel } from './HistoryPanel';
import { LibraryPanel } from './LibraryPanel';
import { WorkspacePanel } from './WorkspacePanel';
import { PALETTE } from './blueprints';
import styles from './LeftPanel.module.css';

const KIND_ICON: Record<NodeKind, React.ComponentType<{ size?: number }>> = {
  container: BoxIcon,
  instance: InstanceIcon,
  heading: HeadingIcon,
  text: TextIcon,
  button: ButtonIcon,
  link: LinkIcon,
  image: ImageIcon,
  divider: DividerIcon,
};

/*
 * The folder tab is desktop-only, because holding a folder open and writing to
 * it continuously is not something a browser tab can do. Hiding it on the web
 * is better than showing a control that cannot work.
 */
const TABS: { id: PanelId; label: string }[] = [
  { id: 'layers', label: 'Layers' },
  { id: 'insert', label: 'Insert' },
  { id: 'library', label: 'Library' },
  { id: 'pages', label: 'Pages' },
  { id: 'design', label: 'Design' },
  { id: 'assets', label: 'Assets' },
  { id: 'history', label: 'History' },
  { id: 'connect', label: 'Connect' },
  ...(isDesktop() ? [{ id: 'folder' as PanelId, label: 'Folder' }] : []),
];

export function LeftPanel(): React.ReactElement {
  const active = useUiStore((s) => s.leftPanel);
  const setPanel = useUiStore((s) => s.setLeftPanel);

  return (
    <div className={styles.panel}>
      <div className={styles.tabs} role="tablist" aria-label="Editor panels">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`panel-tab-${id}`}
            aria-selected={active === id}
            aria-controls={`panel-${id}`}
            tabIndex={active === id ? 0 : -1}
            className={`${styles.tab} ${active === id ? styles.tabActive : ''}`}
            onClick={() => setPanel(id)}
            onKeyDown={(event) => {
              const index = TABS.findIndex((tab) => tab.id === active);
              if (event.key === 'ArrowRight') setPanel(TABS[(index + 1) % TABS.length]!.id);
              if (event.key === 'ArrowLeft') setPanel(TABS[(index - 1 + TABS.length) % TABS.length]!.id);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className={styles.body}
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`panel-tab-${active}`}
      >
        {active === 'layers' && <LayersTree />}
        {active === 'insert' && <InsertPalette />}
        {active === 'library' && <LibraryPanel />}
        {active === 'pages' && <PagesList />}
        {active === 'design' && <DesignPanel />}
        {active === 'assets' && <AssetsPanel />}
        {active === 'history' && <HistoryPanel />}
        {active === 'connect' && <IntegrationsPanel />}
        {active === 'folder' && <WorkspacePanel />}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Layers ---

type DropZone = 'before' | 'after' | 'inside';

function LayersTree(): React.ReactElement {
  const project = useProjectStore((s) => s.project);
  const pageId = useUiStore((s) => s.pageId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);

  const page = project?.pages.find((p) => p.id === pageId) ?? project?.pages[0];
  // Nodes under the dragged node can never be valid drop targets.
  const forbidden = useMemo(() => (dragId ? new Set(descendantsOf(dragId)) : new Set<string>()), [dragId]);

  const handleDrop = useCallback(() => {
    if (!dragId || !dropTarget || !project) return;
    const target = project.nodes[dropTarget.id];
    const dragged = project.nodes[dragId];
    if (!target || !dragged) return;

    if (dropTarget.zone === 'inside' && target.kind === 'container') {
      reorder(dragId, target.id, target.children.length);
    } else if (target.parentId) {
      const siblings = project.nodes[target.parentId]?.children ?? [];
      let index = siblings.indexOf(target.id);
      if (dropTarget.zone === 'after') index += 1;
      // Removing the node first shifts everything after it down one.
      if (dragged.parentId === target.parentId) {
        const from = siblings.indexOf(dragId);
        if (from >= 0 && from < index) index -= 1;
      }
      reorder(dragId, target.parentId, Math.max(0, index));
    }

    setDragId(null);
    setDropTarget(null);
  }, [dragId, dropTarget, project]);

  if (!project || !page) {
    return <p className={styles.panelEmpty}>No page open.</p>;
  }

  return (
    <div
      role="tree"
      aria-label="Layers"
      onDragEnd={() => {
        setDragId(null);
        setDropTarget(null);
      }}
      // Up and down move between visible rows, which is what makes the tree
      // usable without a pointer. Individual rows handle expand and collapse.
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();

        const rows = [
          ...event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'),
        ];
        const index = rows.indexOf(document.activeElement as HTMLElement);
        const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
        next?.focus();
      }}
    >
      <LayerRow
        nodeId={page.rootId}
        depth={0}
        dragId={dragId}
        forbidden={forbidden}
        dropTarget={dropTarget}
        onDragStart={setDragId}
        onDropTarget={setDropTarget}
        onDrop={handleDrop}
      />
    </div>
  );
}

interface LayerRowProps {
  nodeId: string;
  depth: number;
  dragId: string | null;
  forbidden: Set<string>;
  dropTarget: { id: string; zone: DropZone } | null;
  onDragStart: (id: string) => void;
  onDropTarget: (target: { id: string; zone: DropZone } | null) => void;
  onDrop: () => void;
}

function LayerRow(props: LayerRowProps): React.ReactElement | null {
  const { nodeId, depth, dragId, forbidden, dropTarget, onDragStart, onDropTarget, onDrop } = props;

  const node = useResolvedNode(nodeId);
  const instanceRootId = useInstanceRootId(nodeId);
  const selectedId = useUiStore((s) => s.selectedId);
  const selectedIds = useUiStore((s) => s.selectedIds);
  const hoveredId = useUiStore((s) => s.hoveredId);
  const breakpoint = useUiStore((s) => s.breakpoint);
  const expanded = useUiStore((s) => s.expandedIds.has(nodeId));
  const toggleExpanded = useUiStore((s) => s.toggleExpanded);
  const hover = useUiStore((s) => s.hover);
  const isRoot = depth === 0;

  if (!node) return null;

  /*
   * An instance has no children of its own; what sits under it in the tree is
   * the definition, addressed through this instance. Listing it means the
   * layers panel can reach inside a component the same way the canvas does.
   */
  const childIds =
    node.kind === 'instance'
      ? instanceRootId
        ? [instancePath(nodeId, instanceRootId)]
        : []
      : node.children;
  const hasChildren = childIds.length > 0;
  const open = isRoot || expanded;
  const Icon = KIND_ICON[node.kind];
  const hidden = isHiddenAt(node.styles, breakpoint);
  const isDropTarget = dropTarget?.id === nodeId;

  const dropClass = isDropTarget
    ? dropTarget.zone === 'before'
      ? styles.dropBefore
      : dropTarget.zone === 'after'
        ? styles.dropAfter
        : styles.dropInside
    : '';

  return (
    <div role="none">
      <div
        role="treeitem"
        aria-selected={selectedId === nodeId}
        aria-expanded={hasChildren ? open : undefined}
        aria-level={depth + 1}
        // Roving tabindex: exactly one row is tabbable. It is the selected
        // row, or the page root when nothing is selected — otherwise the tree
        // could not be reached by keyboard at all.
        tabIndex={selectedId === nodeId || (selectedId === null && isRoot) ? 0 : -1}
        // A tree row is a composite: the twisty and the label are separate
        // targets, so this outer element carries the semantics.
        className={[
          styles.row,
          selectedIds.includes(nodeId) ? styles.rowSelected : '',
          hoveredId === nodeId && selectedId !== nodeId ? styles.rowHovered : '',
          hidden ? styles.rowHidden : '',
          dragId === nodeId ? styles.dragging : '',
          dropClass,
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: 8 + depth * 12 }}
        draggable={!isRoot}
        onClick={(event) => {
          // Shift extends the selection here as well as on the canvas, so the
          // two ways of picking an element behave the same.
          if (event.shiftKey) toggleSelection(nodeId);
          else selectAndReveal(nodeId);
        }}
        onPointerEnter={() => hover(nodeId)}
        onPointerLeave={() => hover(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectAndReveal(nodeId);
          }
          if (event.key === 'ArrowRight' && hasChildren && !open) toggleExpanded(nodeId);
          if (event.key === 'ArrowLeft' && hasChildren && open) toggleExpanded(nodeId);
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', nodeId);
          onDragStart(nodeId);
        }}
        onDragOver={(event) => {
          if (!dragId || dragId === nodeId || forbidden.has(nodeId)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';

          const rect = event.currentTarget.getBoundingClientRect();
          const offset = (event.clientY - rect.top) / rect.height;
          const canNest = node.kind === 'container';

          let zone: DropZone;
          if (isRoot) zone = 'inside';
          else if (canNest && offset > 0.3 && offset < 0.7) zone = 'inside';
          else zone = offset < 0.5 ? 'before' : 'after';

          onDropTarget({ id: nodeId, zone });
        }}
        onDragLeave={() => {
          if (dropTarget?.id === nodeId) onDropTarget(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDrop();
        }}
      >
        {hasChildren && !isRoot ? (
          <span
            className={`${styles.twisty} ${open ? styles.twistyOpen : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded(nodeId);
            }}
            role="presentation"
          >
            <ChevronRightIcon size={9} />
          </span>
        ) : (
          <span className={styles.twistySpacer} />
        )}

        <span className={styles.rowIcon}>
          <Icon size={12} />
        </span>
        <span className={styles.rowName}>{nodeLabel(node)}</span>
        {hidden && (
          <span className={styles.rowBadge} title="Hidden at this breakpoint">
            <EyeOffIcon size={11} />
          </span>
        )}
      </div>

      {open && hasChildren && (
        // A treeitem's children must sit in a group for the tree to be
        // navigable by assistive technology.
        <div role="group">
          {childIds.map((childId) => (
            <LayerRow key={childId} {...props} nodeId={childId} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- Insert ---

function InsertPalette(): React.ReactElement {
  const selectedId = useUiStore((s) => s.selectedId);
  const selectedName = useProjectStore((s) =>
    selectedId ? (s.project?.nodes[selectedId]?.name ?? null) : null,
  );
  const selectedKind = useProjectStore((s) =>
    selectedId ? (s.project?.nodes[selectedId]?.kind ?? null) : null,
  );

  const destination =
    selectedKind === 'container' && selectedName
      ? `inside ${selectedName}`
      : selectedName
        ? `after ${selectedName}`
        : 'at the end of the page';

  return (
    <div>
      <p className={styles.sectionLabel}>Add element</p>
      <div className={styles.paletteGrid}>
        {PALETTE.map((entry) => {
          const Icon = KIND_ICON[entry.kind];
          return (
            <button
              key={entry.id}
              type="button"
              className={styles.paletteItem}
              onClick={() => insertBlueprint(entry.blueprint)}
            >
              <span className={styles.paletteIcon}>
                <Icon size={14} />
              </span>
              {entry.label}
            </button>
          );
        })}
      </div>
      <p className={styles.panelEmpty} style={{ textAlign: 'left', paddingTop: 4 }}>
        Adds {destination}.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ Pages ---

function PagesList(): React.ReactElement {
  const pages = useProjectStore((s) => s.project?.pages ?? []);
  const activeId = useUiStore((s) => s.pageId);
  const setPage = useUiStore((s) => s.setPage);

  return (
    <div>
      <p className={styles.sectionLabel}>Pages</p>
      {pages.map((page) => (
        <button
          key={page.id}
          type="button"
          className={`${styles.pageRow} ${page.id === activeId ? styles.pageRowActive : ''}`}
          onClick={() => setPage(page.id)}
          aria-current={page.id === activeId ? 'page' : undefined}
        >
          <PagesIcon size={12} />
          {page.name}
          <span className={styles.pagePath}>{page.path}</span>
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- Assets ---

function AssetsPanel(): React.ReactElement {
  const assets = useProjectStore((s) => s.project?.assets ?? []);
  const selectedId = useUiStore((s) => s.selectedId);
  const selectedKind = useProjectStore((s) =>
    selectedId ? (s.project?.nodes[selectedId]?.kind ?? null) : null,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);

    // Collected rather than overwritten: dropping six photos and seeing only
    // the last file's complaint is how the previous version behaved, and it
    // made a per-file problem look like a broken feature.
    const failures: string[] = [];

    try {
      for (const file of Array.from(files)) {
        try {
          const prepared = await prepareImage(file);
          const asset: AssetNode = {
            id: newAssetId(),
            name: file.name.replace(/\.[^.]+$/, ''),
            kind: 'image',
            src: prepared.src,
          };
          const result = useProjectStore.getState().run([{ type: 'ADD_ASSET', asset }], {
            label: `Add image ${asset.name}`,
          });
          if (!result.ok) failures.push(result.reason);
        } catch (cause) {
          failures.push(
            cause instanceof ImageImportError
              ? cause.message
              : `${file.name} could not be added.`,
          );
        }
      }
    } finally {
      setBusy(false);
    }

    if (failures.length > 0) setError(failures.join(' '));
  }, []);

  return (
    <div>
      <p className={styles.sectionLabel}>Images</p>

      <input
        ref={inputRef}
        type="file"
        /*
         * `image/*` rather than a fixed list. The old list left the picker
         * unable to see HEIC, which is what an iPhone produces by default, so
         * those users could not select their photos at all — the file simply
         * appeared greyed out with no explanation.
         */
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        className={styles.uploadZone}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? 'Preparing images…' : 'Add images from this computer'}
      </button>

      {error && <p className={styles.error}>{error}</p>}

      {assets.length === 0 ? (
        <p className={styles.panelEmpty}>
          Images you add are stored inside the project, so they travel with your export.
        </p>
      ) : (
        <div className={styles.assetGrid}>
          {assets.map((asset) => (
            <AssetTile
              key={asset.id}
              asset={asset}
              replaces={selectedKind === 'image'}
              onStatus={setError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One image, and the button that puts it on the page.
 *
 * "Use" used to require an image element to already exist and to already be
 * selected — so the actual path from "I have a photograph" to "it is on my
 * page" was: open Insert, add an Image, find it on the canvas, select it, open
 * Assets, press Use. Four steps before anything appears, and the button was
 * greyed out for all of them with the tooltip "Select an image element first".
 *
 * It now does the obvious thing instead. With an image element selected it
 * replaces that element's source; with anything else selected it inserts a new
 * image element carrying this asset, in the same place the Insert palette
 * would have put one. There is no state in which the button does nothing.
 *
 * Both paths check the result. The command they write was, until the fix in
 * `validate.ts`, rejected as an unsafe source — and because this component
 * discarded the `RunResult`, the entire feature failed in total silence.
 */
function AssetTile({
  asset,
  replaces,
  onStatus,
}: {
  asset: AssetNode;
  /** Whether the current selection is an image whose source this would set. */
  replaces: boolean;
  onStatus: (message: string | null) => void;
}): React.ReactElement {
  const selectedId = useUiStore((s) => s.selectedId);

  const use = useCallback(() => {
    onStatus(null);
    const src = `asset:${asset.id}`;

    if (replaces && selectedId) {
      const result = useProjectStore
        .getState()
        .run([{ type: 'SET_PROP', nodeId: selectedId, patch: { src } }], {
          label: 'Set image source',
        });
      if (!result.ok) onStatus(result.reason);
      return;
    }

    const result = insertBlueprint({
      kind: 'image',
      name: asset.name || 'Image',
      props: { src, alt: asset.name || '' },
      styles: {
        base: {
          width: '100%',
          maxWidth: '480px',
          borderRadius: '8px',
          objectFit: 'cover',
        },
      },
    });
    if (!result.ok) onStatus(result.reason);
  }, [asset.id, asset.name, onStatus, replaces, selectedId]);

  return (
    <div className={styles.assetTile}>
      <img className={styles.assetThumb} src={asset.src} alt="" />
      <span className={styles.assetName} title={asset.name}>
        {asset.name}
      </span>
      <div className={styles.assetActions}>
        <button
          type="button"
          className={styles.assetAction}
          title={replaces ? 'Use for the selected image' : 'Add this image to the page'}
          onClick={use}
        >
          {replaces ? 'Use' : 'Place'}
        </button>
        <button
          type="button"
          className={styles.assetAction}
          onClick={() => {
            const result = useProjectStore
              .getState()
              .run([{ type: 'REMOVE_ASSET', assetId: asset.id }], { label: 'Remove image' });
            if (!result.ok) onStatus(result.reason);
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export type { ElementNode };
