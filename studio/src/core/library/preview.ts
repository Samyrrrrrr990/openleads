/**
 * What a template looks like, in about forty pixels.
 *
 * The dashboard used to draw the same rectangle for every template — a bar, a
 * heading and two lines, recoloured. With six templates that read as a tidy
 * grid. With two dozen it reads as one template printed twenty-four times, and
 * the person choosing has nothing to choose *on* except the colour, which is
 * the one property they are most likely to change first.
 *
 * So the tile is derived from the template's actual first page: its real
 * sections, in their real order, at their real proportions. A portfolio with
 * an index of work no longer looks like a SaaS page with a feature grid,
 * because it is not one.
 *
 * Deliberately coarse. This is a thumbnail, not a renderer — five band kinds,
 * a hard cap on how much of the tree it will walk, and no styles read at all.
 * Reading styles is how a thumbnail turns into a second rendering engine that
 * disagrees with the first one.
 */

import type { ElementNode, NodeBlueprint, NodeKind, Project } from '@zory/core';

export type BandKind = 'nav' | 'hero' | 'grid' | 'rows' | 'media' | 'band' | 'footer';

export interface Band {
  kind: BandKind;
  /** Repeat count for `grid` and `rows`, clamped to what fits. */
  count: number;
}

/** The shape the walk needs, so blueprints and built projects share one path. */
interface Shape {
  kind: NodeKind;
  children: Shape[];
}

/*
 * Four.
 *
 * Six was the first guess and it clipped: the tile is 108px, and a fifth band
 * landed half-drawn against the bottom edge, which reads as a broken image
 * rather than as a page continuing. Four fill it exactly.
 */
const MAX_BANDS = 4;
/** Enough to classify a section, few enough that 25 tiles cost nothing. */
const MAX_NODES = 240;
const MAX_DEPTH = 7;

function fromBlueprint(node: NodeBlueprint, depth = 0): Shape {
  return {
    kind: node.kind,
    children:
      depth >= MAX_DEPTH ? [] : (node.children ?? []).map((child) => fromBlueprint(child, depth + 1)),
  };
}

function fromProject(project: Project, id: string, depth = 0): Shape | null {
  const node: ElementNode | undefined = project.nodes[id as keyof typeof project.nodes];
  if (!node) return null;
  return {
    kind: node.kind,
    children:
      depth >= MAX_DEPTH
        ? []
        : node.children
            .map((child) => fromProject(project, child, depth + 1))
            .filter((child): child is Shape => child !== null),
  };
}

interface Census {
  total: number;
  headings: number;
  images: number;
  links: number;
  buttons: number;
  /** The largest number of sibling children found anywhere inside. */
  widest: number;
}

function census(shape: Shape, into: Census = blank()): Census {
  if (into.total >= MAX_NODES) return into;
  into.total += 1;
  if (shape.kind === 'heading') into.headings += 1;
  if (shape.kind === 'image') into.images += 1;
  if (shape.kind === 'link') into.links += 1;
  if (shape.kind === 'button') into.buttons += 1;
  if (shape.children.length > into.widest) into.widest = shape.children.length;
  for (const child of shape.children) census(child, into);
  return into;
}

function blank(): Census {
  return { total: 0, headings: 0, images: 0, links: 0, buttons: 0, widest: 0 };
}

/**
 * One section to one band.
 *
 * The order of these tests is the whole classifier, and it runs most specific
 * first: a footer is a footer even though it is also full of links, and a hero
 * is a hero even though it is also a band.
 */
function classify(shape: Shape, index: number, last: boolean): Band {
  const counts = census(shape);
  const repeats = Math.min(4, Math.max(2, counts.widest));

  // A nav is short, wide and made of links. Only ever the first thing.
  if (index === 0 && counts.total <= 12 && counts.links >= 2 && counts.headings <= 1) {
    return { kind: 'nav', count: Math.min(4, counts.links) };
  }

  // A footer is the last thing and is mostly links.
  if (last && counts.links >= 3) return { kind: 'footer', count: Math.min(4, counts.links) };

  // The first real section with a heading and something to press.
  if (index <= 1 && counts.headings >= 1 && counts.total <= 40) return { kind: 'hero', count: 1 };

  if (counts.images >= 2) return { kind: 'media', count: Math.min(3, counts.images) };

  // Three or more siblings that repeat: a feature grid, a pricing table, cards.
  if (counts.widest >= 3) return { kind: 'grid', count: repeats };

  // Two or more: an index of work, a list of posts, a stack of rows.
  if (counts.widest === 2 && counts.total > 8) return { kind: 'rows', count: 3 };

  return { kind: 'band', count: 1 };
}

function bandsOf(sections: Shape[]): Band[] {
  const usable = sections.filter((section) => section.children.length > 0 || section.kind !== 'container');
  const taken = usable.slice(0, MAX_BANDS);
  return taken.map((section, index) => classify(section, index, index === taken.length - 1));
}

/** The bands for a starter, from the blueprint of its first page. */
export function bandsFromBlueprint(root: NodeBlueprint): Band[] {
  return bandsOf((root.children ?? []).map((child) => fromBlueprint(child)));
}

/** The bands for somebody's own saved template, from the project it stored. */
export function bandsFromProject(project: Project): Band[] {
  const page = project.pages[0];
  if (!page) return [];
  const root = fromProject(project, page.rootId);
  if (!root) return [];
  return bandsOf(root.children);
}
