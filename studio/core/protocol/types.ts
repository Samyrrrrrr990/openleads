/**
 * The Zory Local bridge protocol.
 *
 * `zory` running in a repository and Zory's visual environment running in a
 * browser are two processes on one machine that have to agree about a project.
 * This file is that agreement, and it is in the open package on purpose: an
 * editor plugin, a CI check or somebody's own tooling should be able to speak
 * it without reading Zory's source.
 *
 * Shape of the thing:
 *
 *   zory (CLI)  ──HTTP on 127.0.0.1──  Zory Studio in the browser
 *        │
 *        └──stdio MCP──  a coding agent
 *
 * The transport is deliberately boring — JSON over loopback HTTP, plus one
 * server-sent event stream for file changes. No websocket framing to get
 * wrong, no custom binary format, and anything can `curl` it while debugging.
 *
 * Security lives in three places and nowhere else:
 *   - the server binds to 127.0.0.1 and refuses any other interface;
 *   - every request carries a session token printed by the CLI at start-up;
 *   - the browser origin is checked against an allowlist, because a page the
 *     user happens to have open must not be able to read their repository.
 */

import type { Project } from '../graph/types';
import type { ZoryCommand } from '../commands/types';

export const PROTOCOL_VERSION = 1;

/** Default loopback port. The CLI walks upward if it is taken. */
export const DEFAULT_BRIDGE_PORT = 4571;

/** Header carrying the session token on every request. */
export const TOKEN_HEADER = 'x-zory-token';

/** Frameworks the CLI recognises. `unknown` is a supported outcome. */
export type FrameworkId = 'next' | 'vite-react' | 'remix' | 'astro' | 'cra' | 'unknown';

export interface FrameworkDetection {
  id: FrameworkId;
  name: string;
  /** Version from package.json, when it could be read. */
  version?: string;
  typescript: boolean;
  /** Styling systems found in the project. */
  styling: ('tailwind' | 'css-modules' | 'styled-components' | 'plain-css' | 'sass')[];
  /** The script the CLI would run for a dev server. */
  devScript?: string;
  /** Port the dev server is expected on, when it could be inferred. */
  devPort?: number;
}

export type WorkspaceMode =
  /** A folder Zory generated and keeps in step. Full visual editing. */
  | 'managed'
  /** A real project Zory did not write. Detected and reported, read-only. */
  | 'observed';

export interface GitState {
  available: boolean;
  branch?: string;
  /** Paths relative to the repository root. */
  changed: string[];
  /** Of `changed`, those inside the Zory-managed directory. */
  zoryChanged: string[];
  ahead?: number;
  behind?: number;
  clean: boolean;
}

export interface BridgeStatus {
  protocol: number;
  /** CLI version. */
  version: string;
  root: string;
  mode: WorkspaceMode;
  framework: FrameworkDetection;
  git: GitState;
  project: { id: string; name: string; pages: number; nodes: number } | null;
  /** Live dev server, when the CLI started or found one. */
  devServer: { url: string; managed: boolean } | null;
}

/** What the browser knows that an agent does not. */
export interface VisualContext {
  projectId: string | null;
  pageId: string | null;
  pagePath: string | null;
  selectedId: string | null;
  selectedName: string | null;
  selectedKind: string | null;
  breakpoint: string;
  /** Node ids from the selection up to the page root, nearest first. */
  ancestry: { id: string; name: string; kind: string }[];
  /** Direct children of the selection. */
  children: { id: string; name: string; kind: string }[];
  updatedAt: number;
}

export interface RecentChange {
  at: number;
  label: string;
  commandType: string;
  nodeId?: string;
}

// ------------------------------------------------------------------ wire ----

export type StatusResponse = BridgeStatus;

export interface ProjectResponse {
  project: Project | null;
  /** Absent when the workspace is `observed`. */
  reason?: string;
}

export interface CommandsRequest {
  commands: ZoryCommand[];
  /** Undo label, for the CLI's own log. */
  label?: string;
}

export interface CommandsResponse {
  applied: number;
  written: number;
  errors: string[];
}

export interface ContextResponse {
  context: VisualContext | null;
  recent: RecentChange[];
}

/** A proposal an agent has made, waiting for the person to approve it. */
export interface ProposalRequest {
  prompt: string;
  commands: ZoryCommand[];
  source: string;
}

export interface ProposalResponse {
  id: string;
  status: 'queued';
  /** Where the person will see it. */
  surface: 'studio';
}

export type BridgeEvent =
  | { type: 'file-changed'; path: string; at: number }
  | { type: 'project-changed'; at: number }
  | { type: 'git-changed'; at: number }
  | { type: 'context-changed'; at: number }
  | { type: 'proposal'; id: string; prompt: string; source: string; at: number };

export interface BridgeError {
  error: string;
  detail?: string;
}

/**
 * Origins the bridge will answer.
 *
 * Anything else gets a 403 with no body. This is the control that stops a
 * random page the user has open from reading their repository over loopback.
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'https://zory.ca',
  'https://www.zory.ca',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
