/**
 * AI editing using the user's own API key.
 *
 * This is the answer to "make the AI work for free". Zory's hosted proxy runs
 * on a free OpenRouter account capped at roughly fifty requests a day shared
 * by everyone, which is fine for a demo and useless for real work. A user's
 * own Google Gemini key allows about fifteen hundred requests a day at no
 * cost, and Groq is comparably generous — so the cheapest reliable option is
 * not a better free tier, it is the user's free tier.
 *
 * The key stays in the browser and is sent only to the provider it belongs to.
 * It is never posted to Zory's own server, never written into the project, and
 * never included in an export.
 *
 * Every provider here is called directly from the page, which is only possible
 * because each one sends permissive CORS headers. Anthropic additionally
 * requires an explicit opt-in header before it will answer a browser at all.
 */

import { getField } from '../integrations/store';
import { AI_INTEGRATIONS } from '../integrations/registry';
import type { ZoryCommand } from '@zory/core';
import { IntentError, type IntentContext, type IntentProvider } from './types';
import { ProviderUnavailableError } from './openRouterProvider';
import { buildIntentMessages, extractCommands } from './promptShared';

const TIMEOUT_MS = 30_000;

interface Adapter {
  /** Registry id, so the key is read from the right place. */
  id: string;
  keyField: string;
  label: string;
  call: (key: string, system: string, user: string, signal: AbortSignal) => Promise<string>;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

/** OpenAI-shaped chat completions. Groq, OpenRouter and OpenAI all match. */
function openAiShaped(
  endpoint: string,
  model: string,
  extraHeaders: Record<string, string> = {},
) {
  return async (key: string, system: string, user: string, signal: AbortSignal) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 1600,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!response.ok) throw await describeFailure(response);
    const data = await readJson(response);
    const choices = data['choices'] as { message?: { content?: string } }[] | undefined;
    return choices?.[0]?.message?.content ?? '';
  };
}

async function describeFailure(response: Response): Promise<Error> {
  const data = await readJson(response);
  const error = data['error'];
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : `The provider returned ${response.status}.`;

  // 401/403 mean the key is wrong, which the user can fix and needs to hear.
  if (response.status === 401 || response.status === 403) {
    throw new IntentError(`That API key was rejected: ${message}`);
  }
  if (response.status === 429) {
    throw new IntentError('Your API key has hit its rate limit. Try again shortly.');
  }
  return new ProviderUnavailableError(message);
}

const ADAPTERS: Adapter[] = [
  {
    id: 'gemini',
    keyField: 'GEMINI_API_KEY',
    label: 'Gemini',
    async call(key, system, user, signal) {
      // Gemini takes the system prompt separately and has its own body shape.
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1600 },
          }),
        },
      );

      if (!response.ok) throw await describeFailure(response);
      const data = await readJson(response);
      const candidates = data['candidates'] as
        | { content?: { parts?: { text?: string }[] } }[]
        | undefined;
      return candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    },
  },
  {
    id: 'groq',
    keyField: 'GROQ_API_KEY',
    label: 'Groq',
    call: openAiShaped('https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile'),
  },
  {
    id: 'anthropic',
    keyField: 'ANTHROPIC_API_KEY',
    label: 'Claude',
    async call(key, system, user, signal) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          // Without this Anthropic refuses browser origins outright.
          'anthropic-dangerous-direct-browser-access': 'true',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1600,
          temperature: 0.1,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });

      if (!response.ok) throw await describeFailure(response);
      const data = await readJson(response);
      const content = data['content'] as { text?: string }[] | undefined;
      return content?.map((part) => part.text ?? '').join('') ?? '';
    },
  },
  {
    id: 'openai',
    keyField: 'OPENAI_API_KEY',
    label: 'OpenAI',
    call: openAiShaped('https://api.openai.com/v1/chat/completions', 'gpt-4o-mini'),
  },
  {
    id: 'openrouter',
    keyField: 'OPENROUTER_API_KEY',
    label: 'OpenRouter',
    call: openAiShaped(
      'https://openrouter.ai/api/v1/chat/completions',
      'google/gemma-4-26b-a4b-it:free',
      { 'http-referer': 'https://github.com/Samyrrrrrr990/openleads', 'x-title': 'OpenLeads Studio' },
    ),
  },
];

/** The first configured adapter, in registry order. */
function activeAdapter(): Adapter | null {
  for (const integration of AI_INTEGRATIONS) {
    const adapter = ADAPTERS.find((candidate) => candidate.id === integration.id);
    if (!adapter) continue;
    if (getField(adapter.id, adapter.keyField).trim() !== '') return adapter;
  }
  return null;
}

/** Name of the service currently supplying AI, for the UI. */
export function activeKeyProviderLabel(): string | null {
  return activeAdapter()?.label ?? null;
}

export const byokProvider: IntentProvider = {
  id: 'byok',
  name: 'Your API key',

  isAvailable: () => activeAdapter() !== null,

  async propose(context: IntentContext, prompt: string): Promise<ZoryCommand[]> {
    const adapter = activeAdapter();
    if (!adapter) throw new ProviderUnavailableError('No API key is configured.');

    const key = getField(adapter.id, adapter.keyField);
    const { system, user } = buildIntentMessages(context, prompt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let raw: string;
    try {
      raw = await adapter.call(key, system, user, controller.signal);
    } catch (cause) {
      // A real, explainable problem (bad key, rate limit) must reach the user
      // rather than being swallowed as "provider unavailable" and retried.
      if (cause instanceof IntentError) throw cause;
      throw new ProviderUnavailableError(
        cause instanceof Error ? cause.message : 'Could not reach the AI provider.',
      );
    } finally {
      clearTimeout(timer);
    }

    const commands = extractCommands(raw);
    if (!commands || commands.length === 0) {
      throw new IntentError('The model did not return a change it could make.');
    }
    return commands as ZoryCommand[];
  },
};
