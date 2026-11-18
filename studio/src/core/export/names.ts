/**
 * Naming for generated code.
 *
 * Generated identifiers come from the names the user gave their layers, so the
 * exported source reads like something a person wrote. Uniqueness is enforced
 * per scope, and every name is checked against JS reserved words.
 */

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import',
  'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'await', 'async',
  'implements', 'interface', 'package', 'private', 'protected', 'public', 'arguments', 'eval',
]);

/** Splits a human name into lowercase word parts. */
function words(input: string): string[] {
  return input
    .normalize('NFKD')
    // Drop combining marks so "Café" yields "cafe", not "caf".
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

export function toCamelCase(input: string, fallback = 'item'): string {
  const parts = words(input);
  if (parts.length === 0) return fallback;
  const [first, ...rest] = parts;
  let name = first! + rest.map((word) => word[0]!.toUpperCase() + word.slice(1)).join('');
  if (/^\d/.test(name)) name = `_${name}`;
  return RESERVED.has(name) ? `${name}Value` : name;
}

export function toPascalCase(input: string, fallback = 'Section'): string {
  const parts = words(input);
  if (parts.length === 0) return fallback;
  let name = parts.map((word) => word[0]!.toUpperCase() + word.slice(1)).join('');
  if (/^\d/.test(name)) name = `S${name}`;
  return RESERVED.has(name.toLowerCase()) ? `${name}Section` : name;
}

export function toKebabCase(input: string, fallback = 'file'): string {
  const parts = words(input);
  return parts.length === 0 ? fallback : parts.join('-');
}

/** Hands out unique names within a scope, suffixing duplicates. */
export class NameRegistry {
  private used = new Set<string>();

  constructor(reserved: string[] = []) {
    for (const name of reserved) this.used.add(name);
  }

  take(preferred: string): string {
    if (!this.used.has(preferred)) {
      this.used.add(preferred);
      return preferred;
    }
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${preferred}${n}`;
      if (!this.used.has(candidate)) {
        this.used.add(candidate);
        return candidate;
      }
    }
    const fallback = `${preferred}_${Math.random().toString(36).slice(2, 7)}`;
    this.used.add(fallback);
    return fallback;
  }

  has(name: string): boolean {
    return this.used.has(name);
  }
}
