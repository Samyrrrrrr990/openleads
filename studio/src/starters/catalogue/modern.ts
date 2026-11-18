/**
 * The rest of the catalogue.
 *
 * Seven sites that are not a SaaS product and not somebody's portfolio: a
 * shop, two places to eat, a consultancy, a letter, a charity and a barber.
 * They exist because "make a website" most often means one of these, and a
 * template bank that is six landing pages and six portfolios has answered a
 * narrower question than the one people arrive with.
 *
 * Two pages or three, and never a navigation bar naming a page that does not
 * exist. Each second page is the thing the business is actually asked about —
 * the prices, the programme, the accounts — and each one ends with a way to
 * reach a person, which every one of these templates used to be missing
 * entirely.
 */

import {
  about,
  cta,
  features,
  heroCentred,
  heroSplit,
  mockPanel,
  plates,
  showcase,
  stats,
  workIndex,
} from '../patterns';
import { contact, pageHead } from '../pageParts';
import { siteMap, HOME } from '../sitemap';
import { FACES, site, theme, type TemplateDef } from './kit';


const BLOOM_INGREDIENTS = { label: 'Ingredients', path: '/ingredients' };
const HEARTH_VISIT = { label: 'Visit', path: '/visit' };
const MERIDIAN_WORK = { label: 'Work', path: '/work' };
const MERIDIAN_CONTACT = { label: 'Contact', path: '/contact' };
const FIELD_ARCHIVE = { label: 'Archive', path: '/archive' };
const VERGE_PROGRAMME = { label: 'Programme', path: '/programme' };
const VERGE_VENUE = { label: 'Venue', path: '/venue' };
const UNDER_WORK = { label: 'Our work', path: '/work' };
const UNDER_ACCOUNTS = { label: 'Accounts', path: '/accounts' };
const TALLOW_PRICES = { label: 'Prices', path: '/prices' };
const TALLOW_FIND = { label: 'Find us', path: '/find-us' };


/* ------------------------------------------------------------------- Bloom -- */

export const bloom: TemplateDef = {
  id: 'bloom',
  name: 'Bloom',
  kind: 'Direct-to-consumer',
  category: 'other',
  description:
    'A skincare brand in sage and chalk. Restrained for the category: no gradients, no serif-on-cream cliché, and an ingredients section that reads like a spec sheet.',
  swatches: ['#f7f8f4', '#1f2620', '#6f8f6a'],
  theme: theme(
    {
      background: '#f7f8f4',
      surface: '#eceee6',
      text: '#1f2620',
      textMuted: '#606a5e',
      accent: '#6f8f6a',
      accentText: '#ffffff',
      border: '#dee1d8',
    },
    FACES.grotesque,
  ),

  pages: site({
    brand: 'Bloom',
    tagline: 'Skincare with the whole formula on the label.',
    cta: 'Shop all',
    map: siteMap(BLOOM_INGREDIENTS),
    nav: { radius: '999px' },
    columns: [
      { heading: 'Shop', links: [HOME] },
      { heading: 'Know', links: [BLOOM_INGREDIENTS] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroSplit(
            {
              eyebrow: 'Daily skincare',
              title: 'Six products. Nothing you have to think about.',
              lede: 'A short range that does the job, with the full formula printed on the box and on this page. No routine, no thirty-step ritual.',
              primary: 'Shop all',
              secondary: 'See the ingredients',
              note: 'Free returns for sixty days.',
            },
            mockPanel('The Daily Set', { rows: 4 }),
            { radius: '999px' },
          ),
          plates(3, { columns: 3, ratio: '300px' }),
          cta(
            {
              title: 'Start with the daily set',
              lede: 'Cleanser, serum and moisturiser. Sixty days to send it back if it is not for you.',
              primary: 'Shop the set',
            },
            { radius: '999px' },
          ),
        ],
      },
      {
        at: BLOOM_INGREDIENTS,
        sections: [
          pageHead({
            eyebrow: 'Ingredients',
            title: 'Every one, and what it is doing there.',
            lede: 'Listed in order of concentration, with the percentage where it matters. Nothing is described as a “complex” to avoid naming it.',
          }),
          features(
            { eyebrow: 'How we make it', title: 'The parts most brands leave out' },
            [
              { title: 'Full percentages', body: 'Every active is listed with its concentration, not just its presence. You can compare us to anything.' },
              { title: 'Made in small batches', body: 'Six-week batches with the date on the base, so you know what you have and how long it has left.' },
              { title: 'Refills, properly', body: 'Aluminium bottles and paper-wrapped refills that cost forty percent less than the first one.' },
            ],
            { background: '#eceee6' },
          ),
          contact(
            { title: 'Ask us anything about a formula' },
            [
            {
              label: 'Formulation',
              value: 'formula@bloom.example',
              href: 'mailto:formula@bloom.example',
              note: 'A chemist answers these, not a chatbot.',
            },
            {
              label: 'Orders',
              value: 'hello@bloom.example',
              href: 'mailto:hello@bloom.example',
              note: 'Returns within 60 days, opened or not.',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

/* ------------------------------------------------------------------ Hearth -- */

export const hearth: TemplateDef = {
  id: 'hearth',
  name: 'Hearth',
  kind: 'Restaurant',
  category: 'local',
  description:
    'A neighbourhood restaurant in oxblood and candlelight. Serif throughout, the menu set as a real menu, and the booking link where a hungry person expects it.',
  swatches: ['#17110f', '#f4ece1', '#c2603f'],
  theme: theme(
    {
      background: '#17110f',
      surface: '#201815',
      text: '#f4ece1',
      textMuted: '#a6968a',
      accent: '#c2603f',
      accentText: '#ffffff',
      border: '#2e2420',
    },
    FACES.literary,
  ),

  pages: site({
    brand: 'Hearth',
    tagline: 'Wood-fired cooking, six nights a week.',
    cta: 'Book a table',
    map: siteMap(HEARTH_VISIT),
    nav: { radius: '2px' },
    columns: [
      { heading: 'Eat', links: [HOME] },
      { heading: 'Visit', links: [HEARTH_VISIT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              eyebrow: 'Open Wednesday to Sunday',
              title: 'A short menu, cooked over fire, on Wilton Street.',
              lede: 'Twenty-eight covers, one seating a night, and whatever the market had that morning. Bookings open two weeks ahead.',
              primary: 'Book a table',
              secondary: 'See this week’s menu',
            },
            { scale: 1.15, radius: '2px' },
          ),
          workIndex({ eyebrow: 'This week' }, [
            { title: 'Grilled leeks, hazelnut, aged sheep', discipline: 'To start', year: '9' },
            { title: 'Hand-rolled bucatini, wild garlic', discipline: 'Pasta', year: '14' },
            { title: 'Whole turbot over embers, for two', discipline: 'From the fire', year: '46' },
            { title: 'Burnt honey tart, crème fraîche', discipline: 'Pudding', year: '8' },
          ], { background: '#201815' }),
          plates(3, { columns: 3, ratio: '260px' }),
          cta(
            {
              title: 'Book a table',
              lede: 'Tables released every Monday at nine for two weeks ahead.',
              primary: 'Book a table',
            },
            { background: '#201815', radius: '2px' },
          ),
        ],
      },
      {
        at: HEARTH_VISIT,
        sections: [
          pageHead({
            eyebrow: 'Visit',
            title: 'Where we are, and when the fire is lit.',
            lede: 'One room, one seating on a Saturday, and a bar that takes walk-ins for as long as there is space at it.',
          }),
          about(
            {
              title: 'Visiting',
              body: 'One seating from seven. We hold four seats at the counter for walk-ins every night, first come. Children welcome before eight.',
              items: [
                { label: 'Address', value: '14 Wilton Street' },
                { label: 'Open', value: 'Wed to Sun, from 7pm' },
                { label: 'Covers', value: 'Twenty-eight' },
                { label: 'Bookings', value: 'Two weeks ahead' },
              ],
            },
          ),
          contact(
            { title: 'Book, or ask' },
            [
            {
              label: 'Tables',
              value: 'table@hearth.example',
              href: 'mailto:table@hearth.example',
              note: 'Parties over six by email rather than online.',
            },
            {
              label: 'Phone',
              value: '(0131) 555 0184',
              href: 'tel:+441315550184',
              note: 'From two in the afternoon.',
            },
            {
              label: 'Address',
              value: '8 Bakehouse Close\nEdinburgh EH8 8DD',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

/* ---------------------------------------------------------------- Meridian -- */

export const meridian: TemplateDef = {
  id: 'meridian',
  name: 'Meridian',
  kind: 'Agency',
  category: 'other',
  description:
    'A strategy and brand agency in cobalt on off-white. Confident, plain-spoken, and structured around what the engagement actually is rather than around adjectives.',
  swatches: ['#fafafa', '#111318', '#2547e8'],
  theme: theme(
    {
      background: '#fafafa',
      surface: '#f0f1f3',
      text: '#111318',
      textMuted: '#5a5f6b',
      accent: '#2547e8',
      accentText: '#ffffff',
      border: '#e2e4e8',
    },
    FACES.grotesque,
  ),

  pages: site({
    brand: 'Meridian',
    tagline: 'Strategy and design for organisations in transition.',
    cta: 'Start a project',
    map: siteMap(MERIDIAN_WORK, MERIDIAN_CONTACT),
    columns: [
      { heading: 'Studio', links: [HOME, MERIDIAN_WORK] },
      { heading: 'Start', links: [MERIDIAN_CONTACT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              eyebrow: 'Brand and strategy',
              title: 'We help companies say what they actually do.',
              lede: 'Positioning, naming and identity for businesses that have outgrown the way they describe themselves.',
              primary: 'Start a project',
              secondary: 'See the work',
            },
            { scale: 1.2 },
          ),
          stats([
            { value: '4wk', label: 'shortest engagement' },
            { value: '6', label: 'clients a year' },
            { value: '2013', label: 'founded' },
          ]),
          cta({
            title: 'Tell us what is not landing',
            lede: 'A paragraph about the problem is enough. We will tell you whether we are the right people.',
            primary: 'Start a project',
          }),
        ],
      },
      {
        at: MERIDIAN_WORK,
        sections: [
          pageHead({
            eyebrow: 'Work',
            title: 'What we did, and what changed because of it.',
            lede: 'Every engagement below finished. The ones that did not are not on this page, which is worth saying, because most of these pages do not say it.',
          }),
          workIndex({ eyebrow: 'Selected work' }, [
            { title: 'Vantage Health', discipline: 'Positioning, identity', year: '2026' },
            { title: 'Corrib Energy', discipline: 'Naming, brand system', year: '2025' },
            { title: 'Stedman & Roe', discipline: 'Repositioning', year: '2025' },
            { title: 'Halloway', discipline: 'Identity, web', year: '2024' },
          ]),
          features(
            { eyebrow: 'Engagements', title: 'Three ways in', lede: 'Fixed scope, fixed price, stated up front.' },
            [
              { title: 'Positioning sprint', body: 'Four weeks. Interviews, a competitive read and a written position your team can actually repeat back.' },
              { title: 'Brand system', body: 'Eight to twelve weeks. Identity, voice and the components to apply both, with the files you need to keep going.' },
              { title: 'Fractional partner', body: 'Ongoing. One of us in your leadership meetings, half a day a week, for as long as it is useful.' },
            ],
            { background: '#f0f1f3' },
          ),
        ],
      },
      {
        at: MERIDIAN_CONTACT,
        sections: [
          pageHead({
            eyebrow: 'Contact',
            title: 'A conversation before a proposal.',
            lede: 'We would rather spend an hour understanding the problem than a week writing a document about the wrong one.',
          }),
          contact(
            { title: 'Get in touch' },
            [
            {
              label: 'New work',
              value: 'studio@meridian.example',
              href: 'mailto:studio@meridian.example',
              note: 'What is changing, and by when.',
            },
            {
              label: 'Studio',
              value: 'Second floor, 14 Rivington Street\nLondon EC2A 3DU',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

/* ------------------------------------------------------------- Field Notes -- */

export const fieldNotes: TemplateDef = {
  id: 'field-notes',
  name: 'Field Notes',
  kind: 'Newsletter',
  category: 'other',
  description:
    'A writer’s newsletter set as a reading surface: paper, a transitional serif and a sixty-eight character measure. The archive is the homepage.',
  swatches: ['#fcfaf6', '#1c1a17', '#3f6f5a'],
  theme: theme(
    {
      background: '#fcfaf6',
      surface: '#f2efe8',
      text: '#1c1a17',
      textMuted: '#6b655c',
      accent: '#3f6f5a',
      accentText: '#ffffff',
      border: '#e4e0d6',
    },
    FACES.literary,
  ),

  pages: site({
    brand: 'Field Notes',
    tagline: 'A letter about landscape, sent on Fridays.',
    cta: 'Subscribe',
    map: siteMap(FIELD_ARCHIVE),
    nav: { radius: '4px' },
    columns: [
      { heading: 'Read', links: [HOME, FIELD_ARCHIVE] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              title: 'A letter about cities, most Sundays.',
              lede: 'Housing, transport and the small decisions that make a street work. Free, roughly nine hundred words, and never more than once a week.',
              primary: 'Subscribe',
              secondary: 'Read the archive',
            },
            { scale: 1.1, radius: '4px' },
          ),
          about(
            {
              title: 'Who writes this',
              body: 'I am a transport planner in Manchester. This is the newsletter I wanted to read when I started, written for people who care about cities but do not work in them.',
              items: [
                { label: 'Started', value: '2022' },
                { label: 'Cadence', value: 'Most Sundays' },
                { label: 'Length', value: 'About 900 words' },
                { label: 'Price', value: 'Free' },
              ],
            },
          ),
          cta(
            {
              title: 'One letter a week',
              lede: 'Free, and you can leave from a link at the bottom of every one.',
              primary: 'Subscribe',
            },
            { radius: '4px' },
          ),
        ],
      },
      {
        at: FIELD_ARCHIVE,
        sections: [
          pageHead({
            eyebrow: 'Archive',
            title: 'Every letter, free, forever.',
            lede: 'Nothing goes behind a wall after a month. An archive that closes is a magazine pretending to be a letter.',
          }),
          workIndex({ eyebrow: 'Recent letters' }, [
            { title: 'The bus lane that paid for itself', discipline: 'Transport', year: 'Aug 17' },
            { title: 'What a good ground floor does', discipline: 'Housing', year: 'Aug 10' },
            { title: 'In defence of the awkward junction', discipline: 'Streets', year: 'Aug 3' },
            { title: 'Nobody asked for the plaza', discipline: 'Public space', year: 'Jul 27' },
          ]),
          contact(
            { title: 'Write back' },
            [
            {
              label: 'Replies',
              value: 'post@fieldnotes.example',
              href: 'mailto:post@fieldnotes.example',
              note: 'Every letter is a reply-to address that reaches a person.',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

/* ------------------------------------------------------------------- Verge -- */

export const verge: TemplateDef = {
  id: 'verge',
  name: 'Verge',
  kind: 'Conference',
  category: 'other',
  description:
    'A two-day conference in ultraviolet on paper. Leads with the date and the ticket, because that is what a conference site is for, and puts the programme above the sponsors.',
  swatches: ['#ffffff', '#15121f', '#5b2ef5'],
  theme: theme(
    {
      background: '#ffffff',
      surface: '#f4f2fb',
      text: '#15121f',
      textMuted: '#5d5872',
      accent: '#5b2ef5',
      accentText: '#ffffff',
      border: '#e5e2f0',
    },
    FACES.condensed,
  ),

  pages: site({
    brand: 'Verge',
    tagline: 'Two days about building things on the edge of the web.',
    cta: 'Get tickets',
    map: siteMap(VERGE_PROGRAMME, VERGE_VENUE),
    nav: { radius: '6px' },
    columns: [
      { heading: 'Event', links: [HOME, VERGE_PROGRAMME] },
      { heading: 'Practical', links: [VERGE_VENUE] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              eyebrow: '14 and 15 November 2026 · Lisbon',
              title: 'Two days on the parts of the web that are still hard.',
              lede: 'Performance, accessibility, and building things that keep working after the launch. Four hundred people, one track, no sales pitches.',
              primary: 'Get tickets',
              secondary: 'See the programme',
            },
            { scale: 1.2, radius: '6px' },
          ),
          stats(
            [
              { value: '2', label: 'days' },
              { value: '1', label: 'track' },
              { value: '18', label: 'talks' },
              { value: '400', label: 'seats' },
            ],
            { background: '#f4f2fb' },
          ),
          cta({
            title: 'Tickets are on sale',
            lede: 'Early tickets are 180 until September. Student and community places are free, no questions asked.',
            primary: 'Get tickets',
            secondary: 'Apply for a free place',
          }),
        ],
      },
      {
        at: VERGE_PROGRAMME,
        sections: [
          pageHead({
            eyebrow: 'Programme',
            title: 'Two days, one track.',
            lede: 'One track on purpose: nobody should have to choose between two things they came for, and a corridor conversation is worth more than a third room.',
          }),
          workIndex({ eyebrow: 'Programme', title: 'Day one' }, [
            { title: 'The cost of a component', discipline: 'Performance', year: '09:30' },
            { title: 'Accessibility after the audit', discipline: 'Accessibility', year: '11:00' },
            { title: 'Shipping to slow networks', discipline: 'Performance', year: '14:00' },
            { title: 'What we broke and how we knew', discipline: 'Operations', year: '16:00' },
          ]),
          showcase(
            {
              eyebrow: 'Venue',
              title: 'Everything in one building',
              body: 'Talks, food and the hallway track all happen in the same converted market hall in Alcântara, ten minutes from the centre.',
              bullets: ['Step-free throughout', 'Live captions on every talk', 'Quiet room open both days'],
            },
            mockPanel('Mercado, Alcântara', { rows: 4 }),
            { background: '#f4f2fb' },
          ),
        ],
      },
      {
        at: VERGE_VENUE,
        sections: [
          pageHead({
            eyebrow: 'Venue',
            title: 'Getting there, and getting in.',
            lede: 'Step-free throughout, captioned live, and a quiet room that stays quiet.',
          }),
          contact(
            { title: 'Practical questions' },
            [
            {
              label: 'Venue',
              value: 'The Tramshed\nPendyris Street, Cardiff CF11 6EL',
              note: 'Fifteen minutes from Cardiff Central on foot.',
            },
            {
              label: 'Access',
              value: 'access@verge.example',
              href: 'mailto:access@verge.example',
              note: 'Tell us what you need and we will arrange it, not discuss it.',
            },
            {
              label: 'Tickets',
              value: 'tickets@verge.example',
              href: 'mailto:tickets@verge.example',
              note: 'Transfers free until the week before.',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

/* -------------------------------------------------------------- Understory -- */

export const understory: TemplateDef = {
  id: 'understory',
  name: 'Understory',
  kind: 'Non-profit',
  category: 'other',
  description:
    'A woodland conservation charity in deep green and bark. Leads with what the money does, not with a mission statement, and puts the accounts link in the nav.',
  swatches: ['#f6f5f0', '#1d2a1e', '#3f6b33'],
  theme: theme(
    {
      background: '#f6f5f0',
      surface: '#e9e9e0',
      text: '#1d2a1e',
      textMuted: '#5f6a5c',
      accent: '#3f6b33',
      accentText: '#ffffff',
      border: '#dcdcd0',
    },
    FACES.editorial,
  ),

  pages: site({
    brand: 'Understory',
    tagline: 'Buying woodland, and keeping it.',
    cta: 'Donate',
    map: siteMap(UNDER_WORK, UNDER_ACCOUNTS),
    nav: { radius: '999px' },
    columns: [
      { heading: 'Charity', links: [HOME, UNDER_WORK] },
      { heading: 'Transparency', links: [UNDER_ACCOUNTS] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroSplit(
            {
              eyebrow: 'Woodland conservation',
              title: 'Nine hundred acres, bought and left alone.',
              lede: 'We buy ancient woodland, take it out of the market permanently, and do the minimum required to let it recover.',
              primary: 'Donate',
              secondary: 'See the woods',
              note: 'Registered charity 1194832.',
            },
            mockPanel('Coed Bryn · 112 acres', { rows: 4 }),
            { radius: '999px' },
          ),
          stats([
            { value: '912', label: 'acres protected' },
            { value: '7', label: 'woods' },
            { value: '81p', label: 'in the pound to land' },
          ]),
          cta(
            {
              title: 'Protect an acre',
              lede: 'Forty pounds covers an acre for a year, including the survey work that proves it is working.',
              primary: 'Donate',
              secondary: 'Read the accounts',
            },
            { radius: '999px' },
          ),
        ],
      },
      {
        at: UNDER_WORK,
        sections: [
          pageHead({
            eyebrow: 'Our work',
            title: 'What the money buys.',
            lede: 'Land, mostly, and then thirty years of leaving it alone in a way that takes considerable effort.',
          }),
          features(
            { eyebrow: 'Where it goes', title: 'What a donation actually pays for' },
            [
              { title: 'Land, permanently', body: 'Eighty-one pence in the pound goes to purchase and to the covenant that stops it ever being sold for development.' },
              { title: 'Deer and rhododendron', body: 'The two things that stop ancient woodland regenerating. Unglamorous, continuous, and the whole job.' },
              { title: 'Monitoring', body: 'Fixed-point photography and species surveys twice a year, published in full whether or not they look good.' },
            ],
            { background: '#e9e9e0' },
          ),
        ],
      },
      {
        at: UNDER_ACCOUNTS,
        sections: [
          pageHead({
            eyebrow: 'Accounts',
            title: 'Where every pound went.',
            lede: 'Published in full each March, alongside the trustees’ report and the bits that did not go to plan.',
          }),
          contact(
            { title: 'Ask us about the numbers' },
            [
            {
              label: 'Finance',
              value: 'accounts@understory.example',
              href: 'mailto:accounts@understory.example',
              note: 'Full accounts are also filed with the Charity Commission.',
            },
            {
              label: 'Registered office',
              value: 'The Old Dairy, Cwmcarn\nNewport NP11 7FA',
              note: 'Registered charity 1198442.',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

/* ------------------------------------------------------------------ Tallow -- */

export const tallow: TemplateDef = {
  id: 'tallow',
  name: 'Tallow',
  kind: 'Local business',
  category: 'local',
  description:
    'A barbershop in charcoal and brass. Everything a walk-in needs is above the fold: what it costs, when it is open, and where the door is.',
  swatches: ['#1a1917', '#f0ece4', '#c08a3e'],
  theme: theme(
    {
      background: '#1a1917',
      surface: '#232220',
      text: '#f0ece4',
      textMuted: '#9c968b',
      accent: '#c08a3e',
      accentText: '#1a1400',
      border: '#302e2b',
    },
    FACES.condensed,
  ),

  pages: site({
    brand: 'Tallow',
    tagline: 'A barbershop that takes walk-ins.',
    cta: 'Book',
    map: siteMap(TALLOW_PRICES, TALLOW_FIND),
    nav: { radius: '2px' },
    columns: [
      { heading: 'Shop', links: [HOME, TALLOW_PRICES] },
      { heading: 'Visit', links: [TALLOW_FIND] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              eyebrow: 'Open Tuesday to Saturday',
              title: 'A proper haircut on Dale Street.',
              lede: 'Four chairs, no music you have to shout over, and walk-ins taken whenever a chair is free.',
              primary: 'Book a chair',
              secondary: 'See prices',
            },
            { scale: 1.25, radius: '2px' },
          ),
          plates(3, { columns: 3, ratio: '240px' }),
          cta(
            {
              title: 'Book a chair',
              lede: 'Or turn up. Mornings are quietest, Saturdays are not.',
              primary: 'Book',
            },
            { background: '#232220', radius: '2px' },
          ),
        ],
      },
      {
        at: TALLOW_PRICES,
        sections: [
          pageHead({
            eyebrow: 'Prices',
            title: 'On the wall, and on this page.',
            lede: 'The same list either way. Nothing costs more because of how long your hair is or who is holding the clippers.',
          }),
          workIndex({ eyebrow: 'Prices' }, [
            { title: 'Cut', discipline: '45 minutes', year: '32' },
            { title: 'Cut and beard', discipline: 'An hour', year: '45' },
            { title: 'Hot towel shave', discipline: '45 minutes', year: '38' },
            { title: 'Under 12s', discipline: '30 minutes', year: '18' },
          ], { background: '#232220' }),
          about(
            {
              title: 'Finding us',
              body: 'Halfway down Dale Street, black front, brass sign. Walk-ins are first come and usually fine before noon.',
              items: [
                { label: 'Address', value: '61 Dale Street' },
                { label: 'Open', value: 'Tue to Sat, 9 to 6' },
                { label: 'Chairs', value: 'Four' },
                { label: 'Walk-ins', value: 'Always welcome' },
              ],
            },
          ),
        ],
      },
      {
        at: TALLOW_FIND,
        sections: [
          pageHead({
            eyebrow: 'Find us',
            title: 'Two chairs, off Mare Street.',
            lede: 'Walk-ins from the moment we open. Booking only guarantees a time, not a better haircut.',
          }),
          contact(
            { title: 'Getting here' },
            [
            {
              label: 'Shop',
              value: '44a Ellingfort Road\nLondon E8 3PA',
              note: 'Five minutes from London Fields.',
            },
            {
              label: 'Phone',
              value: '(020) 7946 0288',
              href: 'tel:+442079460288',
              note: 'Tuesday to Saturday, nine until six.',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

export const MODERN_TEMPLATES: TemplateDef[] = [
  bloom,
  hearth,
  meridian,
  fieldNotes,
  verge,
  understory,
  tallow,
];
