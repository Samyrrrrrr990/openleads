import { useSyncExternalStore } from "react";

import { api } from "./api";
import type { Briefing, Counts } from "./types";

// What's waiting on you, shared by the sidebar badge and every screen that changes it.
let counts: Counts = { replies: 0, drafts: 0, tasks: 0, new_leads: 0 };
const listeners = new Set<() => void>();

export function setCounts(next: Counts | undefined | null) {
  if (!next) return;
  counts = next;
  listeners.forEach((l) => l());
}

export async function refreshCounts() {
  try {
    setCounts((await api.get<Briefing>("/api/today")).counts);
  } catch {
    /* the badge just stays as it was */
  }
}

export function useCounts(): Counts {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => counts,
  );
}
