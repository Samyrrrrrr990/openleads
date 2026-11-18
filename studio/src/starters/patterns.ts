/**
 * Section patterns.
 *
 * The three original starters were written a node at a time, which is right
 * when there are three of them and each one is making a distinct argument.
 * It does not survive twenty: at four hundred lines apiece the catalogue
 * becomes a place bugs go to hide, and the tenth template gets less care than
 * the first.
 *
 * So the shapes that genuinely repeat — a nav, a hero, a feature grid, a
 * pricing table, a footer — live here once, parameterised by theme reference
 * and copy. A template becomes a palette, a typeface pairing and a sequence of
 * these, which is close to how the sections would be assembled in the editor
 * anyway.
 *
 * Every colour is a `themeVarRef`, never a literal. That is what makes
 * changing the accent in the Design panel restyle a whole template instead of
 * repainting one section, and it is why these are worth building on top of the
 * DSL rather than beside it.
 */

import type { ComponentBlueprint, NodeBlueprint, StyleProps } from '@zory/core';
import type { ComposedSection } from './catalogue/kit';

type Align = NonNullable<StyleProps['textAlign']>;
import { themeVarRef } from '@zory/core';
import { box, button, col, divider, grid, heading, image, link, row, section, text } from './builders';
import { HOME, type Destination } from './sitemap';

/**
 * The layer name every wordmark carries.
 *
 * Renaming a template to the business opening it has to find the two places
 * the old name is set as identity — the nav and the footer — without touching
 * the places it appears as content, like a dish named after the restaurant.
 * Matching on the text would hit both; an agreed layer name hits only the
 * first, and it is a name the user sees and can rely on in the layers tree.
 */
export const BRAND_NODE = 'Brand';

export const PAGE = themeVarRef('background');
export const SURFACE = themeVarRef('surface');
export const INK = themeVarRef('text');
export const MUTED = themeVarRef('textMuted');
export const ACCENT = themeVarRef('accent');
export const ON_ACCENT = themeVarRef('accentText');
export const BORDER = themeVarRef('border');
export const DISPLAY = themeVarRef('fontDisplay');
export const BODY = themeVarRef('fontBody');

/* ------------------------------------------------------------------ type -- */

/** Display type. `scale` is a multiplier on the base 56px so a template can
 *  shout or murmur without every caller restating the whole style block. */
export function display(
  name: string,
  copy: string,
  options: { scale?: number; align?: Align; color?: string; maxWidth?: string } = {},
): NodeBlueprint {
  const size = Math.round(56 * (options.scale ?? 1));
  return heading(name, copy, 1, {
    base: {
      fontFamily: DISPLAY,
      fontSize: `${size}px`,
      lineHeight: '1.04',
      letterSpacing: '-0.035em',
      fontWeight: '600',
      color: options.color ?? INK,
      ...(options.align ? { textAlign: options.align } : {}),
      ...(options.maxWidth ? { maxWidth: options.maxWidth } : {}),
    },
    tablet: { fontSize: `${Math.round(size * 0.78)}px` },
    mobile: { fontSize: `${Math.round(size * 0.58)}px`, letterSpacing: '-0.025em' },
  });
}

export function title(
  name: string,
  copy: string,
  options: { level?: 2 | 3; color?: string; align?: Align; size?: number } = {},
): NodeBlueprint {
  const size = options.size ?? (options.level === 3 ? 20 : 34);
  return heading(name, copy, options.level ?? 2, {
    base: {
      fontFamily: DISPLAY,
      fontSize: `${size}px`,
      lineHeight: '1.15',
      letterSpacing: '-0.025em',
      fontWeight: '600',
      color: options.color ?? INK,
      ...(options.align ? { textAlign: options.align } : {}),
    },
    mobile: { fontSize: `${Math.round(size * 0.8)}px` },
  });
}

export function lede(
  name: string,
  copy: string,
  options: { color?: string; align?: Align; maxWidth?: string; size?: number } = {},
): NodeBlueprint {
  return text(name, copy, {
    base: {
      fontFamily: BODY,
      fontSize: `${options.size ?? 18}px`,
      lineHeight: '1.6',
      color: options.color ?? MUTED,
      maxWidth: options.maxWidth ?? '58ch',
      ...(options.align ? { textAlign: options.align } : {}),
    },
    mobile: { fontSize: '16px' },
  });
}

export function body(name: string, copy: string, options: { color?: string } = {}): NodeBlueprint {
  return text(name, copy, {
    base: { fontFamily: BODY, fontSize: '15px', lineHeight: '1.65', color: options.color ?? MUTED },
  });
}

/** A small uppercase label. Used sparingly: it is a signpost, not decoration. */
export function eyebrow(name: string, copy: string, options: { color?: string } = {}): NodeBlueprint {
  return text(name, copy, {
    base: {
      fontFamily: BODY,
      fontSize: '12px',
      fontWeight: '600',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: options.color ?? ACCENT,
    },
  });
}

/* --------------------------------------------------------------- controls -- */

export function primaryButton(label: string, options: { radius?: string } = {}): NodeBlueprint {
  return button(label, label, {
    base: {
      fontFamily: BODY,
      fontSize: '15px',
      fontWeight: '600',
      color: ON_ACCENT,
      backgroundColor: ACCENT,
      paddingTop: '14px',
      paddingBottom: '14px',
      paddingLeft: '24px',
      paddingRight: '24px',
      borderRadius: options.radius ?? '8px',
      borderWidth: '0px',
      transition: 'transform 140ms ease, opacity 140ms ease',
    },
  });
}

export function ghostButton(label: string, options: { radius?: string; color?: string } = {}): NodeBlueprint {
  return button(label, label, {
    base: {
      fontFamily: BODY,
      fontSize: '15px',
      fontWeight: '500',
      color: options.color ?? INK,
      backgroundColor: 'transparent',
      paddingTop: '13px',
      paddingBottom: '13px',
      paddingLeft: '22px',
      paddingRight: '22px',
      borderRadius: options.radius ?? '8px',
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: BORDER,
      transition: 'border-color 140ms ease',
    },
  });
}

/* -------------------------------------------------------------------- nav -- */

export interface NavOptions {
  cta?: string;
  background?: string;
  radius?: string;
  /** The path of the page this nav is on, so it can mark it. */
  current?: string;
}

/**
 * The navigation bar.
 *
 * Two things here are corrections rather than choices.
 *
 * **The links go somewhere.** They take `Destination`s, not strings, so a link
 * carries the path of a page the template actually has. The old signature took
 * labels and emitted `href="#"` for every one of them, which meant the first
 * thing anybody clicked in any template did nothing.
 *
 * **The links survive a phone.** They used to be `display: none` below the
 * tablet breakpoint with nothing put in their place, so every exported
 * template had no navigation at all on a phone — not a collapsed menu, not a
 * hamburger, nothing. A drawer is the usual answer and it is the wrong one
 * here: it needs open/closed state, Zory exports markup and CSS rather than
 * behaviour, and a template that ships a button wired to nothing is the same
 * defect one level up. So on a small screen the bar becomes two rows and the
 * links wrap. It is honest, it needs no JavaScript, and every destination
 * stays reachable with a thumb.
 */
export function nav(brand: string, links: readonly Destination[], options: NavOptions = {}): NodeBlueprint {
  return box(
    'Nav',
    {
      tag: 'header',
      base: {
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
        paddingTop: '20px',
        paddingBottom: '20px',
        paddingLeft: '32px',
        paddingRight: '32px',
        backgroundColor: options.background ?? PAGE,
        borderWidth: '0px 0px 1px 0px',
        borderStyle: 'solid',
        borderColor: BORDER,
      },
      mobile: { paddingLeft: '20px', paddingRight: '20px', paddingTop: '14px', paddingBottom: '14px' },
    },
    [
      col(
        'Nav content',
        '0px',
        {
          base: {
            width: '100%',
            maxWidth: '1120px',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '28px',
          },
          // Two rows on a phone: brand and call to action on the first, the
          // links wrapping underneath. Nothing is hidden.
          mobile: { flexDirection: 'column', alignItems: 'stretch', gap: '12px' },
        },
        [
          row(
            'Nav bar',
            '28px',
            {
              base: { alignItems: 'center', gap: '28px' },
              mobile: { justifyContent: 'space-between', width: '100%' },
            },
            [
              link(BRAND_NODE, brand, HOME.path, {
                base: {
                  fontFamily: DISPLAY,
                  fontSize: '18px',
                  fontWeight: '700',
                  letterSpacing: '-0.02em',
                  color: INK,
                },
              }),
              options.cta
                ? button(options.cta, options.cta, {
                    base: {
                      fontFamily: BODY,
                      fontSize: '14px',
                      fontWeight: '600',
                      color: ON_ACCENT,
                      backgroundColor: ACCENT,
                      paddingTop: '10px',
                      paddingBottom: '10px',
                      paddingLeft: '18px',
                      paddingRight: '18px',
                      borderRadius: options.radius ?? '8px',
                      borderWidth: '0px',
                      // Hidden on desktop: the bar puts it on the right of the
                      // link row instead, which is where the eye expects it.
                      display: 'none',
                    },
                    mobile: { display: 'inline-block' },
                  })
                : box('Nav spacer', { base: { width: '1px' } }),
            ],
          ),
          row(
            'Nav links',
            '26px',
            {
              base: { alignItems: 'center', gap: '26px' },
              mobile: { flexWrap: 'wrap', gap: '18px', width: '100%' },
            },
            [
              ...links.map((destination) =>
                link(destination.label, destination.label, destination.path, {
                  base: {
                    fontFamily: BODY,
                    fontSize: '14px',
                    fontWeight: '500',
                    // The current page is named in its own navigation and
                    // reads as where you are, not as somewhere to go.
                    color: destination.path === options.current ? INK : MUTED,
                  },
                  mobile: { fontSize: '13px' },
                }),
              ),
              options.cta
                ? button(`${options.cta} (nav)`, options.cta, {
                    base: {
                      fontFamily: BODY,
                      fontSize: '14px',
                      fontWeight: '600',
                      color: ON_ACCENT,
                      backgroundColor: ACCENT,
                      paddingTop: '10px',
                      paddingBottom: '10px',
                      paddingLeft: '18px',
                      paddingRight: '18px',
                      borderRadius: options.radius ?? '8px',
                      borderWidth: '0px',
                    },
                    // Shown once. On a phone the copy in the bar above carries it.
                    mobile: { display: 'none' },
                  })
                : box('Nav end', { base: { width: '1px' } }),
            ],
          ),
        ],
      ),
    ],
  );
}

/* ------------------------------------------------------------------ hero -- */

/** Centred hero. The message is the design; use where there is no artefact. */
export function heroCentred(
  copy: { eyebrow?: string; title: string; lede: string; primary: string; secondary?: string },
  options: { background?: string; scale?: number; ink?: string; muted?: string; radius?: string } = {},
): NodeBlueprint {
  return section(
    'Hero',
    {
      background: options.background ?? PAGE,
      paddingY: '128px',
      paddingYMobile: '72px',
      inner: { alignItems: 'center', gap: '24px' },
      // Above the fold: nothing has been scrolled to yet.
      reveal: false,
    },
    [
      ...(copy.eyebrow ? [eyebrow('Hero eyebrow', copy.eyebrow)] : []),
      display('Hero title', copy.title, { scale: options.scale ?? 1.15, align: 'center', color: options.ink, maxWidth: '18ch' }),
      lede('Hero lede', copy.lede, { align: 'center', maxWidth: '54ch', color: options.muted }),
      row('Hero actions', '12px', { base: { marginTop: '12px' }, mobile: { flexWrap: 'wrap', justifyContent: 'center' } }, [
        primaryButton(copy.primary, { radius: options.radius }),
        ...(copy.secondary ? [ghostButton(copy.secondary, { radius: options.radius, color: options.ink })] : []),
      ]),
    ],
  );
}

/** Split hero: argument left, artefact right. The default for a product. */
export function heroSplit(
  copy: { eyebrow?: string; title: string; lede: string; primary: string; secondary?: string; note?: string },
  aside: NodeBlueprint,
  options: { background?: string; ink?: string; muted?: string; radius?: string } = {},
): NodeBlueprint {
  return section(
    'Hero',
    {
      background: options.background ?? PAGE,
      paddingY: '104px',
      paddingYMobile: '64px',
      inner: { display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: '64px', alignItems: 'center' },
      innerMobile: { gridTemplateColumns: '1fr', gap: '40px' },
      // Above the fold: nothing has been scrolled to yet.
      reveal: false,
    },
    [
      col('Hero copy', '22px', {}, [
        ...(copy.eyebrow ? [eyebrow('Hero eyebrow', copy.eyebrow)] : []),
        display('Hero title', copy.title, { scale: 1, color: options.ink, maxWidth: '15ch' }),
        lede('Hero lede', copy.lede, { maxWidth: '46ch', color: options.muted }),
        row('Hero actions', '12px', { base: { marginTop: '6px' }, mobile: { flexWrap: 'wrap' } }, [
          primaryButton(copy.primary, { radius: options.radius }),
          ...(copy.secondary ? [ghostButton(copy.secondary, { radius: options.radius, color: options.ink })] : []),
        ]),
        ...(copy.note
          ? [text('Hero note', copy.note, { base: { fontFamily: BODY, fontSize: '13px', color: options.muted ?? MUTED } })]
          : []),
      ]),
      aside,
    ],
  );
}

/* --------------------------------------------------------------- content -- */

/** A framed panel standing in for a screenshot. Honest: it is obviously a
 *  placeholder shape rather than a fake product photograph. */
export function mockPanel(label: string, options: { background?: string; rows?: number } = {}): NodeBlueprint {
  const rows = options.rows ?? 4;
  return col(
    'Preview',
    '14px',
    {
      base: {
        width: '100%',
        backgroundColor: options.background ?? SURFACE,
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: BORDER,
        borderRadius: '14px',
        paddingTop: '22px',
        paddingBottom: '26px',
        paddingLeft: '22px',
        paddingRight: '22px',
        boxShadow: '0 24px 60px rgba(15, 18, 25, 0.10)',
      },
    },
    [
      row('Preview head', '8px', {}, [
        box('Dot a', { base: { width: '9px', height: '9px', borderRadius: '999px', backgroundColor: BORDER } }),
        box('Dot b', { base: { width: '9px', height: '9px', borderRadius: '999px', backgroundColor: BORDER } }),
        text('Preview label', label, {
          base: { fontFamily: BODY, fontSize: '12px', color: MUTED, marginLeft: '8px' },
        }),
      ]),
      divider('Preview rule', { base: { borderColor: BORDER, marginTop: '4px', marginBottom: '4px' } }),
      ...Array.from({ length: rows }, (_, i) =>
        box(`Preview row ${i + 1}`, {
          base: {
            width: i === 0 ? '72%' : i === rows - 1 ? '48%' : '100%',
            height: i === 0 ? '14px' : '10px',
            borderRadius: '4px',
            backgroundColor: i === 0 ? ACCENT : BORDER,
            opacity: i === 0 ? 1 : 0.85,
          },
        }),
      ),
    ],
  );
}

export interface Feature {
  title: string;
  body: string;
}

/**
 * A feature grid. Bordered cells rather than floating cards: elevation should
 * mean something, and here nothing is above anything else.
 *
 * The cell is a component, not three copies of one. Nearly every template has a
 * section like this, and the whole reason instances exist is that padding the
 * cell, or restyling its heading, should be one edit rather than one edit
 * repeated until the row looks even again. What differs between cells is words,
 * and words are pins.
 */
export function features(
  headline: { eyebrow?: string; title: string; lede?: string },
  items: Feature[],
  options: { background?: string; columns?: number; ink?: string; muted?: string } = {},
): ComposedSection {
  const columns = options.columns ?? 3;
  const first = items[0];

  const cell: ComponentBlueprint = {
    key: 'cell',
    name: 'Feature',
    root: col(
      'Feature',
      '10px',
      {
        base: {
          backgroundColor: options.background ?? PAGE,
          paddingTop: '30px',
          paddingBottom: '30px',
          paddingLeft: '26px',
          paddingRight: '26px',
        },
      },
      [
        {
          ...title('Heading', first?.title ?? 'Feature', { level: 3, color: options.ink }),
          slot: 'title',
        },
        { ...body('Body', first?.body ?? '', { color: options.muted }), slot: 'body' },
      ],
    ),
  };

  return {
    components: [cell],
    node: section(
      'Features',
      { background: options.background ?? PAGE, inner: { gap: '48px' } },
      [
        col('Features head', '16px', { base: { maxWidth: '52ch' } }, [
          ...(headline.eyebrow ? [eyebrow('Features eyebrow', headline.eyebrow)] : []),
          title('Features title', headline.title, { color: options.ink }),
          ...(headline.lede ? [lede('Features lede', headline.lede, { color: options.muted })] : []),
        ]),
        grid(
          'Feature grid',
          `repeat(${columns}, minmax(0, 1fr))`,
          '1px',
          {
            base: {
              backgroundColor: BORDER,
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: BORDER,
              borderRadius: '14px',
            },
            mobile: { gridTemplateColumns: 'minmax(0, 1fr)' },
          },
          items.map((item) => ({
            kind: 'instance' as const,
            name: item.title,
            componentKey: 'cell',
            overrides: { title: { text: item.title }, body: { text: item.body } },
          })),
        ),
      ],
    ),
  };
}

/** A row of measurements. Only ever used with numbers a template's own copy
 *  can stand behind — these are a fictional company's, and read as such. */
export function stats(
  items: { value: string; label: string }[],
  options: { background?: string; ink?: string; muted?: string } = {},
): ComposedSection {
  const first = items[0];

  const figure: ComponentBlueprint = {
    key: 'figure',
    name: 'Figure',
    root: col('Figure', '6px', {}, [
      {
        ...text('Value', first?.value ?? '0', {
          base: {
            fontFamily: DISPLAY,
            fontSize: '40px',
            fontWeight: '700',
            letterSpacing: '-0.03em',
            color: options.ink ?? INK,
          },
          mobile: { fontSize: '30px' },
        }),
        slot: 'value',
      },
      {
        ...text('Label', first?.label ?? '', {
          base: { fontFamily: BODY, fontSize: '14px', color: options.muted ?? MUTED },
        }),
        slot: 'label',
      },
    ]),
  };

  return {
    components: [figure],
    node: section(
      'Numbers',
      { background: options.background ?? SURFACE, paddingY: '64px', paddingYMobile: '48px' },
      [
        grid(
          'Number row',
          `repeat(${items.length}, minmax(0, 1fr))`,
          '32px',
          { mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
          items.map((item) => ({
            kind: 'instance' as const,
            name: item.label,
            componentKey: 'figure',
            overrides: { value: { text: item.value }, label: { text: item.label } },
          })),
        ),
      ],
    ),
  };
}

/** An alternating explanation row. */
export function showcase(
  copy: { eyebrow?: string; title: string; body: string; bullets?: string[] },
  aside: NodeBlueprint,
  options: { background?: string; reverse?: boolean; ink?: string; muted?: string } = {},
): NodeBlueprint {
  const copyColumn = col('Showcase copy', '18px', {}, [
    ...(copy.eyebrow ? [eyebrow('Showcase eyebrow', copy.eyebrow)] : []),
    title('Showcase title', copy.title, { color: options.ink }),
    lede('Showcase body', copy.body, { maxWidth: '46ch', color: options.muted }),
    ...(copy.bullets
      ? [
          col(
            'Showcase points',
            '10px',
            {},
            copy.bullets.map((point) =>
              row(`${point.slice(0, 18)} row`, '10px', { base: { alignItems: 'flex-start' } }, [
                box('Marker', {
                  base: {
                    width: '6px',
                    height: '6px',
                    borderRadius: '999px',
                    backgroundColor: ACCENT,
                    marginTop: '8px',
                  },
                }),
                body(point, point, { color: options.muted }),
              ]),
            ),
          ),
        ]
      : []),
  ]);

  return section(
    'Showcase',
    {
      background: options.background ?? PAGE,
      inner: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '56px', alignItems: 'center' },
      innerMobile: { gridTemplateColumns: '1fr', gap: '36px' },
    },
    options.reverse ? [aside, copyColumn] : [copyColumn, aside],
  );
}

/** A closing ask. */
export function cta(
  copy: { title: string; lede: string; primary: string; secondary?: string },
  options: { background?: string; ink?: string; muted?: string; radius?: string } = {},
): NodeBlueprint {
  return section(
    'Closing',
    {
      background: options.background ?? SURFACE,
      paddingY: '104px',
      paddingYMobile: '72px',
      inner: { alignItems: 'center', gap: '20px' },
    },
    [
      title('Closing title', copy.title, { align: 'center', size: 40, color: options.ink }),
      lede('Closing lede', copy.lede, { align: 'center', maxWidth: '48ch', color: options.muted }),
      row('Closing actions', '12px', { base: { marginTop: '10px' }, mobile: { flexWrap: 'wrap', justifyContent: 'center' } }, [
        primaryButton(copy.primary, { radius: options.radius }),
        ...(copy.secondary ? [ghostButton(copy.secondary, { radius: options.radius, color: options.ink })] : []),
      ]),
    ],
  );
}

export interface FooterColumn {
  heading: string;
  /**
   * Destinations, so a footer link goes where it says.
   *
   * A footer is where a template's dead links used to hide in bulk: nine of
   * them per template, all `href="#"`, under headings like "Product" and
   * "Company". Typed as destinations, a column can only list pages the
   * template has — which is a constraint on the author, and the right one.
   */
  links: readonly Destination[];
}

export function footer(
  brand: string,
  tagline: string,
  columns: FooterColumn[],
  options: { background?: string; ink?: string; muted?: string } = {},
): NodeBlueprint {
  return section(
    'Footer',
    {
      tag: 'footer',
      background: options.background ?? PAGE,
      paddingY: '56px',
      paddingYMobile: '44px',
      inner: { gap: '36px' },
    },
    [
      box(
        'Footer top',
        {
          base: { display: 'grid', gridTemplateColumns: '1.4fr 2fr', gap: '48px' },
          mobile: { gridTemplateColumns: '1fr', gap: '32px' },
        },
        [
          col('Footer brand', '10px', {}, [
            text(BRAND_NODE, brand, {
              base: {
                fontFamily: DISPLAY,
                fontSize: '17px',
                fontWeight: '700',
                letterSpacing: '-0.02em',
                color: options.ink ?? INK,
              },
            }),
            text('Footer tagline', tagline, {
              base: { fontFamily: BODY, fontSize: '13px', lineHeight: '1.6', color: options.muted ?? MUTED, maxWidth: '32ch' },
            }),
          ]),
          grid(
            'Footer columns',
            `repeat(${columns.length}, minmax(0, 1fr))`,
            '24px',
            { mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
            columns.map((column) =>
              col(
                column.heading,
                '9px',
                {},
                [
                  text(`${column.heading} heading`, column.heading, {
                    base: {
                      fontFamily: BODY,
                      fontSize: '11px',
                      fontWeight: '600',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: options.muted ?? MUTED,
                    },
                  }),
                  ...column.links.map((destination) =>
                    link(destination.label, destination.label, destination.path, {
                      base: { fontFamily: BODY, fontSize: '14px', color: options.ink ?? INK },
                    }),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      divider('Footer rule', { base: { borderColor: BORDER } }),
      text('Footer legal', `© ${new Date().getFullYear()} ${brand}`, {
        base: { fontFamily: BODY, fontSize: '12px', color: options.muted ?? MUTED },
      }),
    ],
  );
}

/* -------------------------------------------------------------- portfolio -- */

export interface Work {
  title: string;
  discipline: string;
  year: string;
}

/**
 * An index of work, as ruled rows.
 *
 * A portfolio is a list of things somebody made, and a list is a list. The
 * card grid every portfolio template reaches for turns eight projects into
 * eight identical rectangles and flattens exactly the hierarchy the work
 * needs. Rows keep the reading order and give the titles room to be large.
 */
export function workIndex(
  headline: { eyebrow?: string; title?: string },
  items: Work[],
  options: { background?: string; ink?: string; muted?: string } = {},
): ComposedSection {
  const first = items[0];

  const workRow: ComponentBlueprint = {
    key: 'row',
    name: 'Work row',
    root: box(
      'Work row',
      {
        base: {
          display: 'grid',
          gridTemplateColumns: '1.6fr 1fr auto',
          gap: '24px',
          alignItems: 'baseline',
          paddingTop: '26px',
          paddingBottom: '26px',
          borderWidth: '0px 0px 1px 0px',
          borderStyle: 'solid',
          borderColor: BORDER,
        },
        mobile: { gridTemplateColumns: '1fr', gap: '6px', paddingTop: '20px', paddingBottom: '20px' },
      },
      [
        {
          ...text('Name', first?.title ?? 'Project', {
            base: {
              fontFamily: DISPLAY,
              fontSize: '28px',
              lineHeight: '1.1',
              letterSpacing: '-0.025em',
              color: options.ink ?? INK,
            },
            mobile: { fontSize: '22px' },
          }),
          slot: 'name',
        },
        {
          ...text('Discipline', first?.discipline ?? '', {
            base: { fontFamily: BODY, fontSize: '14px', color: options.muted ?? MUTED },
          }),
          slot: 'discipline',
        },
        {
          ...text('Year', first?.year ?? '', {
            base: { fontFamily: BODY, fontSize: '14px', color: options.muted ?? MUTED },
          }),
          slot: 'year',
        },
      ],
    ),
  };

  return {
    components: [workRow],
    node: section(
      'Work',
      { background: options.background ?? PAGE, inner: { gap: '30px' } },
      [
        ...(headline.title || headline.eyebrow
          ? [
              col('Work head', '12px', {}, [
                ...(headline.eyebrow ? [eyebrow('Work eyebrow', headline.eyebrow)] : []),
                ...(headline.title ? [title('Work title', headline.title, { color: options.ink })] : []),
              ]),
            ]
          : []),
        col(
          'Work list',
          '0px',
          { base: { borderWidth: '1px 0px 0px 0px', borderStyle: 'solid', borderColor: BORDER } },
          items.map((item) => ({
            kind: 'instance' as const,
            name: item.title,
            componentKey: 'row',
            overrides: {
              name: { text: item.title },
              discipline: { text: item.discipline },
              year: { text: item.year },
            },
          })),
        ),
      ],
    ),
  };
}

/**
 * A grid of image plates.
 *
 * Deliberately empty tinted blocks rather than stock photographs. A template
 * that ships someone else's photography looks finished and is not: the first
 * thing the owner does is replace every image, and until they do the site is
 * lying about what it contains.
 */
/**
 * A grid of image plates.
 *
 * These are real `image` nodes with no source and their alt text already
 * written, not tinted boxes. Three reasons, and the third is the one that
 * matters:
 *
 * They export as `<img>`, so a portfolio built from a template ships the
 * markup a portfolio should have rather than a wall of divs.
 *
 * The alt text is there before the photograph is, which is the only order in
 * which alt text reliably gets written. A template that ships nine empty
 * containers ships nine images with no description the day somebody fills
 * them in.
 *
 * And filling one in is one field. With a box, replacing it with a photograph
 * means changing what kind of node it is — which is a thing you have to know
 * Zory well enough to do.
 *
 * The plates stay visually empty: shipping somebody else's photography would
 * make the template look finished while guaranteeing the first hour of use is
 * spent deleting it.
 */
export function plates(
  count: number,
  options: {
    background?: string;
    columns?: number;
    ratio?: string;
    /** What these are pictures of, for the alt text. */
    subject?: string;
  } = {},
): NodeBlueprint {
  const columns = options.columns ?? 3;
  const subject = options.subject ?? 'the work';
  return section(
    'Gallery',
    { background: options.background ?? PAGE, paddingY: '72px', paddingYMobile: '48px' },
    [
      grid(
        'Plates',
        `repeat(${columns}, minmax(0, 1fr))`,
        '16px',
        { mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
        Array.from({ length: count }, (_, i) =>
          image(`Plate ${i + 1}`, '', `${subject}, image ${i + 1} of ${count}`, {
            base: {
              width: '100%',
              minHeight: options.ratio ?? '260px',
              backgroundColor: SURFACE,
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: BORDER,
              borderRadius: '6px',
              objectFit: 'cover',
            },
            mobile: { minHeight: '180px' },
          }),
        ),
      ),
    ],
  );
}

/** A quiet biography block: a lede-sized statement beside a short list. */
export function about(
  copy: { title: string; body: string; items: { label: string; value: string }[] },
  options: { background?: string; ink?: string; muted?: string } = {},
): NodeBlueprint {
  return section(
    'About',
    {
      background: options.background ?? SURFACE,
      inner: { display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '56px' },
      innerMobile: { gridTemplateColumns: '1fr', gap: '32px' },
    },
    [
      col('About copy', '18px', {}, [
        title('About title', copy.title, { color: options.ink }),
        lede('About body', copy.body, { maxWidth: '52ch', color: options.muted }),
      ]),
      col(
        'About facts',
        '0px',
        {},
        copy.items.map((item) =>
          box(
            item.label,
            {
              base: {
                display: 'grid',
                gridTemplateColumns: '1fr 1.4fr',
                gap: '16px',
                paddingTop: '14px',
                paddingBottom: '14px',
                borderWidth: '0px 0px 1px 0px',
                borderStyle: 'solid',
                borderColor: BORDER,
              },
            },
            [
              text(`${item.label} label`, item.label, {
                base: { fontFamily: BODY, fontSize: '13px', color: options.muted ?? MUTED },
              }),
              text(`${item.label} value`, item.value, {
                base: { fontFamily: BODY, fontSize: '14px', color: options.ink ?? INK },
              }),
            ],
          ),
        ),
      ),
    ],
  );
}

/** Shared page style: every template's root. */
export const pageStyles: StyleProps = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  backgroundColor: PAGE,
  fontFamily: BODY,
};
