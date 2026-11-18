/**
 * Section patterns for local businesses.
 *
 * `patterns.ts` is the vocabulary of a marketing page: a hero making an
 * argument, a grid of capabilities, a closing ask. It is the right vocabulary
 * for a product and the wrong one for a restaurant, where the page is not an
 * argument at all. Somebody arriving at a restaurant site wants the menu, the
 * hours and the address, roughly in that order, and a template that opens with
 * "Three things that stop analytics rotting" is not serving them.
 *
 * So this is a second vocabulary, kept separate rather than folded in, because
 * the two do not mix on one page and a single file of thirty exports invites
 * exactly that. A local template imports the shared type and controls from
 * `patterns.ts` and its sections from here.
 *
 * The same rules apply: every colour is a `themeVarRef`, never a literal, and
 * anything that repeats is a component with slots rather than copies.
 *
 * On content: these ship a fictional business's real details — a plausible
 * address, plausible prices, plausible opening hours. Not "Lorem ipsum", and
 * not a real restaurant's menu either. The owner replaces them, and until they
 * do the page has to read as a finished page rather than as a form to fill in.
 */

import type { ComponentBlueprint, NodeBlueprint } from '@zory/core';
import type { ComposedSection } from './catalogue/kit';
import { box, col, divider, grid, row, section, text } from './builders';
import { ACCENT, BODY, BORDER, DISPLAY, INK, MUTED, PAGE, SURFACE } from './patterns';
import { body, eyebrow, lede, primaryButton, title } from './patterns';

interface Tone {
  background?: string;
  ink?: string;
  muted?: string;
}

/** The head every section below shares: an optional eyebrow over a title. */
function head(name: string, copy: { eyebrow?: string; title?: string; lede?: string }, tone: Tone) {
  if (!copy.title && !copy.eyebrow) return [];
  return [
    col(`${name} head`, '14px', { base: { maxWidth: '54ch' } }, [
      ...(copy.eyebrow ? [eyebrow(`${name} eyebrow`, copy.eyebrow)] : []),
      ...(copy.title ? [title(`${name} title`, copy.title, { color: tone.ink })] : []),
      ...(copy.lede ? [lede(`${name} lede`, copy.lede, { color: tone.muted })] : []),
    ]),
  ];
}

/* ------------------------------------------------------------------ menu -- */

export interface MenuItem {
  name: string;
  description?: string;
  price: string;
}

export interface MenuCourse {
  name: string;
  items: MenuItem[];
}

/**
 * A menu, set as courses of ruled rows.
 *
 * Priced against a leader rather than in a right-hand column, because a column
 * of prices invites reading the prices first and a menu is not a price list.
 * The dish carries the line; the price sits at the end of it where you arrive
 * having already read what it is.
 */
export function menu(
  copy: { eyebrow?: string; title?: string; lede?: string },
  courses: MenuCourse[],
  tone: Tone = {},
): ComposedSection {
  const first = courses[0]?.items[0];

  const dish: ComponentBlueprint = {
    key: 'dish',
    name: 'Dish',
    root: col(
      'Dish',
      '5px',
      {
        base: {
          paddingTop: '16px',
          paddingBottom: '16px',
          borderWidth: '0px 0px 1px 0px',
          borderStyle: 'solid',
          borderColor: BORDER,
        },
      },
      [
        row('Dish line', '14px', { base: { justifyContent: 'space-between', alignItems: 'baseline' } }, [
          {
            ...text('Name', first?.name ?? 'Dish', {
              base: {
                fontFamily: DISPLAY,
                fontSize: '19px',
                fontWeight: '600',
                letterSpacing: '-0.015em',
                color: tone.ink ?? INK,
              },
            }),
            slot: 'name',
          },
          {
            ...text('Price', first?.price ?? '—', {
              base: {
                fontFamily: BODY,
                fontSize: '16px',
                fontWeight: '500',
                color: tone.ink ?? INK,
              },
            }),
            slot: 'price',
          },
        ]),
        {
          ...text('Description', first?.description ?? '', {
            base: {
              fontFamily: BODY,
              fontSize: '14px',
              lineHeight: '1.55',
              color: tone.muted ?? MUTED,
              maxWidth: '52ch',
            },
          }),
          slot: 'description',
        },
      ],
    ),
  };

  return {
    components: [dish],
    node: section(
      'Menu',
      { background: tone.background ?? PAGE, inner: { gap: '52px' }, maxWidth: '900px' },
      [
        ...head('Menu', copy, tone),
        col(
          'Courses',
          '44px',
          {},
          courses.map((course) =>
            col('Course', '4px', {}, [
              text(`${course.name} label`, course.name, {
                base: {
                  fontFamily: BODY,
                  fontSize: '12px',
                  fontWeight: '600',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: ACCENT,
                  paddingBottom: '10px',
                },
              }),
              ...course.items.map((item) => ({
                kind: 'instance' as const,
                name: item.name,
                componentKey: 'dish',
                overrides: {
                  name: { text: item.name },
                  price: { text: item.price },
                  description: { text: item.description ?? '' },
                },
              })),
            ]),
          ),
        ),
      ],
    ),
  };
}

/* ----------------------------------------------------------------- hours -- */

export interface DayHours {
  day: string;
  hours: string;
}

/**
 * Opening hours, and where to find the place.
 *
 * These two are one section rather than two because they answer one question —
 * "can I go, and where" — and splitting them puts a scroll between the answer
 * and half of it. The address is a real block of text rather than a map embed:
 * a template cannot know the coordinates, and an empty map frame is worse than
 * an address somebody can paste into their own maps app.
 */
export function hours(
  copy: { eyebrow?: string; title?: string },
  days: DayHours[],
  place: { address: string[]; phone?: string; email?: string; note?: string },
  tone: Tone = {},
): ComposedSection {
  const first = days[0];

  const dayRow: ComponentBlueprint = {
    key: 'day',
    name: 'Opening day',
    root: row(
      'Opening day',
      '16px',
      {
        base: {
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingTop: '11px',
          paddingBottom: '11px',
          borderWidth: '0px 0px 1px 0px',
          borderStyle: 'solid',
          borderColor: BORDER,
        },
      },
      [
        {
          ...text('Day', first?.day ?? 'Monday', {
            base: { fontFamily: BODY, fontSize: '15px', fontWeight: '500', color: tone.ink ?? INK },
          }),
          slot: 'day',
        },
        {
          ...text('Time', first?.hours ?? 'Closed', {
            base: {
              fontFamily: BODY,
              fontSize: '15px',
              color: tone.muted ?? MUTED,
            },
          }),
          slot: 'time',
        },
      ],
    ),
  };

  return {
    components: [dayRow],
    node: section('Visit', { background: tone.background ?? SURFACE, inner: { gap: '44px' } }, [
      ...head('Visit', copy, tone),
      grid(
        'Visit columns',
        'minmax(0, 1fr) minmax(0, 1fr)',
        '56px',
        { mobile: { gridTemplateColumns: 'minmax(0, 1fr)', gap: '40px' } },
        [
          col('Opening hours', '0px', {}, [
            text('Hours label', 'Opening hours', {
              base: {
                fontFamily: BODY,
                fontSize: '12px',
                fontWeight: '600',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: ACCENT,
                paddingBottom: '14px',
              },
            }),
            ...days.map((entry) => ({
              kind: 'instance' as const,
              name: entry.day,
              componentKey: 'day',
              overrides: { day: { text: entry.day }, time: { text: entry.hours } },
            })),
            ...(place.note
              ? [
                  text('Hours note', place.note, {
                    base: {
                      fontFamily: BODY,
                      fontSize: '13px',
                      lineHeight: '1.6',
                      color: tone.muted ?? MUTED,
                      paddingTop: '16px',
                    },
                  }),
                ]
              : []),
          ]),
          col('Find us', '0px', {}, [
            text('Find label', 'Find us', {
              base: {
                fontFamily: BODY,
                fontSize: '12px',
                fontWeight: '600',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: ACCENT,
                paddingBottom: '14px',
              },
            }),
            col(
              'Address',
              '2px',
              {},
              place.address.map((line, index) =>
                text(`Address line ${index + 1}`, line, {
                  base: {
                    fontFamily: BODY,
                    fontSize: '15px',
                    lineHeight: '1.65',
                    color: tone.ink ?? INK,
                  },
                }),
              ),
            ),
            ...(place.phone || place.email
              ? [
                  col('Contact', '4px', { base: { paddingTop: '18px' } }, [
                    ...(place.phone
                      ? [
                          text('Phone', place.phone, {
                            base: { fontFamily: BODY, fontSize: '15px', color: tone.muted ?? MUTED },
                          }),
                        ]
                      : []),
                    ...(place.email
                      ? [
                          text('Email', place.email, {
                            base: { fontFamily: BODY, fontSize: '15px', color: tone.muted ?? MUTED },
                          }),
                        ]
                      : []),
                  ]),
                ]
              : []),
          ]),
        ],
      ),
    ]),
  };
}

/* -------------------------------------------------------------- services -- */

export interface ServiceItem {
  name: string;
  description: string;
  price?: string;
}

/**
 * What a practice or a trade actually does, priced where pricing is honest.
 *
 * Rows rather than a card grid. A clinic offers eleven treatments and a card
 * grid turns eleven treatments into eleven identical rectangles that have to
 * be read one at a time; a list is read at a glance, which is how somebody
 * looking for one specific treatment reads it.
 */
export function services(
  copy: { eyebrow?: string; title?: string; lede?: string },
  items: ServiceItem[],
  tone: Tone = {},
): ComposedSection {
  const first = items[0];
  const priced = items.some((item) => item.price);

  const service: ComponentBlueprint = {
    key: 'service',
    name: 'Service',
    root: box(
      'Service',
      {
        base: {
          display: 'grid',
          gridTemplateColumns: priced ? 'minmax(0, 15ch) minmax(0, 1fr) auto' : 'minmax(0, 15ch) minmax(0, 1fr)',
          gap: '28px',
          alignItems: 'baseline',
          paddingTop: '22px',
          paddingBottom: '22px',
          borderWidth: '0px 0px 1px 0px',
          borderStyle: 'solid',
          borderColor: BORDER,
        },
        mobile: { gridTemplateColumns: 'minmax(0, 1fr)', gap: '8px' },
      },
      [
        {
          ...text('Name', first?.name ?? 'Service', {
            base: {
              fontFamily: DISPLAY,
              fontSize: '17px',
              fontWeight: '600',
              lineHeight: '1.3',
              color: tone.ink ?? INK,
            },
          }),
          slot: 'name',
        },
        {
          ...text('Description', first?.description ?? '', {
            base: {
              fontFamily: BODY,
              fontSize: '15px',
              lineHeight: '1.6',
              color: tone.muted ?? MUTED,
            },
          }),
          slot: 'description',
        },
        ...(priced
          ? [
              {
                ...text('Price', first?.price ?? '', {
                  base: {
                    fontFamily: BODY,
                    fontSize: '15px',
                    fontWeight: '500',
                    color: tone.ink ?? INK,
                  },
                }),
                slot: 'price',
              },
            ]
          : []),
      ],
    ),
  };

  return {
    components: [service],
    node: section('Services', { background: tone.background ?? PAGE, inner: { gap: '44px' } }, [
      ...head('Services', copy, tone),
      col(
        'Service list',
        '0px',
        { base: { borderWidth: '1px 0px 0px 0px', borderStyle: 'solid', borderColor: BORDER } },
        items.map((item) => ({
          kind: 'instance' as const,
          name: item.name,
          componentKey: 'service',
          overrides: {
            name: { text: item.name },
            description: { text: item.description },
            ...(priced ? { price: { text: item.price ?? '' } } : {}),
          },
        })),
      ),
    ]),
  };
}

/* ------------------------------------------------------------------ team -- */

export interface Person {
  name: string;
  role: string;
  note?: string;
}

/**
 * The people, with the thing that makes them qualified.
 *
 * No photographs. A template that ships stock portraits of people who do not
 * work there is lying about the business in the most direct way available, and
 * the owner cannot fix it without a photographer. A named initial in a tinted
 * plate is honestly a placeholder and reads as a deliberate choice until it is
 * replaced.
 */
export function team(
  copy: { eyebrow?: string; title?: string; lede?: string },
  people: Person[],
  tone: Tone = {},
): ComposedSection {
  const first = people[0];

  const person: ComponentBlueprint = {
    key: 'person',
    name: 'Person',
    root: col('Person', '10px', {}, [
      box(
        'Portrait',
        {
          base: {
            display: 'flex',
            alignItems: 'flex-end',
            width: '100%',
            height: '230px',
            backgroundColor: SURFACE,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: BORDER,
            borderRadius: '10px',
            marginBottom: '6px',
            paddingLeft: '16px',
            paddingBottom: '14px',
          },
          mobile: { height: '170px' },
        },
        [
          {
            ...text('Initial', (first?.name ?? 'A').slice(0, 1), {
              base: {
                fontFamily: DISPLAY,
                fontSize: '34px',
                fontWeight: '600',
                color: BORDER,
                lineHeight: '1',
              },
            }),
            slot: 'initial',
          },
        ],
      ),
      {
        ...text('Name', first?.name ?? 'Name', {
          base: {
            fontFamily: DISPLAY,
            fontSize: '18px',
            fontWeight: '600',
            letterSpacing: '-0.015em',
            color: tone.ink ?? INK,
          },
        }),
        slot: 'name',
      },
      {
        ...text('Role', first?.role ?? '', {
          base: { fontFamily: BODY, fontSize: '14px', color: ACCENT },
        }),
        slot: 'role',
      },
      {
        ...text('Note', first?.note ?? '', {
          base: {
            fontFamily: BODY,
            fontSize: '14px',
            lineHeight: '1.6',
            color: tone.muted ?? MUTED,
          },
        }),
        slot: 'note',
      },
    ]),
  };

  return {
    components: [person],
    node: section('Team', { background: tone.background ?? PAGE, inner: { gap: '44px' } }, [
      ...head('Team', copy, tone),
      grid(
        'People',
        `repeat(${Math.min(people.length, 4)}, minmax(0, 1fr))`,
        '28px',
        { mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '20px' } },
        people.map((entry) => ({
          kind: 'instance' as const,
          name: entry.name,
          componentKey: 'person',
          overrides: {
            initial: { text: entry.name.slice(0, 1) },
            name: { text: entry.name },
            role: { text: entry.role },
            note: { text: entry.note ?? '' },
          },
        })),
      ),
    ]),
  };
}

/* ------------------------------------------------------------------- faq -- */

export interface QuestionAnswer {
  question: string;
  answer: string;
}

/**
 * The questions the phone keeps ringing about.
 *
 * Open, not an accordion. Everything here is one or two sentences, and hiding
 * two sentences behind a click costs a click and saves nothing — the whole
 * section is shorter than the hero above it.
 */
export function faq(
  copy: { eyebrow?: string; title?: string; lede?: string },
  items: QuestionAnswer[],
  tone: Tone = {},
): ComposedSection {
  const first = items[0];

  const entry: ComponentBlueprint = {
    key: 'qa',
    name: 'Question',
    root: col(
      'Question',
      '8px',
      {
        base: {
          paddingTop: '24px',
          paddingBottom: '24px',
          borderWidth: '0px 0px 1px 0px',
          borderStyle: 'solid',
          borderColor: BORDER,
        },
      },
      [
        {
          ...text('Question', first?.question ?? 'A question', {
            base: {
              fontFamily: DISPLAY,
              fontSize: '17px',
              fontWeight: '600',
              lineHeight: '1.35',
              color: tone.ink ?? INK,
            },
          }),
          slot: 'question',
        },
        {
          ...text('Answer', first?.answer ?? '', {
            base: {
              fontFamily: BODY,
              fontSize: '15px',
              lineHeight: '1.65',
              color: tone.muted ?? MUTED,
              maxWidth: '68ch',
            },
          }),
          slot: 'answer',
        },
      ],
    ),
  };

  return {
    components: [entry],
    node: section(
      'Questions',
      { background: tone.background ?? PAGE, inner: { gap: '36px' }, maxWidth: '860px' },
      [
        ...head('Questions', copy, tone),
        col(
          'Question list',
          '0px',
          { base: { borderWidth: '1px 0px 0px 0px', borderStyle: 'solid', borderColor: BORDER } },
          items.map((item) => ({
            kind: 'instance' as const,
            name: item.question,
            componentKey: 'qa',
            overrides: { question: { text: item.question }, answer: { text: item.answer } },
          })),
        ),
      ],
    ),
  };
}

/* --------------------------------------------------------------- booking -- */

/**
 * The ask, for a business where the ask is a phone call or an appointment.
 *
 * Louder than `cta` from `patterns.ts`, and it carries the phone number rather
 * than only a button: half the people reading a clinic page on a phone are
 * going to call, and making them find the number in the footer is a worse
 * conversion path than putting it here in type they can tap.
 */
export function booking(
  copy: { title: string; body?: string; action: string; phone?: string; note?: string },
  tone: Tone = {},
): NodeBlueprint {
  return section(
    'Booking',
    {
      background: tone.background ?? SURFACE,
      paddingY: '84px',
      paddingYMobile: '60px',
      inner: { gap: '22px', alignItems: 'center' },
    },
    [
      title('Booking title', copy.title, {
        color: tone.ink,
        align: 'center',
        size: 38,
      }),
      ...(copy.body
        ? [
            lede('Booking body', copy.body, {
              color: tone.muted,
              align: 'center',
              maxWidth: '56ch',
            }),
          ]
        : []),
      row('Booking actions', '14px', { base: { paddingTop: '8px' }, mobile: { flexDirection: 'column' } }, [
        primaryButton(copy.action),
        ...(copy.phone
          ? [
              text('Booking phone', copy.phone, {
                base: {
                  fontFamily: DISPLAY,
                  fontSize: '20px',
                  fontWeight: '600',
                  letterSpacing: '-0.01em',
                  color: tone.ink ?? INK,
                  paddingLeft: '8px',
                },
              }),
            ]
          : []),
      ]),
      ...(copy.note
        ? [
            text('Booking note', copy.note, {
              base: {
                fontFamily: BODY,
                fontSize: '13px',
                color: tone.muted ?? MUTED,
                textAlign: 'center',
              },
            }),
          ]
        : []),
    ],
  );
}

/* ----------------------------------------------------------- service area -- */

/**
 * Where a trade will actually travel to.
 *
 * The single most useful fact on a plumber's site and the one most often
 * missing. Set as plain text rather than a map, for the same reason the
 * address is: a template cannot know the coverage, and a wrong map is worse
 * than a list somebody can read.
 */
export function serviceAreas(
  copy: { eyebrow?: string; title?: string; lede?: string },
  areas: string[],
  tone: Tone = {},
): NodeBlueprint {
  return section(
    'Service area',
    { background: tone.background ?? SURFACE, paddingY: '76px', paddingYMobile: '56px', inner: { gap: '32px' } },
    [
      ...head('Service area', copy, tone),
      box(
        'Area list',
        {
          base: {
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: '10px',
          },
        },
        areas.map((area) =>
          text(area, area, {
            base: {
              fontFamily: BODY,
              fontSize: '14px',
              fontWeight: '500',
              color: tone.ink ?? INK,
              backgroundColor: tone.background ? PAGE : SURFACE,
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: BORDER,
              borderRadius: '999px',
              paddingTop: '8px',
              paddingBottom: '8px',
              paddingLeft: '16px',
              paddingRight: '16px',
            },
          }),
        ),
      ),
    ],
  );
}

/* ------------------------------------------------------------------ tiers -- */

export interface Tier {
  name: string;
  price: string;
  cadence: string;
  includes: string;
}

/**
 * Membership pricing.
 *
 * Three columns, no "most popular" badge and no crossed-out anchor price.
 * Both are pressure tactics, both are the first thing a studio owner would
 * have to delete, and a template that ships them has decided how its owner
 * sells before meeting them.
 */
export function tiers(
  copy: { eyebrow?: string; title?: string; lede?: string },
  plans: Tier[],
  tone: Tone = {},
): ComposedSection {
  const first = plans[0];

  const tier: ComponentBlueprint = {
    key: 'tier',
    name: 'Membership',
    root: col(
      'Membership',
      '8px',
      {
        base: {
          backgroundColor: tone.background === SURFACE ? PAGE : SURFACE,
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: BORDER,
          borderRadius: '14px',
          paddingTop: '30px',
          paddingBottom: '30px',
          paddingLeft: '26px',
          paddingRight: '26px',
        },
      },
      [
        {
          ...text('Name', first?.name ?? 'Membership', {
            base: {
              fontFamily: BODY,
              fontSize: '12px',
              fontWeight: '600',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: ACCENT,
            },
          }),
          slot: 'name',
        },
        row('Price line', '6px', { base: { alignItems: 'baseline', paddingTop: '6px' } }, [
          {
            ...text('Price', first?.price ?? '£0', {
              base: {
                fontFamily: DISPLAY,
                fontSize: '40px',
                fontWeight: '700',
                letterSpacing: '-0.03em',
                color: tone.ink ?? INK,
              },
              mobile: { fontSize: '32px' },
            }),
            slot: 'price',
          },
          {
            ...text('Cadence', first?.cadence ?? '', {
              base: { fontFamily: BODY, fontSize: '14px', color: tone.muted ?? MUTED },
            }),
            slot: 'cadence',
          },
        ]),
        {
          ...text('Includes', first?.includes ?? '', {
            base: {
              fontFamily: BODY,
              fontSize: '14px',
              lineHeight: '1.65',
              color: tone.muted ?? MUTED,
              paddingTop: '8px',
            },
          }),
          slot: 'includes',
        },
      ],
    ),
  };

  return {
    components: [tier],
    node: section('Membership', { background: tone.background ?? PAGE, inner: { gap: '44px' } }, [
      ...head('Membership', copy, tone),
      grid(
        'Membership tiers',
        `repeat(${plans.length}, minmax(0, 1fr))`,
        '18px',
        { mobile: { gridTemplateColumns: 'minmax(0, 1fr)' } },
        plans.map((plan) => ({
          kind: 'instance' as const,
          name: plan.name,
          componentKey: 'tier',
          overrides: {
            name: { text: plan.name },
            price: { text: plan.price },
            cadence: { text: plan.cadence },
            includes: { text: plan.includes },
          },
        })),
      ),
    ]),
  };
}

/* ---------------------------------------------------------------- opening -- */

/**
 * A local hero: the name of the place, what it is, and how to reach it.
 *
 * Deliberately not `heroSplit`. A product hero puts a screenshot beside the
 * argument because the product is the thing being sold; a restaurant has no
 * screenshot, and the honest equivalent is the one line that says what kind of
 * place it is, sitting above the two facts everybody scrolls for.
 */
export function placeHero(
  copy: {
    eyebrow?: string;
    title: string;
    lede: string;
    action?: string;
    phone?: string;
    facts?: string[];
  },
  tone: Tone = {},
): NodeBlueprint {
  return section(
    'Opening',
    {
      background: tone.background ?? PAGE,
      paddingY: '116px',
      paddingYMobile: '76px',
      inner: { gap: '26px' },
      // Above the fold: nothing has been scrolled to yet.
      reveal: false,
    },
    [
      ...(copy.eyebrow ? [eyebrow('Opening eyebrow', copy.eyebrow)] : []),
      {
        ...title('Opening title', copy.title, { color: tone.ink, size: 62 }),
        props: { level: 1 as const },
      },
      lede('Opening lede', copy.lede, { color: tone.muted, maxWidth: '54ch', size: 19 }),
      ...(copy.action || copy.phone
        ? [
            row('Opening actions', '16px', { base: { paddingTop: '10px' }, mobile: { flexWrap: 'wrap' } }, [
              ...(copy.action ? [primaryButton(copy.action)] : []),
              ...(copy.phone
                ? [
                    text('Opening phone', copy.phone, {
                      base: {
                        fontFamily: DISPLAY,
                        fontSize: '18px',
                        fontWeight: '600',
                        color: tone.ink ?? INK,
                      },
                    }),
                  ]
                : []),
            ]),
          ]
        : []),
      ...(copy.facts?.length
        ? [
            box('Opening facts', { base: { paddingTop: '28px', width: '100%' } }, [
              divider('Opening rule', { base: { backgroundColor: BORDER, marginBottom: '20px' } }),
              row(
                'Fact row',
                '40px',
                { mobile: { flexDirection: 'column', alignItems: 'flex-start', gap: '10px' } },
                copy.facts.map((fact) =>
                  body(fact, fact, { color: tone.muted }),
                ),
              ),
            ]),
          ]
        : []),
    ],
  );
}
