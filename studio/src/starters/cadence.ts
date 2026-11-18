/**
 * Starter: Cadence — deployment orchestration for small teams.
 *
 * Direction: engineering-forward and cool. White ground, near-black type, a
 * single blue signal, tight tracking, compact rhythm. Reads like a tool built
 * by people who ship.
 */

import type { PageBlueprint, ProjectTheme } from '@zory/core';
import { themeVarRef } from '@zory/core';
import { box, button, col, grid, heading, link, row, section, text } from './builders';

/*
 * The theme holds the literals. Everything below refers to it.
 *
 * `themeVarRef('accent')` renders as `var(--color-accent)`, which resolves
 * against the project theme on the canvas and against `:root` in an export.
 * Changing the accent in the Design panel therefore restyles this entire
 * starter — the difference between shipping a design system and shipping a
 * palette somebody typed four hundred times.
 */
export const cadenceTheme: ProjectTheme = {
  background: '#ffffff',
  surface: '#f7f8fa',
  text: '#0e1116',
  textMuted: '#5b6675',
  accent: '#2f6feb',
  accentText: '#ffffff',
  border: '#e4e7ec',
  fontDisplay: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontBody: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
};

const PAGE = themeVarRef('background');
const INK = themeVarRef('text');
const MUTED = themeVarRef('textMuted');
const BORDER = themeVarRef('border');
const SURFACE = themeVarRef('surface');
const BLUE = themeVarRef('accent');
const SANS = themeVarRef('fontBody');

const navLink = (label: string, href: string) =>
  link(label, label, href, {
    base: { fontSize: '14px', color: MUTED, fontWeight: '500' },
  });

const featureCard = (title: string, body: string) =>
  col(
    title,
    '10px',
    {
      base: {
        paddingTop: '24px',
        paddingRight: '24px',
        paddingBottom: '24px',
        paddingLeft: '24px',
        backgroundColor: PAGE,
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: BORDER,
        borderRadius: '10px',
      },
    },
    [
      heading(`${title} title`, title, 3, {
        base: { fontSize: '16px', fontWeight: '600', color: INK, letterSpacing: '-0.01em' },
      }),
      text(`${title} body`, body, {
        base: { fontSize: '14px', lineHeight: '1.6', color: MUTED },
      }),
    ],
  );

const step = (index: string, title: string, body: string) =>
  col(
    `Step ${index}`,
    '10px',
    {
      base: {
        paddingTop: '24px',
        borderWidth: '1px 0 0 0',
        borderStyle: 'solid',
        borderColor: BORDER,
      },
    },
    [
      text(`Step ${index} number`, index, {
        base: {
          fontSize: '12px',
          fontWeight: '600',
          color: BLUE,
          letterSpacing: '0.04em',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        },
      }),
      heading(`Step ${index} title`, title, 3, {
        base: { fontSize: '18px', fontWeight: '600', color: INK, letterSpacing: '-0.015em' },
      }),
      text(`Step ${index} body`, body, {
        base: { fontSize: '14px', lineHeight: '1.65', color: MUTED },
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
        backgroundColor: PAGE,
        color: INK,
        fontFamily: SANS,
      },
    },
    [
      // ---- Navigation ----
      box(
        'Nav',
        {
          tag: 'header',
          base: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            paddingTop: '16px',
            paddingRight: '32px',
            paddingBottom: '16px',
            paddingLeft: '32px',
            borderWidth: '0 0 1px 0',
            borderStyle: 'solid',
            borderColor: BORDER,
          },
          mobile: { paddingRight: '20px', paddingLeft: '20px' },
        },
        [
          row(
            'Nav inner',
            '32px',
            {
              base: { width: '100%', maxWidth: '1120px', justifyContent: 'space-between' },
            },
            [
              row('Brand', '28px', {}, [
                text('Wordmark', 'Cadence', {
                  base: { fontSize: '16px', fontWeight: '650', color: INK, letterSpacing: '-0.02em' },
                }),
                row('Nav links', '24px', { mobile: { gap: '18px' } }, [
                  /*
                   * Two links, because there are two sections to land on.
                   *
                   * There used to be four — Docs and Changelog pointed at
                   * `#docs` and `#changelog`, which nothing on the page
                   * carried and nothing in Zory could have carried, because
                   * until `props.anchor` existed there was no way to write an
                   * element id at all. A navigation bar is a promise about
                   * what is on the page.
                   */
                  navLink('Product', '#product'),
                  navLink('How it works', '#how'),
                ]),
              ]),
              row('Nav actions', '16px', {}, [
                /*
                 * No "Sign in" link.
                 *
                 * It pointed at `#signin`, which was not a section, not a
                 * page, and not something a template can invent — a product
                 * template does not know where somebody's login lives. A
                 * second link beside the primary action that goes nowhere is
                 * worse than the space it was filling.
                 */
                button('Nav CTA', 'Start free', {
                  base: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    paddingTop: '8px',
                    paddingRight: '14px',
                    paddingBottom: '8px',
                    paddingLeft: '14px',
                    backgroundColor: INK,
                    color: PAGE,
                    borderRadius: '7px',
                    fontSize: '14px',
                    fontWeight: '550',
                  },
                }),
              ]),
            ],
          ),
        ],
      ),

      // ---- Hero ----
      section(
        'Hero',
        { paddingY: '104px', paddingYMobile: '64px', inner: { alignItems: 'flex-start', gap: '24px' } },
        [
          text('Eyebrow', 'Release coordination', {
            base: {
              fontSize: '13px',
              fontWeight: '550',
              color: BLUE,
              letterSpacing: '0.02em',
            },
          }),
          heading('Hero title', 'Ship on your schedule, not your pipeline’s', 1, {
            base: {
              fontSize: '60px',
              fontWeight: '620',
              lineHeight: '1.04',
              letterSpacing: '-0.035em',
              color: INK,
              maxWidth: '17ch',
            },
            tablet: { fontSize: '48px' },
            mobile: { fontSize: '34px', letterSpacing: '-0.025em' },
          }),
          text(
            'Hero subtitle',
            'Cadence coordinates deploys across every service you run, so a release is one decision instead of nine terminal windows and a group chat.',
            {
              base: { fontSize: '18px', lineHeight: '1.6', color: MUTED, maxWidth: '54ch' },
              mobile: { fontSize: '16px' },
            },
          ),
          row(
            'Hero actions',
            '12px',
            { base: { marginTop: '8px' }, mobile: { flexWrap: 'wrap' } },
            [
              button('Primary CTA', 'Start free', {
                base: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  paddingTop: '12px',
                  paddingRight: '20px',
                  paddingBottom: '12px',
                  paddingLeft: '20px',
                  backgroundColor: BLUE,
                  color: PAGE,
                  borderRadius: '8px',
                  fontSize: '15px',
                  fontWeight: '550',
                },
              }),
              button('Secondary CTA', 'Read the docs', {
                base: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  paddingTop: '12px',
                  paddingRight: '20px',
                  paddingBottom: '12px',
                  paddingLeft: '20px',
                  backgroundColor: PAGE,
                  color: INK,
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: BORDER,
                  borderRadius: '8px',
                  fontSize: '15px',
                  fontWeight: '550',
                },
              }),
            ],
          ),
          text('Hero note', 'Works with GitHub Actions, GitLab CI and Buildkite. No agent to install.', {
            base: { fontSize: '13px', color: MUTED, marginTop: '4px' },
          }),
        ],
      ),

      // ---- Problem / features ----
      section(
        'Features',
        {
          anchor: 'product',
          background: SURFACE,
          inner: { gap: '40px' },
        },
        [
          col('Features head', '12px', { base: { maxWidth: '52ch' } }, [
            heading('Features title', 'Three things that break releases', 2, {
              base: {
                fontSize: '34px',
                fontWeight: '620',
                letterSpacing: '-0.025em',
                color: INK,
              },
              mobile: { fontSize: '26px' },
            }),
            text(
              'Features subtitle',
              'None of them are the build step. Cadence handles the parts that happen around it.',
              { base: { fontSize: '17px', lineHeight: '1.6', color: MUTED } },
            ),
          ]),
          grid(
            'Feature grid',
            'repeat(3, minmax(0, 1fr))',
            '16px',
            {
              tablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
              mobile: { gridTemplateColumns: 'minmax(0, 1fr)' },
            },
            [
              featureCard(
                'Drift',
                'Staging and production stopped matching three weeks ago and nobody noticed. Cadence diffs every environment on each deploy and blocks the ones that surprise you.',
              ),
              featureCard(
                'Coordination',
                'Six services, four owners, one migration that has to land first. Declare the order once and Cadence holds the sequence for every release after it.',
              ),
              featureCard(
                'Rollback',
                'Reverting the API means reverting the worker and the schema with it. Cadence records what shipped together so going back is a single action.',
              ),
            ],
          ),
        ],
      ),

      // ---- How it works — a genuine sequence, so the numbers carry meaning ----
      section(
        'How it works',
        { anchor: 'how', inner: { gap: '40px' } },
        [
          heading('How title', 'How a release runs', 2, {
            base: { fontSize: '34px', fontWeight: '620', letterSpacing: '-0.025em', color: INK },
            mobile: { fontSize: '26px' },
          }),
          grid(
            'Steps',
            'repeat(3, minmax(0, 1fr))',
            '32px',
            { mobile: { gridTemplateColumns: 'minmax(0, 1fr)', gap: '24px' } },
            [
              step(
                '01',
                'Describe the order',
                'Write the dependency graph once in cadence.yml. Migrations before workers, workers before the API, the API before the web app.',
              ),
              step(
                '02',
                'Cadence holds the gate',
                'Each service reports in when its build is green. Nothing moves until every service in the group is ready, and anything that drifts stops the run.',
              ),
              step(
                '03',
                'Ship or unwind together',
                'One approval releases the whole group. If something fails on the way out, Cadence unwinds the services that already landed.',
              ),
            ],
          ),
        ],
      ),

      // ---- Closing CTA ----
      section(
        'CTA',
        {
          background: INK,
          paddingY: '88px',
          inner: { alignItems: 'center', gap: '20px' },
        },
        [
          heading('CTA title', 'Put your releases on a cadence', 2, {
            base: {
              fontSize: '38px',
              fontWeight: '620',
              letterSpacing: '-0.03em',
              color: PAGE,
              textAlign: 'center',
            },
            mobile: { fontSize: '27px' },
          }),
          text('CTA body', 'Free while you are under five services. No card, no sales call.', {
            base: { fontSize: '17px', color: MUTED, textAlign: 'center' },
          }),
          button('CTA button', 'Start free', {
            base: {
              display: 'inline-flex',
              alignItems: 'center',
              marginTop: '8px',
              paddingTop: '13px',
              paddingRight: '24px',
              paddingBottom: '13px',
              paddingLeft: '24px',
              backgroundColor: PAGE,
              color: INK,
              borderRadius: '8px',
              fontSize: '15px',
              fontWeight: '600',
            },
          }),
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
            paddingBottom: '28px',
            paddingLeft: '32px',
            borderWidth: '1px 0 0 0',
            borderStyle: 'solid',
            borderColor: BORDER,
          },
          mobile: { paddingRight: '20px', paddingLeft: '20px' },
        },
        [
          row(
            'Footer inner',
            '24px',
            {
              base: { width: '100%', maxWidth: '1120px', justifyContent: 'space-between' },
              mobile: { flexDirection: 'column', alignItems: 'flex-start', gap: '16px' },
            },
            [
              text('Footer copyright', '© 2026 Cadence Systems', {
                base: { fontSize: '13px', color: MUTED },
              }),
              /*
               * Two links, both to sections this page has.
               *
               * There were three — Docs, Status and Privacy — pointing at
               * `#docs`, `#status` and `#privacy`, none of which existed.
               * They are all real things a real product has, and all three
               * live at URLs a template cannot know, so shipping them was
               * shipping a footer that lied about the site it was in. A
               * template should give somebody a working page and an obvious
               * place to add their own, not a set of links that were never
               * going to work.
               */
              row('Footer links', '20px', { mobile: { flexWrap: 'wrap' } }, [
                link('Footer product', 'Product', '#product', {
                  base: { fontSize: '13px', color: MUTED },
                }),
                link('Footer how', 'How it works', '#how', {
                  base: { fontSize: '13px', color: MUTED },
                }),
              ]),
            ],
          ),
        ],
      ),
    ],
  ),
};

export const cadencePages: PageBlueprint[] = [homePage];
