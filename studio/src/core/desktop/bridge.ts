/**
 * Access to the desktop app's capabilities from the renderer.
 *
 * The same bundle runs in a browser tab and inside Electron, so everything
 * here is written around one question: is `window.zory` there or not? On the
 * web it is not, `isDesktop()` is false, and every desktop-only surface simply
 * does not render. Nothing throws, nothing is stubbed with a fake that
 * pretends to work, and there is no separate web build to keep in step.
 */

export interface DesktopWriteResult {
  written: number;
  total: number;
}

export interface DesktopFileChange {
  root: string;
  path: string;
  at: number;
}

export interface DesktopApi {
  isDesktop: true;
  platform(): Promise<{ platform: string; version: string }>;
  pickFolder(): Promise<string | null>;
  writeProject(
    root: string,
    files: { path: string; content: string | Uint8Array }[],
  ): Promise<DesktopWriteResult>;
  readFile(root: string, path: string): Promise<string | null>;
  removePath(root: string, path: string): Promise<void>;
  revealFolder(root: string): Promise<void>;
  forgetFolder(root: string): Promise<void>;
  openIn(
    root: string,
    target: 'vscode' | 'cursor' | 'terminal',
  ): Promise<{ ok: boolean; reason?: string }>;
  watch(root: string): Promise<boolean>;
  onFileChanged(handler: (change: DesktopFileChange) => void): () => void;
}

declare global {
  interface Window {
    zory?: DesktopApi;
  }
}

export function desktop(): DesktopApi | null {
  if (typeof window === 'undefined') return null;
  return window.zory ?? null;
}

export function isDesktop(): boolean {
  return desktop() !== null;
}

/** Shortens a path for display without losing which folder it is. */
export function shortenPath(path: string, maxSegments = 3): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length <= maxSegments) return path;
  return `…/${parts.slice(-maxSegments).join('/')}`;
}
