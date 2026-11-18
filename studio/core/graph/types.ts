/**
 * The Zory project graph.
 *
 * This is the single canonical source of truth for a project. The canvas
 * renders from it, persistence serialises it, and export generates code from
 * it. Nothing else may hold project state.
 *
 * Editor UI state (selection, hover, zoom, active viewport) deliberately lives
 * outside this type — see `src/editor/state`.
 */

export const SCHEMA_VERSION = 3;

import type { NodeMotion } from '../motion/types';

export type ProjectId = string;
export type PageId = string;
export type NodeId = string;
export type AssetId = string;
/**
 * Named `ComponentDefId`, not `ComponentId`: `interface/types.ts` already owns
 * that name for a React component found in a repository Zory did not write,
 * which is a different thing entirely.
 */
export type ComponentDefId = string;

/**
 * Breakpoints are an override chain, not independent style sets: `mobile`
 * inherits from `tablet`, which inherits from `base`. Only the properties a
 * user actually overrides are stored.
 */
export type Breakpoint = 'base' | 'tablet' | 'mobile';

export const BREAKPOINTS: readonly Breakpoint[] = ['base', 'tablet', 'mobile'] as const;

/**
 * A small, composable set of node kinds. Resist adding special-case kinds —
 * prefer composing `container` with styles and a semantic `tag`.
 */
export type NodeKind =
  | 'container'
  | 'heading'
  | 'text'
  | 'button'
  | 'link'
  | 'image'
  | 'divider'
  /**
   * A reference to a `ComponentDef`, not a copy of one. It holds no children
   * of its own: what renders under it is the definition, resolved on the way
   * out. That is the whole point — a copy cannot be improved after it is
   * inserted, and a reference can.
   */
  | 'instance';

/** Semantic element a container renders as. Drives exported markup. */
export type SemanticTag =
  | 'div'
  | 'header'
  | 'nav'
  | 'main'
  | 'section'
  | 'article'
  | 'aside'
  | 'footer'
  | 'ul'
  | 'li';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The styleable surface of a node. A typed subset of CSS chosen so that every
 * property has a first-class inspector control and a clean export path.
 *
 * Values are CSS strings (`"24px"`, `"#fff"`) except `opacity`, which is a
 * number. `null` in a patch means "remove this override".
 */
export interface StyleProps {
  // Layout
  display?: 'block' | 'flex' | 'grid' | 'inline-flex' | 'inline-block' | 'none';
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
  justifyContent?:
    | 'flex-start'
    | 'center'
    | 'flex-end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly';
  flexWrap?: 'nowrap' | 'wrap';
  gap?: string;
  gridTemplateColumns?: string;

  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;

  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;

  width?: string;
  maxWidth?: string;
  minHeight?: string;
  height?: string;

  // Typography
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';

  // Appearance
  color?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  borderWidth?: string;
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted';
  borderColor?: string;
  borderRadius?: string;
  boxShadow?: string;
  opacity?: number;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none';

  /*
   * Free placement.
   *
   * An element is in normal flow until it is placed, at which point it is
   * pinned to a point inside its parent. Kept as ordinary CSS rather than a
   * separate coordinate system, so an exported project needs no runtime to
   * position anything — it is just `position: absolute` with offsets, which is
   * what a person would have written by hand.
   */
  /*
   * Depth and motion.
   *
   * Plain CSS, so an exported project animates without a library and without a
   * runtime. `transition` covers almost everything a page needs — hover lifts,
   * colour changes, a card rising on focus — and it degrades to nothing under
   * reduced motion, which a JS animation loop would not.
   */
  transform?: string;
  transformOrigin?: string;
  perspective?: string;
  transition?: string;
  filter?: string;
  backdropFilter?: string;

  position?: 'static' | 'relative' | 'absolute';
  left?: string;
  top?: string;
  zIndex?: string;
}

export type StyleKey = keyof StyleProps;

/** A patch where `null` explicitly clears a property. */
export type StylePatch = {
  [K in StyleKey]?: StyleProps[K] | null;
};

export type ResponsiveStyles = {
  [B in Breakpoint]?: StyleProps;
};

export interface NodeProps {
  /** Heading level — drives `<h1>`…`<h6>` in export. */
  level?: HeadingLevel;
  /** Semantic element for containers. */
  tag?: SemanticTag;
  href?: string;
  target?: '_self' | '_blank';
  /** Asset id or absolute URL. */
  src?: string;
  alt?: string;
  /**
   * The element's HTML id, so a link can point at it.
   *
   * Added because there was no way to write one, and three starters shipped
   * navigation bars full of `#work` and `#practice` that could not resolve —
   * a link to an anchor no element could carry. Anybody adding an in-page
   * link in the editor hit the same wall from the other side.
   *
   * It is the id in the *document*, not the node's identity: `ElementNode.id`
   * is Zory's, it is minted per project and it is not somebody's business to
   * choose. This one is theirs, it goes in the markup, and it survives export.
   */
  anchor?: string;
}

/**
 * One node's local edits inside one instance.
 *
 * This is the pinning mechanism. The definition supplies every value; an
 * override replaces one. Nothing is copied forward, so a value nobody has
 * overridden keeps tracking the definition however often it changes, and a
 * value somebody has overridden keeps their edit however often it changes.
 *
 * `motion: null` is meaningfully different from `motion` absent: absent means
 * "follow the definition", null means "this instance does not move".
 */
export interface NodeOverride {
  text?: string;
  props?: NodeProps;
  styles?: ResponsiveStyles;
  motion?: NodeMotion | null;
}

/**
 * A reusable subtree, and the single source of truth for every instance of it.
 *
 * The definition owns its own node map rather than living in the page graph,
 * so there is exactly one place a change to it can be made and no propagation
 * step that could fall behind.
 */
export interface ComponentDef {
  id: ComponentDefId;
  name: string;
  rootId: NodeId;
  /** The definition's own nodes. Ids here never appear in `Project.nodes`. */
  nodes: Record<NodeId, ElementNode>;
  createdAt: number;
  updatedAt: number;
}

export interface ElementNode {
  id: NodeId;
  kind: NodeKind;
  /** Human-facing layer name. */
  name: string;
  parentId: NodeId | null;
  children: NodeId[];
  /** Text content for heading/text/button/link kinds. */
  text?: string;
  props: NodeProps;
  styles: ResponsiveStyles;
  /**
   * How this node moves. Absent means it does not.
   *
   * Motion is kept out of `styles` deliberately: it is not part of the
   * breakpoint cascade, it compiles to keyframes rather than declarations, and
   * an entrance is a property of the element rather than of one viewport.
   */
  motion?: NodeMotion;
  /** Set only on `kind: 'instance'`: which definition this refers to. */
  componentId?: ComponentDefId;
  /**
   * Set only on `kind: 'instance'`: local edits, keyed by the *definition's*
   * node id. Keyed that way on purpose — the definition's ids are the stable
   * thing, so an override survives the definition being restructured around it.
   */
  overrides?: Record<NodeId, NodeOverride>;
}

export interface PageNode {
  id: PageId;
  name: string;
  /** Route path, always leading-slash. `/` is the index page. */
  path: string;
  rootId: NodeId;
}

export interface AssetNode {
  id: AssetId;
  name: string;
  kind: 'image';
  /** Data URI or absolute URL. */
  src: string;
  width?: number;
  height?: number;
}

export interface ProjectTheme {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  border: string;
  fontDisplay: string;
  fontBody: string;
}

export interface ProjectSettings {
  description: string;
  theme: ProjectTheme;
  /** Max viewport width in px at which each breakpoint applies. */
  breakpoints: { tablet: number; mobile: number };
}

export interface Project {
  id: ProjectId;
  /** Persisted schema version — see `migrations.ts`. */
  version: number;
  name: string;
  pages: PageNode[];
  nodes: Record<NodeId, ElementNode>;
  /** Reusable definitions. Added in schema 3; absent means none. */
  components: Record<ComponentDefId, ComponentDef>;
  assets: AssetNode[];
  settings: ProjectSettings;
  createdAt: number;
  updatedAt: number;
}

/** Lightweight row for the dashboard — avoids loading whole graphs. */
export interface ProjectSummary {
  id: ProjectId;
  name: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  nodeCount: number;
  starterId: string | null;
}

export const DEFAULT_BREAKPOINTS = { tablet: 1024, mobile: 640 } as const;

/** Viewport widths the editor renders each breakpoint at. */
export const VIEWPORT_WIDTH: Record<Breakpoint, number> = {
  base: 1440,
  tablet: 900,
  mobile: 390,
};

export const BREAKPOINT_LABEL: Record<Breakpoint, string> = {
  base: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
};

/** Node kinds that carry editable text. */
export function isTextual(kind: NodeKind): boolean {
  return kind === 'heading' || kind === 'text' || kind === 'button' || kind === 'link';
}

/** Node kinds that may contain children. */
export function isContainerLike(kind: NodeKind): boolean {
  return kind === 'container';
}

/**
 * Separates an instance's node id from the definition node it stands for.
 *
 * A node inside an instance has no id of its own in the graph — it is one
 * definition node seen through one instance, and it is addressed as both:
 * `n_instance/n_defnode`. Selection, the inspector and the canvas all pass
 * these around as ordinary opaque ids, which is why the separator has to be a
 * character `createId` never emits.
 */
export const INSTANCE_PATH_SEP = '/';

export function instancePath(instanceId: NodeId, defNodeId: NodeId): NodeId {
  return `${instanceId}${INSTANCE_PATH_SEP}${defNodeId}`;
}

/**
 * Where a two-part id points.
 *
 * `instance` — one definition node seen through one instance. Writing here
 * pins a value on that instance and leaves every other instance alone.
 *
 * `component` — the definition itself. Writing here changes every instance
 * that has not pinned that value.
 *
 * The two are told apart by the owner's id prefix, which is why `createId`
 * prefixes exist at all: `n_` is a node, `c_` is a definition.
 */
export interface NodePath {
  scope: 'instance' | 'component';
  /** The instance node id, or the definition id. */
  ownerId: string;
  /** The node inside the definition. */
  defNodeId: NodeId;
}

export function parseNodePath(id: NodeId): NodePath | null {
  const at = id.indexOf(INSTANCE_PATH_SEP);
  if (at <= 0 || at === id.length - 1) return null;
  const ownerId = id.slice(0, at);
  const defNodeId = id.slice(at + 1);
  if (defNodeId.includes(INSTANCE_PATH_SEP)) return null; // nested instances are not addressable yet
  return { scope: ownerId.startsWith('c_') ? 'component' : 'instance', ownerId, defNodeId };
}

/** True for an id that addresses a node through an instance or a definition. */
export function isNodePath(id: NodeId): boolean {
  return id.includes(INSTANCE_PATH_SEP);
}

export function componentPath(componentId: ComponentDefId, defNodeId: NodeId): NodeId {
  return `${componentId}${INSTANCE_PATH_SEP}${defNodeId}`;
}
