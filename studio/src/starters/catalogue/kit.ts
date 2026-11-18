/**
 * The assembly kit shared by the catalogue.
 *
 * A template is a palette, a typeface pairing and a sequence of sections. This
 * file is the last bit of ceremony between those three things and a
 * `PageBlueprint`, so the template files themselves read as content rather
 * than as scaffolding.
 */

import type { ComponentBlueprint, NodeBlueprint, PageBlueprint, ProjectTheme } from '@zory/core';
import type { TemplateCategory } from '../index';
import { box } from '../builders';
import { footer, nav, pageStyles, type FooterColumn } from '../patterns';
import type { Destination, SiteMap } from '../sitemap';

export interface TemplateDef {
  id: string;
  name: string;
  /** What kind of site this is, in the user's words. */
  kind: string;
  category: TemplateCategory;
  description: string;
  theme: ProjectTheme;
  pages: PageBlueprint[];
  /** Definitions the pages instantiate. Collected by `catalogued`, not written
   *  by hand — see `page` below. */
  components?: ComponentBlueprint[];
  /** Preview swatches, most dominant first: ground, ink, accent. */
  swatches: [string, string, string];
  /**
   * Which plan opens it.
   *
   * Omitted means `'pro'`, so a new template is premium unless somebody
   * decides otherwise — the safe default, since the alternative silently
   * widens the free plan every time the catalogue grows.
   */
  tier?: StarterTier;
}

/** Free opens six; everything else is the reason Pro exists. */
export type StarterTier = 'free' | 'pro';

/**
 * A section that brought definitions with it.
 *
 * A pattern that repeats something — a feature cell, a work row, a figure —
 * declares the repeated part once and places instances of it. It cannot file
 * the definition itself, because definitions live on the project rather than in
 * the page, so it hands back both and the composer files them.
 */
export interface ComposedSection {
  node: NodeBlueprint;
  components: ComponentBlueprint[];
}

/** What a template's page list is written from: plain nodes, or composed ones. */
export type Section = NodeBlueprint | ComposedSection;

const isComposed = (section: Section): section is ComposedSection =>
  'node' in section && 'components' in section;

/** A page, plus the definitions its sections brought. */
export interface ComposedPage extends PageBlueprint {
  components: ComponentBlueprint[];
}

/**
 * Rewrites a section's component keys to be unique within the project.
 *
 * A pattern names its definition locally — `features` always calls its cell
 * `'cell'` — because it has no idea what else is on the page. Two feature
 * sections on one site would then both claim `'cell'` and one would silently
 * win. Namespacing by where the section sits keeps the pattern ignorant and the
 * project consistent, and stays deterministic, which a counter would not.
 */
function namespaceKeys(section: ComposedSection, prefix: string): ComposedSection {
  const renamed = new Map(section.components.map((c) => [c.key, `${prefix}-${c.key}`]));

  const rewrite = (node: NodeBlueprint): NodeBlueprint => ({
    ...node,
    ...(node.componentKey && renamed.has(node.componentKey)
      ? { componentKey: renamed.get(node.componentKey)! }
      : {}),
    ...(node.children ? { children: node.children.map(rewrite) } : {}),
  });

  return {
    node: rewrite(section.node),
    components: section.components.map((c) => ({ ...c, key: renamed.get(c.key)! })),
  };
}

/** Wraps a sequence of sections into a page, collecting what they declared. */
export function page(name: string, path: string, sections: Section[]): ComposedPage {
  const slug = path.replace(/[^a-z0-9]+/gi, '') || 'index';
  const components: ComponentBlueprint[] = [];
  const nodes: NodeBlueprint[] = [];

  sections.forEach((section, index) => {
    if (!isComposed(section)) {
      nodes.push(section);
      return;
    }
    const scoped = namespaceKeys(section, `${slug}${index}`);
    nodes.push(scoped.node);
    components.push(...scoped.components);
  });

  return { name, path, root: box('Page', { tag: 'main', base: pageStyles }, nodes), components };
}

/**
 * Every definition a template's pages declared.
 *
 * Called once where the catalogue is assembled rather than in each template
 * file, so a template author writes sections and never thinks about this.
 */
export function collectComponents(pages: PageBlueprint[]): ComponentBlueprint[] {
  return pages.flatMap((p) => ('components' in p ? (p as ComposedPage).components : []));
}

/** A theme from seven colours and two faces. */
export function theme(
  colours: {
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    accent: string;
    accentText: string;
    border: string;
  },
  fonts: { display: string; body: string },
): ProjectTheme {
  return { ...colours, fontDisplay: fonts.display, fontBody: fonts.body };
}

/* --- The typeface pairings the catalogue draws from. ---------------------- */

const stack = (...faces: string[]): string =>
  faces.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(', ');

export const FACES = {
  /** Neutral grotesque. The default for a product that wants to disappear. */
  grotesque: {
    display: stack('Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'),
    body: stack('Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'),
  },
  /** Geometric, warmer, a little more brand than Inter. */
  geometric: {
    display: stack('Poppins', 'Avenir Next', 'Inter', 'system-ui', 'sans-serif'),
    body: stack('Inter', 'system-ui', '-apple-system', 'sans-serif'),
  },
  /** Editorial: a serif that carries the page, set against a plain body. */
  editorial: {
    display: stack('Playfair Display', 'Iowan Old Style', 'Georgia', 'serif'),
    body: stack('Inter', 'system-ui', '-apple-system', 'sans-serif'),
  },
  /** Transitional serif throughout. Institutional rather than fashionable. */
  literary: {
    display: stack('Iowan Old Style', 'Charter', 'Georgia', 'serif'),
    body: stack('Charter', 'Georgia', 'Iowan Old Style', 'serif'),
  },
  /** Monospace display. Reads as a tool, not a brochure. */
  technical: {
    display: stack('JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'),
    body: stack('Inter', 'system-ui', '-apple-system', 'sans-serif'),
  },
  /** Tall, tight, fashion-adjacent. For work that is looked at. */
  condensed: {
    display: stack('Archivo', 'Helvetica Neue', 'Inter', 'sans-serif'),
    body: stack('Inter', 'system-ui', '-apple-system', 'sans-serif'),
  },
} as const;


/* ------------------------------------------------------------------ site -- */

export interface PagePlan {
  /** Which of the site's destinations this page is. */
  at: Destination;
  /** Everything between the navigation and the footer. */
  sections: Section[];
}

export interface SitePlan {
  brand: string;
  /** One line under the brand in the footer. */
  tagline: string;
  /** Every page, in navigation order. The first must be the home page. */
  map: SiteMap;
  /** The one action in the navigation bar. Omitted where a site has no signup. */
  cta?: string;
  /** Footer columns. Their links are destinations, so they go somewhere. */
  columns: FooterColumn[];
  pages: PagePlan[];
  nav?: { background?: string; radius?: string };
  footer?: { background?: string; ink?: string; muted?: string };
}

/**
 * A template's pages, each wrapped in the same navigation and footer.
 *
 * This exists so that a page cannot be written without them. Every template
 * used to open and close each page by hand, which is how they all ended up
 * with navigation that named four destinations and a site that had one — the
 * bar and the pages were written in different places and nothing made them
 * agree.
 *
 * Here the same `map` produces the links and the pages, and each page is told
 * which destination it is so its own entry reads as where you are. A link can
 * only point at a page that exists, and a page cannot exist without being in
 * the navigation, because both come from the one list.
 */
export function site(plan: SitePlan): ComposedPage[] {
  const missing = plan.pages.find((p) => !plan.map.some((d) => d.path === p.at.path));
  if (missing) {
    // A page the navigation cannot reach is the defect this function exists to
    // prevent, so it is a build-time throw rather than a quiet omission: it
    // fails in the starter test, in front of whoever wrote it.
    throw new Error(`Zory: "${plan.brand}" has a page at ${missing.at.path} that is not in its site map.`);
  }

  return plan.pages.map((p) =>
    page(p.at.label, p.at.path, [
      nav(plan.brand, plan.map, {
        ...(plan.cta === undefined ? {} : { cta: plan.cta }),
        ...(plan.nav ?? {}),
        current: p.at.path,
      }),
      ...p.sections,
      footer(plan.brand, plan.tagline, plan.columns, plan.footer ?? {}),
    ]),
  );
}
