import { useSyncExternalStore } from "react";

// Hash routes ("#/people/maya@x.example") keep the Python server free of route
// knowledge: every page is index.html.

export interface Route {
  /** First segment: "today", "people", ... */
  section: string;
  /** The rest, already URI-decoded. */
  rest: string[];
  /** Query after "?" in the hash. */
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path, qs = ""] = raw.split("?");
  const parts = path
    .split("/")
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  return { section: parts[0] || "today", rest: parts.slice(1), params: new URLSearchParams(qs) };
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

let cachedHash = "";
let cachedRoute: Route = parseHash("");

function snapshot(): Route {
  const h = window.location.hash;
  if (h !== cachedHash) {
    cachedHash = h;
    cachedRoute = parseHash(h);
  }
  return cachedRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot);
}

export function href(...parts: string[]): string {
  return "#/" + parts.map(encodeURIComponent).join("/");
}

export function navigate(...parts: string[]) {
  window.location.hash = href(...parts);
}

/** A classic-dashboard screen shown inside the app, under one of the six sections. */
export function classic(section: string, path: string): string {
  return `#/${section}/classic/${encodeURIComponent(path.replace(/^\/+/, ""))}`;
}
