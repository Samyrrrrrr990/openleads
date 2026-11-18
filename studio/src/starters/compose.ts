/**
 * A sentence in, a real project out.
 *
 * This is the shortest honest path from "I want a site for X" to a graph the
 * canvas can render, the inspector can edit, history can undo and export can
 * turn into React. It reads a plain-English brief and composes a page from the
 * same `patterns.ts` sections every starter in the catalogue is built from.
 *
 * ## Why this is not an AI feature
 *
 * It could have been a prompt to a model, and that would have been the easy
 * version: a paid API key, a JSON schema, and a plausible page most of the
 * time. Two things rule it out. The architecture says core creation may not
 * require a paid third-party API, and a first run that fails because somebody
 * else's endpoint is rate-limiting is the worst possible first run.
 *
 * So it is a parser. Deterministic, offline, instant, and testable: the same
 * sentence always produces the same project, which is a property no model
 * gives you and the reason `compose.test.ts` can assert on output at all.
 *
 * The honest limitation, stated here rather than discovered: this reads a
 * brief, it does not understand one. It recognises what kind of site is being
 * asked for, what it is called, roughly how it should feel, and what it does.
 * Everything past that is a well-built starting point, not a finished site.
 * That is the correct promise — the product is the editor, and this exists to
 * put somebody inside it with their own words already on the canvas rather
 * than a stranger's placeholder copy.
 *
 * ## Where it sits in the flow
 *
 *   prompt
 *     → readBrief          (pure, this file)
 *     → composeProject     (pure, this file, via patterns.ts)
 *     → createProject      (@zory/core, the one graph constructor)
 *     → createProjectRecord (persistence)
 *     → the editor
 *
 * No new source of truth, no privileged node kind, no runtime dependency. What
 * comes out is indistinguishable from a project somebody built by hand, which
 * is the test that matters: you can delete this file and every project it made
 * keeps working.
 */

import type { PageBlueprint, Project, ProjectTheme, NodeBlueprint } from '@zory/core';
import { createProject } from '@zory/core';
import { FACES, collectComponents, page, theme, type Section } from './catalogue/kit';
import {
  ACCENT,
  BODY,
  BORDER,
  INK,
  MUTED,
  PAGE,
  SURFACE,
  about,
  cta,
  features,
  footer,
  heroCentred,
  heroSplit,
  mockPanel,
  nav,
  plates,
  showcase,
  stats,
  workIndex,
} from './patterns';
import { box, col, text } from './builders';
import { HOME } from './sitemap';

/* ==================================================================== read */

/**
 * The kinds of site this can compose.
 *
 * Each one maps to a genuinely different page shape — a portfolio is not a
 * landing page with different words, it is rows of work where a landing page
 * has a feature grid. A kind that renders the same sections as an existing one
 * is not a kind, it is a synonym, and it belongs in that kind's vocabulary.
 *
 * `local` is the seventh because it failed that test the other way round. A
 * restaurant, a salon and a plumber were being read as a shop, and a shop's
 * page is a range and a shipping promise. A local business's page is what it
 * does, when it is open, and how to reach it — a different shape, so a kind.
 */
export type BriefKind = 'product' | 'portfolio' | 'studio' | 'writing' | 'event' | 'store' | 'local';

/** How the page should feel. Drives palette and typeface pairing, nothing else. */
export type BriefTone = 'precise' | 'editorial' | 'warm' | 'bold' | 'quiet';

export interface Brief {
  kind: BriefKind;
  tone: BriefTone;
  /** What the thing is called. Never empty. */
  name: string;
  /** A short noun phrase for what it is, in the visitor's own words where possible. */
  subject: string;
  /** Who it is for, when the sentence said: "an invoicing tool for *freelancers*". */
  audience: string | null;
  /** What it is about, when the sentence said: "a newsletter about *the craft of software*". */
  topic: string | null;
  /** Where it is, when the sentence said: "a yoga studio in *Brooklyn*". */
  place: string | null;
  /** Capability phrases pulled out of the sentence. May be empty. */
  features: string[];
  /** The sentence as typed, trimmed and length-capped. */
  prompt: string;
  /**
   * Whether the sentence actually said what kind of site this is, or whether
   * `kind` is a fallback. The UI tells the truth about this rather than
   * pretending to a confidence it does not have.
   */
  recognised: boolean;
}

/**
 * The narrower thing inside a kind, where the page's words depend on it.
 *
 * A photographer and a developer both want a portfolio, and the page shape is
 * the same, but "Design, mostly for products" is only true of one of them. A
 * role exists wherever a kind's copy would otherwise have to assume one.
 * `general` is the role whose copy assumes nothing, and it is what an
 * unrecognised subject gets — generic is acceptable, wrong is not.
 */
export type BriefRole =
  | 'general'
  | 'photographer'
  | 'illustrator'
  | 'developer'
  | 'architect'
  | 'writer'
  | 'filmmaker'
  | 'designer'
  | 'wedding'
  | 'food'
  | 'care'
  | 'trade'
  | 'fitness';

/**
 * One piece of vocabulary.
 *
 * `weight` is how strongly it says which kind of site this is: 3 for a word
 * that names the kind outright ("portfolio", "restaurant"), 2 for a role that
 * implies it ("photographer"), 1 for a hint ("analytics"). `site` marks the
 * words that describe the website rather than the thing it is for — "landing
 * page" is not a subject — so the subject is never read out of one.
 */
interface Term {
  phrase: string;
  weight: number;
  site?: boolean;
  role?: BriefRole;
  /** The practice a role noun belongs to: photographer → photography. */
  practice?: string;
}

const site = (weight: number, ...phrases: string[]): Term[] =>
  phrases.map((phrase) => ({ phrase, weight, site: true }));
const term = (weight: number, ...phrases: string[]): Term[] =>
  phrases.map((phrase) => ({ phrase, weight }));
const role = (weight: number, role: BriefRole, pairs: [phrase: string, practice?: string][]): Term[] =>
  pairs.map(([phrase, practice]) => ({ phrase, weight, role, practice }));

/**
 * Vocabulary.
 *
 * Matched as whole words, longest phrase first, and a matched span is consumed
 * so that the words inside it cannot score again: "yoga studio" is a local
 * business and does not also count "studio" towards a design studio. That is
 * also what keeps "happy" from containing "app".
 */
const KIND_TERMS: Record<BriefKind, readonly Term[]> = {
  product: [
    // "Landing page" is how many people say "website", so it counts for less
    // than the thing the page is for: a landing page for a restaurant is a
    // restaurant's site.
    ...site(2, 'landing page', 'launch page'),
    ...site(3, 'product page', 'pricing page', 'waitlist'),
    ...term(3, 'saas', 'app', 'web app', 'mobile app', 'platform', 'startup', 'crm', 'api', 'sdk', 'dashboard', 'tool', 'extension', 'plugin', 'b2b'),
    ...term(1, 'software', 'analytics', 'automation', 'ai', 'developers', 'launch'),
  ],
  portfolio: [
    ...site(3, 'portfolio', 'personal site', 'personal website', 'personal page', 'my work', 'resume', 'résumé', 'cv', 'showreel', 'case studies'),
    ...role(2, 'photographer', [
      ['photographer', 'photography'],
      ['wedding photographer', 'wedding photography'],
      ['event photographer', 'event photography'],
    ]),
    ...role(2, 'illustrator', [['illustrator', 'illustration'], ['artist', 'art']]),
    ...role(2, 'developer', [
      ['developer', 'development'],
      ['engineer', 'engineering'],
      ['programmer', 'software'],
    ]),
    ...role(2, 'architect', [['architect', 'architecture']]),
    ...role(2, 'writer', [
      ['writer', 'writing'],
      ['copywriter', 'copywriting'],
      ['journalist', 'journalism'],
    ]),
    ...role(2, 'filmmaker', [
      ['filmmaker', 'film'],
      ['videographer', 'video'],
      ['animator', 'animation'],
      ['motion designer', 'motion design'],
    ]),
    ...role(2, 'designer', [['designer', 'design']]),
  ],
  studio: [
    ...term(3, 'agency', 'design studio', 'creative studio', 'consultancy', 'collective', 'firm'),
    ...term(2, 'studio', 'consulting'),
    ...term(1, 'branding', 'practice'),
  ],
  writing: [
    ...site(3, 'blog', 'newsletter', 'publication', 'magazine', 'journal', 'podcast', 'docs', 'documentation', 'changelog', 'handbook', 'knowledge base'),
    ...site(1, 'writing', 'articles', 'essays'),
  ],
  event: [
    ...role(3, 'wedding', [['wedding'], ['wedding day']]),
    ...term(3, 'conference', 'meetup', 'workshop', 'summit', 'festival', 'retreat', 'webinar', 'hackathon', 'gala', 'event'),
  ],
  store: [
    ...site(3, 'shop', 'store', 'online store', 'online shop', 'ecommerce', 'e-commerce'),
    ...term(1, 'brand', 'product line', 'clothing', 'furniture', 'ceramics', 'skincare', 'jewellery', 'jewelry', 'candles', 'roaster', 'merch', 'prints'),
  ],
  local: [
    ...role(3, 'food', [
      ['restaurant'], ['cafe'], ['café'], ['coffee shop'], ['bakery'], ['bistro'], ['pizzeria'],
      ['diner'], ['food truck'], ['pub'], ['cocktail bar'], ['wine bar'], ['bar and grill'], ['brewery'],
    ]),
    ...role(1, 'food', [['bar'], ['menu']]),
    ...role(3, 'care', [
      ['salon'], ['hair salon'], ['nail salon'], ['barber'], ['barbershop'], ['spa'], ['dentist'],
      ['dental'], ['clinic'], ['physio'], ['physiotherapy'], ['chiropractor'], ['vet'], ['veterinary'],
      ['massage'], ['therapist'], ['tattoo studio'], ['tattoo'],
    ]),
    ...role(3, 'trade', [
      ['plumber'], ['plumbing'], ['electrician'], ['roofer'], ['roofing'], ['contractor'],
      ['landscaping'], ['cleaning service'], ['cleaners'], ['mechanic'], ['auto repair'], ['handyman'],
    ]),
    ...role(3, 'fitness', [
      ['gym'], ['fitness studio'], ['yoga studio'], ['pilates studio'], ['dance studio'], ['yoga'],
      ['pilates'], ['crossfit'], ['climbing gym'],
    ]),
    ...term(3, 'florist', 'hotel', 'bed and breakfast', 'daycare', 'tutoring', 'driving school', 'real estate', 'accountant'),
  ],
};

/**
 * Tie-break order, most common ask first.
 *
 * A local business sits ahead of a studio and a shop because the collisions
 * go its way: a "real estate agency" is somewhere you walk into, and a "coffee
 * shop" is not an online store.
 */
const KIND_ORDER: readonly BriefKind[] = [
  'product',
  'portfolio',
  'local',
  'studio',
  'store',
  'writing',
  'event',
];

const TONE_WORDS: Record<BriefTone, readonly string[]> = {
  precise: ['minimal', 'technical', 'clean', 'precise', 'simple', 'developer', 'engineering', 'sharp'],
  editorial: ['editorial', 'magazine', 'elegant', 'refined', 'classic', 'literary', 'serif', 'archive'],
  warm: ['warm', 'friendly', 'cosy', 'cozy', 'welcoming', 'handmade', 'craft', 'organic', 'soft'],
  bold: ['bold', 'loud', 'striking', 'confident', 'punchy', 'energetic', 'vivid', 'brutalist'],
  quiet: ['quiet', 'calm', 'understated', 'restrained', 'muted', 'subtle', 'serene'],
};

const TONE_ORDER: readonly BriefTone[] = ['precise', 'editorial', 'warm', 'bold', 'quiet'];

/** Acronyms that turn up capitalised in a brief and are never what it is called. */
const ACRONYMS = ['ai', 'saas', 'crm', 'api', 'sdk', 'ux', 'ui', 'b2b', 'b2c', 'seo', 'erp', 'hr', 'it', 'mvp', 'diy', 'llm', 'cv'];

/**
 * Words that are never a brand name.
 *
 * The name extractor looks for a capitalised word, which in a sentence typed
 * into a text box is usually either the brand or the first word. This is what
 * stops "Portfolio for a photographer" becoming a company called Portfolio.
 */
const NOT_A_NAME = new Set([
  ...Object.values(KIND_TERMS).flatMap((terms) => terms.flatMap((entry) => entry.phrase.split(' '))),
  ...Object.values(TONE_WORDS).flat(),
  ...ACRONYMS,
  'a',
  'an',
  'and',
  'build',
  'create',
  'for',
  'i',
  'make',
  'me',
  'my',
  'need',
  'our',
  'page',
  'site',
  'the',
  'want',
  'we',
  'website',
  'with',
  // Sentence starters. The first word of a brief is capitalised because it is
  // first, and these are the ones that are never somebody's brand.
  'help',
  'please',
  'hey',
  'hi',
  'just',
  'something',
  'quick',
  'basic',
  'generate',
  'design',
  'give',
  'write',
  'can',
  'could',
  'you',
  'it',
  'one',
  'some',
]);

/**
 * Capitalised words that follow "in" without being a place.
 *
 * "A conference in March" and "a portfolio built in React" both have the
 * shape of a location, and neither is one.
 */
const NOT_A_PLACE = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'spring', 'summer', 'autumn', 'fall', 'winter',
  'english', 'french', 'spanish', 'german', 'italian', 'portuguese', 'japanese', 'chinese',
  'react', 'next', 'vue', 'svelte', 'astro', 'tailwind', 'typescript', 'javascript', 'figma',
  'webflow', 'framer', 'wordpress', 'shopify', 'zory',
]);

/**
 * Words that are not part of what somebody's thing is, even beside it.
 *
 * The subject is read as the vocabulary word plus the words just before it —
 * "wedding photographer", "plumbing business" — and this is where that walk
 * stops, so "my happy little bakery" is a bakery.
 */
const NOT_A_MODIFIER = new Set([
  ...Object.values(KIND_TERMS).flatMap((terms) =>
    terms.filter((entry) => entry.site).map((entry) => entry.phrase.split(' ').pop()!),
  ),
  'minimal', 'simple', 'clean', 'precise', 'sharp', 'elegant', 'refined', 'editorial', 'warm',
  'friendly', 'cosy', 'cozy', 'welcoming', 'soft', 'bold', 'loud', 'striking', 'confident',
  'punchy', 'energetic', 'vivid', 'brutalist', 'quiet', 'calm', 'understated', 'restrained',
  'muted', 'subtle', 'serene',
  'a', 'an', 'and', 'the', 'for', 'with', 'my', 'our', 'we', 'i', 'me', 'build', 'create', 'make',
  'need', 'want', 'site', 'website', 'page', 'called', 'named',
  'his', 'her', 'their', 'your', 'of', 'in', 'on', 'at', 'to', 'or', 'by', 'from', 'about',
  'web', 'online', 'new', 'little', 'small', 'nice', 'cool', 'beautiful', 'modern', 'great',
  'best', 'good', 'lovely', 'happy', 'local', 'professional', 'personal', 'is', 'that', 'this',
]);

/** Nouns that belong to the subject when they follow it: "plumbing *business*". */
const SUBJECT_TAIL = new Set([
  'business', 'company', 'shop', 'studio', 'clinic', 'practice', 'service', 'services',
  'salon', 'agency', 'firm', 'store', 'bar', 'team', 'co',
]);

/** Cap on what is read. A brief is a sentence; a novel is a different feature. */
const PROMPT_MAX = 280;

/** Cap on a composed name, so nav bars and browser tabs stay sane. */
const NAME_MAX = 32;

function normalise(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ').slice(0, PROMPT_MAX);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A whole-word, case-insensitive matcher for a phrase. */
function wordPattern(phrase: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'giu');
}

interface Hit {
  kind: BriefKind;
  term: Term;
  start: number;
  end: number;
}

/** Every vocabulary term in the sentence, longest first, each span used once. */
const TERM_LIST: readonly { kind: BriefKind; term: Term; pattern: RegExp }[] = KIND_ORDER.flatMap((kind) =>
  KIND_TERMS[kind].map((entry) => ({ kind, term: entry, pattern: wordPattern(entry.phrase) })),
).sort((a, b) => b.term.phrase.length - a.term.phrase.length);

function findHits(text: string): Hit[] {
  const taken = new Uint8Array(text.length);
  const hits: Hit[] = [];

  for (const { kind, term: entry, pattern } of TERM_LIST) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (taken.subarray(start, end).some((flag) => flag === 1)) continue;
      taken.fill(1, start, end);
      hits.push({ kind, term: entry, start, end });
    }
  }

  return hits.sort((a, b) => a.start - b.start);
}

/**
 * The parts of a sentence that describe something other than the site.
 *
 * Everything after "with" lists features, "called …" is a name, and "about …"
 * is a topic. "A newsletter about SaaS pricing" is a newsletter, and "a landing
 * page with a search bar" is not a bar. Terms in a feature or name clause do
 * not count at all; terms in a topic count for a third, which is still enough
 * to recognise "a blog about my bakery" when nothing else matched.
 */
interface Zones {
  features: number;
  topic: [number, number] | null;
  names: [number, number][];
}

const CLAUSE_END = /\s+(?:with|featuring|that has|including|offering|called|named|for|in|based in)\b|[,.!?]/i;

function readZones(text: string): Zones {
  const feature = /\s(?:with|featuring|that has|including|offering)\s/i.exec(text);

  let topic: [number, number] | null = null;
  const about = /\babout\s+/i.exec(text);
  if (about) {
    const from = about.index + about[0].length;
    const rest = CLAUSE_END.exec(text.slice(from));
    topic = [about.index, rest ? from + rest.index : text.length];
  }

  const names: [number, number][] = [];
  for (const match of text.matchAll(/\b(?:called|named)\s+((?:\S+\s*){1,3})/gi)) {
    names.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }

  return { features: feature ? feature.index : text.length, topic, names };
}

function zoneFactor(zones: Zones, hit: Hit): number {
  if (hit.start >= zones.features) return 0;
  if (zones.names.some(([start, end]) => hit.start >= start && hit.start < end)) return 0;
  if (zones.topic && hit.start >= zones.topic[0] && hit.start < zones.topic[1]) return 1 / 3;
  return 1;
}

/**
 * Scores each kind by the weight of its words, and takes the best.
 *
 * A kind the sentence named as the website itself gets half a point more,
 * which only ever decides a tie: "docs for our API" is documentation about
 * an API, and "an online store for my bakery" is a store.
 */
function readKind(hits: Hit[], zones: Zones): { kind: BriefKind; recognised: boolean } {
  const scores = new Map<BriefKind, number>();
  const named = new Set<BriefKind>();
  for (const hit of hits) {
    const factor = zoneFactor(zones, hit);
    if (factor === 0) continue;
    scores.set(hit.kind, (scores.get(hit.kind) ?? 0) + hit.term.weight * factor);
    if (hit.term.site && factor === 1) named.add(hit.kind);
  }
  for (const kind of named) scores.set(kind, (scores.get(kind) ?? 0) + 0.5);

  let best: BriefKind = 'product';
  let bestScore = 0;
  for (const kind of KIND_ORDER) {
    const score = scores.get(kind) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = kind;
    }
  }

  return { kind: best, recognised: bestScore > 0 };
}

function readTone(text: string): BriefTone {
  let best: BriefTone = 'precise';
  let bestScore = 0;

  for (const tone of TONE_ORDER) {
    let score = 0;
    for (const word of TONE_WORDS[tone]) {
      if (wordPattern(word).test(text)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = tone;
    }
  }

  return best;
}

/** Title-cases a word, leaving an already-capitalised acronym alone. */
function titleCase(word: string): string {
  if (word.length > 1 && word === word.toUpperCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Where it is.
 *
 * A capitalised run after "in", "based in", "from" or "serving", unless the
 * run is a month, a language or a framework.
 */
function readPlace(prompt: string): { place: string; start: number; end: number } | null {
  const pattern = /\b(?:in|based in|located in|from|serving)\s+([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,2})/gu;
  for (const match of prompt.matchAll(pattern)) {
    const place = match[1]!;
    const first = place.split(' ')[0]!.toLowerCase().replace(/[.'’-].*$/, '');
    if (NOT_A_PLACE.has(first) || NOT_A_NAME.has(first)) continue;
    const start = (match.index ?? 0) + match[0].length - place.length;
    return { place, start, end: start + place.length };
  }
  return null;
}

/**
 * What the thing is called.
 *
 * Four passes, most explicit first: a quoted string, then an explicit naming
 * phrase ("called Foo", "named Foo"), then a capitalised brand after "for",
 * then the first capitalised word that is not vocabulary and not a place.
 * Falls back to a name derived from the kind, because a nav bar with an empty
 * brand slot is worse than a generic one.
 */
function readName(prompt: string, fallback: string, place: { start: number; end: number } | null): string {
  const quoted = /["“'']([^"”'']{2,32})["”'']/.exec(prompt);
  if (quoted?.[1]) return clampName(quoted[1]);

  const called = /\b(?:called|named)\s+(.+)$/i.exec(prompt);
  if (called?.[1]) {
    const words: string[] = [];
    for (const word of called[1].split(/\s+/)) {
      const bare = word.replace(/[,.!?;:]+$/, '');
      if (/^(?:in|for|with|and|that|which|based|from|to|at|on|by)$/i.test(bare)) break;
      if (bare !== '') words.push(bare);
      if (words.length === 3 || bare !== word) break;
    }
    if (words.length > 0) return clampName(words.join(' '));
  }

  const inPlace = (index: number): boolean => place !== null && index >= place.start && index < place.end;

  const forBrand = /\b(?:for|about)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)?)/.exec(prompt);
  if (forBrand?.[1] && !NOT_A_NAME.has(forBrand[1].toLowerCase()) && !inPlace(forBrand.index + forBrand[0].length - forBrand[1].length)) {
    return clampName(forBrand[1]);
  }

  for (const match of prompt.matchAll(/[^\s,]+/g)) {
    const bare = match[0].replace(/[^\w&.'-]/g, '');
    if (bare.length < 2) continue;
    if (NOT_A_NAME.has(bare.toLowerCase())) continue;
    if (!/^[A-Z]/.test(bare)) continue;
    if (inPlace(match.index ?? 0)) continue;
    return clampName(bare);
  }

  return fallback;
}

function clampName(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
  return cleaned
    .split(' ')
    .map((word) => titleCase(word))
    .join(' ');
}

const DEFAULT_NAME: Record<BriefKind, string> = {
  product: 'Northpoint',
  portfolio: 'Selected Work',
  studio: 'Ardent',
  writing: 'The Margin',
  event: 'Assembly',
  store: 'Wilder Goods',
  local: 'Corner House',
};

/**
 * The noun a subject is built around, for the kind the sentence was read as.
 *
 * The rightmost term of that kind that names a thing rather than the website,
 * outside the feature, name and topic clauses. Rightmost, because English puts
 * the head noun last: in "dental clinic" the clinic is the thing.
 */
function anchorOf(hits: Hit[], zones: Zones, kind: BriefKind): Hit | null {
  let anchor: Hit | null = null;
  for (const hit of hits) {
    if (hit.kind !== kind || hit.term.site) continue;
    if (zoneFactor(zones, hit) !== 1) continue;
    anchor = hit;
  }
  return anchor;
}

/** The words of a sentence with where each one starts. */
function wordsOf(prompt: string): { word: string; start: number; end: number }[] {
  return [...prompt.matchAll(/[^\s]+/g)].map((match) => ({
    word: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

/**
 * What the site is about, as a noun phrase that can sit in a sentence.
 *
 * The anchor term, the words just before it that qualify it ("wedding",
 * "frontend", "small-batch coffee"), and a following noun that completes it
 * ("plumbing business"). Pulled from the brief where the brief says it, so
 * the composed copy uses the visitor's own words rather than ours.
 */
function readSubject(prompt: string, anchor: Hit | null, name: string): { subject: string; end: number } | null {
  if (!anchor) return null;

  const words = wordsOf(prompt);
  const inside = words.filter((entry) => entry.start >= anchor.start && entry.end <= anchor.end);
  if (inside.length === 0) return null;
  const firstIndex = words.indexOf(inside[0]!);
  let lastIndex = words.indexOf(inside[inside.length - 1]!);

  const lead: string[] = [];
  for (let index = firstIndex - 1; index >= 0 && lead.length < 2; index -= 1) {
    const word = words[index]!.word;
    const lower = word.toLowerCase();
    if (/[,.!?;:]$/.test(word)) break;
    if (NOT_A_MODIFIER.has(lower)) break;
    if (lower === name.toLowerCase()) break;
    if (/^[A-Z][a-z]/.test(word)) break;
    lead.unshift(word);
  }

  const next = words[lastIndex + 1];
  const tail = next?.word.toLowerCase().replace(/[,.!?;:]+$/, '');
  if (next && tail && SUBJECT_TAIL.has(tail) && !inside.some((entry) => entry.word.toLowerCase() === tail)) {
    lastIndex += 1;
  }

  const phrase = [...lead, ...words.slice(firstIndex, lastIndex + 1).map((entry) => entry.word)]
    .join(' ')
    .replace(/[,.!?;:]+$/, '');

  return { subject: phrase, end: words[lastIndex]!.end };
}

/** "for freelancers", read off whatever follows the subject. */
function readAudience(prompt: string, from: number): string | null {
  const match = /^\s+for\s+(?:a |an |my |our |the )?([\p{L}\p{N}][\p{L}\p{N}' -]{1,40}?)(?=\s+(?:to|that|which|who|with|called|named|in|so|and)\b|[,.!?]|$)/iu.exec(
    prompt.slice(from),
  );
  return match?.[1]?.trim() ?? null;
}

/** "about the craft of software", when there is one. */
function readTopic(prompt: string): string | null {
  const match = /\babout\s+(.{3,60}?)(?=\s+(?:called|named|with|featuring|for|in|based in)\b|[,.!?]|$)/i.exec(prompt);
  return match?.[1]?.trim() ?? null;
}

/**
 * The for-phrase fallback, for sentences whose subject is not vocabulary.
 *
 * "a site for my grandmother's quilts" has no term to anchor on, and the
 * visitor's own words are still better than a default.
 */
function looseSubject(prompt: string, place: string | null): string | null {
  const forPhrase = /\bfor\s+(?:a|an|my|our)\s+([a-z][\w\s'-]{2,40})/i.exec(prompt);
  if (!forPhrase?.[1]) return null;
  let subject = forPhrase[1]
    .split(/\s+(?:called|named|with|featuring|that|which|including|offering|in|based)\b/i)[0]!
    .trim()
    .replace(/\s+(?:and|or|for|of)$/i, '');
  if (place) subject = subject.replace(new RegExp(`\\s+${escapeRegExp(place)}$`), '');
  const words = subject.split(' ');
  return words.every((word) => NOT_A_MODIFIER.has(word.toLowerCase())) ? null : subject;
}

const DEFAULT_SUBJECT: Record<BriefKind, string> = {
  product: 'software for small teams',
  portfolio: 'independent designer',
  studio: 'small studio',
  writing: 'publication',
  event: 'gathering',
  store: 'small-batch maker',
  local: 'local business',
};

/**
 * Capability phrases.
 *
 * Everything after a "with" or "that has" marker, split on commas and "and".
 * Capped at four because a feature grid with nine cells is a list, and a list
 * wants a different component than a grid does.
 */
function readFeatures(prompt: string): string[] {
  const marker = /\b(?:with|featuring|that has|including|offering)\s+(.+)$/i.exec(prompt);
  if (!marker?.[1]) return [];

  return marker[1]
    .split(/,|\band\b|\bplus\b/i)
    .map((part) => part.trim().replace(/[.!?]+$/, ''))
    .filter((part) => part.length > 2 && part.length < 60)
    .slice(0, 4)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
}

/**
 * Reads a sentence into a brief.
 *
 * Total, by construction: every string produces a brief, including the empty
 * one. A parser that can refuse is a parser the UI has to have an error state
 * for, and there is nothing useful to say in that error state beyond what the
 * defaults already do.
 */
export function readBrief(prompt: string): Brief {
  const cleaned = normalise(prompt);
  const hits = findHits(cleaned);
  const zones = readZones(cleaned);
  const { kind, recognised } = readKind(hits, zones);
  const place = readPlace(cleaned);
  const anchor = anchorOf(hits, zones, kind);
  const name = readName(cleaned, anchor?.term.role === 'wedding' ? 'Sam and Alex' : DEFAULT_NAME[kind], place);
  const read = readSubject(cleaned, anchor, name);

  return {
    kind,
    tone: readTone(cleaned),
    name,
    subject: read?.subject ?? looseSubject(cleaned, place?.place ?? null) ?? DEFAULT_SUBJECT[kind],
    audience: read ? readAudience(cleaned, read.end) : null,
    topic: readTopic(cleaned),
    place: place?.place ?? null,
    features: readFeatures(cleaned),
    prompt: cleaned,
    recognised: recognised && cleaned.length > 0,
  };
}

/**
 * The role a brief's copy is written for.
 *
 * Read from the sentence each time rather than stored on the brief, because
 * the kind can be changed after reading: somebody who switches "a restaurant"
 * from Local to Shop should get a shop's general copy, not a restaurant's.
 */
export function roleOf(brief: Brief): { role: BriefRole; practice: string | null } {
  const hits = findHits(brief.prompt);
  const zones = readZones(brief.prompt);
  const anchor = anchorOf(hits, zones, brief.kind);
  if (!anchor?.term.role) return { role: 'general', practice: null };

  const practice = anchor.term.practice
    ? brief.subject
        .replace(wordPattern(anchor.term.phrase), anchor.term.practice)
        .replace(/^(?:independent|freelance)\s+/i, '')
    : null;

  return { role: anchor.term.role, practice };
}

/* ================================================================== compose */

/**
 * The five palettes, one per tone.
 *
 * Each is a whole system rather than a hue: ground, surface, ink, muted,
 * accent, the text that sits on the accent, and a border. They are deliberately
 * not the catalogue's palettes — a composed project should not look like a
 * template somebody will recognise, it should look like a starting point.
 */
const TONES: Record<BriefTone, { theme: ProjectTheme; radius: string }> = {
  precise: {
    theme: theme(
      {
        background: '#ffffff',
        surface: '#f6f7f9',
        text: '#0d1117',
        textMuted: '#5b6472',
        accent: '#1c56d6',
        accentText: '#ffffff',
        border: '#e3e6ec',
      },
      FACES.grotesque,
    ),
    radius: '8px',
  },
  editorial: {
    theme: theme(
      {
        background: '#fbfaf7',
        surface: '#f2f0ea',
        text: '#16150f',
        textMuted: '#5f5b4e',
        accent: '#1f4d3d',
        accentText: '#fbfaf7',
        border: '#dedacd',
      },
      FACES.editorial,
    ),
    radius: '2px',
  },
  warm: {
    theme: theme(
      {
        background: '#fffdf9',
        surface: '#f6efe4',
        text: '#231a12',
        textMuted: '#6b5b4a',
        accent: '#b4471f',
        accentText: '#fffdf9',
        border: '#e6dccc',
      },
      FACES.geometric,
    ),
    radius: '14px',
  },
  bold: {
    theme: theme(
      {
        background: '#0c0c0d',
        surface: '#161618',
        text: '#f5f5f4',
        textMuted: '#a2a2a0',
        accent: '#d6ff3f',
        accentText: '#0c0c0d',
        border: '#26262a',
      },
      FACES.condensed,
    ),
    radius: '4px',
  },
  quiet: {
    theme: theme(
      {
        background: '#f8f8f7',
        surface: '#eeeeec',
        text: '#1b1c1b',
        textMuted: '#63665f',
        accent: '#3f5c4c',
        accentText: '#f8f8f7',
        border: '#dededa',
      },
      FACES.grotesque,
    ),
    radius: '6px',
  },
};

/* ==================================================================== copy */

/**
 * The rule every line below keeps.
 *
 * A composed page is somebody's own business with our words on it, and they
 * may publish it before they have read all of them. So a line may be generic,
 * and it may be a placeholder that is obviously theirs to fill, but it may not
 * be untrue of the thing the sentence described. That is why there are no
 * uptime percentages, no shipping policies and no "free while you are
 * building" here: none of them are ours to promise on somebody's behalf.
 */

/** "a" or "an", by how the next word sounds rather than how it is spelled. */
function article(phrase: string): 'a' | 'an' {
  const word = phrase.trim().split(/\s+/)[0] ?? '';
  // An acronym is read letter by letter: an AI tool, an SEO agency, a CRM.
  if (/^[A-Z0-9]{2,}$/.test(word)) return /^[AEFHILMNORSX8]/.test(word) ? 'an' : 'a';
  const lower = word.toLowerCase();
  if (/^(?:hour|honest|hono)/.test(lower)) return 'an';
  if (/^(?:uni|use|usu|uti|ure|euro|one\b|once)/.test(lower)) return 'a';
  return /^[aeiou]/.test(lower) ? 'an' : 'a';
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether a phrase's head noun is plural, and so takes no article. */
function isPlural(phrase: string): boolean {
  const head = (phrase.trim().split(/\s+/).pop() ?? '').toLowerCase();
  return head.length > 3 && /s$/.test(head) && !/(?:ss|us|is)$/.test(head);
}

/** "A wedding photographer", with the article the phrase needs, or none. */
function described(phrase: string): string {
  return capitalise(isPlural(phrase) ? phrase : `${article(phrase)} ${phrase}`);
}

/** " in Montreal", or nothing. */
function placed(brief: Brief): string {
  return brief.place ? ` in ${brief.place}` : '';
}

/** Whether the subject came from the sentence rather than from a default. */
function ownSubject(brief: Brief): boolean {
  return !Object.values(DEFAULT_SUBJECT).includes(brief.subject);
}

/** The first sentence of a lede, short enough for a footer, cut on a word. */
function tagline(lede: string): string {
  const first = lede.split(/(?<=[.!?])\s/)[0] ?? lede;
  if (first.length <= 64) return first;
  return `${first.slice(0, 64).replace(/\s+\S*$/, '')}…`;
}

type Cell = { title: string; body: string };
type WorkRow = { title: string; discipline: string; year: string };

interface Copy {
  eyebrow?: string;
  title: string;
  lede: string;
  primary: string;
  secondary: string;
  closing: string;
}

/* ---------------------------------------------------------------- product */

const PRODUCT_CELLS: Cell[] = [
  { title: 'Set up in an afternoon', body: 'No migration, no long onboarding call, no implementation fee.' },
  { title: 'Works with what you use', body: 'Reads from the tools your team already keeps open all day.' },
  { title: 'Priced for one team', body: 'One number, billed monthly. Cancel from the settings page.' },
];

function productCopy(brief: Brief): Copy {
  const thing = ownSubject(brief) ? described(brief.subject) : capitalise(DEFAULT_SUBJECT.product);
  const audience = brief.audience ? ` for ${brief.audience}` : '';
  return {
    title: `${brief.name} does the part nobody wants to do.`,
    lede: `${thing}${audience}, without the six-week rollout.`,
    primary: 'Start free',
    secondary: 'See pricing',
    closing: 'Try it on your own data',
  };
}

/* -------------------------------------------------------------- portfolio */

const PORTFOLIO: Record<
  'general' | 'photographer' | 'illustrator' | 'developer' | 'architect' | 'writer' | 'filmmaker' | 'designer',
  { lede: string; work: WorkRow[]; how: string; primary: string; closing: string }
> = {
  general: {
    lede: 'What I make, who I have made it for, and how to reach me.',
    work: [
      { title: 'Northlight', discipline: 'Project', year: '2026' },
      { title: 'Field notes', discipline: 'Writing', year: '2025' },
      { title: 'Small tools', discipline: 'Side project', year: '2025' },
      { title: 'On finishing things', discipline: 'Talk', year: '2024' },
    ],
    how: 'I take on a few projects at a time, and I prefer to be involved early.',
    primary: 'Get in touch',
    closing: 'Got something in mind?',
  },
  photographer: {
    lede: 'Recent work, how a shoot runs, and how to book a date.',
    work: [
      { title: 'Harbour, first light', discipline: 'Commission', year: '2026' },
      { title: 'The long table', discipline: 'Editorial', year: '2025' },
      { title: 'Two winters', discipline: 'Personal series', year: '2025' },
      { title: 'Studio portraits', discipline: 'Commission', year: '2024' },
    ],
    how: 'Every booking starts with a conversation about what matters to you, and ends with a gallery you can share.',
    primary: 'Check a date',
    closing: 'Tell me what you have in mind',
  },
  illustrator: {
    lede: 'Recent commissions, how a project runs, and how to start one.',
    work: [
      { title: 'The Salt Road', discipline: 'Book cover', year: '2026' },
      { title: 'Field guide', discipline: 'Editorial', year: '2025' },
      { title: 'Night market', discipline: 'Packaging', year: '2025' },
      { title: 'Small hours', discipline: 'Personal', year: '2024' },
    ],
    how: 'Commissions start with a short brief and a round of sketches, so the direction is agreed before anything is finished.',
    primary: 'Get in touch',
    closing: 'Got something in mind?',
  },
  developer: {
    lede: 'Things I have built, what I work with, and how to reach me.',
    work: [
      { title: 'Ledger sync', discipline: 'Open source', year: '2026' },
      { title: 'Checkout rebuild', discipline: 'Client work', year: '2025' },
      { title: 'Type-safe forms', discipline: 'Library', year: '2025' },
      { title: 'Shipping small', discipline: 'Talk', year: '2024' },
    ],
    how: 'I work best on small teams, close to the people using what I build, and I write the tests as I go.',
    primary: 'Get in touch',
    closing: 'Building something?',
  },
  architect: {
    lede: 'Selected projects, how the practice works, and how to start a conversation.',
    work: [
      { title: 'House on the ridge', discipline: 'Residential', year: '2026' },
      { title: 'Library extension', discipline: 'Civic', year: '2025' },
      { title: 'Warehouse studio', discipline: 'Interior', year: '2025' },
      { title: 'Garden room', discipline: 'Residential', year: '2024' },
    ],
    how: 'Each project starts on site, with the brief, the budget and the light, before anything is drawn.',
    primary: 'Start a conversation',
    closing: 'Planning something?',
  },
  writer: {
    lede: 'Recent writing, the work I take on, and how to commission it.',
    work: [
      { title: 'The quiet economy', discipline: 'Feature', year: '2026' },
      { title: 'Why the map is wrong', discipline: 'Essay', year: '2025' },
      { title: 'Voice and tone guide', discipline: 'Brand', year: '2025' },
      { title: 'Annual report', discipline: 'Copywriting', year: '2024' },
    ],
    how: 'A piece starts with a conversation and an outline, so the argument is agreed before the words are.',
    primary: 'Commission a piece',
    closing: 'Need something written?',
  },
  filmmaker: {
    lede: 'Recent films, how a production runs, and how to start one.',
    work: [
      { title: 'Low Tide', discipline: 'Short film', year: '2026' },
      { title: 'Field notes', discipline: 'Documentary', year: '2025' },
      { title: 'Autumn range', discipline: 'Commercial', year: '2025' },
      { title: 'Glass', discipline: 'Music video', year: '2024' },
    ],
    how: 'A project runs from treatment to edit with the same small crew, so the idea survives the production.',
    primary: 'Get in touch',
    closing: 'Got a story to tell?',
  },
  designer: {
    lede: 'Selected projects, how I work, and how to start one.',
    work: [
      { title: 'Ferrous', discipline: 'Product design', year: '2026' },
      { title: 'Halden Press', discipline: 'Identity', year: '2025' },
      { title: 'Ninth Street', discipline: 'Art direction', year: '2025' },
      { title: 'Coastal Radio', discipline: 'Web', year: '2024' },
    ],
    how: 'Small engagements, usually four to eight weeks. I prefer to start before the brief is finished.',
    primary: 'Get in touch',
    closing: 'Got something in mind?',
  },
};

const WEDDING_WORK: WorkRow[] = [
  { title: 'Amélie and Jonah', discipline: 'Wedding', year: '2026' },
  { title: 'Priya and Sam', discipline: 'Wedding', year: '2025' },
  { title: 'Hannah and Theo', discipline: 'Elopement', year: '2025' },
  { title: 'Lucia and Marco', discipline: 'Wedding', year: '2024' },
];

function portfolioRole(brief: Brief): { entry: (typeof PORTFOLIO)['general']; practice: string | null; key: keyof typeof PORTFOLIO } {
  const { role, practice } = roleOf(brief);
  const key = role in PORTFOLIO ? (role as keyof typeof PORTFOLIO) : 'general';
  return { entry: PORTFOLIO[key], practice: key === 'general' ? null : practice, key };
}

function portfolioCopy(brief: Brief): Copy {
  const { entry, practice } = portfolioRole(brief);
  const title = practice
    ? `${brief.name}. ${capitalise(practice)}${placed(brief)}.`
    : `${brief.name}. Things I have made.`;
  const lede = ownSubject(brief) ? `${described(brief.subject)}${placed(brief)}. ${entry.lede}` : entry.lede;
  return { title, lede, primary: entry.primary, secondary: 'See the work', closing: entry.closing };
}

/* ----------------------------------------------------------------- studio */

const STUDIO_DESIGN_CELLS: Cell[] = [
  { title: 'Strategy', body: 'Positioning, naming, and the argument the work has to make.' },
  { title: 'Identity', body: 'Marks, type systems, and the rules that keep them consistent.' },
  { title: 'Digital', body: 'Sites and product surfaces, designed and built in one place.' },
];

const STUDIO_CELLS: Cell[] = [
  { title: 'What we do', body: 'The services we offer, and the kind of project each one suits.' },
  { title: 'Recent work', body: 'A few projects, and what changed because of them.' },
  { title: 'How we work', body: 'From the first call to handover, and who you will be working with.' },
];

function isDesignStudio(brief: Brief): boolean {
  return /\b(?:brand|branding|design|creative|identity)\b/i.test(brief.subject);
}

function studioCopy(brief: Brief): Copy {
  const who = ownSubject(brief) ? described(brief.subject) : capitalise(`${article(DEFAULT_SUBJECT.studio)} ${DEFAULT_SUBJECT.studio}`);
  return isDesignStudio(brief)
    ? {
        title: `${brief.name} builds the argument, then the brand.`,
        lede: `${who}${placed(brief)} working with founders on identity, positioning, and the site that carries both.`,
        primary: 'Start a project',
        secondary: 'See the work',
        closing: 'Tell us what you are building',
      }
    : {
        title: `${brief.name}. Small team, finished work.`,
        lede: `${who}${placed(brief)}. What we do, who we have done it for, and how to start a project.`,
        primary: 'Start a project',
        secondary: 'See the work',
        closing: 'Tell us what you need',
      };
}

/* ---------------------------------------------------------------- writing */

type Medium = 'newsletter' | 'blog' | 'podcast' | 'docs' | 'publication';

/** Which writing site the sentence asked for, from its own noun. */
function mediumOf(brief: Brief): { medium: Medium; noun: string } {
  const zones = readZones(brief.prompt);
  for (const hit of findHits(brief.prompt)) {
    if (hit.kind !== 'writing' || zoneFactor(zones, hit) === 0) continue;
    const noun = hit.term.phrase;
    if (noun === 'newsletter') return { medium: 'newsletter', noun };
    if (noun === 'blog') return { medium: 'blog', noun };
    if (noun === 'podcast') return { medium: 'podcast', noun };
    if (['docs', 'documentation', 'changelog', 'handbook', 'knowledge base'].includes(noun)) {
      return { medium: 'docs', noun: 'documentation' };
    }
    if (['magazine', 'journal', 'publication'].includes(noun)) return { medium: 'publication', noun };
  }
  return { medium: 'publication', noun: 'publication' };
}

const MEDIUM: Record<Medium, { primary: string; secondary: string; closing: string; list: string; rows: WorkRow[] }> = {
  newsletter: {
    primary: 'Subscribe',
    secondary: 'Read the archive',
    closing: 'Get the next one',
    list: 'Recently',
    rows: [
      { title: 'Starting where everyone skips', discipline: 'Essay', year: 'Aug' },
      { title: 'Three things I got wrong last year', discipline: 'Note', year: 'Aug' },
      { title: 'A short defence of doing less', discipline: 'Essay', year: 'Jul' },
      { title: 'What the numbers actually said', discipline: 'Essay', year: 'Jul' },
    ],
  },
  blog: {
    primary: 'Read the latest',
    secondary: 'Browse the archive',
    closing: 'Read the next one',
    list: 'Recently',
    rows: [
      { title: 'Starting where everyone skips', discipline: 'Post', year: 'Aug' },
      { title: 'Three things I got wrong last year', discipline: 'Note', year: 'Aug' },
      { title: 'A short defence of doing less', discipline: 'Post', year: 'Jul' },
      { title: 'What the numbers actually said', discipline: 'Post', year: 'Jul' },
    ],
  },
  podcast: {
    primary: 'Listen',
    secondary: 'All episodes',
    closing: 'Listen to the next episode',
    list: 'Episodes',
    rows: [
      { title: 'Starting where everyone skips', discipline: 'Episode 12', year: '42 min' },
      { title: 'Three things we got wrong', discipline: 'Episode 11', year: '38 min' },
      { title: 'A short defence of doing less', discipline: 'Episode 10', year: '51 min' },
      { title: 'What the numbers actually said', discipline: 'Episode 9', year: '45 min' },
    ],
  },
  docs: {
    primary: 'Get started',
    secondary: 'Browse the guides',
    closing: 'Start with the quickstart',
    list: 'Guides',
    rows: [
      { title: 'Quickstart', discipline: 'Guide', year: '5 min' },
      { title: 'Core concepts', discipline: 'Guide', year: '12 min' },
      { title: 'Configuration', discipline: 'Reference', year: '8 min' },
      { title: 'Troubleshooting', discipline: 'Guide', year: '6 min' },
    ],
  },
  publication: {
    primary: 'Subscribe',
    secondary: 'Read the archive',
    closing: 'Read the next issue',
    list: 'Recently',
    rows: [
      { title: 'Starting where everyone skips', discipline: 'Feature', year: 'Aug' },
      { title: 'Three things we got wrong last year', discipline: 'Essay', year: 'Aug' },
      { title: 'A short defence of doing less', discipline: 'Essay', year: 'Jul' },
      { title: 'What the numbers actually said', discipline: 'Report', year: 'Jul' },
    ],
  },
};

function writingCopy(brief: Brief): Copy {
  const { medium, noun } = mediumOf(brief);
  const about = brief.topic ? ` about ${brief.topic}` : '';
  const entry = MEDIUM[medium];

  if (medium === 'docs') {
    return {
      title: `${brief.name} documentation.`,
      lede: `Everything you need to set up, use and get the most out of ${brief.name}.`,
      primary: entry.primary,
      secondary: entry.secondary,
      closing: entry.closing,
    };
  }

  const podcast = medium === 'podcast';
  const reach = podcast ? 'free to listen to' : 'free to read';
  return {
    title: podcast ? `${brief.name}. Worth the whole episode.` : `${brief.name}. Written to be read, not skimmed.`,
    lede: `${described(noun)}${about}${placed(brief)}, ${reach} and easy to leave.`,
    primary: entry.primary,
    secondary: entry.secondary,
    closing: entry.closing,
  };
}

/* ------------------------------------------------------------------ event */

function eventCopy(brief: Brief): Copy {
  if (roleOf(brief).role === 'wedding') {
    return {
      eyebrow: 'Save the date',
      title: `${brief.name}. We are getting married.`,
      lede: `Saturday, June 13${placed(brief)}. The day, the venue, and everything you need before you arrive.`,
      primary: 'RSVP',
      secondary: 'The day',
      closing: 'Let us know you are coming',
    };
  }

  const what = ownSubject(brief) ? described(brief.subject) : capitalise(`${article(DEFAULT_SUBJECT.event)} ${DEFAULT_SUBJECT.event}`);
  const audience = brief.audience ? ` for ${brief.audience}` : '';
  return {
    eyebrow: 'March 14 and 15',
    title: `${brief.name}. One room, one programme.`,
    lede: `${what}${audience}${placed(brief)}. The programme, the speakers, and how to get a ticket.`,
    primary: 'Get a ticket',
    secondary: 'See the programme',
    closing: 'Seats are limited',
  };
}

/* ------------------------------------------------------------------ store */

const STORE_CELLS: Cell[] = [
  { title: 'How it is made', body: 'Where each piece comes from, and who makes it.' },
  { title: 'Shipping', body: 'Where we send orders, how long they take, and what it costs.' },
  { title: 'Returns', body: 'How to send something back if it is not right.' },
];

function storeCopy(brief: Brief): Copy {
  const who = ownSubject(brief) ? described(brief.subject) : capitalise(`${article(DEFAULT_SUBJECT.store)} ${DEFAULT_SUBJECT.store}`);
  return {
    title: `${brief.name}. Made properly, in small numbers.`,
    lede: `${who}${placed(brief)}. A short range, chosen carefully and sent out quickly.`,
    primary: 'Shop the range',
    secondary: 'Our story',
    closing: 'Take a look at the range',
  };
}

/* ------------------------------------------------------------------ local */

type LocalRole = 'general' | 'food' | 'care' | 'trade' | 'fitness';

const LOCAL: Record<
  LocalRole,
  { title: string; lede: string; primary: string; secondary: string; closing: string; panel: string; cells: Cell[]; visit: string }
> = {
  general: {
    title: 'Here when you need us.',
    lede: 'What we do, when we are open, and how to reach us.',
    primary: 'Get in touch',
    secondary: 'Find us',
    closing: 'Come and see us',
    panel: 'Opening hours',
    visit: 'Visit',
    cells: [
      { title: 'What we do', body: 'Everything we offer, in plain words, with prices where we can give them.' },
      { title: 'When we are open', body: 'Our regular hours, and any days that are different.' },
      { title: 'How to reach us', body: 'Call, write, or come in. Whichever suits you.' },
    ],
  },
  food: {
    title: 'Come hungry.',
    lede: 'The menu, the opening hours, and how to find us.',
    primary: 'See the menu',
    secondary: 'Find us',
    closing: 'Come and see us',
    panel: 'Menu',
    visit: 'Visit',
    cells: [
      { title: 'The menu', body: 'What we are cooking now, with prices, and what changes with the season.' },
      { title: 'Opening hours', body: 'When the doors are open, and when the kitchen closes.' },
      { title: 'Groups and events', body: 'How to book for a bigger table or a private occasion.' },
    ],
  },
  care: {
    title: 'Book a time that suits you.',
    lede: 'Services, prices, and a time that suits you.',
    primary: 'Book an appointment',
    secondary: 'See services',
    closing: 'Book your next appointment',
    panel: 'Services',
    visit: 'Visit',
    cells: [
      { title: 'Services', body: 'Every treatment we offer, with how long it takes and what it costs.' },
      { title: 'Booking', body: 'Choose a time online, or call and we will find one with you.' },
      { title: 'Your first visit', body: 'What to bring, where to park, and what happens when you arrive.' },
    ],
  },
  trade: {
    title: 'The job done properly.',
    lede: 'What we do, where we work, and how to get a quote.',
    primary: 'Get a quote',
    secondary: 'Call us',
    closing: 'Tell us what needs doing',
    panel: 'Services',
    visit: 'Where we work',
    cells: [
      { title: 'Call-outs', body: 'Tell us what is wrong and when you are free, and we will give you a time.' },
      { title: 'Quotes', body: 'A written price before any work starts, so the bill is not a surprise.' },
      { title: 'Where we work', body: 'The areas we cover, so you know before you call.' },
    ],
  },
  fitness: {
    title: 'Start where you are.',
    lede: 'The timetable, memberships, and how to get started.',
    primary: 'Book a first visit',
    secondary: 'See the timetable',
    closing: 'Come for a first session',
    panel: 'This week',
    visit: 'Visit',
    cells: [
      { title: 'Timetable', body: 'What is on each day, who it suits, and who is teaching.' },
      { title: 'Memberships', body: 'Drop-in, packs and monthly plans, with every price on the page.' },
      { title: 'Getting started', body: 'What to bring to your first session, and when to arrive.' },
    ],
  },
};

function localRole(brief: Brief): LocalRole {
  const { role } = roleOf(brief);
  return role === 'food' || role === 'care' || role === 'trade' || role === 'fitness' ? role : 'general';
}

function localCopy(brief: Brief): Copy {
  const entry = LOCAL[localRole(brief)];
  const who = ownSubject(brief) ? `${described(brief.subject)}${placed(brief)}. ` : brief.place ? `In ${brief.place}. ` : '';
  return {
    title: `${brief.name}. ${entry.title}`,
    lede: `${who}${entry.lede}`,
    primary: entry.primary,
    secondary: entry.secondary,
    closing: entry.closing,
  };
}

/* --------------------------------------------------------------- sections */

function copyFor(brief: Brief): Copy {
  switch (brief.kind) {
    case 'product':
      return productCopy(brief);
    case 'portfolio':
      return portfolioCopy(brief);
    case 'studio':
      return studioCopy(brief);
    case 'writing':
      return writingCopy(brief);
    case 'event':
      return eventCopy(brief);
    case 'store':
      return storeCopy(brief);
    case 'local':
      return localCopy(brief);
  }
}

/*
 * A composed project is one page, and its navigation says so.
 *
 * This used to emit three links per kind — Product, Pricing, Docs — over a
 * single generated page, so the first thing a visitor did with the thing they
 * had just described was click something that went nowhere. The templates in
 * `catalogue/` earn their navigation by having the pages behind it; a page
 * composed from one sentence has not been told enough to write a pricing page
 * that is worth reading, and inventing one would be the filler this catalogue
 * exists not to ship.
 *
 * So the bar carries the brand and the one action, the footer carries the
 * brand and no columns, and everything on screen goes somewhere. Adding a
 * second page is then a real decision somebody makes in the editor rather
 * than a promise the template already broke on their behalf.
 */

/**
 * A section list per kind.
 *
 * Each kind gets a genuinely different page shape, and no kind repeats a
 * layout family twice. This is where the difference between "seven templates"
 * and "one template with seven colour schemes" lives.
 */
function sections(brief: Brief, radius: string): Section[] {
  const { kind, name } = brief;
  const copy = copyFor(brief);
  const named = (fallback: Cell[]): Cell[] =>
    brief.features.length >= 2 ? brief.features.map((title) => ({ title, body: featureBody(title, kind) })) : fallback;

  const closing = cta(
    {
      title: copy.closing,
      lede: 'Everything on this page is editable. Select anything, change it, and export the React when it says what you mean.',
      primary: copy.primary,
      secondary: copy.secondary,
    },
    { radius },
  );

  const foot = footer(name, tagline(copy.lede), []);
  const head = nav(name, [], { cta: copy.primary, radius, current: HOME.path });

  switch (kind) {
    case 'product': {
      const cells = named(PRODUCT_CELLS);
      return [
        head,
        heroSplit(
          { title: copy.title, lede: copy.lede, primary: copy.primary, secondary: copy.secondary },
          mockPanel('Overview', { rows: 5 }),
          { radius },
        ),
        features({ title: 'What it actually does' }, cells, { background: SURFACE, columns: cells.length === 4 ? 2 : 3 }),
        showcase(
          { title: 'One place for the whole team', body: 'Everybody sees the same state, so the update meeting stops being a status report.', bullets: ['Shared by default', 'History on every change', 'Export whenever you want'] },
          mockPanel('Activity', { rows: 6 }),
          { reverse: true },
        ),
        closing,
        foot,
      ];
    }

    case 'portfolio': {
      const { entry, key } = portfolioRole(brief);
      const wedding = key === 'photographer' && /\bwedding/i.test(brief.subject);
      return [
        head,
        heroCentred({ title: copy.title, lede: copy.lede, primary: copy.secondary, secondary: copy.primary }, { radius, scale: 1.1 }),
        workIndex({}, wedding ? WEDDING_WORK : entry.work),
        about({
          title: 'How I work',
          body: entry.how,
          items: [
            { label: 'Based', value: brief.place ?? (key === 'photographer' ? 'Available to travel' : 'Remote') },
            { label: 'Availability', value: 'Taking enquiries' },
            { label: 'Rate', value: 'On request' },
          ],
        }),
        closing,
        foot,
      ];
    }

    case 'studio': {
      const cells = named(isDesignStudio(brief) ? STUDIO_DESIGN_CELLS : STUDIO_CELLS);
      return [
        head,
        heroSplit(
          { title: copy.title, lede: copy.lede, primary: copy.primary, secondary: copy.secondary },
          mockPanel('Recent', { rows: 4 }),
          { radius },
        ),
        features({ title: 'Three things, done properly' }, cells, { background: SURFACE, columns: cells.length === 4 ? 2 : 3 }),
        plates(4, { columns: 2, ratio: '300px' }),
        closing,
        foot,
      ];
    }

    case 'writing': {
      const { medium } = mediumOf(brief);
      const entry = MEDIUM[medium];
      return [
        head,
        heroCentred({ title: copy.title, lede: copy.lede, primary: copy.primary, secondary: copy.secondary }, { radius, scale: 1.05 }),
        workIndex({ title: entry.list }, entry.rows),
        medium === 'docs'
          ? showcase(
              { title: 'Find the answer, not the page', body: 'Every guide is searchable, linkable, and written to be read in order or on its own.', bullets: ['Start in five minutes', 'Examples you can copy', 'A changelog for every release'] },
              mockPanel('Search', { rows: 5 }),
            )
          : showcase(
              { title: 'Free, and staying that way', body: 'No paywall, and no sponsored piece slipped in between two real ones.', bullets: ['Reply to any issue', 'Leave in one click', 'The whole archive, open'] },
              mockPanel('Latest', { rows: 5 }),
            ),
        closing,
        foot,
      ];
    }

    case 'event': {
      if (roleOf(brief).role === 'wedding') {
        return [
          head,
          heroCentred({ eyebrow: copy.eyebrow, title: copy.title, lede: copy.lede, primary: copy.primary, secondary: copy.secondary }, { radius, scale: 1.1 }),
          workIndex({ title: 'The day' }, [
            { title: 'Ceremony', discipline: 'Arrive early', year: '2:00 pm' },
            { title: 'Drinks', discipline: 'Outside', year: '3:30 pm' },
            { title: 'Dinner', discipline: 'Seated', year: '6:00 pm' },
            { title: 'Dancing', discipline: 'Until late', year: '8:30 pm' },
          ]),
          about({
            title: 'Getting there',
            body: 'Where to stay, how to get there, and what to wear. If anything here is unclear, ask us.',
            items: [
              { label: 'Where', value: brief.place ?? 'Venue to be confirmed' },
              { label: 'When', value: 'Saturday, June 13' },
              { label: 'Dress', value: 'Smart, with comfortable shoes' },
            ],
          }),
          closing,
          foot,
        ];
      }
      return [
        head,
        heroCentred({ eyebrow: copy.eyebrow, title: copy.title, lede: copy.lede, primary: copy.primary, secondary: copy.secondary }, { radius, scale: 1.1 }),
        stats([
          { value: '14', label: 'Talks' },
          { value: '6', label: 'Workshops' },
          { value: '180', label: 'Seats' },
        ]),
        workIndex({ title: 'The programme' }, [
          { title: 'Opening: what we got wrong', discipline: 'Talk', year: '09:30' },
          { title: 'Designing for the second year', discipline: 'Talk', year: '11:00' },
          { title: 'Workshop: pricing without guessing', discipline: 'Workshop', year: '14:00' },
          { title: 'Closing panel', discipline: 'Panel', year: '16:30' },
        ]),
        closing,
        foot,
      ];
    }

    case 'store': {
      const cells = named(STORE_CELLS);
      return [
        head,
        heroSplit(
          { title: copy.title, lede: copy.lede, primary: copy.primary, secondary: copy.secondary },
          mockPanel('The range', { rows: 4 }),
          { radius },
        ),
        plates(6, { columns: 3, ratio: '240px' }),
        features({ title: 'How it works' }, cells, { background: SURFACE, columns: cells.length === 4 ? 2 : 3 }),
        closing,
        foot,
      ];
    }

    case 'local': {
      const role = localRole(brief);
      const entry = LOCAL[role];
      const cells = named(entry.cells);
      return [
        head,
        heroSplit(
          { title: copy.title, lede: copy.lede, primary: copy.primary, secondary: copy.secondary },
          mockPanel(entry.panel, { rows: 4 }),
          { radius },
        ),
        features({ title: 'What to know' }, cells, { background: SURFACE, columns: cells.length === 4 ? 2 : 3 }),
        ...(role === 'food' ? [plates(3, { columns: 3, ratio: '260px', subject: brief.subject })] : []),
        about({
          title: entry.visit,
          body: 'Everything you need before you come: where we are, when we are open, and how to reach us.',
          items: [
            { label: role === 'trade' ? 'Area' : 'Where', value: brief.place ?? 'Your address' },
            { label: 'Hours', value: 'Your opening hours' },
            { label: 'Phone', value: 'Your phone number' },
          ],
        }),
        closing,
        foot,
      ];
    }
  }
}

/**
 * A plausible sentence under a feature the visitor named themselves.
 *
 * Only a product can promise that something is "part of the plan"; a
 * restaurant with outdoor seating has no plan to be part of.
 */
function featureBody(title: string, kind: BriefKind): string {
  const named = `${title.charAt(0).toUpperCase()}${title.slice(1)}`;
  return kind === 'product'
    ? `${named} is part of the plan from day one, not an upgrade you find out about later.`
    : `What ${title.charAt(0).toLowerCase()}${title.slice(1)} looks like here, and how to make the most of it.`;
}

/** What the opening bar says, given whether there was a sentence to read. */
function openingLine(brief: Brief): string {
  return brief.prompt === ''
    ? `A ${brief.kind} page to start from.`
    : `Composed from: "${brief.prompt}"`;
}

/**
 * The banner that tells somebody what happened.
 *
 * A composed project opens with one line at the top saying what was read out
 * of the sentence and what to do next. It is an ordinary node, so it selects,
 * edits, and deletes like everything else — and deleting it is the intended
 * second action. A hint that cannot be removed is an advertisement.
 */
function openingNote(brief: Brief): NodeBlueprint {
  return box(
    'Start here',
    {
      tag: 'section',
      base: {
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
        paddingTop: '14px',
        paddingBottom: '14px',
        paddingLeft: '32px',
        paddingRight: '32px',
        backgroundColor: SURFACE,
        borderWidth: '0px 0px 1px 0px',
        borderStyle: 'solid',
        borderColor: BORDER,
      },
    },
    [
      col('Start here copy', '4px', { base: { width: '100%', maxWidth: '1120px' } }, [
        /*
         * Quoting nothing reads as a bug.
         *
         * An empty brief is a normal way to arrive here: somebody who pressed
         * the hero's button without typing, or who cleared the field to start
         * again. `Composed from: ""` is what the naive version printed at them.
         */
        text('Start here title', openingLine(brief), {
          base: { fontFamily: BODY, fontSize: '13px', fontWeight: '600', color: INK },
        }),
        text(
          'Start here body',
          'Click any element to select it, then edit it on the right. Delete this bar when you are done with it.',
          { base: { fontFamily: BODY, fontSize: '13px', color: MUTED } },
        ),
      ]),
    ],
  );
}

/** The page a brief composes to. Exported for tests and for previewing. */
export function composePages(brief: Brief): PageBlueprint[] {
  const { radius } = TONES[brief.tone];
  return [page('Home', '/', [openingNote(brief), ...sections(brief, radius)])];
}

/**
 * Brief to project.
 *
 * Goes through `createProject`, the same constructor the blank project and
 * every catalogue starter use. There is no second path into the graph and this
 * is not the place to invent one.
 */
export function composeProject(brief: Brief): Project {
  const pages = composePages(brief);
  return createProject({
    name: brief.name,
    description: brief.prompt || `A ${brief.kind} site.`,
    theme: TONES[brief.tone].theme,
    pages,
    components: collectComponents(pages),
  });
}

/** The whole path, for callers that only have a sentence. */
export function projectFromPrompt(prompt: string): { brief: Brief; project: Project } {
  const brief = readBrief(prompt);
  return { brief, project: composeProject(brief) };
}

/** The palette a tone will use, so the onboarding can show it before committing. */
export function toneTheme(tone: BriefTone): ProjectTheme {
  return TONES[tone].theme;
}

/** Every tone, in the order the onboarding offers them. */
export const TONE_ORDER_PUBLIC: readonly BriefTone[] = TONE_ORDER;

export const TONE_LABEL: Record<BriefTone, string> = {
  precise: 'Precise',
  editorial: 'Editorial',
  warm: 'Warm',
  bold: 'Bold',
  quiet: 'Quiet',
};

export const TONE_NOTE: Record<BriefTone, string> = {
  precise: 'Neutral grotesque, white ground, one blue signal.',
  editorial: 'A serif that carries the page, set on warm paper.',
  warm: 'Geometric type, soft ground, a burnt orange accent.',
  bold: 'Near-black ground, condensed type, high-visibility accent.',
  quiet: 'Low contrast, muted green, nothing raising its voice.',
};

export const KIND_LABEL: Record<BriefKind, string> = {
  product: 'Product or app',
  portfolio: 'Portfolio',
  studio: 'Studio or agency',
  writing: 'Writing',
  event: 'Event',
  store: 'Shop',
  local: 'Local business',
};

/**
 * Every kind, in the order the onboarding offers them.
 *
 * Not `KIND_ORDER`, which is a tie-break and puts a local business third so
 * that it wins its collisions. On screen it is the newest option and goes last.
 */
export const KIND_ORDER_PUBLIC: readonly BriefKind[] = [
  'product',
  'portfolio',
  'studio',
  'store',
  'writing',
  'event',
  'local',
];

/** Prompts that demonstrate the range without being the same sentence twice. */
export const BRIEF_EXAMPLES: readonly string[] = [
  'a landing page for an invoicing tool for freelancers',
  'a minimal portfolio for an independent product designer',
  'a warm shop for a small-batch coffee roaster',
  'an editorial newsletter about the craft of software',
  'a neighbourhood bakery in Lisbon called Miga',
];

/** Swaps a brief's kind while keeping everything the sentence established. */
export function withKind(brief: Brief, kind: BriefKind): Brief {
  return { ...brief, kind, recognised: true };
}

/** Swaps a brief's tone. Same reasoning as `withKind`. */
export function withTone(brief: Brief, tone: BriefTone): Brief {
  return { ...brief, tone };
}

/** Swaps the name, falling back to the kind's default when cleared. */
export function withName(brief: Brief, name: string): Brief {
  const cleaned = name.trim().slice(0, NAME_MAX);
  return { ...brief, name: cleaned === '' ? DEFAULT_NAME[brief.kind] : cleaned };
}

/* Re-exported so callers styling a preview do not reach into patterns.ts. */
export { ACCENT, BORDER, INK, MUTED, PAGE, SURFACE };
