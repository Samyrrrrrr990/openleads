import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  message: string;
  tone: "default" | "error";
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function toast(message: string, tone: Toast["tone"] = "default") {
  const t = { id: nextId++, message, tone };
  toasts = [...toasts.slice(-2), t];
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, tone === "error" ? 6000 : 3200);
}

export function fail(e: unknown) {
  toast(e instanceof Error ? e.message : String(e), "error");
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
  );
}
