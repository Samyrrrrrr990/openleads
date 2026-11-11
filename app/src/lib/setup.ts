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
  choices: string[];
}

export interface ModelState {
  current: { provider: string; model: string; label: string } | null;
  problem: string;
  detected: { provider: string; kind: string; label: string }[];
}

export interface Setup {
  loaded: boolean;
  error: string;
  ai: ModelState;
  settings: Record<string, Setting>;
  mailbox: boolean;
  inbox: boolean;
}

let state: Setup = { loaded: false, error: "", ai: { current: null, problem: "", detected: [] }, settings: {}, mailbox: false, inbox: false };
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
        api.get<{ settings: Setting[]; identity: { mailbox_configured: boolean } }>("/api/settings"),
      ]);
      const settings = Object.fromEntries(s.settings.map((x) => [x.key, x]));
      state = {
        loaded: true,
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
