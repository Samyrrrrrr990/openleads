// The OpenLeads JSON API: same origin, JSON in and out, NDJSON for long jobs.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parse<T>(r: Response): Promise<T> {
  let data: unknown = null;
  try {
    data = await r.json();
  } catch {
    /* an empty or non-JSON body is handled below */
  }
  if (!r.ok) {
    const message =
      (data as { error?: string } | null)?.error || `The server answered ${r.status}.`;
    throw new ApiError(message, r.status);
  }
  return data as T;
}

export function query(params?: Record<string, string | number | boolean | undefined | null>) {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

export const api = {
  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined | null>) {
    return parse<T>(await fetch(path + query(params), { headers: { Accept: "application/json" } }));
  },
  async post<T>(path: string, body: unknown = {}) {
    return parse<T>(
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      }),
    );
  },
  /** POST and read newline-delimited JSON events as they arrive. */
  async stream<E>(path: string, body: unknown, onEvent: (event: E) => void, signal?: AbortSignal) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok || !r.body) throw new ApiError(`The server answered ${r.status}.`, r.status);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = splitLines(buffer);
      buffer = lines.rest;
      for (const line of lines.complete) onEvent(JSON.parse(line) as E);
    }
    const last = buffer.trim();
    if (last) onEvent(JSON.parse(last) as E);
  },
};

/** Split a buffer into complete lines and the unfinished tail. */
export function splitLines(buffer: string): { complete: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { complete: parts.map((p) => p.trim()).filter(Boolean), rest };
}
