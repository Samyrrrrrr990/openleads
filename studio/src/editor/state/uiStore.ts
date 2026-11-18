/**
 * Editor UI state.
 *
 * Deliberately separate from the project graph: this is what the user is
 * looking at, not what they have built. None of it is exported or persisted
 * into the project file.
 */

import { create } from 'zustand';
import type { Breakpoint, NodeId, PageId } from '@zory/core';

export type InspectorTab = 'design' | 'settings';
export type LeftPanel =
  | 'layers'
  | 'pages'
  | 'insert'
  | 'library'
  | 'design'
  | 'assets'
  | 'history'
  | 'connect'
  | 'folder';

interface UiState {
  pageId: PageId | null;
  /**
   * The primary selection — the last node clicked.
   *
   * Kept alongside `selectedIds` rather than derived from it, and that is
   * deliberate: every panel in the editor is written against a single node,
   * and multi-select would have been a rewrite of all of them if this had
   * become an array. It is also the right anchor for "match size", where the
   * reference is the one the person just clicked.
   *
   * Invariant: when `selectedIds` is non-empty, `selectedId` is its last
   * member. When it is empty, `selectedId` is null.
   */
  selectedId: NodeId | null;
  /** Every selected node, in the order they were added. */
  selectedIds: NodeId[];
  hoveredId: NodeId | null;
  breakpoint: Breakpoint;
  zoom: number;
  /** True while the canvas has an active inline text edit. */
  editingTextId: NodeId | null;
  leftPanel: LeftPanel;
  inspectorTab: InspectorTab;
  expandedIds: Set<NodeId>;
  intentOpen: boolean;
  exportOpen: boolean;
  previewOpen: boolean;
  /**
   * Bumped to replay every entrance on the canvas.
   *
   * A number rather than a flag: the canvas puts it in the selector its motion
   * rules are prefixed with, so changing it restarts the animations without
   * anything having to reach into the DOM.
   */
  motionGeneration: number;

  setPage: (pageId: PageId) => void;
  select: (nodeId: NodeId | null) => void;
  /** Adds or removes a node from the selection. Shift-click. */
  toggleSelected: (nodeId: NodeId) => void;
  /** Replaces the whole selection. */
  selectMany: (nodeIds: NodeId[]) => void;
  hover: (nodeId: NodeId | null) => void;
  setBreakpoint: (breakpoint: Breakpoint) => void;
  setZoom: (zoom: number) => void;
  zoomBy: (delta: number) => void;
  resetZoom: () => void;
  beginTextEdit: (nodeId: NodeId) => void;
  endTextEdit: () => void;
  setLeftPanel: (panel: LeftPanel) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  toggleExpanded: (nodeId: NodeId) => void;
  expand: (nodeIds: NodeId[]) => void;
  setIntentOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setPreviewOpen: (open: boolean) => void;
  replayMotion: () => void;
  reset: (pageId: PageId | null) => void;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

const clampZoom = (value: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

export const useUiStore = create<UiState>((set, get) => ({
  pageId: null,
  selectedId: null,
  selectedIds: [],
  hoveredId: null,
  breakpoint: 'base',
  zoom: 1,
  editingTextId: null,
  leftPanel: 'layers',
  inspectorTab: 'design',
  expandedIds: new Set<NodeId>(),
  intentOpen: false,
  exportOpen: false,
  previewOpen: false,
  motionGeneration: 0,

  setPage: (pageId) =>
    set({ pageId, selectedId: null, selectedIds: [], hoveredId: null, editingTextId: null }),

  select: (selectedId) =>
    set((s) => ({
      selectedId,
      selectedIds: selectedId ? [selectedId] : [],
      // Leaving a node always ends its inline edit.
      editingTextId: s.editingTextId === selectedId ? s.editingTextId : null,
    })),

  toggleSelected: (nodeId) =>
    set((s) => {
      const has = s.selectedIds.includes(nodeId);
      const selectedIds = has
        ? s.selectedIds.filter((id) => id !== nodeId)
        : [...s.selectedIds, nodeId];

      return {
        selectedIds,
        // The primary follows the last one added, or the last one left.
        selectedId: selectedIds[selectedIds.length - 1] ?? null,
        editingTextId: null,
      };
    }),

  selectMany: (nodeIds) =>
    set({
      selectedIds: nodeIds,
      selectedId: nodeIds[nodeIds.length - 1] ?? null,
      editingTextId: null,
    }),
  hover: (hoveredId) => set((s) => (s.hoveredId === hoveredId ? s : { hoveredId })),
  setBreakpoint: (breakpoint) => set({ breakpoint }),
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  zoomBy: (delta) => {
    const current = get().zoom;
    const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
    const nextIndex = Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + delta));
    set({ zoom: ZOOM_STEPS[nextIndex] ?? 1 });
  },
  resetZoom: () => set({ zoom: 1 }),
  beginTextEdit: (nodeId) => set({ editingTextId: nodeId, selectedId: nodeId }),
  endTextEdit: () => set({ editingTextId: null }),
  setLeftPanel: (leftPanel) => set({ leftPanel }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  toggleExpanded: (nodeId) =>
    set((s) => {
      const expandedIds = new Set(s.expandedIds);
      if (expandedIds.has(nodeId)) expandedIds.delete(nodeId);
      else expandedIds.add(nodeId);
      return { expandedIds };
    }),
  expand: (nodeIds) =>
    set((s) => {
      if (nodeIds.every((id) => s.expandedIds.has(id))) return s;
      const expandedIds = new Set(s.expandedIds);
      for (const id of nodeIds) expandedIds.add(id);
      return { expandedIds };
    }),
  setIntentOpen: (intentOpen) => set({ intentOpen }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setPreviewOpen: (previewOpen) => set({ previewOpen }),
  replayMotion: () => set((s) => ({ motionGeneration: s.motionGeneration + 1 })),
  reset: (pageId) =>
    set({
      pageId,
      selectedId: null,
      selectedIds: [],
      hoveredId: null,
      breakpoint: 'base',
      zoom: 1,
      editingTextId: null,
      expandedIds: new Set<NodeId>(),
      intentOpen: false,
      exportOpen: false,
      previewOpen: false,
      motionGeneration: 0,
    }),
}));

export const selectSelectedId = (s: UiState): NodeId | null => s.selectedId;
export const selectSelectedIds = (s: UiState): NodeId[] => s.selectedIds;
export const selectBreakpoint = (s: UiState): Breakpoint => s.breakpoint;
