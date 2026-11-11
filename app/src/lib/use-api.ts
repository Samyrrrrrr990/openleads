import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";

export interface Loaded<T> {
  data: T | null;
  error: string;
  loading: boolean;
  /** Fetch again; keeps showing the old data meanwhile. */
  reload: () => Promise<void>;
  /** Replace the data locally (after an action that already returned the new state). */
  set: (next: T | ((prev: T | null) => T | null)) => void;
}

/** GET (or POST when `body` is given) once per `key`, with reload. */
export function useApi<T>(path: string | null, body?: unknown): Loaded<T> {
  const key = path === null ? null : path + "\u0000" + (body === undefined ? "" : JSON.stringify(body));
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({
    data: null,
    error: "",
    loading: path !== null,
  });
  const latest = useRef(0);
  const bodyRef = useRef(body);
  bodyRef.current = body;

  const load = useCallback(async () => {
    if (path === null) return;
    const id = ++latest.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = bodyRef.current === undefined ? await api.get<T>(path) : await api.post<T>(path, bodyRef.current);
      if (id === latest.current) setState({ data, error: "", loading: false });
    } catch (e) {
      if (id === latest.current) setState((s) => ({ data: s.data, error: (e as Error).message, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = useCallback((next: T | ((prev: T | null) => T | null)) => {
    setState((s) => ({
      ...s,
      data: typeof next === "function" ? (next as (prev: T | null) => T | null)(s.data) : next,
    }));
  }, []);

  return { ...state, reload: load, set };
}
