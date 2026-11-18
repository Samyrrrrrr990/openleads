/**
 * Keeping a linked folder current.
 *
 * This is the reason the desktop app exists. A linked project is written to a
 * real folder as ordinary React and TypeScript and rewritten whenever the
 * graph changes, so the folder is always the current state of the design. That
 * turns every editor into an integration without a plugin: `code .` works,
 * `npm run dev` works, and Claude Code can be pointed at it directly.
 *
 * Two things make it safe to leave running:
 *
 *   - writes are debounced, so dragging an element does not touch the disk on
 *     every frame; and
 *   - the main process skips any file whose bytes are unchanged, so a dev
 *     server watching the folder does not reload for edits that changed one
 *     component.
 */

import type { Project } from '@zory/core';
import { generateExport } from '../export/generate';
import { getIntegrationValues } from '../integrations/store';
import { desktop } from './bridge';

/** Debounce, matched to the autosave delay so the two settle together. */
const WRITE_DELAY_MS = 700;

const STORAGE_KEY = 'zory.workspaces.v1';

/** `{ [projectId]: folderPath }` — which folder a project is linked to. */
type Links = Record<string, string>;

function readLinks(): Links {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Links) : {};
  } catch {
    return {};
  }
}

function writeLinks(links: Links): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
  } catch {
    // Non-fatal: the link is still live for this session.
  }
}

export function linkedFolder(projectId: string): string | null {
  return readLinks()[projectId] ?? null;
}

export function setLinkedFolder(projectId: string, folder: string | null): void {
  const links = readLinks();
  if (folder) links[projectId] = folder;
  else delete links[projectId];
  writeLinks(links);
  notify();
}

// ------------------------------------------------------------ subscribers ---

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeWorkspace(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ----------------------------------------------------------------- status ---

export type SyncState = 'idle' | 'writing' | 'synced' | 'error' | 'external';

let state: SyncState = 'idle';
let detail = '';

export function syncState(): { state: SyncState; detail: string } {
  return { state, detail };
}

function setState(next: SyncState, nextDetail = ''): void {
  state = next;
  detail = nextDetail;
  notify();
}

// ------------------------------------------------------------------ write ---

let timer: ReturnType<typeof setTimeout> | null = null;
let queued: { project: Project; root: string } | null = null;
/** When Zory last wrote, so the watcher can ignore its own writes. */
let lastWriteAt = 0;

export function lastWriteTime(): number {
  return lastWriteAt;
}

/**
 * Writes the project to its linked folder, if it has one.
 * Safe to call on every graph change — it coalesces.
 */
export function scheduleSync(project: Project): void {
  const api = desktop();
  if (!api) return;

  const root = linkedFolder(project.id);
  if (!root) return;

  queued = { project, root };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), WRITE_DELAY_MS);
}

export async function flush(): Promise<void> {
  const api = desktop();
  const job = queued;
  queued = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!api || !job) return;

  setState('writing');
  try {
    /*
     * Markers on, unlike a downloadable export. This folder is a linked
     * workspace, so reading edits back out of it is the point; a zip someone
     * downloads must carry no trace of Zory at all.
     */
    const generated = generateExport(job.project, getIntegrationValues(), { markers: true });
    const files = [
      ...generated.files,
      // Written alongside the source so an agent opening this folder learns
      // what it is looking at instead of guessing from the file tree.
      { path: 'CLAUDE.md', content: agentBriefing(job.project) },
    ];

    const result = await api.writeProject(job.root, files);
    lastWriteAt = Date.now();
    setState(
      'synced',
      result.written === 0 ? 'No changes' : `${result.written} file${result.written === 1 ? '' : 's'} written`,
    );
  } catch (cause) {
    setState('error', cause instanceof Error ? cause.message : 'Could not write to the folder.');
  }
}

export function markExternalChange(path: string): void {
  setState('external', path);
}

// --------------------------------------------------------------- briefing ---

/**
 * The note left in the linked folder for a coding agent.
 *
 * Without it, an agent opening this folder sees a generated React project with
 * no indication that anything upstream exists, and its edits are silently
 * replaced the next time the design changes. Saying so plainly is the
 * difference between a folder that co-operates and one that fights.
 */
function agentBriefing(project: Project): string {
  const pages = project.pages.map((page) => `- \`src/pages/\` — ${page.name}`).join('\n');

  return `# ${project.name}

This folder is written by [OpenLeads Studio](https://github.com/Samyrrrrrr990/openleads) and kept in step with a
visual project as it is edited.

## What this is

Plain React and TypeScript on Vite. There is no Studio runtime, no proprietary
format and no build plugin — delete this file and the project still builds and
runs exactly as it does now.

\`\`\`
npm install
npm run dev
\`\`\`

## Pages

${pages || '- (no pages yet)'}

## Working in here alongside Zory

Zory rewrites the files it generates whenever the design changes, and it only
rewrites files whose contents actually differ. Two consequences worth knowing:

- **Edits to generated components can be overwritten.** If the design changes
  upstream, that component is regenerated. Zory notices when files change
  underneath it and says so rather than clobbering quietly, but it cannot
  merge.
- **Anything you add is left alone.** New files, new folders, tests, server
  routes, configuration — Zory writes its own output and does not remove what
  it did not create. This is the safe place to work.

If you are refactoring generated components heavily, unlink the folder in Studio
first. The project is yours at that point and Zory will stop writing to it.

## Environment

Credentials live in \`.env\`, which is gitignored. \`.env.example\` lists the
same names with no values. Anything named \`VITE_*\` is compiled into the
browser bundle and is public; everything else is server-side only.
`;
}
