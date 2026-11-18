/**
 * The sections a second page needs and a home page does not.
 *
 * Every template used to be one page, so the pattern library only ever had to
 * build a home page: a hero, some argument, a call to action. A pricing page
 * and a contact page need two things it never had — a compact head that names
 * where you are without pretending to be a hero, and somewhere to actually put
 * a way of getting in touch.
 *
 * Both are here rather than in `patterns.ts` because that file is already
 * eight hundred lines and these belong to a different job: `patterns.ts`
 * builds the argument, this builds the rest of the site around it.
 */

import type { NodeBlueprint } from '@zory/core';
import { col, grid, link, row, section, text } from './builders';
import {
  ACCENT,
  BODY,
  BORDER,
  DISPLAY,
  INK,
  MUTED,
  PAGE,
  SURFACE,
  body,
  display,
  eyebrow,
  lede,
  primaryButton,
  title,
} from './patterns';

interface Tone {
  background?: string;
  ink?: string;
  muted?: string;
}

/**
 * The top of a page that is not the home page.
 *
 * Deliberately not a hero. A hero's job is to make an argument to somebody who
 * has just arrived; the top of a pricing page is for somebody who has already
 * been convinced enough to click "Pricing", and repeating the pitch at them
 * wastes the fold. So: a line saying where they are, a heading, and one
 * sentence of orientation.
 */
export function pageHead(
  copy: { eyebrow?: string; title: string; lede?: string },
  tone: Tone = {},
): NodeBlueprint {
  return section(
    'Page head',
    {
      background: tone.background ?? PAGE,
      paddingY: '72px',
      paddingYMobile: '48px',
      inner: { gap: '16px', maxWidth: '760px' },
      // The first thing on a secondary page, so it is already in view.
      reveal: false,
    },
    [
      ...(copy.eyebrow ? [eyebrow('Page eyebrow', copy.eyebrow, { color: tone.muted ?? ACCENT })] : []),
      display('Page title', copy.title, { scale: 0.72, color: tone.ink ?? INK }),
      ...(copy.lede ? [lede('Page lede', copy.lede, { color: tone.muted ?? MUTED })] : []),
    ],
  );
}

export interface ContactChannel {
  /** What this is: "Email", "Phone", "Studio". */
  label: string;
  /** The thing itself, shown as written. */
  value: string;
  /**
   * Where it goes. A `mailto:` or `tel:` when there is one, and omitted when
   * there is nothing to link — a street address is not a hyperlink.
   */
  href?: string;
  /** One line of when or why to use this one. */
  note?: string;
}

/**
 * How to get in touch, as facts rather than as a form.
 *
 * No form, and it is worth saying why: Zory exports markup and CSS, so a form
 * would have no handler behind it. A template that ships an input and a Send
 * button that silently does nothing is worse than no form — it loses the
 * message somebody typed, and they have no way of knowing. Real addresses that
 * a founder swaps for their own are useful on the day they export it.
 */
export function contact(
  copy: { eyebrow?: string; title: string; lede?: string },
  channels: ContactChannel[],
  tone: Tone = {},
): NodeBlueprint {
  return section(
    'Contact',
    {
      background: tone.background ?? PAGE,
      inner: { display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: '56px' },
      innerMobile: { gridTemplateColumns: '1fr', gap: '32px' },
    },
    [
      col('Contact copy', '14px', {}, [
        ...(copy.eyebrow ? [eyebrow('Contact eyebrow', copy.eyebrow, { color: tone.muted ?? ACCENT })] : []),
        title('Contact title', copy.title, { color: tone.ink ?? INK }),
        ...(copy.lede ? [body('Contact lede', copy.lede, { color: tone.muted ?? MUTED })] : []),
      ]),
      col(
        'Channels',
        '0px',
        { base: { borderWidth: '1px 0px 0px 0px', borderStyle: 'solid', borderColor: BORDER } },
        channels.map((channel) =>
          col(
            channel.label,
            '6px',
            {
              base: {
                paddingTop: '20px',
                paddingBottom: '20px',
                borderWidth: '0px 0px 1px 0px',
                borderStyle: 'solid',
                borderColor: BORDER,
              },
            },
            [
              text(`${channel.label} label`, channel.label, {
                base: {
                  fontFamily: BODY,
                  fontSize: '11px',
                  fontWeight: '600',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: tone.muted ?? MUTED,
                },
              }),
              channel.href
                ? link(`${channel.label} value`, channel.value, channel.href, {
                    base: {
                      fontFamily: DISPLAY,
                      fontSize: '19px',
                      fontWeight: '500',
                      letterSpacing: '-0.01em',
                      color: tone.ink ?? INK,
                    },
                  })
                : text(`${channel.label} value`, channel.value, {
                    base: {
                      fontFamily: DISPLAY,
                      fontSize: '19px',
                      fontWeight: '500',
                      letterSpacing: '-0.01em',
                      lineHeight: '1.4',
                      color: tone.ink ?? INK,
                    },
                  }),
              ...(channel.note
                ? [
                    text(`${channel.label} note`, channel.note, {
                      base: { fontFamily: BODY, fontSize: '13px', lineHeight: '1.55', color: tone.muted ?? MUTED },
                    }),
                  ]
                : []),
            ],
          ),
        ),
      ),
    ],
  );
}

export interface Question {
  question: string;
  answer: string;
}

/**
 * Questions and answers in two columns.
 *
 * `faq` in `localPatterns` is the component-backed version, for a page that
 * repeats the shape many times. This is the plain one, for a pricing page
 * that has four of them and does not need a definition to edit in one place.
 */
export function notes(
  copy: { eyebrow?: string; title: string },
  items: Question[],
  tone: Tone = {},
): NodeBlueprint {
  return section(
    'Notes',
    { background: tone.background ?? SURFACE, inner: { gap: '28px' } },
    [
      col('Notes head', '12px', {}, [
        ...(copy.eyebrow ? [eyebrow('Notes eyebrow', copy.eyebrow, { color: tone.muted ?? ACCENT })] : []),
        title('Notes title', copy.title, { color: tone.ink ?? INK }),
      ]),
      grid(
        'Notes grid',
        'repeat(2, minmax(0, 1fr))',
        '30px',
        { mobile: { gridTemplateColumns: '1fr', gap: '24px' } },
        items.map((item) =>
          col(item.question, '8px', {}, [
            text(`${item.question} q`, item.question, {
              base: {
                fontFamily: DISPLAY,
                fontSize: '17px',
                fontWeight: '600',
                lineHeight: '1.35',
                color: tone.ink ?? INK,
              },
            }),
            text(`${item.question} a`, item.answer, {
              base: { fontFamily: BODY, fontSize: '15px', lineHeight: '1.65', color: tone.muted ?? MUTED },
            }),
          ]),
        ),
      ),
    ],
  );
}

/**
 * A closing line with one action, for the foot of a secondary page.
 *
 * `cta` in `patterns.ts` is the home page's — full bleed, two buttons, its own
 * background. This is the quieter one: somebody who read a pricing table does
 * not need to be sold again, they need the next click to be obvious.
 */
export function closer(
  copy: { title: string; action: string; note?: string },
  tone: Tone = {},
): NodeBlueprint {
  return section(
    'Closer',
    {
      background: tone.background ?? PAGE,
      paddingY: '64px',
      paddingYMobile: '48px',
      inner: { gap: '20px' },
    },
    [
      row(
        'Closer row',
        '28px',
        {
          base: { justifyContent: 'space-between', alignItems: 'center', width: '100%' },
          mobile: { flexDirection: 'column', alignItems: 'flex-start', gap: '20px' },
        },
        [
          col('Closer copy', '8px', { base: { maxWidth: '46ch' } }, [
            title('Closer title', copy.title, { color: tone.ink ?? INK }),
            ...(copy.note
              ? [
                  text('Closer note', copy.note, {
                    base: { fontFamily: BODY, fontSize: '14px', lineHeight: '1.6', color: tone.muted ?? MUTED },
                  }),
                ]
              : []),
          ]),
          primaryButton(copy.action),
        ],
      ),
    ],
  );
}
