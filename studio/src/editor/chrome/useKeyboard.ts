/**
 * Editor keyboard shortcuts.
 *
 * The single most important rule here: destructive and navigational shortcuts
 * must never fire while the user is typing. `isTyping` guards every one of
 * them, including inside the canvas's own inline text editing.
 */

import { useEffect } from 'react';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import {
  deleteSelected,
  deleteSelection,
  duplicateSelected,
  groupSelected,
  ungroupSelected,
} from '../state/actions';
import { hasCommandModifier } from './platform';

/** True when focus is in a field where keystrokes are content, not commands. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useEditorKeyboard(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const ui = useUiStore.getState();
      const store = useProjectStore.getState();
      const mod = hasCommandModifier(event);
      const typing = isTyping(event.target);

      // ---- Available even while typing ----

      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void store.flush();
        return;
      }

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        ui.setIntentOpen(!ui.intentOpen);
        return;
      }

      if (mod && event.key.toLowerCase() === 'z') {
        // Inside a text field, ⌘Z should undo the typing, not the project.
        if (typing) return;
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }

      if (mod && event.key.toLowerCase() === 'y') {
        if (typing) return;
        event.preventDefault();
        store.redo();
        return;
      }

      if (event.key === 'Escape') {
        // Close the topmost surface first.
        if (ui.intentOpen) {
          ui.setIntentOpen(false);
          return;
        }
        if (ui.exportOpen) {
          ui.setExportOpen(false);
          return;
        }
        if (ui.previewOpen) {
          ui.setPreviewOpen(false);
          return;
        }
        if (ui.editingTextId) {
          ui.endTextEdit();
          return;
        }
        if (typing && event.target instanceof HTMLElement) {
          event.target.blur();
          return;
        }
        ui.select(null);
        return;
      }

      // ---- Everything below is suppressed while typing ----
      if (typing) return;

      if (mod && event.key.toLowerCase() === 'd') {
        if (!ui.selectedId) return;
        event.preventDefault();
        duplicateSelected(ui.selectedId);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!ui.selectedId) return;
        event.preventDefault();
        // One step for the whole selection, not one per element.
        if (ui.selectedIds.length > 1) deleteSelection(ui.selectedIds);
        else deleteSelected(ui.selectedId);
        return;
      }

      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        ui.zoomBy(1);
        return;
      }
      if (mod && event.key === '-') {
        event.preventDefault();
        ui.zoomBy(-1);
        return;
      }
      if (mod && event.key === '0') {
        event.preventDefault();
        ui.resetZoom();
        return;
      }

      // Viewport switching — bare number keys, so ⌘1 stays the browser's.
      if (!mod && !event.altKey) {
        if (event.key === '1') {
          ui.setBreakpoint('base');
          return;
        }
        if (event.key === '2') {
          ui.setBreakpoint('tablet');
          return;
        }
        if (event.key === '3') {
          ui.setBreakpoint('mobile');
          return;
        }
      }

      // Group and ungroup, on the shortcuts every design tool uses.
      if (mod && (event.key === 'g' || event.key === 'G')) {
        if (!ui.selectedId) return;
        event.preventDefault();
        if (event.shiftKey) ungroupSelected(ui.selectedId);
        else groupSelected(ui.selectedId);
        return;
      }

      // Enter starts editing the selected element's text.
      if (event.key === 'Enter' && ui.selectedId) {
        const node = store.project?.nodes[ui.selectedId];
        if (!node) return;
        if (node.kind === 'container' || node.kind === 'image' || node.kind === 'divider') return;
        event.preventDefault();
        ui.beginTextEdit(ui.selectedId);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/**
 * Flushes pending work when the tab is hidden or closed, and warns if a write
 * is still outstanding.
 */
export function useSaveOnExit(): void {
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent): void {
      const { saveState, flush } = useProjectStore.getState();
      if (saveState === 'saved') return;
      void flush();
      event.preventDefault();
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === 'hidden') {
        void useProjectStore.getState().flush();
      }
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}
