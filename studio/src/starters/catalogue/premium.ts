/**
 * The premium bank.
 *
 * Six templates that exist to be the reason somebody pays. The free plan opens
 * with six, and until this file existed the other seventeen were free too — so
 * the catalogue, which is the most obviously valuable thing Zory has, was
 * given away in full and the subscription sold cloud sync.
 *
 * Every one of these is an **original brand in a recognisable category**, not
 * a recreation of anybody's site. That is a deliberate line and it is worth
 * stating: the visual design, the copy and the marks on a real company's
 * website are protectable, and a template bank that ships "the Stripe one" and
 * "the Linear one" is a cease-and-desist with a price tag attached. A category
 * is not ownable, and a category is what people actually want — nobody wants
 * Notion's page, they want the shape that makes a documentation product look
 * like a documentation product.
 *
 * The same rules as the rest of the catalogue apply. Real copy rather than
 * lorem, numbers that do not claim to be measurements, no invented
 * testimonials and no logo walls of companies that never signed anything. A
 * template is a starting point somebody ships, and one full of placeholder
 * lies is one they have to gut before they can.
 *
 * These are the ones somebody pays for, so they are held to the harder version
 * of the navigation rule: three pages each, every link in the bar and the
 * footer going to one of them, and a way to reach a human on every site.
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


const QUANTA_PRICING = { label: 'Pricing', path: '/pricing' };
const QUANTA_DOCS = { label: 'Docs', path: '/docs' };
const SABLE_WORK = { label: 'Work', path: '/work' };
const SABLE_PRACTICE = { label: 'Practice', path: '/practice' };
const LOOM_DOCS = { label: 'Docs', path: '/docs' };
const CORIANO_MENU = { label: 'Menu', path: '/menu' };
const CORIANO_FIND = { label: 'Find us', path: '/find-us' };
const TENET_RATES = { label: 'Rates', path: '/rates' };
const TENET_SECURITY = { label: 'Security', path: '/security' };
const SOLENE_LOOKBOOK = { label: 'Lookbook', path: '/lookbook' };
const SOLENE_STOCKISTS = { label: 'Stockists', path: '/stockists' };


/* ------------------------------------------------------------------ Quanta -- */

const quanta: TemplateDef = {
  id: 'quanta',
  name: 'Quanta',
  kind: 'Analytics platform',
  category: 'product',
  description:
    'A data product in graphite and lime. Dense numbers, a hero that leads with the dashboard rather than the promise, and a pricing rhythm built for a technical buyer.',
  swatches: ['#0c0e0d', '#f2f4f1', '#a6e22e'],
  theme: theme(
    {
      background: '#0c0e0d',
      surface: '#141816',
      text: '#f2f4f1',
      textMuted: '#8f9a93',
      accent: '#a6e22e',
      accentText: '#0c0e0d',
      border: '#1f2622',
    },
    FACES.technical,
  ),

  pages: site({
    brand: 'Quanta',
    tagline: 'Product analytics that keeps the raw events.',
    cta: 'Start free',
    map: siteMap(QUANTA_PRICING, QUANTA_DOCS),
    nav: { radius: '6px' },
    columns: [
      { heading: 'Product', links: [HOME, QUANTA_PRICING] },
      { heading: 'Developers', links: [QUANTA_DOCS] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroSplit(
            {
              eyebrow: 'Product analytics',
              title: 'Every event, and the query that explains it.',
              lede: 'Quanta keeps the raw events and lets you ask about them in SQL. No sampling, no pre-aggregation you cannot undo, and no dashboard you are stuck with.',
              primary: 'Start free',
              secondary: 'Read the docs',
              note: 'Two million events a month on the free tier.',
            },
            mockPanel('Sessions, last 30 days', { rows: 6 }),
            { radius: '6px' },
          ),
          stats([
            { value: '2M', label: 'Events a month, free' },
            { value: '<40ms', label: 'Median query' },
            { value: '18mo', label: 'Raw retention' },
          ]),
          cta(
            {
              title: 'Point it at something today',
              lede: 'The free tier is two million events a month and the full query surface. No card, and no call with anybody.',
              primary: 'Start free',
              secondary: 'Talk to us',
            },
            { radius: '6px' },
          ),
        ],
      },
      {
        at: QUANTA_PRICING,
        sections: [
          pageHead({
            eyebrow: 'Pricing',
            title: 'Per event kept, not per person looking.',
            lede: 'Seat-based analytics pricing means the people who most need a number are the ones nobody buys a seat for.',
          }),
          features(
            {
              eyebrow: 'What it does',
              title: 'Built for the question you have not thought of yet',
              lede: 'Most analytics tools ask you to decide what matters before you have any data. This one keeps everything and lets you decide later.',
            },
            [
              {
                title: 'Raw events, kept',
                body: 'Nothing is rolled up on the way in, so a question about last March is the same query as a question about yesterday.',
              },
              {
                title: 'SQL, not a query builder',
                body: 'The interface writes SQL and shows it to you. Copy it into your own warehouse whenever you outgrow us.',
              },
              {
                title: 'Warehouse sync',
                body: 'Point it at your own Postgres or BigQuery and Quanta becomes a query layer rather than a second copy of your data.',
              },
            ],
          ),
          contact(
            { title: 'Talk to us about volume' },
            [
            {
              label: 'Sales',
              value: 'hello@quanta.example',
              href: 'mailto:hello@quanta.example',
              note: 'Send an event volume and we will send a number back.',
            },
            {
              label: 'Support',
              value: 'help@quanta.example',
              href: 'mailto:help@quanta.example',
              note: 'On every plan, including the free one.',
            },
            ],
          ),
        ],
      },
      {
        at: QUANTA_DOCS,
        sections: [
          pageHead({
            eyebrow: 'Docs',
            title: 'One endpoint, then SQL.',
            lede: 'Send events with a POST and query them with the SQL you already know. There is no query language to learn and no aggregation to configure first.',
          }),
          showcase(
            {
              eyebrow: 'Instrumentation',
              title: 'One call, and a schema that tells you when it drifts',
              body: 'Send events however you like. Quanta records the shape of each one and warns you when a property changes type or stops arriving — which is how instrumentation actually breaks.',
              bullets: [
                'Typed schema inferred from the first thousand events',
                'Alerts when a property disappears or changes type',
                'Replay a corrected batch without duplicating rows',
              ],
            },
            mockPanel('track("checkout.completed")', { rows: 5 }),
            { reverse: true },
          ),
        ],
      },
    ],
  }),
};

/* --------------------------------------------------------------- Sablewood -- */

const sablewood: TemplateDef = {
  id: 'sablewood',
  name: 'Sablewood',
  kind: 'Architecture studio',
  category: 'portfolio',
  description:
    'An architecture practice in bone and charcoal. Photography-led, with a project index set as a ruled list and captions doing the work a paragraph usually does.',
  swatches: ['#faf8f5', '#1a1917', '#8a6f4e'],
  theme: theme(
    {
      background: '#faf8f5',
      surface: '#f0ece5',
      text: '#1a1917',
      textMuted: '#6b665e',
      accent: '#8a6f4e',
      accentText: '#ffffff',
      border: '#e2ddd3',
    },
    FACES.editorial,
  ),

  pages: site({
    brand: 'Sablewood',
    tagline: 'Architecture. Copenhagen.',
    map: siteMap(SABLE_WORK, SABLE_PRACTICE),
    nav: { radius: '0px' },
    columns: [
      { heading: 'Practice', links: [SABLE_WORK, SABLE_PRACTICE] },
      { heading: 'Start here', links: [HOME] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              eyebrow: 'Architecture, Copenhagen',
              title: 'Buildings that are quieter than their photographs.',
              lede: 'A practice of nine working on houses, small civic buildings and the occasional shop. We take four projects a year so that each one can be finished properly.',
              primary: 'See the work',
              secondary: 'The practice',
            },
            { radius: '0px' },
          ),
          plates(3),
          cta(
            {
              title: 'Tell us about the site',
              lede: 'Even at the stage where it is a plot and an idea. We would rather hear early than be handed a brief.',
              primary: 'Get in touch',
            },
            { radius: '0px' },
          ),
        ],
      },
      {
        at: SABLE_WORK,
        sections: [
          pageHead({
            eyebrow: 'Work',
            title: 'Built, building, and unbuilt.',
            lede: 'Competition entries are marked as such. A practice that shows only what was built is showing you half of what it does.',
          }),
          workIndex({ title: 'Selected work' }, [
            { title: 'Hallgarten House', discipline: 'Private house', year: '2026' },
            { title: 'Ørsted Library', discipline: 'Civic', year: '2025' },
            { title: 'Brink Studio', discipline: 'Workspace', year: '2025' },
            { title: 'Nyhavn Apartment', discipline: 'Interior', year: '2024' },
          ]),
        ],
      },
      {
        at: SABLE_PRACTICE,
        sections: [
          pageHead({
            eyebrow: 'Practice',
            title: 'Nine people, one studio, no satellite offices.',
            lede: 'Everything is drawn in the room where it is discussed, which is the reason we have stayed this size.',
          }),
          about({
            title: 'How we work',
            body: 'Every project starts with a week of drawing by hand and ends with us on site. We do not run more than four at a time, which is the only way we know to be present for all of them.',
            items: [
              { label: 'Founded', value: '2014' },
              { label: 'People', value: 'Nine' },
              { label: 'Projects a year', value: 'Four' },
              { label: 'Where', value: 'Copenhagen' },
            ],
          }),
          contact(
            { title: 'Enquiries' },
            [
            {
              label: 'New projects',
              value: 'studio@sablewood.example',
              href: 'mailto:studio@sablewood.example',
              note: 'A site, a budget range and a timescale is enough.',
            },
            {
              label: 'Studio',
              value: 'Refshalevej 163A\n1432 København K',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

/* -------------------------------------------------------------------- Loom -- */

const loom: TemplateDef = {
  id: 'loom-docs',
  name: 'Loom',
  kind: 'Developer documentation',
  category: 'product',
  description:
    'A docs-led product site in ink and amber. The hero is a code block, the features are written for somebody deciding whether to install it, and nothing on the page is a promise the README would not make.',
  swatches: ['#141210', '#f7f3ec', '#e0a33c'],
  theme: theme(
    {
      background: '#141210',
      surface: '#1d1a16',
      text: '#f7f3ec',
      textMuted: '#9a9188',
      accent: '#e0a33c',
      accentText: '#141210',
      border: '#2a251f',
    },
    FACES.technical,
  ),

  pages: site({
    brand: 'Loom',
    tagline: 'A job queue for Postgres. MIT licensed.',
    cta: 'Install',
    map: siteMap(LOOM_DOCS),
    nav: { radius: '4px' },
    columns: [
      { heading: 'Project', links: [HOME] },
      { heading: 'Docs', links: [LOOM_DOCS] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroSplit(
            {
              eyebrow: 'Open source',
              title: 'Background jobs that survive a deploy.',
              lede: 'A job queue for Postgres. Jobs live in your own database, retries are exponential and visible, and a worker that dies mid-job releases it rather than losing it.',
              primary: 'Install',
              secondary: 'Read the docs',
              note: 'MIT licensed. No hosted service required.',
            },
            mockPanel('npm i loomq', { rows: 5 }),
            { radius: '4px' },
          ),
          cta(
            {
              title: 'It is one table and a worker loop',
              lede: 'Read the source before you install it — that is rather the point of it being this small.',
              primary: 'Install',
              secondary: 'View on GitHub',
            },
            { radius: '4px' },
          ),
        ],
      },
      {
        at: LOOM_DOCS,
        sections: [
          pageHead({
            eyebrow: 'Docs',
            title: 'Install, define a job, run a worker.',
            lede: 'Three steps and one table. Loom adds no service to your deployment and no dependency you do not already have running.',
          }),
          features(
            {
              eyebrow: 'Why this one',
              title: 'The three things that go wrong with job queues',
              lede: 'Every queue works until something is interrupted. These are the cases we designed for first rather than last.',
            },
            [
              {
                title: 'A worker dies mid-job',
                body: 'Jobs are leased, not claimed. A lease that stops being renewed expires and the job goes back to the queue instead of disappearing.',
              },
              {
                title: 'A job runs twice',
                body: 'Every job carries an idempotency key. Running it a second time with the same key is a no-op rather than a second charge.',
              },
              {
                title: 'A deploy lands mid-queue',
                body: 'Workers drain rather than stop. In-flight jobs finish on the old version and nothing new is picked up.',
              },
            ],
          ),
          showcase(
            {
              eyebrow: 'Operability',
              title: 'You can read the queue with SQL',
              body: 'It is a table. When something is wrong at two in the morning you can query it, fix a row, and understand what happened afterwards from the same table.',
              bullets: [
                'One table, documented, no opaque payload column',
                'Retries recorded as rows rather than counters',
                'Dead letters kept with the error that caused them',
              ],
            },
            mockPanel('select * from loom_jobs', { rows: 6 }),
          ),
          contact(
            { title: 'Where the project lives' },
            [
            {
              label: 'Source',
              value: 'github.com/loom-queue/loom',
              href: 'https://github.com/loom-queue/loom',
              note: 'MIT. Issues and pull requests both welcome.',
            },
            {
              label: 'Security',
              value: 'security@loom.example',
              href: 'mailto:security@loom.example',
              note: 'Report privately first; we will credit you in the release.',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

/* ----------------------------------------------------------------- Coriano -- */

const coriano: TemplateDef = {
  id: 'coriano',
  name: 'Coriano',
  kind: 'Restaurant',
  category: 'local',
  description:
    'A neighbourhood restaurant in oxblood and cream. A menu that is actually legible, opening hours above the fold, and a booking action that follows you down the page.',
  swatches: ['#fbf7f1', '#231613', '#7d2b25'],
  theme: theme(
    {
      background: '#fbf7f1',
      surface: '#f3ebe1',
      text: '#231613',
      textMuted: '#6d5c55',
      accent: '#7d2b25',
      accentText: '#fbf7f1',
      border: '#e6dbcd',
    },
    FACES.literary,
  ),

  pages: site({
    brand: 'Coriano',
    tagline: 'Meeting House Lane. Tuesday to Sunday.',
    cta: 'Book a table',
    map: siteMap(CORIANO_MENU, CORIANO_FIND),
    nav: { radius: '999px' },
    columns: [
      { heading: 'Eat', links: [CORIANO_MENU] },
      { heading: 'Visit', links: [CORIANO_FIND] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              eyebrow: 'Open Tuesday to Sunday, 5pm',
              title: 'Twelve tables and one sitting a night.',
              lede: 'A short Italian menu that changes when the market does. We take bookings four weeks out and keep two tables back for whoever walks in.',
              primary: 'Book a table',
              secondary: 'See the menu',
            },
            { radius: '999px' },
          ),
          plates(3, { columns: 3 }),
          cta(
            {
              title: 'Book a table',
              lede: 'Four weeks out, up to six people. For anything larger, write to us and we will find a night.',
              primary: 'Book a table',
              secondary: 'Email us',
            },
            { radius: '999px' },
          ),
        ],
      },
      {
        at: CORIANO_MENU,
        sections: [
          pageHead({
            eyebrow: 'Menu',
            title: 'What is on this week.',
            lede: 'It changes when the delivery does, which is most weeks. Anything marked can be made without gluten; ask about the rest.',
          }),
          features(
            {
              title: 'This week',
              lede: 'The menu moves with what arrives. This is roughly where it is now — the board inside is the version that counts.',
            },
            [
              {
                title: 'To start',
                body: 'Grilled bread and new oil. Broad beans, pecorino, mint. Anchovies from Cetara with butter.',
              },
              {
                title: 'Pasta',
                body: 'Tonnarelli cacio e pepe. Rigatoni with lamb ragù, slow. Handkerchiefs with walnut and sage.',
              },
              {
                title: 'To finish',
                body: 'Affogato. Almond tart with cream. A short list of amari, poured properly.',
              },
            ],
          ),
        ],
      },
      {
        at: CORIANO_FIND,
        sections: [
          pageHead({
            eyebrow: 'Find us',
            title: 'The lane, the hours, the door.',
            lede: 'It is the green door with no sign on it, which we are told is charming and know is occasionally infuriating.',
          }),
          about({
            title: 'Where to find us',
            body: 'On the corner of Meeting House Lane, next to the bookshop. There is no sign — look for the red door and the noise.',
            items: [
              { label: 'Tuesday to Thursday', value: '5pm – 10pm' },
              { label: 'Friday and Saturday', value: '5pm – 11pm' },
              { label: 'Sunday', value: '12pm – 6pm' },
              { label: 'Monday', value: 'Closed' },
            ],
          }),
          contact(
            { title: 'Book or ask' },
            [
            {
              label: 'Tables',
              value: '(01273) 555 0142',
              href: 'tel:+441273555142',
              note: 'From noon. Parties over eight by email.',
            },
            {
              label: 'Email',
              value: 'ciao@coriano.example',
              href: 'mailto:ciao@coriano.example',
            },
            {
              label: 'Address',
              value: '11 Meeting House Lane\nBrighton BN1 1HB',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

/* ------------------------------------------------------------------- Tenet -- */

const tenet: TemplateDef = {
  id: 'tenet',
  name: 'Tenet',
  kind: 'Fintech',
  category: 'product',
  description:
    'A financial product in navy and bone, set in a transitional serif. Institutional rather than playful: rates in a table, terms in plain sentences, and no illustration of a person holding a phone.',
  swatches: ['#ffffff', '#0f1c33', '#1f4fd8'],
  theme: theme(
    {
      background: '#ffffff',
      surface: '#f4f6fa',
      text: '#0f1c33',
      textMuted: '#5b6880',
      accent: '#1f4fd8',
      accentText: '#ffffff',
      border: '#dde3ec',
    },
    FACES.literary,
  ),

  pages: site({
    brand: 'Tenet',
    tagline: 'Business banking with a published rate card.',
    cta: 'Open an account',
    map: siteMap(TENET_RATES, TENET_SECURITY),
    nav: { radius: '4px' },
    columns: [
      { heading: 'Accounts', links: [HOME, TENET_RATES] },
      { heading: 'Trust', links: [TENET_SECURITY] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroSplit(
            {
              eyebrow: 'Business banking',
              title: 'A business account that states its fees on the homepage.',
              lede: 'One account, one monthly price, and a rate card you can read before you sign up. International transfers at the mid-market rate with the fee shown before you send.',
              primary: 'Open an account',
              secondary: 'See the rate card',
              note: 'Deposits protected up to the statutory limit.',
            },
            mockPanel('Rate card', { rows: 6 }),
            { radius: '4px' },
          ),
          stats([
            { value: '£9', label: 'A month, all in' },
            { value: '0.4%', label: 'International transfer' },
            { value: '24h', label: 'Account opened' },
          ]),
          cta(
            {
              title: 'Open an account',
              lede: 'Most applications are approved within a day. You will need a company number and one form of ID.',
              primary: 'Open an account',
              secondary: 'Talk to us',
            },
            { radius: '4px' },
          ),
        ],
      },
      {
        at: TENET_RATES,
        sections: [
          pageHead({
            eyebrow: 'Rates',
            title: 'Every charge, on one page.',
            lede: 'Including the ones most banks put in a PDF behind a login — international transfers, cash handling, and what happens if a payment bounces.',
          }),
          features(
            {
              eyebrow: 'What you get',
              title: 'The parts other accounts charge for separately',
              lede: 'Everything below is included in the monthly price. There is no tier above this one and no upsell inside the app.',
            },
            [
              {
                title: 'Multi-currency',
                body: 'Hold and pay in eleven currencies. Conversion at the mid-market rate with the fee shown before it happens, not after.',
              },
              {
                title: 'Accounting that reconciles',
                body: 'Direct sync to Xero, QuickBooks and FreeAgent. Receipts attach to the transaction rather than to an email folder.',
              },
              {
                title: 'Cards with real limits',
                body: 'Issue a card per person or per subscription, with a monthly ceiling and a merchant lock, in about a minute.',
              },
            ],
          ),
        ],
      },
      {
        at: TENET_SECURITY,
        sections: [
          pageHead({
            eyebrow: 'Security',
            title: 'Where the money is, and who can move it.',
            lede: 'Deposits are held with a clearing bank and covered by the FSCS to £85,000 per depositor. We are an agent, and we say so.',
          }),
          showcase(
            {
              eyebrow: 'Security',
              title: 'Where the money actually sits',
              body: 'Client funds are held at a partner bank, not on our balance sheet, and are covered by the statutory deposit guarantee. The arrangement is described in full rather than summarised.',
              bullets: [
                'Funds held at a ring-fenced partner institution',
                'Statutory deposit protection, per depositor',
                'Independent audit published every year',
              ],
            },
            mockPanel('Safeguarding', { rows: 5 }),
            { reverse: true },
          ),
          contact(
            { title: 'Reach the right team' },
            [
            {
              label: 'Fraud',
              value: '0800 555 0119',
              href: 'tel:08005550119',
              note: 'Twenty-four hours. Say “fraud” and you skip the menu.',
            },
            {
              label: 'Security reports',
              value: 'security@tenet.example',
              href: 'mailto:security@tenet.example',
              note: 'Disclosure policy at /.well-known/security.txt.',
            },
            {
              label: 'Complaints',
              value: 'complaints@tenet.example',
              href: 'mailto:complaints@tenet.example',
              note: 'Eight weeks, then the Financial Ombudsman, and we will remind you of that.',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

/* ------------------------------------------------------------------ Solene -- */

const solene: TemplateDef = {
  id: 'solene',
  name: 'Solene',
  kind: 'Fashion label',
  category: 'other',
  description:
    'A small clothing label in bone and black, set in a tall condensed face. Product-led with almost no copy — the grid carries the page and the writing gets out of its way.',
  swatches: ['#ffffff', '#0a0a0a', '#b4462f'],
  theme: theme(
    {
      background: '#ffffff',
      surface: '#f4f4f2',
      text: '#0a0a0a',
      textMuted: '#6f6f6c',
      accent: '#b4462f',
      accentText: '#ffffff',
      border: '#e6e6e2',
    },
    FACES.condensed,
  ),

  pages: site({
    brand: 'Solene',
    tagline: 'One collection a year. Made in Portugal.',
    cta: 'Shop',
    map: siteMap(SOLENE_LOOKBOOK, SOLENE_STOCKISTS),
    nav: { radius: '0px' },
    columns: [
      { heading: 'Collection', links: [HOME, SOLENE_LOOKBOOK] },
      { heading: 'Buy', links: [SOLENE_STOCKISTS] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              eyebrow: 'Autumn, in stock',
              title: 'Fourteen pieces. Made in Portugal.',
              lede: 'One collection a year, cut from deadstock and mill-end cloth, in runs small enough that we can tell you where every metre came from.',
              primary: 'Shop the collection',
              secondary: 'See the lookbook',
            },
            { radius: '0px' },
          ),
          plates(4, { columns: 4 }),
          cta(
            {
              title: 'Fourteen pieces, while they last',
              lede: 'Free returns for thirty days, and a repair service for as long as you own it.',
              primary: 'Shop the collection',
            },
            { radius: '0px' },
          ),
        ],
      },
      {
        at: SOLENE_LOOKBOOK,
        sections: [
          pageHead({
            eyebrow: 'Lookbook',
            title: 'The whole collection, eleven pieces.',
            lede: 'Photographed once, on two people, in daylight. Nothing here is styled to look like something it is not.',
          }),
          showcase(
            {
              eyebrow: 'How it is made',
              title: 'Deadstock, and the reason it is cheaper',
              body: 'Mills over-run. The cloth is finished, paid for and sitting in a warehouse, and buying it means a lower price and a shorter supply chain — with the catch that when it is gone it is gone.',
              bullets: [
                'Every fabric traced to a named mill',
                'Cut and sewn in Porto, factory named on the label',
                'No restocks — the cloth does not exist twice',
              ],
            },
            mockPanel('The Autumn cloth', { rows: 4 }),
          ),
          workIndex({ title: 'The collection' }, [
            { title: 'Fisher Coat', discipline: 'Wool, undyed', year: '€380' },
            { title: 'Wide Trouser', discipline: 'Cotton drill', year: '€180' },
            { title: 'Camp Shirt', discipline: 'Linen, ecru', year: '€140' },
            { title: 'Crew Knit', discipline: 'Lambswool', year: '€165' },
          ]),
        ],
      },
      {
        at: SOLENE_STOCKISTS,
        sections: [
          pageHead({
            eyebrow: 'Stockists',
            title: 'Nine shops, and here.',
            lede: 'We would rather you tried a coat on. Everything is also available directly, with returns paid both ways.',
          }),
          contact(
            { title: 'Wholesale and enquiries' },
            [
            {
              label: 'Wholesale',
              value: 'trade@solene.example',
              href: 'mailto:trade@solene.example',
              note: 'Line sheets go out each February.',
            },
            {
              label: 'Orders',
              value: 'hello@solene.example',
              href: 'mailto:hello@solene.example',
              note: 'Returns free within 30 days, worn or not.',
            },
            {
              label: 'Atelier',
              value: 'Rua da Boavista 84\n1200-068 Lisboa',
            },
            ],
          ),
        ],
      },
    ],
  }),
};

export const PREMIUM_TEMPLATES: TemplateDef[] = [
  quanta,
  sablewood,
  loom,
  coriano,
  tenet,
  solene,
];
