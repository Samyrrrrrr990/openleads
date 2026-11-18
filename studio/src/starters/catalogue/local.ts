/**
 * Local business templates.
 *
 * Eight businesses that exist on a street rather than on the internet: two
 * places to eat, two practices, two trades, two studios. They are the reason
 * the `local` category exists, and they are built from `localPatterns.ts`
 * rather than the marketing vocabulary, because the page a restaurant needs is
 * not a shorter version of the page a SaaS needs — it answers different
 * questions in a different order.
 *
 * What separates them is not the palette. A dental practice and a barre studio
 * can share a colour and still be nothing alike: the clinic leads with what it
 * treats and what it costs, the studio leads with the timetable, the
 * electrician leads with the area covered and a phone number, and the
 * restaurant leads with the menu. That ordering is the design decision in each
 * of these, and it is why they are eight templates rather than one template
 * eight times.
 *
 * Each is three pages, and the split is the point rather than padding. These
 * were single scrolls of a hundred nodes — a restaurant's menu, hours, and
 * questions all stacked under one hero, with a navigation bar naming three
 * destinations that did not exist. A menu is a page. Opening hours and an
 * address are a page. Somebody standing outside on a phone wanting to know
 * whether you are open should not scroll past your wine list to find out.
 *
 * Every business here is fictional and reads as such — a plausible address, a
 * plausible price, plausible hours. No template ships a real company's details,
 * a stock portrait of somebody who does not work there, or a review nobody
 * wrote.
 */

import { cta, showcase, mockPanel } from '../patterns';
import {
  booking,
  faq,
  hours,
  menu,
  placeHero,
  serviceAreas,
  services,
  team,
  tiers,
} from '../localPatterns';
import { pageHead } from '../pageParts';
import { siteMap, HOME } from '../sitemap';
import { FACES, site, theme, type TemplateDef } from './kit';

const CARDOON_MENU = { label: 'Menu', path: '/menu' };
const CARDOON_VISIT = { label: 'Visit', path: '/visit' };
const PENNY_VISIT = { label: 'Visit', path: '/visit' };
const PENNY_WHOLESALE = { label: 'Wholesale', path: '/wholesale' };
const ALDER_PRACTICE = { label: 'The practice', path: '/practice' };
const ALDER_CONTACT = { label: 'Contact', path: '/contact' };
const STILL_ABOUT = { label: 'About', path: '/about' };
const STILL_CONTACT = { label: 'Get in touch', path: '/contact' };
const HOLLIS_AREAS = { label: 'Areas', path: '/areas' };
const HOLLIS_QUOTE = { label: 'Quotes', path: '/quotes' };
const MARSH_PRICING = { label: 'How we price', path: '/pricing' };
const MARSH_AREAS = { label: 'Areas', path: '/areas' };
const IRON_COACHING = { label: 'Coaching', path: '/coaching' };
const IRON_VISIT = { label: 'Visit', path: '/visit' };
const FOLD_PRICING = { label: 'Pricing', path: '/pricing' };
const FOLD_VISIT = { label: 'Visit', path: '/visit' };


/* ------------------------------------------------------------------- Cardoon -- */

export const cardoon: TemplateDef = {
  id: 'cardoon',
  name: 'Cardoon',
  kind: 'Restaurant',
  category: 'local',
  description:
    'A neighbourhood restaurant that leads with the menu instead of a photograph of somebody else’s food. Warm paper, a quiet serif, and the two facts people actually scroll for.',
  swatches: ['#faf7f0', '#211d18', '#8c4a2f'],
  theme: theme(
    {
      background: '#faf7f0',
      surface: '#f2ece0',
      text: '#211d18',
      textMuted: '#6b6154',
      accent: '#8c4a2f',
      accentText: '#faf7f0',
      border: '#e0d7c6',
    },
    FACES.editorial,
  ),

  pages: site({
    brand: 'Cardoon',
    tagline: '41 Fulton Street, Sheffield',
    cta: 'Book a table',
    map: siteMap(CARDOON_MENU, CARDOON_VISIT),
    columns: [
      { heading: 'Eat', links: [CARDOON_MENU] },
      { heading: 'Visit', links: [CARDOON_VISIT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          placeHero({
            eyebrow: 'Fulton Street',
            title: 'Small plates, a short list, and a room that stays quiet enough to talk.',
            lede: 'We cook what the market gave us that morning, which is why the menu is short and changes on Tuesdays. Twenty-eight covers, one seating a night.',
            action: 'Book a table',
            phone: '(0114) 273 8890',
            facts: ['Dinner Tue–Sat', 'Walk-ins at the counter', 'Corkage £8'],
          }),
          faq({ title: 'Before you come' }, [
            {
              question: 'Do you take bookings for one?',
              answer: 'Yes, and the four seats at the counter are the nicest in the room for it.',
            },
            {
              question: 'Can you cook around allergies?',
              answer:
                'Usually, if you tell us when you book. The menu is short enough that we know every ingredient in it by heart.',
            },
            {
              question: 'Is there a set menu?',
              answer:
                'Only for the whole room on Sunday lunch — five courses, £45, and it is the same for everybody.',
            },
          ]),
        ],
      },
      {
        at: CARDOON_MENU,
        sections: [
          pageHead({
            eyebrow: 'This week',
            title: 'Written on Tuesday, printed the same afternoon.',
            lede: 'Twenty-eight covers and one seating a night, so the list is short on purpose. If something has sold out by nine, it has genuinely sold out.',
          }),
          menu(
            {
              eyebrow: 'This week',
              title: 'The menu',
              lede: 'Written on Tuesday morning and printed the same afternoon. If something here has sold out by nine, it has genuinely sold out.',
            },
            [
              {
                name: 'To start',
                items: [
                  {
                    name: 'Bread, cultured butter',
                    description: 'Baked here each afternoon. The butter is churned on Mondays.',
                    price: '£5',
                  },
                  {
                    name: 'Cardoon, anchovy, brown butter',
                    description: 'The dish the place is named after. On until the season ends in March.',
                    price: '£11',
                  },
                  {
                    name: 'Chicory, walnut, aged sheep’s cheese',
                    description: 'Bitter, sweet, salty. Meant to be eaten with your hands.',
                    price: '£9',
                  },
                ],
              },
              {
                name: 'Larger',
                items: [
                  {
                    name: 'Hogget shoulder, white beans, salsa verde',
                    description: 'Cooked overnight. For two or three to share, and it will feed three.',
                    price: '£34',
                  },
                  {
                    name: 'Whole plaice, capers, seaweed butter',
                    description: 'Landed at Scarborough and on the pass within a day.',
                    price: '£26',
                  },
                  {
                    name: 'Baked celeriac, hazelnut, lovage',
                    description: 'The vegetarian dish, and not an afterthought — it takes four hours.',
                    price: '£19',
                  },
                ],
              },
              {
                name: 'To finish',
                items: [
                  {
                    name: 'Burnt honey tart',
                    description: 'One slice left by half nine, most nights.',
                    price: '£8',
                  },
                  { name: 'Yorkshire cheeses, quince', price: '£11' },
                ],
              },
            ],
          ),
        ],
      },
      {
        at: CARDOON_VISIT,
        sections: [
          pageHead({
            eyebrow: 'Visit',
            title: 'Fulton Street, and how to get a table.',
            lede: 'Dinner Tuesday to Saturday, lunch on Sunday. The four seats at the counter take walk-ins all evening.',
          }),
          hours(
            { eyebrow: 'Coming in', title: 'When and where' },
            [
              { day: 'Monday', hours: 'Closed' },
              { day: 'Tuesday – Thursday', hours: '6pm – 10pm' },
              { day: 'Friday – Saturday', hours: '6pm – 11pm' },
              { day: 'Sunday', hours: 'Lunch only, 12pm – 4pm' },
            ],
            {
              address: ['41 Fulton Street', 'Sheffield', 'S6 3QD'],
              phone: '(0114) 273 8890',
              email: 'table@cardoon.example',
              note: 'The last kitchen order is forty-five minutes before we close. The counter takes walk-ins all evening.',
            },
          ),
        ],
      },
    ],
  }),
};

/* ---------------------------------------------------------------- Pennyroyal -- */

export const pennyroyal: TemplateDef = {
  id: 'pennyroyal',
  name: 'Pennyroyal',
  kind: 'Café and bakery',
  category: 'local',
  description:
    'A morning café that opens at six and sells out by two. Bright, plain and fast to read on a phone standing outside, which is where most people read it.',
  swatches: ['#fffdf8', '#1a1a17', '#2f6d4f'],
  theme: theme(
    {
      background: '#fffdf8',
      surface: '#f3f1e8',
      text: '#1a1a17',
      textMuted: '#6a685e',
      accent: '#2f6d4f',
      accentText: '#fffdf8',
      border: '#e3e0d3',
    },
    FACES.geometric,
  ),

  pages: site({
    brand: 'Pennyroyal',
    tagline: '12 Colville Road, Bristol',
    cta: 'Pre-order',
    map: siteMap(PENNY_VISIT, PENNY_WHOLESALE),
    columns: [
      { heading: 'Shop', links: [HOME, PENNY_VISIT] },
      { heading: 'Trade', links: [PENNY_WHOLESALE] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          placeHero({
            eyebrow: 'Open 6.30am',
            title: 'Bread in the morning, and not much of it left by two.',
            lede: 'A four-person bakery on Colville Road. We bake once, we bake early, and when it is gone it is gone until tomorrow.',
            action: 'Pre-order for collection',
            facts: ['Six days a week', 'Collection from 6.30am', 'Wholesale from 40 loaves'],
          }),
          menu({ eyebrow: 'Today', title: 'What is on the shelf' }, [
            {
              name: 'Bread',
              items: [
                {
                  name: 'Country sourdough',
                  description: 'Two-day ferment, 1kg. The one we make most of.',
                  price: '£5.20',
                },
                { name: 'Seeded rye', description: 'Dense, sour, keeps for a week.', price: '£5.80' },
                { name: 'Milk loaf', description: 'Soft, sweet, gone by nine most days.', price: '£4.40' },
              ],
            },
            {
              name: 'Morning',
              items: [
                { name: 'Butter croissant', price: '£3.20' },
                { name: 'Cardamom bun', description: 'Fridays and Saturdays only.', price: '£4.10' },
                { name: 'Sausage roll', description: 'Free-range pork, fennel, black pepper.', price: '£4.80' },
              ],
            },
            {
              name: 'Coffee',
              items: [
                { name: 'Filter', price: '£3.00' },
                { name: 'Flat white', price: '£3.60' },
              ],
            },
          ]),
        ],
      },
      {
        at: PENNY_VISIT,
        sections: [
          pageHead({
            eyebrow: 'Visit',
            title: 'Colville Road, six mornings a week.',
            lede: 'Pre-orders are collected before eleven. After that we sell whatever is still on the shelf, which on a Saturday is not much.',
          }),
          hours(
            { title: 'Where we are' },
            [
              { day: 'Monday', hours: 'Closed' },
              { day: 'Tuesday – Friday', hours: '6.30am – 2pm' },
              { day: 'Saturday', hours: '7am – 3pm' },
              { day: 'Sunday', hours: '8am – 1pm' },
            ],
            {
              address: ['12 Colville Road', 'Bristol', 'BS6 5EQ'],
              phone: '(0117) 908 4412',
              email: 'hello@pennyroyal.example',
              note: 'Pre-orders are collected before eleven. After that we sell whatever is left on the shelf.',
            },
          ),
        ],
      },
      {
        at: PENNY_WHOLESALE,
        sections: [
          pageHead({
            eyebrow: 'Wholesale',
            title: 'Forty loaves and up, delivered before seven.',
            lede: 'We supply nine cafés and two restaurants across Bristol. Standing orders are set weekly and can move with your trade.',
          }),
          cta({
            title: 'Wholesale',
            lede: 'We supply nine cafés and two restaurants across Bristol. Minimum forty loaves, delivered before seven.',
            primary: 'Ask about wholesale',
          }),
        ],
      },
    ],
  }),
};

/* ----------------------------------------------------------------- Alderwood -- */

export const alderwood: TemplateDef = {
  id: 'alderwood',
  name: 'Alderwood Dental',
  kind: 'Dental practice',
  category: 'local',
  description:
    'A dental practice that publishes its prices. Cool, calm and institutional, built to answer the two questions people are too embarrassed to phone and ask.',
  swatches: ['#ffffff', '#12232e', '#3f7d8c'],
  theme: theme(
    {
      background: '#ffffff',
      surface: '#f4f8f9',
      text: '#12232e',
      textMuted: '#5c7280',
      accent: '#3f7d8c',
      accentText: '#ffffff',
      border: '#dde7ea',
    },
    FACES.grotesque,
  ),

  pages: site({
    brand: 'Alderwood',
    tagline: '84 Alderwood Road, Manchester',
    cta: 'Book',
    map: siteMap(ALDER_PRACTICE, ALDER_CONTACT),
    columns: [
      { heading: 'Practice', links: [HOME, ALDER_PRACTICE] },
      { heading: 'Patients', links: [ALDER_CONTACT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          placeHero({
            eyebrow: 'Accepting new patients',
            title: 'A dental practice that tells you what it costs before you sit down.',
            lede: 'Every fee is on this page. Nothing is quoted only in the chair, and nothing on the plan changes without you agreeing to it first.',
            action: 'Book an appointment',
            phone: '(0161) 447 2210',
            facts: ['NHS and private', 'Evening clinics Tuesday', 'Emergency slots held daily'],
          }),
          services(
            {
              eyebrow: 'Treatments',
              title: 'What we do, and what it costs',
              lede: 'Private fees, current from January. NHS treatment is charged at the standard band rates.',
            },
            [
              {
                name: 'Examination',
                description: 'Full check, including soft-tissue screening. Twenty minutes.',
                price: '£48',
              },
              {
                name: 'Hygienist',
                description: 'Scale and polish with a treatment plan you keep.',
                price: '£65',
              },
              {
                name: 'White filling',
                description: 'Composite, colour-matched. Priced per surface.',
                price: 'from £120',
              },
              {
                name: 'Root canal',
                description: 'Single visit where possible. Molars are quoted separately.',
                price: 'from £340',
              },
              {
                name: 'Crown',
                description: 'Ceramic, made by a lab in Stockport we have used for eleven years.',
                price: 'from £590',
              },
              {
                name: 'Extraction',
                description: 'Simple extraction under local anaesthetic.',
                price: 'from £145',
              },
            ],
          ),
        ],
      },
      {
        at: ALDER_PRACTICE,
        sections: [
          pageHead({
            eyebrow: 'The practice',
            title: 'Who you will see, and what people ask us.',
            lede: 'Four of us, one building, and the same person on the front desk since 2014.',
          }),
          team(
            { eyebrow: 'The practice', title: 'Who you will see' },
            [
              {
                name: 'Ruth Adeyemi',
                role: 'Principal dentist',
                note: 'BDS Manchester, 2009. Special interest in restorative work.',
              },
              {
                name: 'Tom Bruce',
                role: 'Associate dentist',
                note: 'BDS Leeds, 2016. Takes most of the evening clinic.',
              },
              {
                name: 'Priya Nair',
                role: 'Hygienist',
                note: 'Fifteen years in practice. Runs the periodontal programme.',
              },
              {
                name: 'Jan Kowalski',
                role: 'Practice manager',
                note: 'The person who actually answers the phone.',
              },
            ],
          ),
          faq({ title: 'The questions we get asked' }, [
            {
              question: 'Are you taking NHS patients?',
              answer:
                'Yes, for children and for adults already registered. The adult list opens again when capacity allows, and the front desk will tell you honestly where it stands.',
            },
            {
              question: 'What if I have not been to a dentist in years?',
              answer:
                'That describes a good share of the people who walk in. The first appointment is a look and a plan, not a lecture, and nothing gets done that day unless you ask for it.',
            },
            {
              question: 'Can I pay in instalments?',
              answer:
                'Anything over £300 can be spread across three months at no extra cost. Longer plans go through a finance provider and we will show you the total before you sign.',
            },
            {
              question: 'Do you see emergencies?',
              answer:
                'Two slots are held every weekday morning. Phone before nine and you will usually be seen the same day.',
            },
          ]),
        ],
      },
      {
        at: ALDER_CONTACT,
        sections: [
          pageHead({
            eyebrow: 'Contact',
            title: 'Registering, and getting seen quickly.',
            lede: 'The front desk is open eight until six and would rather answer a question on the phone than have you put it off.',
          }),
          booking({
            title: 'Book, or just ask a question',
            body: 'The front desk is open eight until six, and would rather answer a question on the phone than have you put it off.',
            action: 'Book an appointment',
            phone: '(0161) 447 2210',
            note: '84 Alderwood Road, Didsbury, Manchester M20 6QT',
          }),
        ],
      },
    ],
  }),
};

/* --------------------------------------------------------------- Still Water -- */

export const stillwater: TemplateDef = {
  id: 'stillwater',
  name: 'Still Water',
  kind: 'Therapy practice',
  category: 'local',
  description:
    'A counselling practice with a page that lowers the stakes of getting in touch. Soft, unhurried, and honest about waiting times and cost.',
  swatches: ['#f7f6f3', '#25282a', '#6b7f6e'],
  theme: theme(
    {
      background: '#f7f6f3',
      surface: '#eeece6',
      text: '#25282a',
      textMuted: '#6a6f6b',
      accent: '#6b7f6e',
      accentText: '#f7f6f3',
      border: '#dedbd2',
    },
    FACES.literary,
  ),

  pages: site({
    brand: 'Still Water',
    tagline: 'Counselling and psychotherapy, Hove',
    cta: 'Get in touch',
    map: siteMap(STILL_ABOUT, STILL_CONTACT),
    columns: [
      { heading: 'Practice', links: [HOME, STILL_ABOUT] },
      { heading: 'Start', links: [STILL_CONTACT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          placeHero({
            title: 'Talking to someone, without a six-month wait to start.',
            lede: 'A small counselling practice in Hove. Four therapists, one waiting list, and a first conversation that costs nothing and commits you to nothing.',
            action: 'Arrange a first call',
            facts: ['Usually seen within two weeks', 'In person or online', 'Evening appointments'],
          }),
          showcase(
            {
              eyebrow: 'How it works',
              title: 'Three steps, and you can stop after any of them',
              body: 'Most people put off the first message for months because they are not sure what they are agreeing to. You are agreeing to a fifteen-minute phone call.',
              bullets: [
                'A free fifteen-minute call to see whether we are the right fit',
                'A first session, at which you decide whether to book a second',
                'Weekly or fortnightly sessions for as long as they are useful',
              ],
            },
            mockPanel('First call', { rows: 4 }),
          ),
          services(
            { eyebrow: 'Fees', title: 'What it costs' },
            [
              {
                name: 'First call',
                description: 'Fifteen minutes on the phone. No notes taken, no obligation.',
                price: 'Free',
              },
              {
                name: 'Individual session',
                description: 'Fifty minutes, weekly or fortnightly, in person or online.',
                price: '£60',
              },
              {
                name: 'Couples session',
                description: 'Seventy-five minutes. Both of you, one therapist.',
                price: '£85',
              },
              {
                name: 'Concessions',
                description: 'A number of reduced-rate places are held for students and people out of work.',
                price: '£35',
              },
            ],
          ),
        ],
      },
      {
        at: STILL_ABOUT,
        sections: [
          pageHead({
            eyebrow: 'About',
            title: 'Four therapists, one waiting list.',
            lede: 'A small practice on Wilbury Road, and online. Everything below is what we would tell you on the first call anyway.',
          }),
          team({ eyebrow: 'Who we are', title: 'The four of us' }, [
            {
              name: 'Marianne Ellis',
              role: 'Integrative counsellor',
              note: 'MBACP. Anxiety, bereavement, work-related stress.',
            },
            {
              name: 'David Osei',
              role: 'Psychotherapist',
              note: 'UKCP registered. Longer-term work, trauma.',
            },
            {
              name: 'Sara Lindqvist',
              role: 'CBT therapist',
              note: 'BABCP accredited. Structured, shorter courses of work.',
            },
          ]),
          faq({ title: 'Reasonable things to wonder' }, [
            {
              question: 'How long is the wait?',
              answer:
                'Currently around two weeks for a weekday appointment and three for an evening one. If that changes we update this line rather than leaving it optimistic.',
            },
            {
              question: 'What if I do not get on with my therapist?',
              answer:
                'Say so, to them or to anyone else here, and we will move you. It is common and nobody takes it personally.',
            },
            {
              question: 'Is it confidential?',
              answer:
                'Yes, with the limits every therapist works under — risk to you or to someone else. Those limits are explained in full at the first session.',
            },
          ]),
        ],
      },
      {
        at: STILL_CONTACT,
        sections: [
          pageHead({
            eyebrow: 'Get in touch',
            title: 'The first message is the hard one.',
            lede: 'Two lines is enough. You do not have to explain everything, and nobody will ask you to by email.',
          }),
          booking({
            title: 'The first message is the hard one',
            body: 'Write two lines. You do not have to explain everything, and nobody will ask you to on email.',
            action: 'Arrange a first call',
            note: 'Wilbury Road, Hove BN3 3PB — and online, wherever you are.',
          }),
        ],
      },
    ],
  }),
};

/* ----------------------------------------------------------- Hollis Electric -- */

export const hollis: TemplateDef = {
  id: 'hollis',
  name: 'Hollis Electric',
  kind: 'Electrician',
  category: 'local',
  description:
    'An electrician’s site built around the three things a customer needs: whether you cover them, what you charge, and the number to ring. Plain by design.',
  swatches: ['#12141a', '#f1f3f6', '#f0b429'],
  theme: theme(
    {
      background: '#12141a',
      surface: '#1b1e26',
      text: '#f1f3f6',
      textMuted: '#98a1b0',
      accent: '#f0b429',
      accentText: '#12141a',
      border: '#2a2f3a',
    },
    FACES.condensed,
  ),

  pages: site({
    brand: 'Hollis Electric',
    tagline: 'Domestic electrical work across Leeds',
    cta: '07700 900412',
    map: siteMap(HOLLIS_AREAS, HOLLIS_QUOTE),
    columns: [
      { heading: 'Work', links: [HOME, HOLLIS_AREAS] },
      { heading: 'Contact', links: [HOLLIS_QUOTE] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          placeHero({
            eyebrow: 'NICEIC approved',
            title: 'Domestic electrician. Twelve years, one van, no call centre.',
            lede: 'Rewires, consumer units, EV chargers and the small jobs nobody else will drive out for. You get me, and you get a price before I start.',
            action: 'Get a quote',
            phone: '07700 900412',
            facts: ['NICEIC approved', 'Public liability £5m', 'Free written quotes'],
          }),
          services(
            {
              eyebrow: 'Rates',
              title: 'What things cost',
              lede: 'Guide prices, materials included unless stated. Anything bigger gets a written quote before a tool comes out of the van.',
            },
            [
              {
                name: 'Call-out',
                description: 'First hour, weekdays. Fault-finding and small repairs.',
                price: '£65',
              },
              {
                name: 'Consumer unit',
                description: 'Full replacement to current regs, certificate included.',
                price: 'from £550',
              },
              {
                name: 'EV charger',
                description: '7kW unit installed and commissioned. Grant paperwork handled.',
                price: 'from £800',
              },
              {
                name: 'Full rewire',
                description: 'Three-bed house, priced per room after a survey.',
                price: 'from £3,600',
              },
              {
                name: 'EICR',
                description: 'Landlord safety report, usually same-week.',
                price: '£140',
              },
              {
                name: 'Extra socket',
                description: 'Spurred from an existing circuit. Half-hour job, most rooms.',
                price: '£85',
              },
            ],
          ),
        ],
      },
      {
        at: HOLLIS_AREAS,
        sections: [
          pageHead({
            eyebrow: 'Areas',
            title: 'Where the van goes.',
            lede: 'No travel charge anywhere on this list. Outside it, ask — if the job is big enough I will still come.',
          }),
          serviceAreas(
            {
              eyebrow: 'Coverage',
              title: 'Where I work',
              lede: 'Anywhere inside this list, no travel charge. Outside it, ask — if the job is big enough I will still come.',
            },
            [
              'Leeds',
              'Horsforth',
              'Otley',
              'Guiseley',
              'Yeadon',
              'Bramhope',
              'Pudsey',
              'Headingley',
              'Chapel Allerton',
              'Wetherby',
            ],
          ),
          faq({ title: 'Worth knowing' }, [
            {
              question: 'How soon can you come out?',
              answer:
                'Small jobs, usually within three days. Anything without power gets moved to the front of the queue the same day.',
            },
            {
              question: 'Do you charge for quotes?',
              answer: 'No. I will come and look, and you get it in writing by the evening.',
            },
            {
              question: 'Are you insured and certified?',
              answer:
                'NICEIC approved contractor, £5m public liability, and every notifiable job is registered with building control. Certificates come by email the same week.',
            },
          ]),
        ],
      },
      {
        at: HOLLIS_QUOTE,
        sections: [
          pageHead({
            eyebrow: 'Quotes',
            title: 'Ring, or send a photo of the problem.',
            lede: 'A photo of the fuse board answers half the questions I would otherwise ask on the phone.',
          }),
          booking({
            title: 'Ring, or send a photo of the problem',
            body: 'A photo of the fuse board answers half the questions I would otherwise have to ask on the phone.',
            action: 'Request a quote',
            phone: '07700 900412',
            note: 'Weekdays 7.30am – 6pm. Emergencies out of hours at a higher rate.',
          }),
        ],
      },
    ],
  }),
};

/* -------------------------------------------------------------- Marsh & Vale -- */

export const marshvale: TemplateDef = {
  id: 'marshvale',
  name: 'Marsh & Vale',
  kind: 'Builder',
  category: 'local',
  description:
    'A small building firm that leads with finished work and a realistic timescale. Grounded, unglossy, and written for somebody about to spend a lot of money.',
  swatches: ['#f5f4f1', '#1f1d1a', '#7a5c3e'],
  theme: theme(
    {
      background: '#f5f4f1',
      surface: '#e9e6e0',
      text: '#1f1d1a',
      textMuted: '#6b655c',
      accent: '#7a5c3e',
      accentText: '#f5f4f1',
      border: '#dad5cb',
    },
    FACES.grotesque,
  ),

  pages: site({
    brand: 'Marsh & Vale',
    tagline: 'Building and renovation, Gloucestershire',
    cta: 'Arrange a visit',
    map: siteMap(MARSH_PRICING, MARSH_AREAS),
    columns: [
      { heading: 'Work', links: [HOME, MARSH_PRICING] },
      { heading: 'Practical', links: [MARSH_AREAS] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          placeHero({
            eyebrow: 'Extensions and renovations',
            title: 'Two jobs at a time, so yours is not the one waiting.',
            lede: 'A six-person firm in the Cotswolds. We take on two builds at once, which is slower to start and considerably faster to finish.',
            action: 'Arrange a site visit',
            phone: '(01453) 887 220',
            facts: ['Fixed-price contracts', 'FMB registered', 'Ten-year structural warranty'],
          }),
          showcase(
            {
              eyebrow: 'Recently',
              title: 'A 1930s semi in Stroud, opened up at the back',
              body: 'Six by four metre extension, steel across the old rear wall, and a kitchen that finally gets the afternoon light. Sixteen weeks from breaking ground.',
              bullets: [
                'Fixed price agreed before starting: £71,400',
                'Final invoice: £73,900, the difference a rerouted soil pipe',
                'Two weeks over the estimate, both of them waiting on windows',
              ],
            },
            mockPanel('Stroud — week 16', { rows: 6 }),
            { reverse: true },
          ),
        ],
      },
      {
        at: MARSH_PRICING,
        sections: [
          pageHead({
            eyebrow: 'How we price',
            title: 'Every stage, and what it usually runs to.',
            lede: 'Quoted properly after a site visit. These are the numbers from real jobs, not a range wide enough to be meaningless.',
          }),
          services(
            {
              eyebrow: 'How we price',
              title: 'What a job actually involves',
              lede: 'Every build is quoted after a site visit. These are the stages, and what each one typically runs to on a single-storey rear extension.',
            },
            [
              {
                name: 'Site visit',
                description: 'Two hours, a proper look, and an honest view on whether it is worth doing.',
                price: 'Free',
              },
              {
                name: 'Drawings and planning',
                description: 'Architect, structural calculations, and the application itself.',
                price: 'from £2,400',
              },
              {
                name: 'Groundworks',
                description: 'Foundations, drainage, and the part where the surprises live.',
                price: 'from £9,000',
              },
              {
                name: 'Shell and roof',
                description: 'Walls, steels, roof structure and covering. Watertight at the end of it.',
                price: 'from £24,000',
              },
              {
                name: 'Fit-out',
                description: 'Plastering, electrics, plumbing, joinery, decoration.',
                price: 'from £18,000',
              },
            ],
          ),
          faq({ title: 'Fair questions' }, [
            {
              question: 'How far ahead are you booked?',
              answer:
                'Usually four to five months for a full build. Smaller jobs sometimes fit between the two big ones, so it is always worth asking.',
            },
            {
              question: 'What happens if the price changes?',
              answer:
                'Nothing gets added without a written variation you sign first. The two things that genuinely move a price are ground conditions and what we find behind the plaster, and we will tell you the moment we know.',
            },
            {
              question: 'Do you handle planning?',
              answer:
                'Yes, with an architect we have worked with for nine years. You are welcome to bring your own.',
            },
          ]),
        ],
      },
      {
        at: MARSH_AREAS,
        sections: [
          pageHead({
            eyebrow: 'Areas',
            title: 'Where we build, and when we are free.',
            lede: 'Two jobs at a time across Gloucestershire. Usually four to five months ahead for a full build.',
          }),
          serviceAreas({ title: 'Where we build' }, [
            'Stroud',
            'Nailsworth',
            'Painswick',
            'Minchinhampton',
            'Cirencester',
            'Tetbury',
            'Dursley',
            'Gloucester',
          ]),
          booking({
            title: 'Start with a site visit',
            body: 'Two hours, no charge, and you get a straight answer on whether the thing you are imagining is worth the money.',
            action: 'Arrange a site visit',
            phone: '(01453) 887 220',
          }),
        ],
      },
    ],
  }),
};

/* ---------------------------------------------------------------- Ironmonger -- */

export const ironmonger: TemplateDef = {
  id: 'ironmonger',
  name: 'Ironmonger',
  kind: 'Gym',
  category: 'local',
  description:
    'A barbell gym with no joining fee and no contract. Dark, heavy typography and a membership table that fits on one screen.',
  swatches: ['#0e0e0f', '#f4f4f2', '#d64933'],
  theme: theme(
    {
      background: '#0e0e0f',
      surface: '#17171a',
      text: '#f4f4f2',
      textMuted: '#8f8f93',
      accent: '#d64933',
      accentText: '#f4f4f2',
      border: '#26262b',
    },
    FACES.condensed,
  ),

  pages: site({
    brand: 'Ironmonger',
    tagline: 'Arch 47, Almond Road, London',
    cta: 'First session free',
    map: siteMap(IRON_COACHING, IRON_VISIT),
    columns: [
      { heading: 'Gym', links: [HOME, IRON_COACHING] },
      { heading: 'Practical', links: [IRON_VISIT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          placeHero({
            eyebrow: 'Bermondsey',
            title: 'Barbells, platforms, and a coach who knows your name.',
            lede: 'Fourteen platforms, no mirrors, no joining fee and no minimum term. Come once for nothing and decide afterwards.',
            action: 'Book a first session',
            facts: ['Open 6am – 10pm', 'No contract', 'Coaching included on full membership'],
          }),
          tiers(
            {
              eyebrow: 'Membership',
              title: 'Three ways in',
              lede: 'Cancel any month, from the app, without a phone call. Nothing here has a joining fee.',
            },
            [
              {
                name: 'Off-peak',
                price: '£38',
                cadence: '/month',
                includes: 'Ten till four, weekdays. Full run of the floor and the rack you actually wanted.',
              },
              {
                name: 'Full',
                price: '£58',
                cadence: '/month',
                includes: 'Any hour we are open, plus a monthly session with a coach and a written programme.',
              },
              {
                name: 'Day pass',
                price: '£12',
                cadence: 'per visit',
                includes: 'For people passing through, and for anyone not ready to commit to a month.',
              },
            ],
          ),
        ],
      },
      {
        at: IRON_COACHING,
        sections: [
          pageHead({
            eyebrow: 'Coaching',
            title: 'If you want someone watching.',
            lede: 'Included monthly on full membership, and available to anybody by the hour.',
          }),
          services(
            { eyebrow: 'Coaching', title: 'If you want someone watching' },
            [
              {
                name: 'Technique session',
                description: 'One hour, one lift. Squat, bench, deadlift or the olympic lifts.',
                price: '£45',
              },
              {
                name: 'Programme review',
                description: 'Bring what you are running and leave with something better.',
                price: '£35',
              },
              {
                name: 'Block of six',
                description: 'Weekly coaching for six weeks, with the programme written around it.',
                price: '£240',
              },
            ],
          ),
          team({ eyebrow: 'Coaching', title: 'Who is on the floor' }, [
            {
              name: 'Dani Ferreira',
              role: 'Head coach',
              note: 'Powerlifting. Eleven years coaching, still competing at 72kg.',
            },
            {
              name: 'Owen Blake',
              role: 'Coach',
              note: 'Weightlifting and general strength. Runs the beginners’ block.',
            },
            {
              name: 'Nadia Haq',
              role: 'Coach',
              note: 'Return-to-lifting after injury, working alongside two local physios.',
            },
          ]),
        ],
      },
      {
        at: IRON_VISIT,
        sections: [
          pageHead({
            eyebrow: 'Visit',
            title: 'Arch 47, and the first one is free.',
            lede: 'Turn up, borrow a belt, and see whether it is the sort of room you want to spend four hours a week in.',
          }),
          faq({ title: 'Straight answers' }, [
            {
              question: 'Is it a beginners’ gym?',
              answer:
                'Half the floor on a Tuesday morning has been lifting under a year. The first session with a coach is free and exists precisely for this.',
            },
            {
              question: 'How busy does it get?',
              answer:
                'Six to eight in the evening is the crush, and you will wait for a platform. Before ten and after eight it is close to empty.',
            },
            {
              question: 'Can I cancel?',
              answer: 'Any month, in the app, no notice period and nobody phones you to ask why.',
            },
          ]),
          booking({
            title: 'The first one is free',
            body: 'Turn up, borrow a belt, and see whether it is the sort of room you want to spend four hours a week in.',
            action: 'Book a first session',
            note: 'Arch 47, Almond Road, London SE16 3TN',
          }),
        ],
      },
    ],
  }),
};

/* --------------------------------------------------------------- Fold Studio -- */

export const foldstudio: TemplateDef = {
  id: 'foldstudio',
  name: 'Fold Studio',
  kind: 'Pilates studio',
  category: 'local',
  description:
    'A twelve-mat studio whose page is really a timetable. Pale, spacious and quiet, with the class list doing the work a hero usually does.',
  swatches: ['#fbfaf8', '#2a2724', '#a4785f'],
  theme: theme(
    {
      background: '#fbfaf8',
      surface: '#f1eeea',
      text: '#2a2724',
      textMuted: '#726b64',
      accent: '#a4785f',
      accentText: '#fbfaf8',
      border: '#e3ded7',
    },
    FACES.editorial,
  ),

  pages: site({
    brand: 'Fold',
    tagline: '3a Northwold Road, London',
    cta: 'Book a class',
    map: siteMap(FOLD_PRICING, FOLD_VISIT),
    columns: [
      { heading: 'Studio', links: [HOME, FOLD_PRICING] },
      { heading: 'Practical', links: [FOLD_VISIT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          placeHero({
            eyebrow: 'Twelve mats',
            title: 'Small classes, in a room with daylight in it.',
            lede: 'Reformer and mat pilates in Stoke Newington. Twelve people maximum, which means the teacher corrects you rather than watching the room.',
            action: 'Book a class',
            facts: ['Twelve mats', 'First class £12', 'Classes seven days'],
          }),
          services(
            {
              eyebrow: 'Timetable',
              title: 'The week',
              lede: 'Booking opens fourteen days ahead. Cancel up to twelve hours before and the credit goes back.',
            },
            [
              { name: 'Monday', description: 'Reformer 7am · Mat 9.30am · Reformer 6.15pm, 7.30pm', price: '4 classes' },
              { name: 'Tuesday', description: 'Mat 7am · Reformer 12.30pm · Pre-natal 5pm · Reformer 6.15pm', price: '4 classes' },
              { name: 'Wednesday', description: 'Reformer 7am, 9.30am · Mat 6.15pm · Reformer 7.30pm', price: '4 classes' },
              { name: 'Thursday', description: 'Mat 7am · Reformer 9.30am, 6.15pm', price: '3 classes' },
              { name: 'Friday', description: 'Reformer 7am, 9.30am · Mat 5.30pm', price: '3 classes' },
              { name: 'Saturday', description: 'Reformer 8.30am, 10am · Mat 11.30am', price: '3 classes' },
              { name: 'Sunday', description: 'Mat 9.30am · Reformer 11am', price: '2 classes' },
            ],
          ),
        ],
      },
      {
        at: FOLD_PRICING,
        sections: [
          pageHead({
            eyebrow: 'Pricing',
            title: 'Blocks, memberships, and the first class.',
            lede: 'Booking opens fourteen days ahead. Cancel up to twelve hours before and the credit goes back.',
          }),
          tiers({ eyebrow: 'Pricing', title: 'Blocks and memberships' }, [
            {
              name: 'First class',
              price: '£12',
              cadence: 'once',
              includes: 'Any class on the timetable, once, so you can see whether the room suits you.',
            },
            {
              name: 'Ten classes',
              price: '£190',
              cadence: 'block',
              includes: 'Valid four months. Shareable with one other person, which most couples do.',
            },
            {
              name: 'Unlimited',
              price: '£145',
              cadence: '/month',
              includes: 'Every class, booked fourteen days ahead. Pause it for a month at a time.',
            },
          ]),
        ],
      },
      {
        at: FOLD_VISIT,
        sections: [
          pageHead({
            eyebrow: 'Visit',
            title: 'Northwold Road, up one flight.',
            lede: 'There is a ground-floor class on Wednesday mornings for anybody who needs it.',
          }),
          team({ eyebrow: 'Teaching', title: 'Who takes the classes' }, [
            {
              name: 'Cecile Marchand',
              role: 'Founder, reformer',
              note: 'Twelve years teaching. Opened Fold in 2019.',
            },
            {
              name: 'Iris Tanaka',
              role: 'Mat and pre-natal',
              note: 'Takes the pre-natal class and most weekday mornings.',
            },
            {
              name: 'Ben Whitlock',
              role: 'Reformer',
              note: 'Background in rehab, works with two local physiotherapists.',
            },
          ]),
          hours(
            { title: 'Finding us' },
            [
              { day: 'Monday – Friday', hours: '6.45am – 8.30pm' },
              { day: 'Saturday', hours: '8am – 1pm' },
              { day: 'Sunday', hours: '9am – 12.30pm' },
            ],
            {
              address: ['3a Northwold Road', 'London', 'N16 7HR'],
              phone: '(020) 7946 0332',
              email: 'book@foldstudio.example',
              note: 'The studio is up one flight of stairs. There is a ground-floor class on Wednesday mornings for anyone who needs it.',
            },
          ),
        ],
      },
    ],
  }),
};

export const LOCAL_TEMPLATES: TemplateDef[] = [
  cardoon,
  pennyroyal,
  alderwood,
  stillwater,
  hollis,
  marshvale,
  ironmonger,
  foldstudio,
];
