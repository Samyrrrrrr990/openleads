/**
 * Where third-party credentials live.
 *
 * Deliberately *not* in the project graph, and this is the most important
 * decision in this file. The graph is exported as source, and it is uploaded
 * to Firestore whenever a user backs up, so a key written into it would be
 * published by two separate features that are both working correctly. Keys
 * live in this browser, in their own storage, and nothing syncs them.
 *
 * By default that means credentials do not travel between devices, and that is
 * the intended trade: a secret that follows you around is a secret with more
 * copies. Somebody who would rather not paste their keys again on every
 * machine can turn that off deliberately — see `./sync.ts`, which is opt-in
 * precisely because this file's default is a promise the settings page makes
 * in writing.
 *
 * This is honest storage, not secure storage. Anything the page can read, a
 * script running on the page can read. localStorage is no worse than the
 * alternatives available to a client-side app, and the real protection is that
 * these are the user's own keys, on their own machine, for their own projects.
 */

const STORAGE_KEY = 'zory.integrations.v1';

/** `{ [integrationId]: { [fieldId]: value } }` */
export type IntegrationValues = Record<string, Record<string, string>>;

type Listener = () => void;

const listeners = new Set<Listener>();
let cache: IntegrationValues | null = null;

function read(): IntegrationValues {
  if (cache) return cache;
  if (typeof localStorage === 'undefined') {
    cache = {};
    return cache;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === 'object' ? (parsed as IntegrationValues) : {};
  } catch {
    // Corrupt storage should not brick the editor.
    cache = {};
  }
  return cache;
}

function write(next: IntegrationValues): void {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode, or a full quota. The value stays in memory for this
    // session rather than throwing in the middle of a form.
  }
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getIntegrationValues(): IntegrationValues {
  return read();
}

export function getField(integrationId: string, fieldId: string): string {
  return read()[integrationId]?.[fieldId] ?? '';
}

/** True when every required field of an integration has something in it. */
export function isConfigured(integrationId: string, fieldIds: string[]): boolean {
  const values = read()[integrationId] ?? {};
  return fieldIds.length > 0 && fieldIds.every((id) => (values[id] ?? '').trim() !== '');
}

export function setField(integrationId: string, fieldId: string, value: string): void {
  const current = read();
  const trimmed = value.trim();
  const forIntegration = { ...(current[integrationId] ?? {}) };

  if (trimmed === '') delete forIntegration[fieldId];
  else forIntegration[fieldId] = trimmed;

  const next = { ...current };
  if (Object.keys(forIntegration).length === 0) delete next[integrationId];
  else next[integrationId] = forIntegration;

  write(next);
}

/**
 * Replaces every stored value at once.
 *
 * Only for `./sync.ts`, which has already merged the account's copy with this
 * one. Deliberately not exported as a general setter: everything else goes
 * through `setField`, which trims, prunes empty fields and notifies once.
 */
export function replaceAll(values: IntegrationValues): void {
  write(values);
}

export function clearIntegration(integrationId: string): void {
  const next = { ...read() };
  delete next[integrationId];
  write(next);
}

/**
 * Masks a credential for display.
 *
 * Enough to recognise which key is in the box, never enough to use it or to
 * leak it into a screenshot or a screen share.
 */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}${'•'.repeat(Math.min(16, value.length - 8))}${value.slice(-4)}`;
}
