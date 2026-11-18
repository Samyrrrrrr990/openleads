/**
 * Starter: Ilse Fontaine — art director and graphic designer.
 *
 * Direction: editorial. Warm paper ground, an oversized serif display set very
 * tight, asymmetric measure, and index-style project rows instead of cards.
 * Almost no chrome — the type does the work.
 */

import type { PageBlueprint, ProjectTheme } from '@zory/core';
import { themeVarRef } from '@zory/core';
import { box, col, divider, heading, link, row, section, text } from './builders';

/* The theme holds the literals; the constants below refer to it. See cadence.ts. */
export const fontaineTheme: ProjectTheme = {
  background: '#f2efe8',
  surface: '#e9e5db',
  text: '#171512',
  textMuted: '#6c665c',
  accent: '#171512',
  accentText: '#f2efe8',
  border: '#d8d2c6',
  fontDisplay: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  fontBody: "'Inter', system-ui, -apple-system, sans-serif",
};

const PAPER = themeVarRef('background');
const IRON = themeVarRef('text');
const MUTED = themeVarRef('textMuted');
const RULE = themeVarRef('border');
const SERIF = themeVarRef('fontDisplay');
const SANS = themeVarRef('fontBody');

/** An index row: year, title, discipline. Reads like a printed contents page. */
const work = (year: string, title: string, discipline: string) =>
  row(
    title,
    '24px',
    {
      base: {
        justifyContent: 'space-between',
        alignItems: 'baseline',
        width: '100%',
        paddingTop: '20px',
        paddingBottom: '20px',
        borderWidth: '0 0 1px 0',
        borderStyle: 'solid',
        borderColor: RULE,
      },
      mobile: { flexDirection: 'column', alignItems: 'flex-start', gap: '6px' },
    },
    [
      row('Left', '20px', { base: { alignItems: 'baseline' } }, [
        text(`${title} year`, year, {
          base: {
            fontFamily: SANS,
            fontSize: '13px',
            color: MUTED,
            width: '48px',
          },
        }),
        heading(`${title} name`, title, 3, {
          base: {
            fontFamily: SERIF,
            fontSize: '26px',
            fontWeight: '400',
            letterSpacing: '-0.015em',
            color: IRON,
          },
          mobile: { fontSize: '21px' },
        }),
      ]),
      text(`${title} discipline`, discipline, {
        base: { fontFamily: SANS, fontSize: '13px', color: MUTED, textAlign: 'right' },
        mobile: { textAlign: 'left', marginLeft: '68px' },
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
        backgroundColor: PAPER,
        color: IRON,
        fontFamily: SANS,
      },
    },
    [
      // ---- Masthead ----
      box(
        'Masthead',
        {
          tag: 'header',
          base: {
            display: 'flex',
            justifyContent: 'center',
            width: '100%',
            paddingTop: '28px',
            paddingRight: '40px',
            paddingBottom: '28px',
            paddingLeft: '40px',
          },
          mobile: { paddingRight: '20px', paddingLeft: '20px', paddingTop: '20px', paddingBottom: '20px' },
        },
        [
          row(
            'Masthead inner',
            '32px',
            { base: { width: '100%', maxWidth: '1080px', justifyContent: 'space-between' } },
            [
              text('Wordmark', 'Ilse Fontaine', {
                base: {
                  fontFamily: SERIF,
                  fontSize: '19px',
                  fontWeight: '400',
                  letterSpacing: '-0.01em',
                  color: IRON,
                },
              }),
              row('Masthead links', '28px', {}, [
                link('Work link', 'Work', '#work', { base: { fontSize: '14px', color: MUTED } }),
                link('About link', 'About', '#about', { base: { fontSize: '14px', color: MUTED } }),
                link('Contact link', 'Contact', '#contact', {
                  base: { fontSize: '14px', color: IRON, fontWeight: '500' },
                }),
              ]),
            ],
          ),
        ],
      ),

      // ---- Statement ----
      section(
        'Statement',
        {
          paddingY: '80px',
          paddingYMobile: '48px',
          maxWidth: '1080px',
          inner: { gap: '40px' },
        },
        [
          heading(
            'Statement headline',
            'I make identities for people who would rather be remembered than liked.',
            1,
            {
              base: {
                fontFamily: SERIF,
                fontSize: '76px',
                fontWeight: '400',
                lineHeight: '1.02',
                letterSpacing: '-0.032em',
                color: IRON,
                maxWidth: '18ch',
              },
              tablet: { fontSize: '56px' },
              mobile: { fontSize: '36px', letterSpacing: '-0.02em' },
            },
          ),
          row(
            'Statement meta',
            '64px',
            {
              base: { alignItems: 'flex-start', marginTop: '8px' },
              mobile: { flexDirection: 'column', gap: '24px' },
            },
            [
              text(
                'Statement body',
                'Fifteen years of brand and editorial work, most of it for cultural institutions, independent publishers and the occasional restaurant that deserved better. I work alone, take three projects at a time, and stay through implementation.',
                {
                  base: {
                    fontFamily: SANS,
                    fontSize: '16px',
                    lineHeight: '1.7',
                    color: MUTED,
                    maxWidth: '46ch',
                  },
                },
              ),
              col('Statement details', '10px', { base: { minHeight: '1px' } }, [
                text('Based label', 'Based in Antwerp', {
                  base: { fontSize: '14px', color: IRON },
                }),
                text('Available label', 'Booking from March 2026', {
                  base: { fontSize: '14px', color: MUTED },
                }),
              ]),
            ],
          ),
        ],
      ),

      // ---- Selected work ----
      section(
        'Work',
        {
          // The masthead's `#work` link has always pointed here; until
          // `props.anchor` existed there was no way to say so.
          anchor: 'work',
          paddingY: '48px',
          paddingYMobile: '32px',
          maxWidth: '1080px',
          inner: { gap: '8px' },
        },
        [
          row(
            'Work head',
            '16px',
            {
              base: {
                justifyContent: 'space-between',
                alignItems: 'baseline',
                paddingBottom: '12px',
              },
            },
            [
              heading('Work title', 'Selected work', 2, {
                base: {
                  fontFamily: SANS,
                  fontSize: '13px',
                  fontWeight: '600',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: MUTED,
                },
              }),
              text('Work count', 'Six of twenty-eight', {
                base: { fontFamily: SANS, fontSize: '13px', color: MUTED },
              }),
            ],
          ),
          divider('Work rule', {
            base: {
              width: '100%',
              minHeight: '1px',
              backgroundColor: IRON,
              borderStyle: 'none',
            },
          }),
          work('2025', 'Museum Plantin-Moretus', 'Identity, signage, print'),
          work('2025', 'Vermeulen & Fils', 'Packaging, art direction'),
          work('2024', 'The Quarterly Review', 'Editorial system, typography'),
          work('2024', 'Halle Vijf', 'Identity, wayfinding'),
          work('2023', 'Nocturne Press', 'Book series, covers'),
          work('2023', 'Café Wolvengracht', 'Identity, menus, murals'),
        ],
      ),

      // ---- Approach ----
      section(
        'Approach',
        {
          anchor: 'about',
          paddingY: '96px',
          paddingYMobile: '56px',
          maxWidth: '1080px',
          inner: { gap: '32px' },
        },
        [
          heading('Approach title', 'How I work', 2, {
            base: {
              fontFamily: SANS,
              fontSize: '13px',
              fontWeight: '600',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: MUTED,
            },
          }),
          row(
            'Approach columns',
            '48px',
            {
              base: { alignItems: 'flex-start' },
              mobile: { flexDirection: 'column', gap: '28px' },
            },
            [
              col('Approach one', '8px', { base: { width: '100%' } }, [
                heading('Approach one title', 'Research before drawing', 3, {
                  base: { fontFamily: SERIF, fontSize: '22px', fontWeight: '400', color: IRON },
                }),
                text(
                  'Approach one body',
                  'The first two weeks are reading, interviews and archives. Most identity problems turn out to be clarity problems, and those are cheaper to solve on paper.',
                  { base: { fontSize: '15px', lineHeight: '1.7', color: MUTED } },
                ),
              ]),
              col('Approach two', '8px', { base: { width: '100%' } }, [
                heading('Approach two title', 'One direction, developed fully', 3, {
                  base: { fontFamily: SERIF, fontSize: '22px', fontWeight: '400', color: IRON },
                }),
                text(
                  'Approach two body',
                  'I do not present three options. I present the one I would defend, with the reasoning that got there, and we take it apart together.',
                  { base: { fontSize: '15px', lineHeight: '1.7', color: MUTED } },
                ),
              ]),
              col('Approach three', '8px', { base: { width: '100%' } }, [
                heading('Approach three title', 'Stay through the build', 3, {
                  base: { fontFamily: SERIF, fontSize: '22px', fontWeight: '400', color: IRON },
                }),
                text(
                  'Approach three body',
                  'Identities fail in implementation, not in the deck. I stay on retainer through the first year so the system survives contact with real deadlines.',
                  { base: { fontSize: '15px', lineHeight: '1.7', color: MUTED } },
                ),
              ]),
            ],
          ),
        ],
      ),

      // ---- Contact ----
      section(
        'Contact',
        {
          anchor: 'contact',
          background: IRON,
          paddingY: '96px',
          paddingYMobile: '64px',
          maxWidth: '1080px',
          inner: { gap: '20px' },
        },
        [
          heading('Contact title', 'Tell me what you are making.', 2, {
            base: {
              fontFamily: SERIF,
              fontSize: '52px',
              fontWeight: '400',
              lineHeight: '1.06',
              letterSpacing: '-0.03em',
              color: PAPER,
              maxWidth: '16ch',
            },
            mobile: { fontSize: '32px' },
          }),
          text(
            'Contact body',
            'A paragraph is enough to start. I reply to everything within a week, including the projects I turn down.',
            {
              base: { fontSize: '16px', lineHeight: '1.7', color: MUTED, maxWidth: '48ch' },
            },
          ),
          link('Contact email', 'studio@ilsefontaine.be', 'mailto:studio@ilsefontaine.be', {
            base: {
              fontFamily: SERIF,
              fontSize: '26px',
              color: PAPER,
              marginTop: '12px',
              borderWidth: '0 0 1px 0',
              borderStyle: 'solid',
              borderColor: RULE,
              width: 'fit-content',
              paddingBottom: '4px',
            },
            mobile: { fontSize: '20px' },
          }),
        ],
      ),

      // ---- Colophon ----
      box(
        'Colophon',
        {
          tag: 'footer',
          base: {
            display: 'flex',
            justifyContent: 'center',
            width: '100%',
            paddingTop: '24px',
            paddingRight: '40px',
            paddingBottom: '32px',
            paddingLeft: '40px',
          },
          mobile: { paddingRight: '20px', paddingLeft: '20px' },
        },
        [
          row(
            'Colophon inner',
            '24px',
            {
              base: { width: '100%', maxWidth: '1080px', justifyContent: 'space-between' },
              mobile: { flexDirection: 'column', alignItems: 'flex-start', gap: '8px' },
            },
            [
              text('Colophon left', 'Ilse Fontaine, Antwerp', {
                base: { fontSize: '13px', color: MUTED },
              }),
              text('Colophon right', 'Set in Iowan Old Style', {
                base: { fontSize: '13px', color: MUTED },
              }),
            ],
          ),
        ],
      ),
    ],
  ),
};

export const fontainePages: PageBlueprint[] = [homePage];
