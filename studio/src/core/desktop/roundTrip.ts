/**
 * Reading code changes back into the project.
 *
 * Every visual builder is a one-way door: you design, you export, and the
 * moment a developer touches the code the visual tool is dead to that project.
 * That is the single reason these tools get abandoned halfway through a build,
 * and it is why "export" has always been an ending rather than a step.
 *
 * This is the door opening both ways. Zory wrote the stylesheet, and it wrote
 * a node id above every rule, so a change made in VS Code — or by Claude Code,
 * or by anyone on the team who would rather type than click — can be read
 * straight back into the graph and appear on the canvas.
 *
 * The scope is deliberately what can be done *correctly* rather than what
 * sounds most impressive:
 *
 *   - it parses Zory's own output, not arbitrary CSS. The format is known, so
 *     there is no heuristic and no guessing which selector maps to which node.
 *   - it only reports declarations that differ from the graph, so reformatting
 *     a file or adding a comment produces nothing.
 *   - it never applies anything. It returns commands, which go through the
 *     same validation and the same approval step as an AI proposal, because
 *     a file on disk is no more trusted than a model's output.
 *
 * Anything it cannot map — a hand-written rule, a new selector, a file Zory
 * did not generate — is left completely alone.
 */

import type { Breakpoint, NodeId, Project, StylePatch, ZoryCommand } from '@zory/core';
import { resolveStyleValue, setStyle, validateStylePatch } from '@zory/core';

export interface RoundTripChange {
  nodeId: NodeId;
  breakpoint: Breakpoint;
  property: string;
  from: string;
  to: string;
}

export interface RoundTripResult {
  changes: RoundTripChange[];
  commands: ZoryCommand[];
  /** Declarations that were understood but rejected, with the reason. */
  skipped: { property: string; reason: string }[];
}

function toCamel(property: string): string {
  return property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/**
 * Splits a stylesheet into rules, tracking which media query each sits in.
 *
 * A hand-rolled scan rather than a CSS parser: the input is Zory's own output,
 * the shapes are known, and a dependency that understands every corner of CSS
 * would be carrying weight this never uses.
 */
function scanRules(css: string): { nodeId: string; breakpoint: Breakpoint; body: string }[] {
  const out: { nodeId: string; breakpoint: Breakpoint; body: string }[] = [];

  // Which breakpoint a position belongs to, from the media queries around it.
  const mediaRanges: { start: number; end: number; breakpoint: Breakpoint }[] = [];
  const mediaPattern = /@media\s*\(max-width:\s*(\d+)px\)\s*\{/g;
  let media: RegExpExecArray | null;

  while ((media = mediaPattern.exec(css)) !== null) {
    // Walk braces to find where this query closes.
    let depth = 1;
    let index = media.index + media[0].length;
    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') depth -= 1;
      index += 1;
    }
    const width = Number.parseInt(media[1] ?? '0', 10);
    // The generator emits tablet above mobile; width tells them apart without
    // needing the project's own breakpoint settings here.
    mediaRanges.push({
      start: media.index,
      end: index,
      breakpoint: width <= 700 ? 'mobile' : 'tablet',
    });
  }

  const rulePattern = /\/\*\s*zory:([A-Za-z0-9_-]+)\s*\*\/\s*\.[A-Za-z0-9_-]+\s*\{([^}]*)\}/g;
  let rule: RegExpExecArray | null;

  while ((rule = rulePattern.exec(css)) !== null) {
    const at = rule.index;
    const range = mediaRanges.find((candidate) => at > candidate.start && at < candidate.end);
    out.push({
      nodeId: rule[1]!,
      breakpoint: range?.breakpoint ?? 'base',
      body: rule[2] ?? '',
    });
  }

  return out;
}

function parseDeclarations(body: string): { property: string; value: string }[] {
  const out: { property: string; value: string }[] = [];
  for (const line of body.split(';')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const property = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (property === '' || value === '') continue;
    if (property.startsWith('/*')) continue;
    out.push({ property, value });
  }
  return out;
}

/**
 * Compares an edited stylesheet against the project.
 *
 * Returns the commands that would bring the graph in line with the file. The
 * caller decides whether to show them, and the user decides whether to apply.
 */
export function readStylesheet(project: Project, css: string): RoundTripResult {
  const changes: RoundTripChange[] = [];
  const skipped: { property: string; reason: string }[] = [];
  const patches = new Map<string, { nodeId: NodeId; breakpoint: Breakpoint; patch: StylePatch }>();

  for (const rule of scanRules(css)) {
    const node = project.nodes[rule.nodeId];
    // A rule for a node that no longer exists is not an error — the element was
    // deleted in Zory while the file still had it.
    if (!node) continue;

    for (const declaration of parseDeclarations(rule.body)) {
      const property = toCamel(declaration.property);

      // The allowlist is the same one every other command goes through. A file
      // on disk gets no more trust than a model's reply.
      const check = validateStylePatch({ [property]: declaration.value });
      if (!check.ok) {
        skipped.push({ property: declaration.property, reason: check.reason });
        continue;
      }

      const current = resolveStyleValue(node.styles, rule.breakpoint, property as never);
      const existing = current.value === undefined ? '' : String(current.value);
      if (existing === declaration.value) continue;

      changes.push({
        nodeId: rule.nodeId,
        breakpoint: rule.breakpoint,
        property,
        from: existing,
        to: declaration.value,
      });

      const key = `${rule.nodeId}:${rule.breakpoint}`;
      const entry =
        patches.get(key) ?? { nodeId: rule.nodeId, breakpoint: rule.breakpoint, patch: {} };
      (entry.patch as Record<string, unknown>)[property] = declaration.value;
      patches.set(key, entry);
    }
  }

  const commands = [...patches.values()].map((entry) =>
    setStyle(entry.nodeId, entry.breakpoint, entry.patch),
  );

  return { changes, commands, skipped };
}

/**
 * Reads text edits out of a generated component.
 *
 * Only elements whose entire content is a single run of text are considered.
 * Anything with a nested element, an expression or an entity is skipped —
 * reconstructing the author's intent from partially-parsed JSX is exactly the
 * kind of cleverness that silently corrupts someone's copy, and skipping is
 * free.
 */
export function readComponent(project: Project, source: string): RoundTripResult {
  const changes: RoundTripChange[] = [];
  const commands: ZoryCommand[] = [];

  // Marker, then an opening tag, then text with no markup in it, then a close.
  const pattern =
    /\{\/\*\s*zory:([A-Za-z0-9_-]+)\s*\*\/\}\s*<([a-zA-Z][\w.]*)\b[^>]*>([^<>{}]*)<\/\2>/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const nodeId = match[1]!;
    const node = project.nodes[nodeId];
    if (!node) continue;

    const text = decodeJsxText(match[3] ?? '');
    const current = node.text ?? '';
    if (text === current) continue;
    // An emptied element is far more likely to be a parse we got wrong than an
    // intentional edit, and clearing someone's copy is not recoverable from
    // the file. Deleting the element is the way to remove it.
    if (text.trim() === '') continue;

    changes.push({ nodeId, breakpoint: 'base', property: 'text', from: current, to: text });
    commands.push({ type: 'SET_TEXT', nodeId, text });
  }

  return { changes, commands, skipped: [] };
}

/** Undoes the escaping the generator applies when it writes JSX text. */
function decodeJsxText(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Runs `readStylesheet` across every generated stylesheet in a folder. */
export function readStylesheets(
  project: Project,
  files: { path: string; content: string }[],
): RoundTripResult {
  const all: RoundTripResult = { changes: [], commands: [], skipped: [] };

  for (const file of files) {
    const result = file.path.endsWith('.css')
      ? readStylesheet(project, file.content)
      : file.path.endsWith('.tsx')
        ? readComponent(project, file.content)
        : null;
    if (!result) continue;

    all.changes.push(...result.changes);
    all.commands.push(...result.commands);
    all.skipped.push(...result.skipped);
  }

  return all;
}

/** A one-line summary for the UI. */
export function describeRoundTrip(result: RoundTripResult): string {
  const count = result.changes.length;
  if (count === 0) return 'No changes Zory can read';
  const nodes = new Set(result.changes.map((change) => change.nodeId)).size;
  return `${count} change${count === 1 ? '' : 's'} across ${nodes} element${nodes === 1 ? '' : 's'}`;
}
