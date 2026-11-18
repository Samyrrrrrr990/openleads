/**
 * What an interface *is*, read from code Zory did not write.
 *
 * Everything Zory does well — the audit, the structural diff, the context it
 * hands an agent — needs a model of an interface. Until now the only model was
 * `Project`, which Zory authors itself, so every one of those capabilities was
 * gated behind a file Zory had written. On a real repository the bridge answers
 * `project: null` and there is nothing to audit, diff or explain.
 *
 * This is the other model: built by reading somebody's source, never by
 * writing it.
 *
 * ## Why this is not a `Project`
 *
 * The obvious move is to parse React into the existing graph and reuse
 * everything. It is the wrong move, and the reason is the vocabulary. A
 * `Project` node is one of seven primitives — container, heading, text, button,
 * link, image, divider — with no concept of a component or an instance.
 * Flattening a real codebase into that shape turns `<PricingCard plan="pro"/>`
 * into an anonymous container, which destroys precisely the structure the
 * people we are building for care about, and it would imply the result is
 * editable when it is not.
 *
 * So this model keeps what a `Project` cannot express: component identity,
 * where each thing lives in the file system, which props were passed, and —
 * most importantly — **what it failed to understand**.
 *
 * ## Coverage is a first-class value, not a log line
 *
 * Every visual tool that tried to own arbitrary source is remembered for
 * guessing. The difference between this and that graveyard is not a better
 * parser; it is being explicit about the edges. A map that says "I understood
 * 78% of this page and skipped four dynamic lists" is useful and trustworthy.
 * A map that silently omits the same four lists is a map that will one day tell
 * a reviewer nothing changed when something did.
 *
 * That is why `Coverage` is on the map itself and why every skipped subtree
 * carries a reason. Nothing here is allowed to fail silently.
 *
 * ## Read-only, permanently
 *
 * Nothing in this module writes, and nothing built on it may write to source
 * Zory did not author. Editing stays with `Project`, where the format is known.
 */

/** Bumped when the shape changes in a way a consumer must notice. */
export const MAP_VERSION = 1;

/**
 * Where something lives, so a reader can go and look at it.
 *
 * Paths are repository-relative and POSIX-separated regardless of platform, so
 * a map produced on Windows and read on a Linux runner agrees with itself.
 * Lines are 1-indexed, matching every editor and every stack trace.
 */
export interface SourceRef {
  file: string;
  line: number;
  column: number;
}

/**
 * A component's identity, stable across runs and across commits.
 *
 * Derived from the file and the export name rather than from position, so
 * moving a component down its file does not read as a deletion and an
 * addition. This is the same property that makes the `Project` diff able to
 * say "this moved" — without stable identity a diff can only say "these lines
 * differ", which is the thing `git` already does.
 */
export type ComponentId = string;

/** Builds the id for a component. Pure, so two runs agree. */
export function componentId(file: string, name: string): ComponentId {
  return `${file}#${name}`;
}

/**
 * Why a piece of an interface could not be read.
 *
 * Named rather than counted as one lump, because the fixes are different and
 * because a reader deserves to know whether the gap is a `.map()` over data or
 * a syntax the parser has never seen.
 */
export type SkipReason =
  /** `{items.map(...)}` — the shape is known, the contents are data. */
  | 'list'
  /** `{flag && <X/>}` or a ternary — more than one possible interface. */
  | 'conditional'
  /** `{expr}` in a child position that is not a list or a condition. */
  | 'expression'
  /** `{...props}` — the props cannot be enumerated. */
  | 'spread'
  /**
   * A component from another package, or one that could not be resolved.
   *
   * Annotates an element; it is deliberately **not** a coverage skip. The
   * element itself was read — its tag, its props and its position are all
   * known — and only its internals are out of reach. Counting it against
   * coverage would punish every repository that uses a component library,
   * which is all of them.
   */
  | 'external'
  /** Nesting past the depth limit; a guard against pathological files. */
  | 'too-deep'
  /** The file did not parse, or used syntax this reader does not model. */
  | 'unsupported';

/** Counters for the reasons that count against coverage. */
export type SkipCounts = Record<Exclude<SkipReason, 'external'>, number>;

/**
 * The reasons that count against coverage.
 *
 * `external` is missing on purpose — see the note on it above. The invariant
 * this list carries is that `elementsSkipped` equals the sum of these counts,
 * which is what makes a coverage line something a person can check by hand
 * rather than a number they have to believe.
 */
export const SKIP_REASONS: readonly (keyof SkipCounts)[] = [
  'list',
  'conditional',
  'expression',
  'spread',
  'too-deep',
  'unsupported',
] as const;

/**
 * A prop as it was written.
 *
 * `value` is present only when it is statically knowable — a string, a number,
 * a boolean. Anything computed is marked `dynamic` and carries no value, which
 * is honest: `className={cn(base, active && 'on')}` has no single answer, and
 * inventing one is how a tool starts lying about what is on screen.
 */
export interface PropRef {
  name: string;
  value?: string;
  dynamic: boolean;
}

/**
 * One element in what a component renders.
 *
 * `name` is exactly what the source says — `div`, `PricingCard`, `motion.div`.
 * `componentId` is set only when that name resolves to a component in this same
 * map, which is what makes the graph navigable rather than a list of tags.
 */
export interface ElementRef {
  name: string;
  componentId?: ComponentId;
  source: SourceRef;
  props: PropRef[];
  children: ElementRef[];
  /** Static text content, when the element's children are only literal text. */
  text?: string;
  /** Present when this subtree is incomplete, with the reason it is. */
  skipped?: SkipReason;
}

/** A component: where it is, what it takes, and what it renders. */
export interface ComponentNode {
  id: ComponentId;
  name: string;
  source: SourceRef;
  exported: boolean;
  isDefault: boolean;
  /** Declared prop names, where they could be read from the signature. */
  props: string[];
  /** What it renders, best-effort. `null` when nothing could be read. */
  root: ElementRef | null;
  /** Components it renders, resolved within this map and de-duplicated. */
  uses: ComponentId[];
}

/** How a route was discovered, since the conventions differ per framework. */
export type RouteKind = 'next-app' | 'next-pages' | 'react-router' | 'unknown';

export interface RouteNode {
  /** The URL path, always leading-slash. */
  path: string;
  source: SourceRef;
  componentId: ComponentId | null;
  kind: RouteKind;
}

/**
 * The design system, as far as it can be recovered from configuration.
 *
 * Read from a Tailwind config and from CSS custom properties, because those
 * are where a real project keeps this. Empty is a normal answer and must not
 * be presented as a finding.
 */
export interface TokenSet {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  fontSizes: Record<string, string>;
  fonts: Record<string, string>;
  /**
   * Tokens from a design-system file that resist classification.
   *
   * `--radius`, `--shadow-panel`, `--ease-out-quint`. They are real tokens and
   * a change to one is worth reporting, but filing them under "colours" would
   * be the invented-palette problem again. They are kept out of the display
   * and included in the diff, which is the split that serves both: a summary
   * that stays honest, and a diff that stays complete.
   *
   * Learned from missing a real `--radius` change on a live repository.
   */
  other: Record<string, string>;
}

export function emptyTokens(): TokenSet {
  return { colors: {}, spacing: {}, fontSizes: {}, fonts: {}, other: {} };
}

/**
 * How much of this repository was actually understood.
 *
 * The number that decides whether anything built on this map is trustworthy.
 * `confidence` is elements understood over elements seen — deliberately not a
 * weighted score, because a number nobody can recompute by hand is a number
 * nobody believes.
 */
export interface Coverage {
  filesSeen: number;
  filesParsed: number;
  componentsFound: number;
  elementsParsed: number;
  elementsSkipped: number;
  /** Counts per reason. Every counted reason is present, including zeroes. */
  skips: SkipCounts;
  /**
   * Elements resolving to a component outside this repository.
   *
   * Read, not skipped — reported because "this page is mostly a component
   * library we cannot see into" is a useful thing to know about a map, and
   * invisible if it is folded into either of the other numbers.
   */
  externalElements: number;
  /** 0–1. Elements understood as a fraction of elements encountered. */
  confidence: number;
}

export function emptySkips(): SkipCounts {
  return {
    list: 0,
    conditional: 0,
    expression: 0,
    spread: 0,
    'too-deep': 0,
    unsupported: 0,
  };
}

/**
 * Computes coverage from raw counts.
 *
 * A repository with nothing in it scores 1, not 0: there was nothing to fail
 * to understand, and reporting "0% confidence" for an empty folder would send
 * somebody looking for a bug that is not there.
 */
export function coverageOf(input: {
  filesSeen: number;
  filesParsed: number;
  componentsFound: number;
  elementsParsed: number;
  elementsSkipped: number;
  skips: SkipCounts;
  externalElements?: number;
}): Coverage {
  const total = input.elementsParsed + input.elementsSkipped;
  const confidence = total === 0 ? 1 : input.elementsParsed / total;

  return {
    ...input,
    externalElements: input.externalElements ?? 0,
    // Two decimal places: the difference between 0.7831 and 0.78 is not
    // information, and a long float in a PR comment reads as false precision.
    confidence: Math.round(confidence * 100) / 100,
  };
}

/**
 * A repository's interface, as read from its source.
 *
 * Serialisable in full — it goes over the bridge, into an MCP reply, and into a
 * cache keyed by commit — so nothing here may hold a function or a class.
 */
export interface InterfaceMap {
  version: number;
  /** Absolute path of the repository this was read from. */
  root: string;
  /** Framework id from `detectFramework`, or 'unknown'. */
  framework: string;
  components: Record<ComponentId, ComponentNode>;
  routes: RouteNode[];
  tokens: TokenSet;
  coverage: Coverage;
  /** When this was produced, so a stale cache is visible. */
  generatedAt: number;
}

export function emptyMap(root: string, framework = 'unknown'): InterfaceMap {
  return {
    version: MAP_VERSION,
    root,
    framework,
    components: {},
    routes: [],
    tokens: emptyTokens(),
    coverage: coverageOf({
      filesSeen: 0,
      filesParsed: 0,
      componentsFound: 0,
      elementsParsed: 0,
      elementsSkipped: 0,
      skips: emptySkips(),
    }),
    generatedAt: 0,
  };
}

/* ------------------------------------------------------------- reading -- */

/** Every element in a subtree, parents before children. */
export function walk(element: ElementRef): ElementRef[] {
  const out: ElementRef[] = [];
  const stack: ElementRef[] = [element];

  while (stack.length > 0) {
    const current = stack.pop()!;
    out.push(current);
    // Reversed so the natural reading order survives the stack.
    for (let i = current.children.length - 1; i >= 0; i -= 1) stack.push(current.children[i]!);
  }

  return out;
}

/** Every element the map contains, across every component. */
export function allElements(map: InterfaceMap): ElementRef[] {
  return Object.values(map.components).flatMap((component) =>
    component.root ? walk(component.root) : [],
  );
}

/**
 * Components nothing else renders.
 *
 * The entry points of the interface: pages, layouts, and anything only a route
 * reaches. Useful on its own, and the starting point for reading the map as a
 * tree rather than as a dictionary.
 */
export function rootComponents(map: InterfaceMap): ComponentNode[] {
  const used = new Set<ComponentId>();
  for (const component of Object.values(map.components)) {
    for (const id of component.uses) used.add(id);
  }
  return Object.values(map.components).filter((component) => !used.has(component.id));
}

/**
 * Whether this map is worth acting on.
 *
 * Below this, a diff built from it can miss real changes, and a tool that
 * reports "nothing changed" from a map it half-read is worse than one that
 * says it could not tell. Callers should degrade to saying so rather than
 * publishing a confident answer.
 */
export const TRUSTWORTHY = 0.7;

export function isTrustworthy(map: InterfaceMap): boolean {
  return map.coverage.confidence >= TRUSTWORTHY;
}

/**
 * One sentence about what was and was not understood.
 *
 * Written to be pasted into a pull request comment or a terminal without
 * further formatting, and to lead with the honest part.
 */
export function describeCoverage(coverage: Coverage): string {
  const percent = Math.round(coverage.confidence * 100);
  if (coverage.elementsParsed === 0 && coverage.elementsSkipped === 0) {
    return 'No interface found in this repository.';
  }

  const reasons = SKIP_REASONS.filter((reason) => coverage.skips[reason] > 0)
    .sort((a, b) => coverage.skips[b] - coverage.skips[a])
    .slice(0, 3)
    .map((reason) => `${coverage.skips[reason]} ${reason}`);

  const skipped = reasons.length > 0 ? ` · skipped ${reasons.join(', ')}` : '';
  return `${percent}% of ${coverage.elementsParsed + coverage.elementsSkipped} elements${skipped}`;
}
