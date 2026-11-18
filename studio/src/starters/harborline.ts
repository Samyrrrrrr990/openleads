/**
 * Starter: Harborline — operations consulting for mid-size manufacturers.
 *
 * Direction: institutional. A deep ink-green ground with ivory type, denser
 * setting than the other starters, structured two-column blocks and a muted
 * brass accent. Reads as long-established rather than newly funded.
 */

import type { PageBlueprint, ProjectTheme } from '@zory/core';
import { themeVarRef } from '@zory/core';
import { box, button, col, divider, grid, heading, link, row, section, text } from './builders';

/* The theme holds the literals; the constants below refer to it. See cadence.ts. */
export const harborlineTheme: ProjectTheme = {
  background: '#10201c',
  surface: '#0a1613',
  text: '#f0ede4',
  textMuted: '#a8b3ad',
  accent: '#c2a05a',
  accentText: '#10201c',
  border: '#243a34',
  fontDisplay: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  fontBody: "'Inter', system-ui, -apple-system, sans-serif",
};

const INK = themeVarRef('background');
const INK_DEEP = themeVarRef('surface');
const IVORY = themeVarRef('text');
const IVORY_DIM = themeVarRef('textMuted');
const BRASS = themeVarRef('accent');
const RULE = themeVarRef('border');
const SERIF = themeVarRef('fontDisplay');
const SANS = themeVarRef('fontBody');

const practice = (title: string, body: string, detail: string) =>
  col(
    title,
    '12px',
    {
      base: {
        paddingTop: '28px',
        borderWidth: '2px 0 0 0',
        borderStyle: 'solid',
        borderColor: BRASS,
      },
    },
    [
      heading(`${title} title`, title, 3, {
        base: { fontFamily: SERIF, fontSize: '21px', fontWeight: '400', color: IVORY },
      }),
      text(`${title} body`, body, {
        base: { fontSize: '14px', lineHeight: '1.7', color: IVORY_DIM },
      }),
      text(`${title} detail`, detail, {
        base: {
          fontSize: '12px',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: BRASS,
          marginTop: '4px',
        },
      }),
    ],
  );

const homePage: PageBlueprint = {
  name: 'Home',
  path: '/',
  root: box(
    'Page',
    {
      tag: 'main',
      base: {
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: INK,
        color: IVORY,
        fontFamily: SANS,
      },
    },
    [
      // ---- Header ----
      box(
        'Header',
        {
          tag: 'header',
          base: {
            display: 'flex',
            justifyContent: 'center',
            width: '100%',
            paddingTop: '20px',
            paddingRight: '32px',
            paddingBottom: '20px',
            paddingLeft: '32px',
            borderWidth: '0 0 1px 0',
            borderStyle: 'solid',
            borderColor: RULE,
          },
          mobile: { paddingRight: '20px', paddingLeft: '20px' },
        },
        [
          row(
            'Header inner',
            '32px',
            { base: { width: '100%', maxWidth: '1080px', justifyContent: 'space-between' } },
            [
              col('Brand', '2px', {}, [
                text('Wordmark', 'Harborline', {
                  base: {
                    fontFamily: SERIF,
                    fontSize: '20px',
                    fontWeight: '400',
                    letterSpacing: '0.01em',
                    color: IVORY,
                  },
                }),
                text('Brand line', 'Operations consulting', {
                  base: {
                    fontSize: '11px',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: IVORY_DIM,
                  },
                  mobile: { display: 'none' },
                }),
              ]),
              row('Header nav', '26px', { mobile: { gap: '18px' } }, [
                link('Practice link', 'Practice', '#practice', {
                  base: { fontSize: '14px', color: IVORY_DIM },
                }),
                link('Engagements link', 'Engagements', '#engagements', {
                  base: { fontSize: '14px', color: IVORY_DIM },
                }),
                link('Contact link', 'Contact', '#contact', {
                  base: { fontSize: '14px', color: IVORY_DIM },
                }),
              ]),
              button('Header CTA', 'Request a consultation', {
                base: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  paddingTop: '9px',
                  paddingRight: '16px',
                  paddingBottom: '9px',
                  paddingLeft: '16px',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: BRASS,
                  color: BRASS,
                  borderRadius: '2px',
                  fontSize: '13px',
                  fontWeight: '500',
                },
                // Stays on a phone. It is the page's one action, and hiding it
                // there hid it from most of the people who would use it.
                mobile: { fontSize: '12px', paddingLeft: '14px', paddingRight: '14px' },
              }),
            ],
          ),
        ],
      ),

      // ---- Hero ----
      section(
        'Hero',
        { paddingY: '96px', paddingYMobile: '56px', maxWidth: '1080px', inner: { gap: '36px' } },
        [
          row(
            'Hero columns',
            '72px',
            {
              base: { alignItems: 'flex-start' },
              tablet: { gap: '40px' },
              mobile: { flexDirection: 'column', gap: '28px' },
            },
            [
              col('Hero left', '24px', { base: { width: '100%' } }, [
                text('Hero eyebrow', 'Established 2009', {
                  base: {
                    fontSize: '12px',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: BRASS,
                  },
                }),
                heading('Hero title', 'The floor already knows what is wrong. We help you act on it.', 1, {
                  base: {
                    fontFamily: SERIF,
                    fontSize: '54px',
                    fontWeight: '400',
                    lineHeight: '1.08',
                    letterSpacing: '-0.02em',
                    color: IVORY,
                  },
                  tablet: { fontSize: '42px' },
                  mobile: { fontSize: '31px' },
                }),
              ]),
              col('Hero right', '20px', { base: { width: '100%', paddingTop: '38px' }, mobile: { paddingTop: '0px' } }, [
                text(
                  'Hero body',
                  'Harborline works with manufacturers between £20m and £200m in revenue, usually at the point where the systems that got them here have started to cost them. We spend the first month on the floor, not in the boardroom.',
                  { base: { fontSize: '16px', lineHeight: '1.75', color: IVORY_DIM } },
                ),
                row('Hero actions', '20px', { base: { marginTop: '4px' } }, [
                  button('Hero CTA', 'Request a consultation', {
                    base: {
                      display: 'inline-flex',
                      alignItems: 'center',
                      paddingTop: '12px',
                      paddingRight: '20px',
                      paddingBottom: '12px',
                      paddingLeft: '20px',
                      backgroundColor: BRASS,
                      color: INK,
                      borderRadius: '2px',
                      fontSize: '14px',
                      fontWeight: '600',
                    },
                  }),
                  link('Hero secondary', 'How we engage', '#engagements', {
                    base: {
                      fontSize: '14px',
                      color: IVORY,
                      borderWidth: '0 0 1px 0',
                      borderStyle: 'solid',
                      borderColor: RULE,
                      paddingBottom: '2px',
                    },
                  }),
                ]),
              ]),
            ],
          ),
        ],
      ),

      divider('Hero rule', {
        base: {
          width: '100%',
          minHeight: '1px',
          backgroundColor: RULE,
          borderStyle: 'none',
        },
      }),

      // ---- Practice areas ----
      section(
        'Practice',
        {
          anchor: 'practice',
          paddingY: '88px',
          paddingYMobile: '56px',
          maxWidth: '1080px',
          inner: { gap: '44px' },
        },
        [
          col('Practice head', '14px', { base: { maxWidth: '54ch' } }, [
            heading('Practice title', 'Three practices, one engagement team', 2, {
              base: {
                fontFamily: SERIF,
                fontSize: '34px',
                fontWeight: '400',
                letterSpacing: '-0.015em',
                color: IVORY,
              },
              mobile: { fontSize: '26px' },
            }),
            text(
              'Practice subtitle',
              'We do not hand you to a delivery pod after the pitch. The people who scope the work are the people who do it.',
              { base: { fontSize: '16px', lineHeight: '1.7', color: IVORY_DIM } },
            ),
          ]),
          grid(
            'Practice grid',
            'repeat(3, minmax(0, 1fr))',
            '32px',
            { mobile: { gridTemplateColumns: 'minmax(0, 1fr)', gap: '28px' } },
            [
              practice(
                'Throughput',
                'Line balancing, changeover reduction and the scheduling discipline to keep both. Most of our clients find a third of their capacity was never a capital problem.',
                'Typical engagement: 14 weeks',
              ),
              practice(
                'Supply',
                'Supplier consolidation, dual-sourcing for the parts that actually stop the line, and inventory policy that survives a bad quarter.',
                'Typical engagement: 20 weeks',
              ),
              practice(
                'Succession',
                'Transferring what your longest-serving operators know into something the next shift can follow. Usually the most urgent work and the last to be commissioned.',
                'Typical engagement: 9 months',
              ),
            ],
          ),
        ],
      ),

      // ---- Engagement model ----
      section(
        'Engagements',
        {
          anchor: 'engagements',
          background: INK_DEEP,
          paddingY: '88px',
          paddingYMobile: '56px',
          maxWidth: '1080px',
          inner: { gap: '36px' },
        },
        [
          heading('Engagements title', 'How we engage', 2, {
            base: {
              fontFamily: SERIF,
              fontSize: '34px',
              fontWeight: '400',
              letterSpacing: '-0.015em',
              color: IVORY,
            },
            mobile: { fontSize: '26px' },
          }),
          col('Engagement rows', '0px', { base: { width: '100%' } }, [
            engagementRow(
              'Assessment',
              'Four weeks on site. We shadow every shift, read five years of maintenance logs, and give you a written account of what we found, whether or not you hire us for the rest.',
              'Fixed fee',
            ),
            engagementRow(
              'Programme',
              'Three to nine months, two consultants embedded. Weekly working sessions with your team, monthly written reporting to the board, no slide decks in between.',
              'Monthly retainer',
            ),
            engagementRow(
              'Stewardship',
              'Quarterly reviews for two years after the programme closes. This is where the gains either hold or quietly disappear, so we price it to be easy to keep.',
              'Annual',
            ),
          ]),
        ],
      ),

      // ---- Contact ----
      section(
        'Contact',
        {
          anchor: 'contact',
          paddingY: '88px',
          paddingYMobile: '56px',
          maxWidth: '1080px',
          inner: { gap: '24px' },
        },
        [
          heading('Contact title', 'Start with a conversation about your floor.', 2, {
            base: {
              fontFamily: SERIF,
              fontSize: '38px',
              fontWeight: '400',
              lineHeight: '1.12',
              letterSpacing: '-0.02em',
              color: IVORY,
              maxWidth: '20ch',
            },
            mobile: { fontSize: '27px' },
          }),
          text(
            'Contact body',
            'We take four new clients a year. If we are not the right firm for the problem, we will tell you in the first call and point you at someone who is.',
            { base: { fontSize: '16px', lineHeight: '1.7', color: IVORY_DIM, maxWidth: '52ch' } },
          ),
          row('Contact actions', '24px', { base: { marginTop: '8px' }, mobile: { flexWrap: 'wrap' } }, [
            button('Contact CTA', 'Request a consultation', {
              base: {
                display: 'inline-flex',
                alignItems: 'center',
                paddingTop: '13px',
                paddingRight: '22px',
                paddingBottom: '13px',
                paddingLeft: '22px',
                backgroundColor: BRASS,
                color: INK,
                borderRadius: '2px',
                fontSize: '14px',
                fontWeight: '600',
              },
            }),
            link('Contact phone', '+44 161 496 0180', 'tel:+441614960180', {
              base: { fontSize: '15px', color: IVORY_DIM },
            }),
          ]),
        ],
      ),

      // ---- Footer ----
      box(
        'Footer',
        {
          tag: 'footer',
          base: {
            display: 'flex',
            justifyContent: 'center',
            width: '100%',
            paddingTop: '28px',
            paddingRight: '32px',
            paddingBottom: '32px',
            paddingLeft: '32px',
            borderWidth: '1px 0 0 0',
            borderStyle: 'solid',
            borderColor: RULE,
          },
          mobile: { paddingRight: '20px', paddingLeft: '20px' },
        },
        [
          row(
            'Footer inner',
            '24px',
            {
              base: { width: '100%', maxWidth: '1080px', justifyContent: 'space-between', alignItems: 'flex-start' },
              mobile: { flexDirection: 'column', gap: '16px' },
            },
            [
              col('Footer address', '4px', {}, [
                text('Footer firm', 'Harborline Consulting LLP', {
                  base: { fontSize: '13px', color: IVORY },
                }),
                text('Footer street', 'Ropewalks, 14 Blackfriars Road, Manchester M3 5AZ', {
                  base: { fontSize: '13px', color: IVORY_DIM },
                }),
              ]),
              text('Footer registration', 'Registered in England & Wales, OC351902', {
                base: { fontSize: '13px', color: IVORY_DIM },
              }),
            ],
          ),
        ],
      ),
    ],
  ),
};

/** A labelled row in the engagement table. */
function engagementRow(title: string, body: string, terms: string) {
  return row(
    title,
    '40px',
    {
      base: {
        alignItems: 'flex-start',
        width: '100%',
        paddingTop: '26px',
        paddingBottom: '26px',
        borderWidth: '0 0 1px 0',
        borderStyle: 'solid',
        borderColor: RULE,
      },
      mobile: { flexDirection: 'column', gap: '10px' },
    },
    [
      heading(`${title} label`, title, 3, {
        base: {
          fontFamily: SERIF,
          fontSize: '20px',
          fontWeight: '400',
          color: IVORY,
          width: '200px',
        },
        mobile: { width: '100%' },
      }),
      text(`${title} body`, body, {
        base: { fontSize: '15px', lineHeight: '1.7', color: IVORY_DIM, width: '100%' },
      }),
      text(`${title} terms`, terms, {
        base: {
          fontSize: '12px',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: BRASS,
          width: '160px',
          textAlign: 'right',
        },
        mobile: { width: '100%', textAlign: 'left' },
      }),
    ],
  );
}

export const harborlinePages: PageBlueprint[] = [homePage];
