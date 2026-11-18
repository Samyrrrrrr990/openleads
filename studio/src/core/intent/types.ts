/**
 * Intent Mode.
 *
 * Intent is a command compiler, not a chat surface: a prompt plus the current
 * selection goes in, structured commands come out, and nothing is applied
 * until the user confirms and the validator agrees.
 *
 * The provider boundary is deliberately narrow so a local model or a remote
 * one can be dropped in later without any of them ever owning project state.
 */

import type { Breakpoint, NodeId, Project, ZoryCommand } from '@zory/core';

export interface IntentContext {
  /** Read-only. A provider must never mutate this. */
  readonly project: Project;
  readonly selectedId: NodeId | null;
  /** The page being edited. Lets a provider see the whole composition, not
      just the node under the cursor. */
  readonly pageId: string | null;
  /** The breakpoint the editor is currently scoped to. */
  readonly breakpoint: Breakpoint;
}

export interface IntentProvider {
  readonly id: string;
  readonly name: string;
  /** Whether this provider can run right now (e.g. has credentials). */
  isAvailable(): boolean;
  propose(context: IntentContext, prompt: string): Promise<ZoryCommand[]>;
}

/** Raised by a provider when it understood the request but cannot serve it. */
export class IntentError extends Error {
  constructor(
    message: string,
    /** Concrete things the user could type instead. */
    readonly suggestions: string[] = [],
  ) {
    super(message);
    this.name = 'IntentError';
  }
}

/**
 * A change the provider asked for and Zory would not make.
 *
 * Listed beside the proposal rather than thrown, so an ambitious request that
 * is mostly right lands mostly right. Before this existed one invalid node id
 * in a reply of twenty discarded the other nineteen, which taught people to
 * ask Intent for less than they wanted.
 */
export interface SkippedChange {
  /** What it was, named from the command's shape. */
  what: string;
  /** Why the validator refused it, in its own words. */
  reason: string;
}

/** A validated, previewable change set. */
export interface IntentProposal {
  prompt: string;
  /** Only the commands that validated. Nothing invalid is ever carried here. */
  commands: ZoryCommand[];
  /** One line per command, in the user's language. */
  descriptions: string[];
  /** What was asked for and refused. Usually empty. */
  skipped: SkippedChange[];
  summary: string;
  providerId: string;
}
