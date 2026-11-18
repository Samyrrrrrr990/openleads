/**
 * A terse blueprint DSL for authoring starters.
 *
 * These are plain helpers over `NodeBlueprint` — nothing here survives into
 * the project graph, which stores fully materialised nodes.
 */

import type {
  NodeBlueprint,
  HeadingLevel,
  NodeMotion,
  NodeProps,
  ResponsiveStyles,
  SemanticTag,
  StyleProps,
} from '@zory/core';

type Kids = NodeBlueprint[];

interface BoxOptions {
  tag?: SemanticTag;
  /** The element's own HTML id, for an in-page `#anchor` link to find. */
  anchor?: string;
  base?: StyleProps;
  tablet?: StyleProps;
  mobile?: StyleProps;
}

function responsive(options: BoxOptions): ResponsiveStyles {
  const styles: ResponsiveStyles = {};
  if (options.base) styles.base = options.base;
  if (options.tablet) styles.tablet = options.tablet;
  if (options.mobile) styles.mobile = options.mobile;
  return styles;
}

export function box(name: string, options: BoxOptions, children: Kids = []): NodeBlueprint {
  const props: NodeProps = {};
  if (options.tag) props.tag = options.tag;
  if (options.anchor) props.anchor = options.anchor;
  return { kind: 'container', name, props, styles: responsive(options), children };
}

/** Vertical stack. */
export function col(
  name: string,
  gap: string,
  options: BoxOptions = {},
  children: Kids = [],
): NodeBlueprint {
  return box(name, { ...options, base: { display: 'flex', flexDirection: 'column', gap, ...options.base } }, children);
}

/** Horizontal stack. */
export function row(
  name: string,
  gap: string,
  options: BoxOptions = {},
  children: Kids = [],
): NodeBlueprint {
  return box(
    name,
    { ...options, base: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap, ...options.base } },
    children,
  );
}

export function grid(
  name: string,
  columns: string,
  gap: string,
  options: BoxOptions = {},
  children: Kids = [],
): NodeBlueprint {
  return box(
    name,
    { ...options, base: { display: 'grid', gridTemplateColumns: columns, gap, ...options.base } },
    children,
  );
}

export function heading(
  name: string,
  text: string,
  level: HeadingLevel,
  options: BoxOptions = {},
): NodeBlueprint {
  return { kind: 'heading', name, text, props: { level }, styles: responsive(options) };
}

export function text(name: string, content: string, options: BoxOptions = {}): NodeBlueprint {
  return { kind: 'text', name, text: content, styles: responsive(options) };
}

export function button(name: string, label: string, options: BoxOptions = {}): NodeBlueprint {
  return { kind: 'button', name, text: label, styles: responsive(options) };
}

export function link(
  name: string,
  label: string,
  href: string,
  options: BoxOptions = {},
): NodeBlueprint {
  return { kind: 'link', name, text: label, props: { href }, styles: responsive(options) };
}

export function image(
  name: string,
  src: string,
  alt: string,
  options: BoxOptions = {},
): NodeBlueprint {
  return { kind: 'image', name, props: { src, alt }, styles: responsive(options) };
}

export function divider(name: string, options: BoxOptions = {}): NodeBlueprint {
  return { kind: 'divider', name, styles: responsive(options) };
}

/**
 * A full-bleed section with a centred content column — the pattern every
 * starter section is built from.
 */
/**
 * The entrance every section arrives with.
 *
 * Motion was plumbed all the way through — blueprint, graph, canvas, and an
 * export that writes a reveal observer and `prefers-reduced-motion` rules —
 * and then no template used any of it. Thirty-seven starters shipped static,
 * so the one thing on the pricing page called "Zory Motion" had nowhere in
 * the product a person could see it working.
 *
 * The values are chosen to be almost unnoticeable, which is the point. Twenty
 * pixels of rise over half a second as a section arrives is what a
 * well-made site does; anything more is what a template does to prove it can
 * animate, and it is the first thing anybody deletes. The stagger applies to
 * the section's children, so a row of three features arrives as three things
 * rather than as one block.
 *
 * It is on the section rather than on every node deliberately: one entrance
 * per screenful is a rhythm, and one per element is a page that will not sit
 * still while somebody reads it.
 */
const SECTION_ENTRANCE: NodeMotion = {
  entrance: {
    effect: 'rise',
    duration: 520,
    delay: 0,
    easing: 'ease-out',
    trigger: 'scroll',
    distance: 20,
    stagger: 60,
  },
};

export function section(
  name: string,
  options: {
    tag?: SemanticTag;
    background?: string;
    paddingY?: string;
    paddingYMobile?: string;
    maxWidth?: string;
    inner?: StyleProps;
    innerMobile?: StyleProps;
    /** The section's HTML id, so navigation can link straight to it. */
    anchor?: string;
    /**
     * Set false for a section that must be visible the instant the page is.
     *
     * A hero above the fold has not been scrolled *to*, so a scroll-triggered
     * entrance on one is a bet that the observer fires before the first paint
     * — and when it loses, the first thing a visitor sees is nothing.
     */
    reveal?: boolean;
  },
  children: Kids = [],
): NodeBlueprint {
  const paddingY = options.paddingY ?? '96px';
  const paddingYMobile = options.paddingYMobile ?? '64px';

  const node = box(
    name,
    {
      tag: options.tag ?? 'section',
      ...(options.anchor ? { anchor: options.anchor } : {}),
      base: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        paddingTop: paddingY,
        paddingRight: '32px',
        paddingBottom: paddingY,
        paddingLeft: '32px',
        ...(options.background ? { backgroundColor: options.background } : {}),
      },
      mobile: {
        paddingTop: paddingYMobile,
        paddingBottom: paddingYMobile,
        paddingRight: '20px',
        paddingLeft: '20px',
      },
    },
    [
      box(
        `${name} content`,
        {
          base: {
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: options.maxWidth ?? '1120px',
            ...options.inner,
          },
          ...(options.innerMobile ? { mobile: options.innerMobile } : {}),
        },
        children,
      ),
    ],
  );

  return options.reveal === false ? node : { ...node, motion: SECTION_ENTRANCE };
}
