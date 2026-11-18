/**
 * The AI-backed Intent provider.
 *
 * It sends the selection and the prompt to Zory's own endpoint, which holds
 * the OpenRouter key server-side. Whatever comes back is a *suggestion*: the
 * engine validates every command against the real project before the user
 * sees a proposal, and the user still approves it.
 *
 * This provider is additive. If the server has no key, or the network is
 * down, or the model returns nonsense, `propose` throws and the engine falls
 * back to the deterministic local parser — which is why AI can be switched off
 * entirely without losing a feature.
 */

import type { ElementNode, ZoryCommand } from '@zory/core';
import { findNode } from '@zory/core';
import { IntentError, type IntentContext, type IntentProvider } from './types';

/** Raised when the provider cannot serve a request and the caller should fall back. */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

const ENDPOINT = '/api/intent';
const TIMEOUT_MS = 20_000;

/**
 * Set when the server refuses on allowance grounds, so the editor can explain
 * why a request fell back to the on-device parser instead of leaving the user
 * to guess.
 */
let lastAllowanceMessage: string | null = null;

export function allowanceMessage(): string | null {
  return lastAllowanceMessage;
}

/**
 * Attaches the caller's identity when there is one.
 *
 * The server needs it to know whose allowance to spend. Signing in is not
 * required — an anonymous request is served from a shared Free bucket — so a
 * failure to produce a token is never treated as an error.
 */
async function authorisedHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  return headers;
}

/**
 * Set once the endpoint has proved absent (a local `vite dev` with no
 * serverless functions, or a deploy without the key). Without this the
 * provider would fire a doomed request on every prompt and fill the console
 * with 404s, when the answer is already known.
 */
let endpointMissing = false;

/** Trimmed node summary — enough for the model, small enough to stay cheap. */
/**
 * How many nodes of page structure to send.
 *
 * Enough for a real marketing page, capped so a large project cannot blow the
 * request out. Trimmed breadth-first from the page root, so what survives is
 * the top-level composition rather than a random deep corner.
 */
const MAX_TREE_NODES = 90;

/**
 * A compact map of the page.
 *
 * Without this the model can only ever see the node you clicked, so every
 * request has to be phrased as a single-element instruction. Sending the
 * structure is what makes "make this page feel calmer" a question the model
 * can actually answer — it can see the heading, the subtitle and the button
 * are related, and return one command for each.
 *
 * Styles are omitted for everything but the focused node: they are the bulk of
 * the payload, and the model needs the *shape* of the page far more than it
 * needs every declared value.
 */
function pageTree(context: IntentContext): { id: string; kind: string; name: string; parentId: string | null; text?: string }[] {
  const page =
    context.project.pages.find((candidate) => candidate.id === context.pageId) ??
    context.project.pages[0];
  if (!page) return [];

  const out: { id: string; kind: string; name: string; parentId: string | null; text?: string }[] = [];
  const queue: string[] = [page.rootId];

  while (queue.length > 0 && out.length < MAX_TREE_NODES) {
    const id = queue.shift()!;
    const node = findNode(context.project, id);
    if (!node) continue;
    out.push({
      id: node.id,
      kind: node.kind,
      name: node.name,
      parentId: node.parentId,
      ...(node.text ? { text: node.text.slice(0, 80) } : {}),
    });
    queue.push(...node.children);
  }

  return out;
}

function summarise(node: ElementNode) {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    ...(node.text ? { text: node.text.slice(0, 160) } : {}),
    styles: node.styles,
  };
}

export const openRouterProvider: IntentProvider = {
  id: 'openrouter',
  name: 'AI',

  // The server decides whether AI is configured; the client cannot know until
  // it asks. Assume yes until an attempt proves otherwise.
  isAvailable: () => !endpointMissing,

  async propose(context: IntentContext, prompt: string): Promise<ZoryCommand[]> {
    /*
     * Selection is a focus hint, not a requirement. Requiring it made
     * whole-page requests impossible to express: there is no single element to
     * click when the instruction is about the composition. With nothing
     * selected the page root stands in, and the tree below carries the rest.
     */
    const page =
      context.project.pages.find((candidate) => candidate.id === context.pageId) ??
      context.project.pages[0];

    const focusId = context.selectedId ?? page?.rootId ?? null;
    if (!focusId) throw new IntentError('Open a page before describing a change.');

    const selected = findNode(context.project, focusId);
    if (!selected) throw new IntentError('That element no longer exists.');

    const parent = selected.parentId ? findNode(context.project, selected.parentId) : undefined;
    const siblings = (parent?.children ?? [])
      .map((id) => findNode(context.project, id))
      .filter((n): n is ElementNode => Boolean(n) && n!.id !== selected.id)
      .slice(0, 12)
      .map((n) => ({ id: n.id, kind: n.kind, name: n.name }));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: await authorisedHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          prompt,
          context: {
            selected: summarise(selected),
            siblings,
            tree: pageTree(context),
            breakpoint: context.breakpoint,
          },
        }),
      });
    } catch {
      throw new ProviderUnavailableError('Could not reach the AI service.');
    } finally {
      clearTimeout(timer);
    }

    // 404 means there is no function deployed here at all; 503 means it is
    // deployed but unconfigured. Neither will change during this session.
    if (response.status === 404 || response.status === 503) {
      endpointMissing = true;
      throw new ProviderUnavailableError('AI editing is not enabled on this server.');
    }

    const data = (await response.json().catch(() => null)) as
      | { commands?: unknown; error?: string }
      | null;

    if (!response.ok) {
      /*
       * The daily allowance is spent.
       *
       * Surfaced as unavailable rather than as an error, so the engine falls
       * through to the on-device parser and the edit still happens. The
       * message is kept for the moment the user asks why the hosted model was
       * not used.
       */
      if (response.status === 429) {
        lastAllowanceMessage = (data as { message?: string } | null)?.message ?? null;
        throw new ProviderUnavailableError(lastAllowanceMessage ?? 'Daily AI allowance reached.');
      }

      // A 4xx is usually a real, explainable problem with the request.
      if (response.status >= 400 && response.status < 500 && data?.error) {
        throw new IntentError(data.error);
      }
      throw new ProviderUnavailableError(data?.error ?? 'The AI service is unavailable.');
    }

    if (!Array.isArray(data?.commands) || data.commands.length === 0) {
      throw new IntentError(
        `The AI could not turn "${prompt}" into a concrete change. Try naming the property you want, like "make the heading 40px".`,
      );
    }

    // No trust is extended here. These are candidate objects; `propose()` in
    // the engine validates each one against the project before it is shown.
    return data.commands as ZoryCommand[];
  },
};
