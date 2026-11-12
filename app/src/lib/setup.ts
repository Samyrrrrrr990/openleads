import { useSyncExternalStore } from "react";

import { api } from "./api";

// What OpenLeads is connected to: the model, the mailbox, the places it exports to.
// One copy for the whole app, so Today, Ask and Connections always agree.

export interface Setting {
  key: string;
  group: string;
  secret: boolean;
  value: string | number | boolean;
  is_set: boolean;
  /** "env" when it comes from this computer's environment, which the app can't change. */
  source?: string;
  choices: string[];
}

export interface ModelState {
  current: { provider: string; model: string; label: string } | null;
  problem: string;
  detected: { provider: string; kind: string; label: string }[];
}

export interface Setup {
  loaded: boolean;
  /** The invented demo workspace: its people and emails are made up. */
  demo: boolean;
  version: string;
  error: string;
  ai: ModelState;
  settings: Record<string, Setting>;
  mailbox: boolean;
  inbox: boolean;
}

let state: Setup = { loaded: false, demo: false, version: "", error: "", ai: { current: null, problem: "", detected: [] }, settings: {}, mailbox: false, inbox: false };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function isSet(settings: Record<string, Setting>, key: string): boolean {
  return !!settings[key]?.is_set;
}

export function refreshSetup(): Promise<void> {
  loading ??= (async () => {
    try {
      const [ai, s] = await Promise.all([
        api.get<ModelState>("/api/ai"),
        api.get<{ settings: Setting[]; identity: { mailbox_configured: boolean }; demo?: boolean; version: string }>("/api/state"),
      ]);
      const settings = Object.fromEntries(s.settings.map((x) => [x.key, x]));
      state = {
        loaded: true,
        demo: !!s.demo,
        version: s.version,
        error: "",
        ai,
        settings,
        mailbox: s.identity.mailbox_configured,
        inbox: isSet(settings, "imap_host") && (isSet(settings, "imap_user") || isSet(settings, "smtp_user")),
      };
    } catch (e) {
      state = { ...state, loaded: true, error: (e as Error).message };
    }
    loading = null;
    listeners.forEach((l) => l());
  })();
  return loading;
}

export function useSetup(): Setup {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (!state.loaded && !loading) void refreshSetup();
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

/** Save settings by key. An empty string clears one. Returns per-key problems, if any. */
export async function saveSettings(values: Record<string, string | number | boolean>): Promise<Record<string, string>> {
  const r = await api.post<{ errors: Record<string, string> }>("/api/settings", { values });
  await refreshSetup();
  return r.errors ?? {};
}

/** The brand mark that stands for a model provider. */
export const PROVIDER_BRAND: Record<string, string> = {
  claude: "claude",
  anthropic: "anthropic",
  codex: "openai",
  openai: "openai",
  gemini: "gemini",
  openrouter: "openrouter",
  ollama: "ollama",
  custom: "custom",
};

/** Start using a model (or "off" for the built-in rules). Returns a sentence when it didn't work. */
export async function switchModel(provider: string): Promise<string | void> {
  const r = await api.post<{ ok: boolean; detail?: string }>("/api/ai/use", { provider });
  await refreshSetup();
  if (!r.ok) return r.detail || "It didn't answer a test message.";
}

/** A short name for a model provider, as people say it. */
export const PROVIDER_NAME: Record<string, string> = {
  claude: "Claude",
  codex: "ChatGPT",
  anthropic: "Anthropic API",
  openai: "OpenAI API",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  custom: "Your endpoint",
};
