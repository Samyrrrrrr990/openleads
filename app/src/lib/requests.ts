import { useSyncExternalStore } from "react";

// The last few things you asked for, kept in this browser so the sidebar can offer them again.
const KEY = "openleads.requests";
const MAX = 8;
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    cache = Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(0, MAX) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function remember(text: string) {
  const t = text.trim();
  if (!t) return;
  cache = [t, ...read().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

export function useRequests(): string[] {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, read);
}

// The ask box listens for this so a click in the sidebar or the palette can fill it.
const ASK_EVENT = "openleads:ask";

export function askFor(text: string) {
  window.dispatchEvent(new CustomEvent<string>(ASK_EVENT, { detail: text }));
}

export function onAsk(handler: (text: string) => void): () => void {
  const fn = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(ASK_EVENT, fn);
  return () => window.removeEventListener(ASK_EVENT, fn);
}
