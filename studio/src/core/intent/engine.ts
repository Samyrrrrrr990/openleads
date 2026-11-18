/**
 * The Intent pipeline.
 *
 * prompt + context → provider → validation → proposal → (user) → commands
 *
 * Two providers, tried in order:
 *
 * 1. `openRouterProvider` — sends the selection to Zory's own endpoint, which
 *    holds the API key server-side. Handles open-ended phrasing.
 * 2. `localIntentProvider` — a deterministic parser that runs on the device.
 *    No key, no network, no account.
 *
 * The order matters less than the guarantee: the local provider is last and
 * always available, so Intent keeps working when the AI is unconfigured,
 * rate-limited, offline or simply wrong. That is what lets us say AI is
 * optional and mean it.
 *
 * Validation sits between every provider and the user. A provider is untrusted
 * by construction — a proposal is only shown once every command in it has been
 * checked against the real project.
 */

import type { Project, ZoryCommand } from '@zory/core';
import { applyCommand, describeCommand, validateCommand } from '@zory/core';
import {
  IntentError,
  type IntentContext,
  type IntentProposal,
  type IntentProvider,
  type SkippedChange,
} from './types';
import { localIntentProvider } from './localProvider';
import { ProviderUnavailableError, openRouterProvider } from './openRouterProvider';
import { byokProvider } from './byokProvider';
import { expandProposals } from './expand';

/**
 * Priority order: on-device first, hosted model second.
 *
 * This is deliberately the opposite of what it looks like it should be. The
 * built-in parser is not a degraded fallback — for the requests it recognises
 * it is *better* than the model: instant, deterministic, offline, and it
 * cannot invent a node id or drift between two identical prompts.
 *
 * Putting it first also fixes the thing that made AI editing unreliable in
 * practice. Free inference is rate limited to a few dozen requests a day, so
 * spending one on "make this calmer" — which is a rule, not a judgement call —
 * meant running out of quota on exactly the requests that genuinely need a
 * model. Now the model is only reached by prompts nothing here understands.
 *
 * The parser throws for anything it does not recognise, and the engine treats
 * that as "try the next provider", so falling through is the normal path
 * rather than an error case.
 *
 * Second is the user's own key, when they have added one. It comes before the
 * shared hosted proxy because it is theirs: a personal Gemini key allows
 * roughly thirty times the daily requests of the free account behind the
 * proxy, so anyone who has supplied one should never be queued behind a limit
 * they are not causing.
 */
const PROVIDERS: IntentProvider[] = [localIntentProvider, byokProvider, openRouterProvider];

export function availableProviders(): IntentProvider[] {
  return PROVIDERS.filter((provider) => provider.isAvailable());
}

export function activeProvider(): IntentProvider {
  return availableProviders()[0] ?? localIntentProvider;
}

/*
 * The ceiling on a single proposal.
 *
 * This is not a safety limit — every command is validated against the real
 * project and the user still approves the whole batch before anything moves.
 * It is a sanity limit, guarding against a provider that has misunderstood the
 * request so badly it wants to rewrite the document.
 *
 * It was 24, which was generous when a proposal meant one or two properties on
 * one element and far too tight the moment section-level intents arrived: a
 * "make this calmer" across a real page is legitimately 30-40 commands, and
 * refusing it told the user their reasonable request was reckless.
 */
const MAX_COMMANDS_PER_PROPOSAL = 80;

/**
 * Validates a batch and builds the previewable proposal.
 *
 * ## Partial acceptance, and why it is not a lowering of standards
 *
 * This used to throw on the first command that failed validation, which meant
 * one bad node id in a reply of twenty threw away the other nineteen. The user
 * asked for something ambitious, the model got most of it right, and Zory
 * answered "could not turn that into a change" — so the way to get anything
 * out of Intent was to ask for less than you wanted.
 *
 * Every command is still validated against the real project, and nothing
 * invalid is ever applied. What changed is what happens to the rest: the ones
 * that pass are kept, the ones that fail are listed with the reason, and the
 * user approves the whole thing with both halves in front of them. That is
 * strictly more information than an error message, and it is the difference
 * between a tool you can ask for a redesign and one you can ask for a font
 * size.
 *
 * Validation runs against a running probe, so each command is checked against
 * the project *as the preceding ones left it* — a node inserted by command
 * three is a legal parent for command four, and a node deleted by command two
 * makes command five fail honestly rather than silently doing nothing.
 */
function buildProposal(
  context: IntentContext,
  prompt: string,
  commands: ZoryCommand[],
  providerId: string,
): IntentProposal {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new IntentError('That produced no changes.');
  }

  let probe: Project = context.project;
  const accepted: ZoryCommand[] = [];
  const descriptions: string[] = [];
  const skipped: SkippedChange[] = [];

  for (const command of commands) {
    /*
     * The ceiling, applied as a truncation rather than a refusal.
     *
     * It was a hard reject of the whole batch, which turned a model that got
     * carried away into a user with nothing. Taking the first eighty and
     * saying so is the same protection with a better outcome.
     */
    if (accepted.length >= MAX_COMMANDS_PER_PROPOSAL) {
      skipped.push({
        what: `${commands.length - accepted.length} further changes`,
        reason: `Zory applies at most ${MAX_COMMANDS_PER_PROPOSAL} changes at once.`,
      });
      break;
    }

    const result = validateCommand(probe, command);
    if (!result.ok) {
      skipped.push({ what: describeIntent(command), reason: result.reason });
      continue;
    }
    accepted.push(command);
    descriptions.push(describeCommand(probe, command));
    probe = applyCommand(probe, command);
  }

  if (accepted.length === 0) {
    throw new IntentError(
      skipped[0]
        ? `Zory refused that change: ${skipped[0].reason}`
        : 'That produced no changes.',
    );
  }

  return {
    prompt,
    commands: accepted,
    descriptions,
    skipped,
    summary: descriptions.length === 1 ? descriptions[0]! : `${descriptions.length} changes`,
    providerId,
  };
}

/**
 * Names a command that never validated, for the list of what was left out.
 *
 * `describeCommand` needs a project the command is valid against, which by
 * definition this one is not — so this reads the shape rather than the effect.
 */
function describeIntent(command: ZoryCommand): string {
  const type = typeof command === 'object' && command !== null ? String(command.type) : 'A change';
  const label = type.toLowerCase().replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Asks each provider in turn until one returns commands that validate.
 *
 * A provider being *unavailable* (no key, offline, rate limited) falls through
 * silently to the next. A provider producing an *invalid* proposal also falls
 * through — a malformed AI response should not deny you the built-in parser.
 * Only when everything has been tried does the error surface.
 */
export async function propose(
  context: IntentContext,
  prompt: string,
  provider?: IntentProvider,
): Promise<IntentProposal> {
  const chain = provider ? [provider] : availableProviders();
  let lastUserError: IntentError | null = null;

  for (const candidate of chain) {
    try {
      const raw = await candidate.propose(context, prompt);
      // Requests become commands here, so the ids in an insertion or a
      // duplication are always generated locally rather than by a model.
      const commands = expandProposals(context.project, raw);
      return buildProposal(context, prompt, commands, candidate.id);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) continue;

      if (error instanceof IntentError) {
        // Keep the most human error to show if nothing else works, but keep
        // trying — the local parser may well understand this phrasing.
        lastUserError = error;
        continue;
      }

      // Anything unexpected: try the next provider rather than failing hard.
      continue;
    }
  }

  throw (
    lastUserError ??
    new IntentError('Zory could not turn that into a change. Try naming the property you want.')
  );
}

export { IntentError };
export type { IntentContext, IntentProposal, IntentProvider };
