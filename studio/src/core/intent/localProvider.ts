/**
 * The default Intent provider: deterministic rules, no network, no API key.
 *
 * This is the provider that has to work for everyone, so it is the one that
 * gets the care. It reads the selection, resolves the value currently in
 * effect, and emits ordinary commands — the same ones the inspector emits.
 *
 * Design notes:
 * - Rules are ordered; the first match wins, so specific phrasings are listed
 *   before general ones.
 * - A trailing "on mobile"/"on tablet" retargets the breakpoint, which is what
 *   makes responsive work expressible in one sentence.
 * - Anything it cannot parse fails loudly with suggestions rather than
 *   guessing, because a wrong edit is worse than no edit.
 */

import type {
  Breakpoint,
  ElementNode,
  NodeId,
  NodeKind,
  Project,
  StyleKey,
  StylePatch,
  ZoryCommand,
} from '@zory/core';
import { resolveStyleValue, setStyle } from '@zory/core';
import { findBlock } from './blocks';
import { IntentError, type IntentContext, type IntentProvider } from './types';

// ---------------------------------------------------------------- helpers ---

const LENGTH = /^(-?\d*\.?\d+)([a-z%]*)$/i;

/** Multiplies a CSS length, keeping its unit. */
function scaleLength(raw: string | undefined, factor: number, fallback: string): string {
  const match = LENGTH.exec((raw ?? '').trim());
  if (!match) return fallback;
  const value = Number.parseFloat(match[1]!);
  const unit = match[2] || 'px';
  const next = Math.round(value * factor * 100) / 100;
  // Never collapse something to nothing through repeated shrinking.
  const floor = unit === 'px' ? 1 : 0.05;
  return `${Math.max(floor, next)}${unit}`;
}

function addLength(raw: string | undefined, delta: number, fallback: string): string {
  const match = LENGTH.exec((raw ?? '').trim());
  if (!match) return fallback;
  const value = Number.parseFloat(match[1]!);
  const unit = match[2] || 'px';
  return `${Math.max(0, Math.round((value + delta) * 100) / 100)}${unit}`;
}

function currentValue<K extends StyleKey>(
  node: ElementNode,
  breakpoint: Breakpoint,
  key: K,
): string | undefined {
  const value = resolveStyleValue(node.styles, breakpoint, key).value;
  return value === undefined ? undefined : String(value);
}

/** Nodes whose "size" means font size rather than box size. */
function isTextKind(kind: NodeKind): boolean {
  return kind === 'heading' || kind === 'text' || kind === 'button' || kind === 'link';
}

const NAMED_COLOURS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#dc2626',
  orange: '#ea7317',
  amber: '#f0a22e',
  yellow: '#eab308',
  green: '#16a34a',
  teal: '#0d9488',
  blue: '#2f6feb',
  navy: '#1e3a8a',
  indigo: '#4f46e5',
  purple: '#7c3aed',
  pink: '#db2777',
  brown: '#78350f',
  grey: '#6b7280',
  gray: '#6b7280',
  silver: '#c0c4cc',
  transparent: 'transparent',
};

function parseColour(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(value) || /^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^[0-9a-f]{6}$/.test(value)) return `#${value}`;
  const named = NAMED_COLOURS[value];
  if (named) return named;
  // "light blue" / "dark green" shift the named value.
  const shade = /^(light|dark)\s+(\w+)$/.exec(value);
  if (shade) {
    const base = NAMED_COLOURS[shade[2]!];
    if (base && base.startsWith('#')) return shade[1] === 'light' ? lighten(base, 0.4) : darken(base, 0.3);
  }
  return null;
}

function channels(hex: string): [number, number, number] {
  const full =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  return [
    Number.parseInt(full.slice(1, 3), 16),
    Number.parseInt(full.slice(3, 5), 16),
    Number.parseInt(full.slice(5, 7), 16),
  ];
}

const toHex = (n: number): string =>
  Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

function lighten(hex: string, amount: number): string {
  const [r, g, b] = channels(hex);
  return `#${toHex(r + (255 - r) * amount)}${toHex(g + (255 - g) * amount)}${toHex(b + (255 - b) * amount)}`;
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = channels(hex);
  return `#${toHex(r * (1 - amount))}${toHex(g * (1 - amount))}${toHex(b * (1 - amount))}`;
}

// ------------------------------------------------------------------ rules ---

interface RuleContext {
  node: ElementNode;
  breakpoint: Breakpoint;
  project: Project;
  /** The prompt with any trailing breakpoint phrase removed. */
  text: string;
  match: RegExpExecArray;
}

interface Rule {
  /** Matched against the normalised prompt. */
  pattern: RegExp;
  run: (ctx: RuleContext) => ZoryCommand[];
}

const RULES: Rule[] = [
  // ---- Visibility ----
  {
    pattern: /^(?:hide|remove)\s+(?:this|it)?\s*$/,
    run: ({ node, breakpoint }) => [setStyle(node.id, breakpoint, { display: 'none' })],
  },
  {
    pattern: /^(?:show|unhide|reveal)\s+(?:this|it)?\s*$/,
    run: ({ node, breakpoint }) => [
      setStyle(node.id, breakpoint, { display: node.kind === 'container' ? 'flex' : 'block' }),
    ],
  },

  // ---- Size ----
  {
    pattern: /^make\s+(?:this|it)?\s*(?:a\s+)?(?:lot\s+|much\s+)?(bigger|larger|smaller)\s*$/,
    run: ({ node, breakpoint, match }) => {
      const grow = match[1] !== 'smaller';
      const factor = grow ? 1.25 : 0.8;
      if (isTextKind(node.kind)) {
        const current = currentValue(node, breakpoint, 'fontSize') ?? '16px';
        return [setStyle(node.id, breakpoint, { fontSize: scaleLength(current, factor, '16px') })];
      }
      const current = currentValue(node, breakpoint, 'width');
      if (current && current !== 'auto') {
        return [setStyle(node.id, breakpoint, { width: scaleLength(current, factor, '100%') })];
      }
      // No explicit size: scale the padding, which is what "bigger" means for
      // a container that sizes itself from its content.
      const pad = currentValue(node, breakpoint, 'paddingTop') ?? '16px';
      const padX = currentValue(node, breakpoint, 'paddingLeft') ?? pad;
      return [
        setStyle(node.id, breakpoint, {
          paddingTop: scaleLength(pad, factor, '20px'),
          paddingBottom: scaleLength(currentValue(node, breakpoint, 'paddingBottom') ?? pad, factor, '20px'),
          paddingLeft: scaleLength(padX, factor, '20px'),
          paddingRight: scaleLength(currentValue(node, breakpoint, 'paddingRight') ?? padX, factor, '20px'),
        }),
      ];
    },
  },
  {
    pattern: /^(?:make\s+)?(?:this|it)?\s*full[- ]?width\s*$/,
    run: ({ node, breakpoint }) => [
      setStyle(node.id, breakpoint, { width: '100%', maxWidth: 'none' }),
    ],
  },

  // ---- Weight ----
  {
    pattern: /^make\s+(?:this|it)?\s*(bold|bolder|lighter|thinner|normal|regular)\s*$/,
    run: ({ node, breakpoint, match }) => {
      const word = match[1]!;
      const current = Number.parseInt(currentValue(node, breakpoint, 'fontWeight') ?? '400', 10);
      let next: number;
      if (word === 'bold') next = 700;
      else if (word === 'bolder') next = Math.min(900, current + 200);
      else if (word === 'normal' || word === 'regular') next = 400;
      else next = Math.max(100, current - 200);
      return [setStyle(node.id, breakpoint, { fontWeight: String(next) })];
    },
  },

  // ---- Alignment ----
  {
    pattern: /^(?:center|centre)\s+(?:this|it)?\s*$/,
    run: ({ node, breakpoint }) => {
      if (isTextKind(node.kind)) {
        return [setStyle(node.id, breakpoint, { textAlign: 'center' })];
      }
      const display = currentValue(node, breakpoint, 'display');
      if (display === 'flex' || display === 'inline-flex') {
        const column = currentValue(node, breakpoint, 'flexDirection') === 'column';
        return [
          setStyle(
            node.id,
            breakpoint,
            column ? { alignItems: 'center' } : { justifyContent: 'center', alignItems: 'center' },
          ),
        ];
      }
      // A plain block centres by way of auto margins.
      return [setStyle(node.id, breakpoint, { marginLeft: 'auto', marginRight: 'auto' })];
    },
  },
  {
    pattern: /^(?:left|right)[- ]?align\s+(?:this|it)?\s*$|^align\s+(?:this|it)?\s*(?:to\s+the\s+)?(left|right)\s*$/,
    run: ({ node, breakpoint, text }) => {
      const side = text.includes('right') ? 'right' : 'left';
      if (isTextKind(node.kind)) return [setStyle(node.id, breakpoint, { textAlign: side })];
      return [
        setStyle(node.id, breakpoint, {
          justifyContent: side === 'left' ? 'flex-start' : 'flex-end',
        }),
      ];
    },
  },

  // ---- Spacing ----
  {
    pattern: /^(?:add|increase|more)\s+(?:the\s+)?(spacing|space|gap|padding)\s*$|^(?:increase|add)\s+(?:more\s+)?(spacing|space|gap|padding)\s*$/,
    run: ({ node, breakpoint, text }) => spacingCommands(node, breakpoint, text, 1),
  },
  {
    pattern: /^(?:reduce|decrease|less|tighten)\s+(?:the\s+)?(spacing|space|gap|padding)\s*$/,
    run: ({ node, breakpoint, text }) => spacingCommands(node, breakpoint, text, -1),
  },

  // ---- Corners ----
  {
    pattern: /^(?:round|soften)\s+(?:the\s+)?corners\s*$|^make\s+(?:the\s+)?corners\s+(?:more\s+)?round(?:er|ed)?\s*$/,
    run: ({ node, breakpoint }) => {
      const current = currentValue(node, breakpoint, 'borderRadius');
      const next = current ? addLength(current, 4, '8px') : '8px';
      return [setStyle(node.id, breakpoint, { borderRadius: next })];
    },
  },
  {
    pattern: /^(?:square|sharpen)\s+(?:the\s+)?corners\s*$|^remove\s+(?:the\s+)?(?:corner\s+)?(?:radius|rounding)\s*$/,
    run: ({ node, breakpoint }) => [setStyle(node.id, breakpoint, { borderRadius: '0px' })],
  },

  // ---- Background & colour ----
  {
    pattern: /^remove\s+(?:the\s+)?(?:background|fill)\s*$|^(?:make\s+it\s+)?transparent\s*$/,
    run: ({ node, breakpoint }) => [setStyle(node.id, breakpoint, { backgroundColor: null })],
  },
  {
    pattern: /^(?:make|set)\s+(?:the\s+)?background\s+(?:colou?r\s+)?(?:to\s+)?(.+?)\s*$/,
    run: ({ node, breakpoint, match }) => {
      const colour = parseColour(match[1]!);
      if (!colour) throw new IntentError(`"${match[1]}" is not a colour Studio recognises.`, [
        'make the background white',
        'make the background #f5f5f5',
      ]);
      return [setStyle(node.id, breakpoint, { backgroundColor: colour })];
    },
  },
  {
    pattern: /^(?:make|set)\s+(?:the\s+)?(?:text\s+)?colou?r\s+(?:to\s+)?(.+?)\s*$|^(?:make\s+)?(?:this|it)\s+(?:text\s+)?(.+?)\s+colou?red?\s*$/,
    run: ({ node, breakpoint, match }) => {
      const raw = match[1] ?? match[2] ?? '';
      const colour = parseColour(raw);
      if (!colour) throw new IntentError(`"${raw}" is not a colour Studio recognises.`, [
        'set the colour to black',
        'set the colour to #2f6feb',
      ]);
      return [setStyle(node.id, breakpoint, { color: colour })];
    },
  },

  // ---- Typography detail ----
  {
    pattern: /^(?:tighten|reduce)\s+(?:the\s+)?(?:tracking|letter[- ]spacing)\s*$/,
    run: ({ node, breakpoint }) => [
      setStyle(node.id, breakpoint, {
        letterSpacing: addLength(currentValue(node, breakpoint, 'letterSpacing') ?? '0em', -0.01, '-0.02em'),
      }),
    ],
  },
  {
    pattern: /^(?:loosen|increase)\s+(?:the\s+)?(?:tracking|letter[- ]spacing)\s*$/,
    run: ({ node, breakpoint }) => [
      setStyle(node.id, breakpoint, {
        letterSpacing: addLength(currentValue(node, breakpoint, 'letterSpacing') ?? '0em', 0.01, '0.02em'),
      }),
    ],
  },
  {
    pattern: /^(?:make\s+it\s+)?uppercase\s*$/,
    run: ({ node, breakpoint }) => [setStyle(node.id, breakpoint, { textTransform: 'uppercase' })],
  },

  // ---- Stack direction ----
  {
    pattern: /^stack\s+(?:these|this|them)?\s*(?:vertically)?\s*$|^make\s+(?:this|it)\s+(?:a\s+)?column\s*$/,
    run: ({ node, breakpoint }) => [
      setStyle(node.id, breakpoint, { display: 'flex', flexDirection: 'column' }),
    ],
  },
  {
    pattern: /^(?:lay|put)\s+(?:these|them)\s+(?:out\s+)?(?:in\s+)?a?\s*row\s*$|^make\s+(?:this|it)\s+(?:a\s+)?row\s*$/,
    run: ({ node, breakpoint }) => [
      setStyle(node.id, breakpoint, { display: 'flex', flexDirection: 'row' }),
    ],
  },
];

function spacingCommands(
  node: ElementNode,
  breakpoint: Breakpoint,
  text: string,
  direction: 1 | -1,
): ZoryCommand[] {
  const display = String(resolveStyleValue(node.styles, breakpoint, 'display').value ?? '');
  const wantsGap = /gap/.test(text) || display === 'flex' || display === 'grid' || display === 'inline-flex';

  if (wantsGap && !/padding/.test(text)) {
    const current = currentValue(node, breakpoint, 'gap') ?? '0px';
    return [
      setStyle(node.id, breakpoint, {
        gap: direction > 0 ? scaleLength(current, 1.5, '16px') : scaleLength(current, 0.66, '8px'),
      }),
    ];
  }

  const factor = direction > 0 ? 1.4 : 0.7;
  const fallback = direction > 0 ? '24px' : '12px';
  return [
    setStyle(node.id, breakpoint, {
      paddingTop: scaleLength(currentValue(node, breakpoint, 'paddingTop') ?? '16px', factor, fallback),
      paddingRight: scaleLength(currentValue(node, breakpoint, 'paddingRight') ?? '16px', factor, fallback),
      paddingBottom: scaleLength(currentValue(node, breakpoint, 'paddingBottom') ?? '16px', factor, fallback),
      paddingLeft: scaleLength(currentValue(node, breakpoint, 'paddingLeft') ?? '16px', factor, fallback),
    }),
  ];
}


// ------------------------------------------------------- design intents ---

/**
 * Whole-section restyles, computed on this device.
 *
 * The narrow rules above each change one property on one element. These change
 * a coherent set of properties across a whole subtree, which is what people
 * actually ask for — "make this calmer" is not a font-size request.
 *
 * Everything is *relative*: each value is derived from what the node already
 * has, so the result respects the design it is given rather than stamping
 * fixed numbers over it. Applying the same intent twice keeps moving in the
 * same direction instead of snapping to a preset.
 *
 * Why this exists at all: the hosted model handles these well, but free
 * inference is rate limited and occasionally slow, so a demo that depends on
 * it fails in front of people. These run instantly, offline, forever, and cost
 * nothing — which is the version of "AI optional" the product claims.
 */

interface DesignIntent {
  pattern: RegExp;
  /** Per-node styles, given what that node currently resolves to. */
  style: (node: ElementNode, breakpoint: Breakpoint) => StylePatch | null;
}

/** Depth-first subtree, capped so one prompt cannot emit hundreds of commands. */
function subtree(project: Project, rootId: NodeId, limit = 40): ElementNode[] {
  const out: ElementNode[] = [];
  const queue: NodeId[] = [rootId];
  while (queue.length > 0 && out.length < limit) {
    const id = queue.shift()!;
    const node = project.nodes[id];
    if (!node) continue;
    out.push(node);
    queue.push(...node.children);
  }
  return out;
}

const isHeading = (node: ElementNode): boolean => node.kind === 'heading';
const isBody = (node: ElementNode): boolean => node.kind === 'text';
const isBox = (node: ElementNode): boolean => node.kind === 'container';

const DESIGN_INTENTS: DesignIntent[] = [
  {
    // Calm reads as: more room, less weight, longer measure, softer body text.
    pattern: /\b(calm|calmer|quieter|softer|more\s+premium|premium|refined|elegant|understated)\b/,
    style: (node, bp) => {
      if (isBox(node)) {
        return {
          paddingTop: scaleLength(currentValue(node, bp, 'paddingTop'), 1.5, '48px'),
          paddingBottom: scaleLength(currentValue(node, bp, 'paddingBottom'), 1.5, '48px'),
          gap: scaleLength(currentValue(node, bp, 'gap'), 1.4, '20px'),
        };
      }
      if (isHeading(node)) {
        return {
          fontWeight: '500',
          letterSpacing: '-0.02em',
          lineHeight: '1.1',
        };
      }
      if (isBody(node)) {
        return {
          lineHeight: '1.65',
          maxWidth: '60ch',
        };
      }
      return null;
    },
  },
  {
    // Bold reads as: heavier and tighter display type, tighter leading.
    pattern: /\b(bolder|louder|punchier|stronger|more\s+impactful|more\s+dramatic)\b/,
    style: (node, bp) => {
      if (isHeading(node)) {
        return {
          fontSize: scaleLength(currentValue(node, bp, 'fontSize'), 1.25, '48px'),
          fontWeight: '700',
          letterSpacing: '-0.035em',
          lineHeight: '1',
        };
      }
      if (node.kind === 'button') return { fontWeight: '600' };
      if (isBody(node)) return { fontSize: scaleLength(currentValue(node, bp, 'fontSize'), 1.1, '18px') };
      return null;
    },
  },
  {
    // Denser: pull the spacing scale in without touching type.
    pattern: /\b(tighter|denser|more\s+compact|compact|condensed)\b/,
    style: (node, bp) => {
      if (isBox(node)) {
        return {
          paddingTop: scaleLength(currentValue(node, bp, 'paddingTop'), 0.65, '16px'),
          paddingBottom: scaleLength(currentValue(node, bp, 'paddingBottom'), 0.65, '16px'),
          gap: scaleLength(currentValue(node, bp, 'gap'), 0.7, '8px'),
        };
      }
      if (isBody(node) || isHeading(node)) return { lineHeight: '1.25' };
      return null;
    },
  },
  {
    // Airier: the inverse, spacing only.
    pattern: /\b(airier|roomier|more\s+spacious|more\s+breathing\s+room|more\s+whitespace)\b/,
    style: (node, bp) => {
      if (isBox(node)) {
        return {
          paddingTop: scaleLength(currentValue(node, bp, 'paddingTop'), 1.6, '56px'),
          paddingBottom: scaleLength(currentValue(node, bp, 'paddingBottom'), 1.6, '56px'),
          gap: scaleLength(currentValue(node, bp, 'gap'), 1.5, '24px'),
        };
      }
      if (isBody(node)) return { lineHeight: '1.7' };
      return null;
    },
  },
];

/**
 * Runs the first matching design intent over the subtree.
 * Returns null when the prompt is not one of these, so the caller falls
 * through to the hosted model.
 */
function designIntentCommands(
  project: Project,
  rootId: NodeId,
  breakpoint: Breakpoint,
  text: string,
): ZoryCommand[] | null {
  const intent = DESIGN_INTENTS.find((candidate) => candidate.pattern.test(text));
  if (!intent) return null;

  const commands: ZoryCommand[] = [];
  for (const node of subtree(project, rootId)) {
    const patch = intent.style(node, breakpoint);
    if (patch && Object.keys(patch).length > 0) {
      commands.push(setStyle(node.id, breakpoint, patch));
    }
  }

  // A match that touches nothing is worse than no match: fall through rather
  // than reporting a successful edit that changed zero elements.
  return commands.length > 0 ? commands : null;
}


// -------------------------------------------------------- theme intents ---

/**
 * Whole-site stylistic choices.
 *
 * Design intents above reshape a subtree you point at. These are broader: they
 * answer "make it dark", "give it a gradient", "make it feel modern" — requests
 * about the look of the whole thing, where there is no element to select
 * because the answer touches every section.
 *
 * They always run from the page root regardless of selection, and they are
 * deterministic, so they cost nothing and work offline. That matters more here
 * than anywhere else: a theme change is the single most likely thing for
 * someone to try in the first minute, and it is the worst possible moment to
 * hit a rate limit.
 *
 * Everything produced is ordinary CSS — gradients on backgroundImage,
 * transitions rather than animation loops — so it survives export untouched
 * and respects reduced motion without any work from us.
 */

interface ThemeIntent {
  pattern: RegExp;
  /** Applied to every node in the page, given its role. */
  style: (node: ElementNode, depth: number) => StylePatch | null;
}

/** A container that reads as a page section rather than a small wrapper. */
function isSection(node: ElementNode, depth: number): boolean {
  return node.kind === 'container' && depth <= 2;
}

const THEME_INTENTS: ThemeIntent[] = [
  {
    pattern: /\b(dark\s*mode|make\s+it\s+dark|go\s+dark|dark\s+theme)\b/,
    style: (node, depth) => {
      if (node.kind === 'container' && depth === 0) {
        return { backgroundColor: '#0b0b0f', color: '#e8e8ea' };
      }
      if (isSection(node, depth)) return { backgroundColor: 'transparent', color: '#e8e8ea' };
      if (node.kind === 'heading') return { color: '#f5f5f7' };
      if (node.kind === 'text') return { color: '#a8a8ad' };
      if (node.kind === 'button') return { backgroundColor: '#f5f5f7', color: '#0b0b0f' };
      return null;
    },
  },
  {
    pattern: /\b(light\s*mode|make\s+it\s+light|light\s+theme)\b/,
    style: (node, depth) => {
      if (node.kind === 'container' && depth === 0) {
        return { backgroundColor: '#ffffff', color: '#15151a' };
      }
      if (node.kind === 'heading') return { color: '#0d0d12' };
      if (node.kind === 'text') return { color: '#55555f' };
      if (node.kind === 'button') return { backgroundColor: '#15151a', color: '#ffffff' };
      return null;
    },
  },
  {
    // Gradients go on backgroundImage, which already exists and already
    // exports; there is no gradient primitive to invent.
    pattern: /\b(gradient|colou?rful\s+background|add\s+a\s+gradient)\b/,
    style: (node, depth) => {
      if (node.kind === 'container' && depth === 0) {
        return {
          backgroundImage: 'linear-gradient(160deg, #0f172a 0%, #3b1d60 55%, #7c2d5e 100%)',
          color: '#f2f2f5',
        };
      }
      if (node.kind === 'heading') return { color: '#ffffff' };
      if (node.kind === 'text') return { color: 'rgba(255,255,255,0.72)' };
      return null;
    },
  },
  {
    pattern: /\b(glass|glassy|frosted|blur(?:red)?\s+background)\b/,
    style: (node, depth) => {
      if (isSection(node, depth) && depth > 0) {
        return {
          backgroundColor: 'rgba(255,255,255,0.08)',
          backdropFilter: 'blur(14px)',
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: 'rgba(255,255,255,0.16)',
          borderRadius: '16px',
        };
      }
      return null;
    },
  },
  {
    pattern: /\b(add\s+depth|3d|three\s*d|make\s+it\s+pop|dimension)\b/,
    style: (node, depth) => {
      if (isSection(node, depth) && depth > 0) {
        return {
          borderRadius: '18px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.12)',
          transform: 'perspective(1200px) rotateX(0.6deg)',
          transition: 'transform 320ms ease, box-shadow 320ms ease',
        };
      }
      if (node.kind === 'button') {
        return { transition: 'transform 160ms ease, box-shadow 160ms ease' };
      }
      return null;
    },
  },
  {
    pattern: /\b(animate|animations?|make\s+it\s+smooth|smooth\s+it|add\s+motion)\b/,
    style: (node) => {
      // Transitions rather than keyframes: they need no @keyframes block in the
      // export and they stop existing under prefers-reduced-motion for free.
      if (node.kind === 'button' || node.kind === 'link') {
        return { transition: 'transform 160ms ease, opacity 160ms ease, background-color 160ms ease' };
      }
      if (node.kind === 'container') {
        return { transition: 'transform 280ms ease, box-shadow 280ms ease' };
      }
      return null;
    },
  },
  {
    /*
     * The catch-all people actually type. Composes the others rather than
     * inventing a seventh look: a dark ground, a gradient, depth on the
     * sections and motion on anything clickable.
     */
    pattern: /\b(make\s+(?:this|it)\s+(?:a\s+)?cool|make\s+it\s+(?:look\s+)?(?:modern|premium|beautiful|stunning)|redesign\s+(?:this|it)|make\s+a\s+cool\s+website)\b/,
    style: (node, depth) => {
      if (node.kind === 'container' && depth === 0) {
        return {
          backgroundImage: 'linear-gradient(165deg, #08080c 0%, #14142a 60%, #241a3d 100%)',
          color: '#ededf2',
        };
      }
      if (isSection(node, depth)) {
        return {
          paddingTop: '96px',
          paddingBottom: '96px',
          gap: '24px',
        };
      }
      if (node.kind === 'heading') {
        return {
          color: '#ffffff',
          fontWeight: '500',
          letterSpacing: '-0.035em',
          lineHeight: '1.05',
        };
      }
      if (node.kind === 'text') return { color: 'rgba(237,237,242,0.68)', lineHeight: '1.65' };
      if (node.kind === 'button') {
        return {
          backgroundColor: '#ffffff',
          color: '#08080c',
          borderRadius: '10px',
          transition: 'transform 160ms ease, opacity 160ms ease',
        };
      }
      return null;
    },
  },
];

/** Depth-first walk of the whole page, with each node's depth. */
function pageNodes(project: Project, rootId: NodeId, limit = 120): { node: ElementNode; depth: number }[] {
  const out: { node: ElementNode; depth: number }[] = [];
  const queue: { id: NodeId; depth: number }[] = [{ id: rootId, depth: 0 }];
  while (queue.length > 0 && out.length < limit) {
    const { id, depth } = queue.shift()!;
    const node = project.nodes[id];
    if (!node) continue;
    out.push({ node, depth });
    for (const child of node.children) queue.push({ id: child, depth: depth + 1 });
  }
  return out;
}

function themeIntentCommands(
  project: Project,
  rootId: NodeId,
  breakpoint: Breakpoint,
  text: string,
): ZoryCommand[] | null {
  const intent = THEME_INTENTS.find((candidate) => candidate.pattern.test(text));
  if (!intent) return null;

  const commands: ZoryCommand[] = [];
  for (const { node, depth } of pageNodes(project, rootId)) {
    const patch = intent.style(node, depth);
    if (patch && Object.keys(patch).length > 0) {
      commands.push(setStyle(node.id, breakpoint, patch));
    }
  }
  return commands.length > 0 ? commands : null;
}

// ----------------------------------------------------------- structural ---

/**
 * Adding, removing and duplicating, without a model.
 *
 * Deliberately conservative about *where* things land: a new block goes inside
 * the selection when it can hold children, and beside it otherwise. Guessing
 * more cleverly than that produces surprises, and the user can drag it.
 */
function structuralCommands(
  project: Project,
  focusId: NodeId,
  text: string,
  /*
   * The prompt as typed. Matching happens against the normalised form, but any
   * wording the user supplied has to be taken from here — normalising
   * lowercases, so "add a heading that says Welcome To Zory" would otherwise
   * insert "welcome to zory".
   */
  original: string,
): ZoryCommand[] | null {
  const node = project.nodes[focusId];
  if (!node) return null;

  if (/^(?:delete|remove)\s+(?:this|it)\s*$/.test(text)) {
    // A page root has nowhere to go; validation refuses it, but saying so here
    // gives a better message than "that change was refused".
    if (!node.parentId) throw new IntentError('The page itself cannot be deleted.');
    return [{ type: 'DELETE_NODE', nodeId: focusId }];
  }

  if (/^duplicate\s+(?:this|it)\s*$/.test(text)) {
    if (!node.parentId) throw new IntentError('The page itself cannot be duplicated.');
    // No idMap: the engine builds it, so ids come from one place.
    return [{ type: 'DUPLICATE_NODE', nodeId: focusId } as unknown as ZoryCommand];
  }

  const ADD = /^(?:add|insert)\s+(?:an?\s+)?([a-z]+)(?:\s+(?:that\s+says|saying|with\s+the\s+text)\s+(.+))?\s*$/i;
  const add = ADD.exec(text);
  if (add) {
    // Re-match the untouched prompt to recover the user's own casing.
    const cased = ADD.exec(original.trim())?.[2];
    const block = findBlock(add[1] ?? '');
    if (!block) return null;

    const container = node.kind === 'container' ? node : project.nodes[node.parentId ?? ''];
    if (!container) return null;

    const index =
      container.id === node.id ? container.children.length : container.children.indexOf(node.id) + 1;

    return [
      {
        type: 'INSERT_BLOCK',
        block: block.id,
        parentId: container.id,
        index,
        ...(add[2]
          ? {
              text: (cased ?? add[2])
                .trim()
                .replace(/^["\u2018\u2019\u201c\u201d']|["\u2018\u2019\u201c\u201d']$/g, ''),
            }
          : {}),
      } as unknown as ZoryCommand,
    ];
  }

  return null;
}

// --------------------------------------------------------------- provider ---

const BREAKPOINT_PHRASE = /\s+(?:on|for|at)\s+(mobile|phone|tablet|desktop)\s*$/;

/** Strips a trailing "on mobile" and returns the breakpoint it names. */
export function extractBreakpoint(
  prompt: string,
  fallback: Breakpoint,
): { text: string; breakpoint: Breakpoint } {
  const match = BREAKPOINT_PHRASE.exec(prompt);
  if (!match) return { text: prompt, breakpoint: fallback };

  const word = match[1]!;
  const breakpoint: Breakpoint =
    word === 'tablet' ? 'tablet' : word === 'desktop' ? 'base' : 'mobile';
  return { text: prompt.slice(0, match.index).trim(), breakpoint };
}

/**
 * Order matters here: trailing punctuation can only be stripped once
 * surrounding whitespace is gone, or "bigger. " slips through unmatched.
 */
export function normalisePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/\bplease\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();
}

export const EXAMPLE_PROMPTS = [
  'make this bigger',
  'centre this',
  'make this bold',
  'increase the spacing',
  'round the corners',
  'remove the background',
  'hide this on mobile',
  'make this full width',
  'set the background to #f4f4f5',
  'make this smaller on mobile',
];

export const localIntentProvider: IntentProvider = {
  id: 'local-rules',
  name: 'Built-in',

  isAvailable: () => true,

  async propose(context: IntentContext, prompt: string) {
    const trimmed = prompt.trim();
    if (trimmed === '') throw new IntentError('Describe the change you want.', EXAMPLE_PROMPTS.slice(0, 3));

    /*
     * Selection is a focus hint. A section-level request ("make this calmer")
     * has no single element to click, so with nothing selected the page root
     * stands in and the intent applies to the whole page.
     */
    const page =
      context.project.pages.find((candidate) => candidate.id === context.pageId) ??
      context.project.pages[0];
    const focusId = context.selectedId ?? page?.rootId ?? null;
    if (!focusId) throw new IntentError('Open a page before describing a change.');

    const node = context.project.nodes[focusId];
    if (!node) throw new IntentError('That element no longer exists.');

    const { text, breakpoint } = extractBreakpoint(normalisePrompt(trimmed), context.breakpoint);

    /*
     * Precise rules win, but only with a selection. "Make this bigger" names a
     * specific thing, so answering it by scaling the page root would be
     * obedient and wrong. Mood-level intents below are different: "make this
     * calmer" is about a composition and reads fine against the whole page.
     */
    if (context.selectedId) {
      for (const rule of RULES) {
        const match = rule.pattern.exec(text);
        if (!match) continue;
        return rule.run({ node, breakpoint, project: context.project, text, match });
      }
    }

    /*
     * Theme first, and always from the page root. "Make it dark" is about the
     * site, not about whatever happened to be selected when it was typed —
     * applying it to one heading would be obedient and useless.
     */
    const rootId = page?.rootId ?? focusId;
    const theme = themeIntentCommands(context.project, rootId, breakpoint, text);
    if (theme) return theme;

    /*
     * Structural requests, answered on the device.
     *
     * These emit INSERT_BLOCK rather than INSERT_NODE for the same reason the
     * model does: the engine builds the node, so there is exactly one place
     * where ids are generated.
     */
    const structural = structuralCommands(context.project, focusId, text, trimmed);
    if (structural) return structural;

    const design = designIntentCommands(context.project, focusId, breakpoint, text);
    if (design) return design;

    if (!context.selectedId) {
      throw new IntentError('Select an element on the canvas first, then describe the change.');
    }

    throw new IntentError(
      `Studio does not know how to "${trimmed}" yet.`,
      EXAMPLE_PROMPTS.slice(0, 4),
    );
  },
};
