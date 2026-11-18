/**
 * Portfolio and studio templates.
 *
 * Six people who make things, and one studio. What separates a portfolio from
 * a product page is that the work is the argument, so these lead with an index
 * or a plate grid rather than with a claim, and the type is allowed to be much
 * larger than a SaaS page would tolerate.
 *
 * The image plates ship empty. Somebody else's photography would make the
 * template look finished while guaranteeing the first hour of use is spent
 * deleting it — but they are real `image` nodes with their alt text already
 * written, so replacing one is a single field rather than a change of node
 * kind, and the accessible name exists before the photograph does.
 *
 * Three pages each, because a portfolio whose navigation offers "Work" and
 * then goes nowhere is not a portfolio, and because one page cannot hold both
 * an index and the things it indexes.
 */

import { about, cta, heroCentred, heroSplit, mockPanel, plates, showcase, workIndex } from '../patterns';
import { closer, contact, notes, pageHead } from '../pageParts';
import { siteMap, HOME } from '../sitemap';
import { FACES, site, theme, type TemplateDef } from './kit';

/* ------------------------------------------------------------ Vesper --- */

const VESPER_WORK = { label: 'Work', path: '/work' };
const VESPER_STUDIO = { label: 'Studio', path: '/studio' };

export const vesper: TemplateDef = {
  id: 'vesper',
  name: 'Studio Vesper',
  kind: 'Design studio',
  category: 'portfolio',
  description:
    'A studio site in bone and ink with an oversized condensed display. The work index carries the page; everything else gets out of its way.',
  swatches: ['#f4f2ee', '#14130f', '#b4472c'],
  theme: theme(
    {
      background: '#f4f2ee',
      surface: '#e9e6df',
      text: '#14130f',
      textMuted: '#68635a',
      accent: '#b4472c',
      accentText: '#ffffff',
      border: '#d9d5cb',
    },
    FACES.condensed,
  ),
  pages: site({
    brand: 'Studio Vesper',
    tagline: 'Brand and interface design. Rotterdam.',
    map: siteMap(VESPER_WORK, VESPER_STUDIO),
    nav: { radius: '2px' },
    columns: [
      { heading: 'Studio', links: [VESPER_WORK, VESPER_STUDIO] },
      { heading: 'Start here', links: [HOME] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              title: 'Brand and interface for companies that make difficult things.',
              lede: 'A four-person studio in Rotterdam. We work with a small number of clients each year, which is the only way we know to do this properly.',
              primary: 'See the work',
              secondary: 'Start a project',
            },
            { scale: 1.25, radius: '2px' },
          ),
          workIndex({ eyebrow: 'Selected work' }, [
            { title: 'Halden Instruments', discipline: 'Identity, web', year: '2026' },
            { title: 'Norrland Bank', discipline: 'Product design', year: '2025' },
            { title: 'Field & Ferrous', discipline: 'Identity, packaging', year: '2025' },
            { title: 'Corvid Press', discipline: 'Editorial, web', year: '2024' },
            { title: 'Atlas Freight', discipline: 'Interface systems', year: '2024' },
          ]),
          plates(6, { background: '#e9e6df', subject: 'Studio Vesper project' }),
          cta(
            {
              title: 'Tell us what you are making',
              lede: 'A paragraph is enough to start. We reply to everything within a week.',
              primary: 'Start a project',
            },
            { radius: '2px' },
          ),
        ],
      },
      {
        at: VESPER_WORK,
        sections: [
          pageHead({
            eyebrow: 'Work',
            title: 'Eleven projects, in the order they happened.',
            lede: 'Some of it is under embargo and some of it never shipped. What is here is what we can show and would show again.',
          }),
          workIndex({}, [
            { title: 'Halden Instruments', discipline: 'Identity, web', year: '2026' },
            { title: 'Norrland Bank', discipline: 'Product design', year: '2025' },
            { title: 'Field & Ferrous', discipline: 'Identity, packaging', year: '2025' },
            { title: 'Verre & Fils', discipline: 'Identity', year: '2025' },
            { title: 'Corvid Press', discipline: 'Editorial, web', year: '2024' },
            { title: 'Atlas Freight', discipline: 'Interface systems', year: '2024' },
            { title: 'Bureau Klim', discipline: 'Identity, signage', year: '2023' },
            { title: 'Stad Rotterdam', discipline: 'Wayfinding', year: '2022' },
          ]),
          plates(9, { background: '#e9e6df', subject: 'Studio Vesper project' }),
          closer(
            {
              title: 'The full case studies are a conversation, not a PDF.',
              action: 'Start a project',
              note: 'We will walk you through the two closest to what you are doing.',
            },
            { background: '#e9e6df' },
          ),
        ],
      },
      {
        at: VESPER_STUDIO,
        sections: [
          pageHead({
            eyebrow: 'Studio',
            title: 'Four people, one project at a time.',
            lede: 'Small on purpose. It is the only structure where the people who pitched the work are the people who make it.',
          }),
          about({
            title: 'How we work',
            body: 'One project at a time, start to finish, with the people who made it. No account managers and no work passed to a team you have not met.',
            items: [
              { label: 'Founded', value: '2019, Rotterdam' },
              { label: 'Size', value: 'Four people' },
              { label: 'Engagements', value: 'Six to fourteen weeks' },
              { label: 'Availability', value: 'Q3 2026' },
            ],
          }),
          notes({ title: 'What people ask before they start' }, [
            {
              question: 'What does a project cost?',
              answer: 'An identity is typically €28–60k and a product engagement €40–90k. We quote a fixed price after a paid discovery week, not before.',
            },
            {
              question: 'Do you work in stages?',
              answer: 'Yes, and you can stop at the end of any of them. Everything produced up to that point is yours, in source, with no licence attached.',
            },
            {
              question: 'Will you work with our developers?',
              answer: 'Usually. We hand over a system and sit in your standups for the first fortnight of build, which is when systems actually get broken.',
            },
            {
              question: 'Who owns the work?',
              answer: 'You do, in full, on final payment — including the fonts we license on your behalf and the files behind every asset.',
            },
          ]),
          contact({ title: 'Start a conversation' }, [
            {
              label: 'Projects',
              value: 'studio@vesper.example',
              href: 'mailto:studio@vesper.example',
              note: 'A paragraph about what you are making is plenty.',
            },
            {
              label: 'Studio',
              value: 'Van Nelleweg 1\n3044 BC Rotterdam',
              note: 'Visitors welcome on Thursdays.',
            },
          ]),
        ],
      },
    ],
  }),
};

/* ------------------------------------------------------------ Marlowe --- */

const MARLOWE_SERIES = { label: 'Series', path: '/series' };
const MARLOWE_PRINTS = { label: 'Prints', path: '/prints' };

export const marlowe: TemplateDef = {
  id: 'marlowe',
  name: 'Marlowe',
  kind: 'Photographer',
  category: 'portfolio',
  description:
    'A photographer’s site on near-black, where the plates are the only bright thing. Almost no type, because the images are supposed to be doing the work.',
  swatches: ['#0c0c0c', '#f2f0ed', '#9a8f7d'],
  theme: theme(
    {
      background: '#0c0c0c',
      surface: '#161616',
      text: '#f2f0ed',
      textMuted: '#8d8a85',
      accent: '#9a8f7d',
      accentText: '#12100c',
      border: '#242424',
    },
    FACES.editorial,
  ),
  pages: site({
    brand: 'Marlowe',
    tagline: 'Landscape and industrial photography.',
    map: siteMap(MARLOWE_SERIES, MARLOWE_PRINTS),
    nav: { radius: '2px' },
    columns: [
      { heading: 'Work', links: [MARLOWE_SERIES, MARLOWE_PRINTS] },
      { heading: 'Start here', links: [HOME] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              title: 'Ruth Marlowe',
              lede: 'Landscape and industry. Northern England, mostly, and wherever the weather is doing something.',
              primary: 'View series',
            },
            { scale: 1.3, radius: '2px' },
          ),
          plates(9, { columns: 3, ratio: '300px', subject: 'Photograph by Ruth Marlowe' }),
          about({
            title: 'About',
            body: 'I photograph places that are working, or have stopped. Prints are made in editions of twenty-five and shipped from the studio in Leeds.',
            items: [
              { label: 'Based', value: 'Leeds, UK' },
              { label: 'Represented by', value: 'Kestrel Gallery' },
              { label: 'Prints', value: 'Editions of 25' },
              { label: 'Commissions', value: 'Open' },
            ],
          }),
          cta({
            title: 'Prints and commissions',
            lede: 'Editions ship worldwide. Commission enquiries usually get a reply the same week.',
            primary: 'Get in touch',
          }),
        ],
      },
      {
        at: MARLOWE_SERIES,
        sections: [
          pageHead({
            eyebrow: 'Series',
            title: 'Four bodies of work.',
            lede: 'Each one is shot over a year or more. They are not projects so much as places I kept going back to.',
          }),
          workIndex(
            {},
            [
              { title: 'Coalfield', discipline: 'Long-form, ongoing', year: '2023 —' },
              { title: 'The Tidal Road', discipline: 'Series of 24', year: '2025' },
              { title: 'Winter Plant', discipline: 'Commission', year: '2024' },
              { title: 'Salt', discipline: 'Series of 12', year: '2022' },
            ],
            { background: '#161616' },
          ),
          plates(6, { columns: 2, ratio: '320px', subject: 'From the series Coalfield' }),
          closer({
            title: 'Full series are shown by appointment at the Leeds studio.',
            action: 'Get in touch',
          }),
        ],
      },
      {
        at: MARLOWE_PRINTS,
        sections: [
          pageHead({
            eyebrow: 'Prints',
            title: 'Editions of twenty-five, made in Leeds.',
            lede: 'Archival pigment on Hahnemühle Photo Rag, signed and numbered on the reverse.',
          }),
          notes(
            { title: 'What you are buying' },
            [
              {
                question: 'Sizes and prices',
                answer: 'Small (40×50cm) £180, medium (60×75cm) £340, large (90×112cm) £680. Unframed, shipped rolled in a tube.',
              },
              {
                question: 'The edition',
                answer: 'Twenty-five of each size, plus three artist proofs. When a size closes it stays closed; nothing is reprinted at a different scale to get around it.',
              },
              {
                question: 'Delivery',
                answer: 'Made to order in about three weeks. UK shipping is included; elsewhere is at cost and quoted before anything is charged.',
              },
              {
                question: 'Framing',
                answer: 'Not offered, deliberately. A local framer will do it better and cheaper than I can ship a frame across a country.',
              },
            ],
            { background: '#161616' },
          ),
          plates(4, { columns: 2, ratio: '300px', subject: 'Available print' }),
          contact({ title: 'Order or ask' }, [
            {
              label: 'Prints',
              value: 'prints@marlowe.example',
              href: 'mailto:prints@marlowe.example',
              note: 'Tell me the image and the size; I will invoice directly.',
            },
            {
              label: 'Gallery',
              value: 'Kestrel Gallery, Leeds',
              note: 'For framed work and exhibition sales.',
            },
          ]),
        ],
      },
    ],
  }),
};

/* ------------------------------------------------------------- Kestrel --- */

const KESTREL_WRITING = { label: 'Writing', path: '/writing' };
const KESTREL_CV = { label: 'CV', path: '/cv' };

export const kestrel: TemplateDef = {
  id: 'kestrel',
  name: 'Kestrel',
  kind: 'Developer portfolio',
  category: 'portfolio',
  description:
    'An engineer’s site, set in monospace on a dark ground. Reads like a well-kept README: what was built, what it was built with, and what it is doing now.',
  swatches: ['#101216', '#e6e9ee', '#7ee787'],
  theme: theme(
    {
      background: '#101216',
      surface: '#181b21',
      text: '#e6e9ee',
      textMuted: '#8b93a1',
      accent: '#7ee787',
      accentText: '#0b1b0e',
      border: '#242832',
    },
    FACES.technical,
  ),
  pages: site({
    brand: 'kestrel.dev',
    tagline: 'Infrastructure and database engineering.',
    cta: 'Email me',
    map: siteMap(KESTREL_WRITING, KESTREL_CV),
    nav: { radius: '4px' },
    columns: [
      { heading: 'Work', links: [HOME, KESTREL_CV] },
      { heading: 'Writing', links: [KESTREL_WRITING] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroSplit(
            {
              eyebrow: 'Infrastructure engineer',
              title: 'I make slow systems fast and loud systems quiet.',
              lede: 'Twelve years on backend and platform work, mostly databases and the things that talk to them. Currently at a payments company in Berlin.',
              primary: 'Email me',
              secondary: 'Read the writing',
            },
            mockPanel('~/projects', { rows: 5 }),
            { radius: '4px' },
          ),
          workIndex(
            { eyebrow: 'Selected work' },
            [
              { title: 'Ledger rewrite', discipline: 'Postgres, Rust', year: '2026' },
              { title: 'Query planner cache', discipline: 'Open source', year: '2025' },
              { title: 'Multi-region failover', discipline: 'Platform', year: '2024' },
              { title: 'pgcheck', discipline: 'Open source', year: '2023' },
            ],
            { background: '#181b21' },
          ),
          showcase(
            {
              eyebrow: 'Writing',
              title: 'I write things down when they take me too long',
              body: 'Mostly post-mortems of my own mistakes, occasionally something useful about query planning. Roughly one piece a month.',
              bullets: [
                'Why your index is not being used',
                'Failover is a people problem',
                'Reading EXPLAIN without crying',
              ],
            },
            mockPanel('writing/', { rows: 4 }),
          ),
          cta(
            {
              title: 'Open to interesting problems',
              lede: 'Contract or full time, remote or Berlin. Databases preferred, but not required.',
              primary: 'Email me',
            },
            { background: '#181b21', radius: '4px' },
          ),
        ],
      },
      {
        at: KESTREL_WRITING,
        sections: [
          pageHead({
            eyebrow: 'Writing',
            title: 'Notes from things that took too long.',
            lede: 'Roughly monthly. No newsletter, no popup, and the RSS feed has been at /feed.xml since 2019.',
          }),
          workIndex(
            {},
            [
              { title: 'Why your index is not being used', discipline: 'Postgres', year: 'Mar 2026' },
              { title: 'Failover is a people problem', discipline: 'Platform', year: 'Jan 2026' },
              { title: 'Reading EXPLAIN without crying', discipline: 'Postgres', year: 'Nov 2025' },
              { title: 'A cache that made things slower', discipline: 'Post-mortem', year: 'Aug 2025' },
              { title: 'Connection pools, and where they go wrong', discipline: 'Postgres', year: 'May 2025' },
              { title: 'The migration that ran for nine days', discipline: 'Post-mortem', year: 'Feb 2025' },
            ],
            { background: '#181b21' },
          ),
          notes({ title: 'Two things worth saying about all of it' }, [
            {
              question: 'Most of these are mistakes',
              answer: 'The post-mortems are of my own work. A write-up of somebody else’s outage is a much easier thing to publish and a much less useful thing to read.',
            },
            {
              question: 'The benchmarks are reproducible',
              answer: 'Every post with numbers in it links a repository that generates them, including the schema and the data. If you cannot rerun it, do not trust it.',
            },
          ]),
          closer(
            { title: 'Disagree with one of these?', action: 'Email me', note: 'Corrections get published with the correction, not quietly edited in.' },
            { background: '#181b21' },
          ),
        ],
      },
      {
        at: KESTREL_CV,
        sections: [
          pageHead({
            eyebrow: 'CV',
            title: 'Twelve years, four companies.',
            lede: 'The short version. A PDF is available on request, and it says the same things in a worse font.',
          }),
          workIndex(
            { eyebrow: 'Roles' },
            [
              { title: 'Staff engineer, payments', discipline: 'Berlin · ledger, Postgres, Rust', year: '2023 —' },
              { title: 'Platform lead, logistics', discipline: 'Remote · multi-region, failover', year: '2020 – 2023' },
              { title: 'Backend engineer, marketplace', discipline: 'London · Ruby, Postgres', year: '2017 – 2020' },
              { title: 'Engineer, agency', discipline: 'Manchester · everything', year: '2014 – 2017' },
            ],
            { background: '#181b21' },
          ),
          notes({ title: 'What I am actually good at' }, [
            {
              question: 'Databases under load',
              answer: 'Query planning, index design, connection management and the migrations you cannot take downtime for. Postgres mostly, MySQL when I must.',
            },
            {
              question: 'Making failure boring',
              answer: 'Failover, replication topology, and the runbooks and drills that mean the third incident goes better than the first.',
            },
            {
              question: 'Rust and Go, when they earn it',
              answer: 'Both in production. Neither as a preference — most of what makes a system fast is not the language it is written in.',
            },
            {
              question: 'What I am not',
              answer: 'A frontend engineer, and not a manager. I have done both and the work was worse than when the right person did it.',
            },
          ]),
          contact({ title: 'Get in touch' }, [
            { label: 'Email', value: 'hi@kestrel.example', href: 'mailto:hi@kestrel.example' },
            { label: 'Code', value: 'github.com/kestrel', href: 'https://github.com/kestrel' },
          ]),
        ],
      },
    ],
  }),
};

/* ---------------------------------------------------------- Atelier Nord - */

const NORD_PROJECTS = { label: 'Projects', path: '/projects' };
const NORD_PRACTICE = { label: 'Practice', path: '/practice' };

export const atelierNord: TemplateDef = {
  id: 'atelier-nord',
  name: 'Atelier Nord',
  kind: 'Architecture practice',
  category: 'portfolio',
  description:
    'An architecture practice in cool grey and glass blue. Large plates, small type, and an index that reads like a project register rather than a gallery.',
  swatches: ['#ecedee', '#1a1d20', '#41627e'],
  theme: theme(
    {
      background: '#ecedee',
      surface: '#e0e2e4',
      text: '#1a1d20',
      textMuted: '#636a71',
      accent: '#41627e',
      accentText: '#ffffff',
      border: '#d2d5d8',
    },
    FACES.grotesque,
  ),
  pages: site({
    brand: 'Atelier Nord',
    tagline: 'Architecture and interiors. Bergen and Inverness.',
    map: siteMap(NORD_PROJECTS, NORD_PRACTICE),
    nav: { radius: '0px' },
    columns: [
      { heading: 'Practice', links: [NORD_PROJECTS, NORD_PRACTICE] },
      { heading: 'Start here', links: [HOME] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              eyebrow: 'Architecture and interiors',
              title: 'Buildings that behave well in bad weather.',
              lede: 'A practice working across Norway and northern Scotland on housing, civic buildings and the occasional very small cabin.',
              primary: 'See projects',
              secondary: 'About the practice',
            },
            { scale: 1.1, radius: '0px' },
          ),
          plates(4, { columns: 2, ratio: '340px', background: '#e0e2e4', subject: 'Atelier Nord building' }),
          workIndex({ eyebrow: 'Project register' }, [
            { title: 'Bergen Housing', discipline: '34 dwellings', year: '2026' },
            { title: 'Skerry Cabin', discipline: 'Private, 48m²', year: '2025' },
            { title: 'Tromsø Library', discipline: 'Civic, competition', year: '2025' },
            { title: 'Fjord Workshops', discipline: 'Light industrial', year: '2023' },
          ]),
          cta(
            {
              title: 'Discuss a project',
              lede: 'We are taking on commissions from the second half of 2026.',
              primary: 'Get in touch',
            },
            { radius: '0px' },
          ),
        ],
      },
      {
        at: NORD_PROJECTS,
        sections: [
          pageHead({
            eyebrow: 'Projects',
            title: 'The register, complete.',
            lede: 'Built, under construction and competition entries, including the ones we did not win.',
          }),
          workIndex(
            {},
            [
              { title: 'Bergen Housing', discipline: '34 dwellings · complete', year: '2026' },
              { title: 'Skerry Cabin', discipline: 'Private, 48m² · complete', year: '2025' },
              { title: 'Tromsø Library', discipline: 'Civic · competition, second', year: '2025' },
              { title: 'Ålesund Quay', discipline: 'Mixed use · on site', year: '2025' },
              { title: 'Fjord Workshops', discipline: 'Light industrial · complete', year: '2023' },
              { title: 'Inverness Health Centre', discipline: 'Civic · complete', year: '2022' },
              { title: 'Storfjord School', discipline: 'Education · competition', year: '2021' },
            ],
            { background: '#e0e2e4' },
          ),
          plates(6, { columns: 2, ratio: '320px', subject: 'Atelier Nord project photograph' }),
          closer({ title: 'Drawings and specifications on request.', action: 'Get in touch' }),
        ],
      },
      {
        at: NORD_PRACTICE,
        sections: [
          pageHead({
            eyebrow: 'Practice',
            title: 'Eleven people, half of whom build models.',
            lede: 'A practice large enough to take on a civic building and small enough that a partner is on every site visit.',
          }),
          about({
            title: 'The practice',
            body: 'Eleven people, half of whom build models. We take on six projects a year and see each one through to the site visit that closes it.',
            items: [
              { label: 'Founded', value: '2011, Bergen' },
              { label: 'Studio', value: 'Eleven people' },
              { label: 'Sectors', value: 'Housing, civic, private' },
              { label: 'Awards', value: 'Available on request' },
            ],
          }),
          notes({ title: 'How we work' }, [
            {
              question: 'Fees',
              answer: 'Percentage of construction cost on a full service, day rate for feasibility. Both quoted in writing before the first drawing.',
            },
            {
              question: 'Climate and fabric',
              answer: 'Everything is modelled for the wettest decade on record for the site, not the average. It is the reason our buildings look the way they do.',
            },
            {
              question: 'Who you deal with',
              answer: 'A partner leads every project and attends every site meeting. There is no separate delivery team you meet at stage four.',
            },
            {
              question: 'Timescales',
              answer: 'Feasibility in six weeks, planning in four to eight months depending on the authority. We tell you which of those we control.',
            },
          ]),
          contact({ title: 'Enquiries' }, [
            {
              label: 'New projects',
              value: 'post@atelier-nord.example',
              href: 'mailto:post@atelier-nord.example',
              note: 'A site address and a budget range is enough to start.',
            },
            { label: 'Bergen', value: 'Bryggen 14\n5003 Bergen, Norway' },
            { label: 'Inverness', value: '2 Ness Walk\nInverness IV3 5NE' },
          ]),
        ],
      },
    ],
  }),
};

/* --------------------------------------------------------------- Bramble - */

const BRAMBLE_WORK = { label: 'Work', path: '/work' };
const BRAMBLE_ABOUT = { label: 'About', path: '/about' };

export const bramble: TemplateDef = {
  id: 'bramble',
  name: 'Bramble',
  kind: 'Illustrator',
  category: 'portfolio',
  description:
    'An illustrator’s site in cream and cherry, geometric and cheerful without being childish. Plates first, words second, commissions in the nav.',
  swatches: ['#fdf6ef', '#2a1d1a', '#d94f45'],
  theme: theme(
    {
      background: '#fdf6ef',
      surface: '#f6e9dc',
      text: '#2a1d1a',
      textMuted: '#7a655c',
      accent: '#d94f45',
      accentText: '#ffffff',
      border: '#ecdccb',
    },
    FACES.geometric,
  ),
  pages: site({
    brand: 'Bramble',
    tagline: 'Illustration by June Park.',
    cta: 'Commission',
    map: siteMap(BRAMBLE_WORK, BRAMBLE_ABOUT),
    nav: { radius: '999px' },
    columns: [
      { heading: 'Work', links: [BRAMBLE_WORK] },
      { heading: 'About', links: [BRAMBLE_ABOUT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              title: 'June Park draws for books, magazines and the occasional jar of jam.',
              lede: 'Editorial and packaging illustration, working mostly in gouache and mostly with people who like colour.',
              primary: 'See the work',
              secondary: 'Commission a piece',
            },
            { scale: 1.05, radius: '999px' },
          ),
          plates(6, { columns: 3, ratio: '240px', subject: 'Illustration by June Park' }),
          workIndex(
            { eyebrow: 'Recent' },
            [
              { title: 'The Paris Review', discipline: 'Editorial, four covers', year: '2026' },
              { title: 'Ferment Co.', discipline: 'Packaging, full range', year: '2025' },
              { title: 'A Year of Small Birds', discipline: 'Book, 64 plates', year: '2025' },
              { title: 'Kew Gardens', discipline: 'Poster series', year: '2024' },
            ],
            { background: '#f6e9dc' },
          ),
          cta(
            {
              title: 'Commissions are open',
              lede: 'Editorial turnaround is usually two weeks. Packaging and books, rather longer.',
              primary: 'Commission a piece',
            },
            { radius: '999px' },
          ),
        ],
      },
      {
        at: BRAMBLE_WORK,
        sections: [
          pageHead({
            eyebrow: 'Work',
            title: 'Editorial, packaging, books.',
            lede: 'Roughly in that order by volume, and in the opposite order by how long each one takes.',
          }),
          plates(9, { columns: 3, ratio: '240px', subject: 'Illustration by June Park' }),
          workIndex(
            {},
            [
              { title: 'The Paris Review', discipline: 'Editorial, four covers', year: '2026' },
              { title: 'Ferment Co.', discipline: 'Packaging, full range', year: '2025' },
              { title: 'A Year of Small Birds', discipline: 'Book, 64 plates', year: '2025' },
              { title: 'Noon Magazine', discipline: 'Editorial, monthly', year: '2024 —' },
              { title: 'Kew Gardens', discipline: 'Poster series', year: '2024' },
              { title: 'Hollow & Sons', discipline: 'Packaging, labels', year: '2023' },
            ],
            { background: '#f6e9dc' },
          ),
          closer(
            { title: 'Something like one of these, or nothing like them?', action: 'Commission a piece' },
            { background: '#f6e9dc' },
          ),
        ],
      },
      {
        at: BRAMBLE_ABOUT,
        sections: [
          pageHead({
            eyebrow: 'About',
            title: 'Gouache, mostly. Deadlines, always.',
            lede: 'I have been drawing for a living since 2016, from a studio above a bike shop in Margate.',
          }),
          about({
            title: 'How a commission works',
            body: 'A brief, a fee, three roughs, one round of changes and the final piece. I quote before I start and the quote does not move unless the brief does.',
            items: [
              { label: 'Based', value: 'Margate, UK' },
              { label: 'Medium', value: 'Gouache, some digital' },
              { label: 'Editorial', value: 'About two weeks' },
              { label: 'Books', value: 'Three to nine months' },
            ],
          }),
          notes(
            { title: 'The practical bits' },
            [
              {
                question: 'What does it cost?',
                answer: 'Editorial spots from £280, covers from £900, packaging ranges quoted per project. Rates are the AOI’s recommended ones, not below them.',
              },
              {
                question: 'What do you keep?',
                answer: 'Copyright, always. You get a licence for the use we agreed, for the territory and term we agreed, and I will not resell the piece.',
              },
              {
                question: 'Can I see the originals?',
                answer: 'Yes — originals are for sale after publication, and clients get first refusal at cost.',
              },
              {
                question: 'Do you take on students?',
                answer: 'Not formally, but I answer portfolio questions by email and always will. Ask.',
              },
            ],
            { background: '#f6e9dc' },
          ),
          contact({ title: 'Get in touch' }, [
            {
              label: 'Commissions',
              value: 'june@bramble.example',
              href: 'mailto:june@bramble.example',
              note: 'Brief, deadline and budget, in any order.',
            },
            { label: 'Studio', value: 'Above Fairlight Cycles\nMargate CT9 1RS' },
          ]),
        ],
      },
    ],
  }),
};

/* ---------------------------------------------------------------- Foundry - */

const FOUNDRY_WORK = { label: 'Work', path: '/work' };
const FOUNDRY_CONTACT = { label: 'Contact', path: '/contact' };

export const foundry: TemplateDef = {
  id: 'foundry',
  name: 'Foundry',
  kind: 'Motion designer',
  category: 'portfolio',
  description:
    'A motion designer’s reel page: black ground, electric yellow, condensed caps. Built to be scrolled fast, with the reel above everything else.',
  swatches: ['#000000', '#f5f5f5', '#e8ff45'],
  theme: theme(
    {
      background: '#000000',
      surface: '#0e0e0e',
      text: '#f5f5f5',
      textMuted: '#8a8a8a',
      accent: '#e8ff45',
      accentText: '#181a00',
      border: '#1e1e1e',
    },
    FACES.condensed,
  ),
  pages: site({
    brand: 'Foundry',
    tagline: 'Motion design and direction.',
    cta: 'Hire me',
    map: siteMap(FOUNDRY_WORK, FOUNDRY_CONTACT),
    nav: { radius: '0px' },
    columns: [
      { heading: 'Work', links: [HOME, FOUNDRY_WORK] },
      { heading: 'Contact', links: [FOUNDRY_CONTACT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              eyebrow: 'Motion design and direction',
              title: 'Things that move on purpose.',
              lede: 'Title sequences, product film and broadcast identity. Ten years of it, mostly in After Effects and increasingly in Houdini.',
              primary: 'Watch the reel',
              secondary: 'See the work',
            },
            { scale: 1.35, radius: '0px' },
          ),
          plates(4, { columns: 2, ratio: '280px', background: '#0e0e0e', subject: 'Frame from the reel' }),
          workIndex({ eyebrow: 'Selected' }, [
            { title: 'Nightjar', discipline: 'Title sequence', year: '2026' },
            { title: 'Vantage Audio', discipline: 'Product film', year: '2025' },
            { title: 'Channel 5 rebrand', discipline: 'Broadcast identity', year: '2024' },
            { title: 'Hollow Coast', discipline: 'Short, direction', year: '2023' },
          ]),
          cta(
            {
              title: 'Available from September',
              lede: 'Freelance, remote or on site. Broadcast, product and title work all welcome.',
              primary: 'Hire me',
            },
            { background: '#0e0e0e', radius: '0px' },
          ),
        ],
      },
      {
        at: FOUNDRY_WORK,
        sections: [
          pageHead({
            eyebrow: 'Work',
            title: 'Ten years, in reverse.',
            lede: 'Direction credits marked as such. Everything else I animated, and often designed, but did not direct.',
          }),
          workIndex(
            {},
            [
              { title: 'Nightjar', discipline: 'Title sequence · design, animation', year: '2026' },
              { title: 'Vantage Audio', discipline: 'Product film · direction', year: '2025' },
              { title: 'Meridian Festival', discipline: 'Idents · design, animation', year: '2025' },
              { title: 'Channel 5 rebrand', discipline: 'Broadcast identity · animation', year: '2024' },
              { title: 'Kelp', discipline: 'Music video · direction', year: '2024' },
              { title: 'Hollow Coast', discipline: 'Short · direction', year: '2023' },
              { title: 'Aster Bank', discipline: 'Explainer series · animation', year: '2022' },
            ],
            { background: '#0e0e0e' },
          ),
          plates(6, { columns: 3, ratio: '200px', subject: 'Frame from the work' }),
          closer(
            { title: 'The full reel is two minutes and has sound.', action: 'Watch the reel' },
            { background: '#0e0e0e' },
          ),
        ],
      },
      {
        at: FOUNDRY_CONTACT,
        sections: [
          pageHead({
            eyebrow: 'Contact',
            title: 'Free from September.',
            lede: 'Booking usually two to three months out. Short-notice work sometimes happens — ask.',
          }),
          contact(
            { title: 'How to book' },
            [
              {
                label: 'Work',
                value: 'hello@foundry.example',
                href: 'mailto:hello@foundry.example',
                note: 'Dates, format and a rough length is enough for a quote.',
              },
              {
                label: 'Rate',
                value: '£650 a day',
                note: 'Project rates for anything over three weeks. Kit and licences included.',
              },
              { label: 'Based', value: 'Bristol, UK\nRemote, or on site anywhere' },
            ],
            { background: '#0e0e0e' },
          ),
          notes({ title: 'Before you write' }, [
            {
              question: 'What do you need from me?',
              answer: 'A script or a board if there is one, the delivery formats, and the actual deadline rather than the comfortable one.',
            },
            {
              question: 'Do you pitch?',
              answer: 'Paid pitches, yes. Unpaid ones, no — including the ones described as "a small test".',
            },
          ]),
        ],
      },
    ],
  }),
};

export const PORTFOLIO_TEMPLATES: TemplateDef[] = [
  vesper,
  marlowe,
  kestrel,
  atelierNord,
  bramble,
  foundry,
];
