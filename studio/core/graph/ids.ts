/**
 * Stable id generation.
 *
 * Ids are short, URL-safe and readable enough to appear in exported code
 * comments and the command ledger without looking like noise.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSuffix(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export function createId(prefix: string): string {
  return `${prefix}_${randomSuffix(8)}`;
}

export const newNodeId = (): string => createId('n');
export const newPageId = (): string => createId('p');
export const newProjectId = (): string => createId('proj');
export const newAssetId = (): string => createId('a');
export const newComponentId = (): string => createId('c');
