/**
 * Studio without the editor: what OpenLeads' Sites screen drives directly.
 *
 * Built as its own entry (`/studio/auto.js`) so the app can import Studio's real
 * engines (templates, personalising, the command validator, the static renderer)
 * instead of sending people to another screen. Nothing here owns state: every
 * function takes a project and returns a new one, and saving goes through the
 * same `/api/sites/save` the editor uses, so a site built here opens in Studio
 * exactly as if it had been made there.
 *
 * The model never edits the graph. It proposes Zory commands; each one is
 * validated against the project as the previous ones left it, and only the ones
 * that pass are applied. Anything refused comes back as `skipped`, with why.
 */

import type { Project, ZoryCommand } from '@zory/core';
import { applyCommand, childIdsOf, describeCommand, findNode, migrateProject, validateCommand } from '@zory/core';
import { STARTERS, buildProject, findStarter } from '@/starters';
import type { Starter } from '@/starters';
import { BRAND_NODE } from '@/starters/patterns';
import { personalisedProject } from '@/starters/personalise';
import { generateStaticSite } from '@/core/export/staticHtml';
import { propose as engineProposal } from '@/core/intent/engine';
import { localIntentProvider } from '@/core/intent/localProvider';
import { buildIntentMessages, extractCommands } from '@/core/intent/promptShared';
import { expandProposals } from '@/core/intent/expand';
import { IntentError, type IntentProvider, type SkippedChange } from '@/core/intent/types';

export const ENGINE_VERSION = 1;

/** What OpenLeads knows about a lead (`GET /api/sites/lead`). */
export interface LeadBrief {
  email: string;
  business: string;
  contact: string;
  city: string;
  phone: string;
  website: string;
  industry: string;
  address: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  kind: string;
  category: string;
  swatches: [string, string, string];
}

export interface Change {
  project: Project;
  /** One line per applied change, in plain words. */
  changes: string[];
  skipped: SkippedChange[];
  /** "rules" when Studio's built-in parser understood it, "model" otherwise. */
  by?: 'rules' | 'model';
}

/** Sends a system and user prompt to the connected model; resolves its raw reply. */
export type Ask = (system: string, user: string) => Promise<string>;

export function templates(): TemplateInfo[] {
  return STARTERS.map((s) => ({ id: s.id, name: s.name, kind: s.kind, category: s.category, swatches: s.swatches }));
}

/*
 * Which template suits a business, from words in its industry and name.
 *
 * Ordered: the first rule that matches wins, so narrow trades come before the
 * broad words ("dental clinic" is a dentist, not a therapy practice).
 */
const RULES: [RegExp, string][] = [
  [/dent(al|ist)|orthodon|endodon|periodon|oral surg|\bdds\b/, 'alderwood'],
  [/caf[eé]|coffee|bakery|bakehouse|patisser|bagel|donut|doughnut|tea ?room|cake|pastr/, 'pennyroyal'],
  [/restaurant|bistro|diner|pizz|grill|eatery|trattoria|taverna|sushi|ramen|taco|kitchen|brasserie|steakhouse|bar & |gastro|food|catering|pub\b/, 'cardoon'],
  [/pilates|yoga|barre|dance|spa\b|salon|beauty|nail|hair|barber|lash|brow|esthetic|aesthetic|skin ?care|massage/, 'foldstudio'],
  [/gym|fitness|crossfit|boxing|martial|jiu|karate|personal train|bootcamp|strength/, 'ironmonger'],
  [/therap|counsel|psycholog|psychiatr|chiropract|physio|osteopath|acupunct|naturopath|wellness|clinic|medical|doctor|health|vet(erinar)?/, 'stillwater'],
  [/electric|plumb|hvac|heating|cooling|air con|locksmith|handyman|appliance|pest|garage door|solar|boiler|drain/, 'hollis'],
  [/build|construct|contractor|roof|renovat|remodel|carpent|joiner|paint|decorat|landscap|garden|fenc|concrete|mason|floor|deck|pav|tile|window|kitchen fit|bathroom|cleaning|clean/, 'marshvale'],
  [/photograph|videograph|wedding film/, 'marlowe'],
  [/architect/, 'atelier-nord'],
  [/agency|marketing|branding|design studio|web design|seo\b|advertis|creative/, 'meridian'],
  [/law|attorney|lawyer|solicitor|legal|account|cpa\b|bookkeep|tax|financ|insur|consult|advis|real estate|realt|estate agent|mortgage/, 'harborline'],
  [/non.?profit|charity|church|foundation|community/, 'understory'],
];

const FALLBACK = 'tallow';

export function pickTemplate(lead: Pick<LeadBrief, 'industry' | 'business'>): { id: string; name: string; kind: string; why: string } {
  const industry = (lead.industry || '').toLowerCase();
  const words = `${industry} ${(lead.business || '').toLowerCase()}`;
  for (const [re, id] of RULES) {
    const starter = findStarter(id);
    if (starter && re.test(words)) {
      const hit = re.exec(words)?.[0] ?? '';
      const from = industry && re.test(industry) ? lead.industry : lead.business;
      return {
        id,
        name: starter.name,
        kind: starter.kind,
        why: hit ? `${from} reads like a ${starter.kind.toLowerCase()}` : starter.kind,
      };
    }
  }
  const starter = findStarter(FALLBACK) ?? STARTERS.find((s) => s.category === 'local') ?? STARTERS[0]!;
  return { id: starter.id, name: starter.name, kind: starter.kind, why: 'a general template for a local business' };
}

/* Places the local templates are set in, so a lead's city can stand in for them. */
const TEMPLATE_PLACES = [
  'Stoke Newington', 'Gloucestershire', 'Sheffield', 'Stockport', 'Manchester', 'Bristol',
  'Leeds', 'Stroud', 'London', 'Hove', 'Porto',
];

const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)|\d{2,5})[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.example\b/g;

/** Every node on every page that shows words, as the renderer will see it. */
export function copyNodes(project: Project): { id: string; page: string; kind: string; name: string; text: string; href?: string }[] {
  const out: { id: string; page: string; kind: string; name: string; text: string; href?: string }[] = [];
  const seen = new Set<string>();
  for (const page of project.pages) {
    const stack = [page.rootId];
    while (stack.length > 0) {
      const id = stack.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = findNode(project, id);
      if (!node) continue;
      const href = typeof node.props?.href === 'string' ? node.props.href : undefined;
      if (typeof node.text === 'string' && node.text.trim() !== '') {
        out.push({ id, page: page.name, kind: node.kind, name: node.name, text: node.text, ...(href ? { href } : {}) });
      } else if (href && /^(tel|mailto):/.test(href)) {
        out.push({ id, page: page.name, kind: node.kind, name: node.name, text: '', href });
      }
      stack.push(...childIdsOf(project, id));
    }
  }
  return out;
}

/** "+15124520888" → "(512) 452-0888"; anything else as given. */
export function displayPhone(phone: string): string {
  const d = phone.replace(/[^\d]/g, '');
  const us = d.length === 11 && d.startsWith('1') ? d.slice(1) : d.length === 10 && !phone.trim().startsWith('+') ? d : '';
  return us ? `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}` : phone.trim();
}

function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
}

/** Runs a batch through the validator; keeps what passes, lists what didn't. */
export function applyCommands(project: Project, commands: ZoryCommand[]): Change {
  let probe = project;
  const changes: string[] = [];
  const skipped: SkippedChange[] = [];
  for (const command of commands) {
    const result = validateCommand(probe, command);
    if (!result.ok) {
      skipped.push({ what: String((command as { type?: unknown }).type ?? 'A change').toLowerCase().replace(/_/g, ' '), reason: result.reason });
      continue;
    }
    changes.push(describeCommand(probe, command));
    probe = applyCommand(probe, command);
  }
  return { project: probe, changes, skipped };
}

/**
 * The template, as this business: their name on it, their phone, email and city
 * in place of the demo's. No model involved; the words stay the template's.
 */
export function build(lead: LeadBrief, starterId: string): { project: Project; notes: string[] } {
  const starter = findStarter(starterId);
  if (!starter) throw new Error(`No template called ${starterId}`);
  const business = lead.business.trim() || lead.contact.trim() || lead.email.split('@')[1]?.split('.')[0] || 'Your business';
  lead = { ...lead, phone: lead.phone ? displayPhone(lead.phone) : '' };
  let project = personalisedProject(starter, { name: business });

  const brands = new Set<string>([starter.name]);
  const pristine = buildProject(starter.id);
  for (const node of Object.values(pristine.nodes)) {
    if (node.name === BRAND_NODE && node.text) brands.add(node.text);
  }

  const commands: ZoryCommand[] = [];
  const counts = { name: 0, phone: 0, email: 0, city: 0 };
  for (const n of copyNodes(project)) {
    let text = n.text;
    for (const brand of brands) {
      if (brand && text.includes(brand) && brand !== business) {
        text = text.split(brand).join(business);
        counts.name++;
      }
    }
    if (lead.phone && PHONE_RE.test(text)) {
      text = text.replace(PHONE_RE, lead.phone);
      counts.phone++;
    }
    PHONE_RE.lastIndex = 0;
    if (lead.email && EMAIL_RE.test(text)) {
      text = text.replace(EMAIL_RE, lead.email);
      counts.email++;
    }
    EMAIL_RE.lastIndex = 0;
    if (lead.city) {
      for (const place of TEMPLATE_PLACES) {
        const re = new RegExp(`\\b${place}\\b`, 'g');
        if (re.test(text)) {
          text = text.replace(re, lead.city);
          counts.city++;
        }
      }
    }
    if (text !== n.text) commands.push({ type: 'SET_TEXT', nodeId: n.id, text } as ZoryCommand);
    if (n.href?.startsWith('tel:') && lead.phone) {
      const href = telHref(lead.phone);
      if (href && href !== n.href) commands.push({ type: 'SET_PROP', nodeId: n.id, patch: { href } } as ZoryCommand);
    }
    if (n.href?.startsWith('mailto:') && lead.email && n.href !== `mailto:${lead.email}`) {
      commands.push({ type: 'SET_PROP', nodeId: n.id, patch: { href: `mailto:${lead.email}` } } as ZoryCommand);
    }
  }
  project = applyCommands(project, commands).project;

  const notes = [`Put ${business} on the ${starter.name} template`];
  const filled = [
    counts.phone ? 'phone number' : '',
    counts.email && lead.email ? 'email' : '',
    counts.city ? lead.city : '',
  ].filter(Boolean);
  if (filled.length) notes.push(`Swapped in their ${filled.join(', ')}`);
  return { project, notes };
}

const COPY_SYSTEM = `You rewrite the words on a website template so it belongs to a real local business.

Reply with ONLY a JSON array of commands. No prose, no markdown fences.
  {"type":"SET_TEXT","nodeId":"<id>","text":"<new words>"}
  {"type":"SET_PROP","nodeId":"<id>","patch":{"href":"tel:<digits>"|"mailto:<address>"}}

Rules:
- Use only node ids from the list. Never invent one.
- Rewrite copy that describes the template's made-up business: headlines, intros,
  service names and descriptions, about text, opening hours notes, calls to action.
- Write for THIS business and its kind of customer: plain, warm, specific, short.
  Keep each text close to the original length; headlines stay headlines.
- Use the facts given (name, city, phone, address, what they do). Never invent
  awards, certifications, years in business, staff names, prices, ratings or
  numbers you were not given. Where the template states one, say something true
  and general instead, or write a short placeholder in square brackets such as
  "[Your opening hours]".
- Testimonials and reviews: replace each quote with "[A customer review goes
  here]" and each name under one with "[Customer name]". Never write a review.
- Addresses: use the given address and city, else "[Your address]".
- Keep navigation and button labels short (one to three words).
- Leave a text alone if it already fits. Reply [] if nothing needs changing.`;

/** The prompt for Claude's pass over the copy. */
export function copyRequest(project: Project, lead: LeadBrief, extra = ''): { system: string; user: string } {
  const nodes = copyNodes(project)
    .slice(0, 400)
    .map((n) => ({ id: n.id, page: n.page, kind: n.kind, ...(n.text ? { text: n.text.slice(0, 300) } : {}), ...(n.href ? { href: n.href } : {}) }));
  const facts = {
    business: lead.business,
    what_they_do: lead.industry || '(not known: infer carefully from the name, or stay general)',
    city: lead.city,
    phone: lead.phone,
    email: lead.email,
    address: lead.address,
    current_website: lead.website,
    owner_or_contact: lead.contact,
  };
  const user = [
    `The business: ${JSON.stringify(facts)}`,
    extra ? `Also: ${extra}` : '',
    `The template's words, in page order: ${JSON.stringify(nodes)}`,
  ]
    .filter(Boolean)
    .join('\n');
  return { system: COPY_SYSTEM, user };
}

/** Applies a model's reply to `copyRequest`: only text and link changes pass. */
export function applyCopyReply(project: Project, reply: string): Change {
  const raw = extractCommands(reply);
  if (raw === null) throw new Error("The model's reply wasn't a list of changes.");
  const allowed = raw.filter(
    (c): c is ZoryCommand =>
      typeof c === 'object' && c !== null && ['SET_TEXT', 'SET_PROP'].includes(String((c as { type?: unknown }).type)),
  );
  // A link change may only touch href, and only to tel: or mailto:.
  const safe = allowed.filter((c) => {
    if (c.type !== 'SET_PROP') return true;
    const patch = (c as { patch?: Record<string, unknown> }).patch ?? {};
    const keys = Object.keys(patch);
    return keys.length === 1 && keys[0] === 'href' && /^(tel|mailto):/.test(String(patch['href']));
  });
  return { ...applyCommands(project, safe), by: 'model' };
}

/**
 * A free-form request ("make it warmer", "add a section about emergency call
 * outs"). With a model connected it goes there first: a request about words
 * needs judgement, and Studio's rules would read "punchier" as a style tweak.
 * The rules still answer when the model can't (offline, rate limited, or a
 * reply that wasn't commands), and they're all there is without one.
 */
export async function proposeChange(project: Project, prompt: string, ask: Ask | null): Promise<Change> {
  const context = { project, selectedId: null, pageId: project.pages[0]?.id ?? null, breakpoint: 'base' as const };
  const byRules = async (): Promise<Change> => {
    const proposal = await engineProposal(context, prompt, localIntentProvider);
    return { ...applyCommands(project, proposal.commands), skipped: proposal.skipped, by: 'rules' };
  };
  if (!ask) return byRules();
  const viaModel: IntentProvider = {
    id: 'openleads-model',
    name: 'Your model',
    isAvailable: () => true,
    async propose(ctx, request) {
      const { system, user } = buildIntentMessages(ctx, request);
      const reply = await ask(system, user);
      const commands = extractCommands(reply);
      if (commands === null) throw new IntentError("The model's reply wasn't a list of changes.");
      if (commands.length === 0) throw new IntentError("The model didn't find anything to change for that. Try naming the section.");
      return expandProposals(ctx.project, commands);
    },
  };
  try {
    const proposal = await engineProposal(context, prompt, viaModel);
    return { ...applyCommands(project, proposal.commands), skipped: proposal.skipped, by: 'model' };
  } catch (modelError) {
    try {
      return await byRules();
    } catch {
      throw modelError;
    }
  }
}

/** The rendered pages, `{"/": "<!doctype html>…"}`, as the server stores them. */
export function render(project: Project): Record<string, string> | undefined {
  try {
    return generateStaticSite(project);
  } catch {
    return undefined;
  }
}

export interface SavedSite {
  id: string;
  slug: string;
  name: string;
  lead_email: string | null;
  company: string;
  starter_id: string | null;
  preview: string;
  url: string;
  updated: number;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `OpenLeads answered ${res.status}`);
  return data;
}

/** Saves a project (and its rendered pages). `lead` links a new site to a person. */
export function save(project: Project, starterId: string | null, lead = ''): Promise<SavedSite> {
  const data = JSON.parse(JSON.stringify(project)) as Project;
  return post<SavedSite>('/api/sites/save', { project: data, starterId, lead, html: render(data) });
}

/** A saved site's project, brought forward to this build's schema. */
export async function load(id: string): Promise<Project | null> {
  const res = await fetch(`/api/sites/get?id=${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const site = (await res.json()) as { project?: Project | null };
  return site.project ? migrateProject(site.project) : null;
}

export type { Project, Starter };
