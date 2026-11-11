import { useSyncExternalStore } from "react";

// Shared with the classic dashboard, so a screen embedded from it follows along.
const KEY = "ol-theme";
type Theme = "light" | "dark";
const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice lasts for this tab */
  }
  listeners.forEach((l) => l());
}

export function toggleTheme() {
  setTheme(current() === "dark" ? "light" : "dark");
}

export function useTheme(): Theme {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, current);
}
