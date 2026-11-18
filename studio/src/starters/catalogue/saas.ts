/**
 * SaaS and product templates.
 *
 * Seven products in seven different industries, deliberately not seven
 * variations on a blue developer tool. What separates them is the palette, the
 * typeface and the order of the argument: a fintech leads with trust, a
 * developer tool leads with the mechanism, a wellness product leads with a
 * feeling. The section vocabulary is shared; the reasoning is not.
 *
 * All copy is written for a fictional company and reads as such. No template
 * ships a fake customer, a fake logo wall or a metric that implies a real
 * business behind it.
 *
 * Each is three pages: the argument, what it costs, and how to reach somebody.
 * Three because that is the smallest thing that is honestly a *site* — a
 * product page whose navigation offers Pricing and then has no pricing page is
 * the shape every one of these used to be, and the first click anybody made
 * did nothing.
 */

import { mockPanel } from '../patterns';
import { cta, features, heroSplit, heroCentred, showcase, stats } from '../patterns';
import { tiers } from '../localPatterns';
import { closer, contact, notes, pageHead } from '../pageParts';
import { siteMap, HOME } from '../sitemap';
import { FACES, site, theme, type TemplateDef } from './kit';

const PRICING = { label: 'Pricing', path: '/pricing' };
const CONTACT = { label: 'Contact', path: '/contact' };
const MAP = siteMap(PRICING, CONTACT);

/* ------------------------------------------------------------- Northwind -- */

export const northwind: TemplateDef = {
  id: 'northwind',
  name: 'Northwind',
  kind: 'Analytics SaaS',
  category: 'product',
  description:
    'A product page for a data tool, set on near-black with one cyan signal. Dense, technical, and confident enough to lead with the mechanism instead of a promise.',
  swatches: ['#0b0d10', '#e9edf2', '#3ddbd9'],
  theme: theme(
    {
      background: '#0b0d10',
      surface: '#14181d',
      text: '#e9edf2',
      textMuted: '#8b95a3',
      accent: '#3ddbd9',
      accentText: '#04211f',
      border: '#232a33',
    },
    FACES.grotesque,
  ),
  pages: site({
    brand: 'Northwind',
    tagline: 'Warehouse-native analytics for teams that argue with their numbers.',
    cta: 'Start free',
    map: MAP,
    columns: [
      { heading: 'Product', links: [HOME, PRICING] },
      { heading: 'Company', links: [CONTACT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroSplit(
            {
              eyebrow: 'Warehouse-native',
              title: 'Every number, traced to where it came from.',
              lede: 'Northwind reads your warehouse directly. No sync, no nightly job, no second copy of the truth to reconcile at the end of the quarter.',
              primary: 'Start free',
              secondary: 'Read the docs',
              note: 'Connects to Postgres, Snowflake and BigQuery.',
            },
            mockPanel('revenue_by_cohort.sql', { rows: 5 }),
          ),
          features(
            { eyebrow: 'How it works', title: 'Three things that stop analytics rotting' },
            [
              {
                title: 'Definitions live in git',
                body: 'A metric is a file, reviewed like any other change. When someone asks why revenue moved, the answer is a commit rather than a conversation.',
              },
              {
                title: 'Lineage you can walk',
                body: 'Click any figure and follow it back through every transformation to the raw table. Nothing is a black box you have to trust.',
              },
              {
                title: 'Alerts on the shape, not the value',
                body: 'Northwind learns what normal looks like for each series, so you hear about the anomaly and not about Monday.',
              },
            ],
          ),
          stats([
            { value: '400ms', label: 'median query' },
            { value: '12', label: 'warehouses supported' },
            { value: '0', label: 'copies of your data' },
          ]),
          showcase(
            {
              eyebrow: 'For engineers',
              title: 'It behaves like part of your stack',
              body: 'Northwind is configured in code, deployed in CI and versioned with everything else. There is no separate console where the real settings secretly live.',
              bullets: [
                'Terraform provider and a typed SDK',
                'Every dashboard exportable as YAML',
                'Row-level permissions from your existing groups',
              ],
            },
            mockPanel('northwind.yml', { rows: 4 }),
            { reverse: true, background: '#14181d' },
          ),
          cta(
            {
              title: 'Point it at your warehouse',
              lede: 'The free tier covers a single warehouse and unlimited readers. No card, and no call with anyone.',
              primary: 'Start free',
              secondary: 'Talk to us',
            },
            { background: '#14181d' },
          ),
        ],
      },
      {
        at: PRICING,
        sections: [
          pageHead({
            eyebrow: 'Pricing',
            title: 'Priced on warehouses, not on seats.',
            lede: 'Charging per reader punishes you for letting people look at their own numbers, which is the entire point of the product.',
          }),
          tiers(
            {},
            [
              {
                name: 'Free',
                price: '$0',
                cadence: 'forever',
                includes: 'One warehouse, unlimited readers, seven days of query history.',
              },
              {
                name: 'Team',
                price: '$400',
                cadence: 'per month',
                includes: 'Three warehouses, unlimited readers and editors, a year of history, lineage export.',
              },
              {
                name: 'Enterprise',
                price: 'From $1,800',
                cadence: 'per month',
                includes: 'Unlimited warehouses, SSO and SCIM, audit log, a named engineer.',
              },
            ],
            { background: '#14181d' },
          ),
          notes({ title: 'Questions people ask before they buy' }, [
            {
              question: 'What counts as a warehouse?',
              answer: 'One connection to one database. A staging copy of production is a second warehouse; a second schema in the same database is not.',
            },
            {
              question: 'Do readers cost anything?',
              answer: 'No, on every plan including the free one. A dashboard nobody is allowed to open is not worth building.',
            },
            {
              question: 'What happens to my definitions if I leave?',
              answer: 'They are files in your repository and always were. Cancelling stops the queries, not your access to the work.',
            },
            {
              question: 'Is there a trial of Team?',
              answer: 'Fourteen days, started from inside the product, no card. It reverts to Free rather than locking you out.',
            },
          ]),
          closer(
            {
              title: 'Start on Free and see whether the lineage holds up.',
              action: 'Start free',
              note: 'It takes one connection string. Upgrade when you add the second warehouse.',
            },
            { background: '#14181d' },
          ),
        ],
      },
      {
        at: CONTACT,
        sections: [
          pageHead({
            eyebrow: 'Contact',
            title: 'Talk to the people who build it.',
            lede: 'There is no sales development team here. Whoever answers has written some of the code.',
          }),
          contact({ title: 'Where to reach us', lede: 'Weekdays, London hours, usually within a few of them.' }, [
            {
              label: 'Email',
              value: 'hello@northwind.example',
              href: 'mailto:hello@northwind.example',
              note: 'The right one for almost everything.',
            },
            {
              label: 'Security',
              value: 'security@northwind.example',
              href: 'mailto:security@northwind.example',
              note: 'Disclosure policy and PGP key are published at /.well-known/security.txt.',
            },
            {
              label: 'Office',
              value: '14 Bastwick Street\nLondon EC1V 3PS',
              note: 'Visits by arrangement — it is four desks and a kettle.',
            },
          ]),
          closer(
            {
              title: 'Or skip the conversation and connect a warehouse.',
              action: 'Start free',
            },
            { background: '#14181d' },
          ),
        ],
      },
    ],
  }),
};

/* ----------------------------------------------------------------- Relay -- */

const RELAY_DOCS = { label: 'Docs', path: '/docs' };
const RELAY_MAP = siteMap(RELAY_DOCS, PRICING);

export const relay: TemplateDef = {
  id: 'relay',
  name: 'Relay',
  kind: 'Developer tool',
  category: 'product',
  description:
    'A developer API on white, with a monospace display face. Everything is set tight and technical, the way documentation is, because the audience reads code all day.',
  swatches: ['#ffffff', '#101418', '#ff5c35'],
  theme: theme(
    {
      background: '#ffffff',
      surface: '#f6f7f9',
      text: '#101418',
      textMuted: '#5d6672',
      accent: '#ff5c35',
      accentText: '#ffffff',
      border: '#e3e6ea',
    },
    FACES.technical,
  ),
  pages: site({
    brand: 'Relay',
    tagline: 'Webhook infrastructure for teams who would rather ship their own product.',
    cta: 'Get an API key',
    map: RELAY_MAP,
    nav: { radius: '6px' },
    columns: [
      { heading: 'Product', links: [HOME, PRICING] },
      { heading: 'Developers', links: [RELAY_DOCS] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroSplit(
            {
              eyebrow: 'Webhooks as infrastructure',
              title: 'Deliver every event. Prove that you did.',
              lede: 'Relay takes your outbound webhooks, retries them properly, and gives your customers a log they can read themselves instead of emailing you.',
              primary: 'Get an API key',
              secondary: 'Read the docs',
              note: 'Free to 10,000 events a month.',
            },
            mockPanel('POST /v1/events', { rows: 5 }),
            { radius: '6px' },
          ),
          features(
            {
              title: 'What you stop building',
              lede: 'Every team writes this once, badly, and then maintains it forever.',
            },
            [
              {
                title: 'Retries with backoff',
                body: 'Exponential, jittered and capped, with a dead-letter queue you can replay from a dashboard or the API.',
              },
              {
                title: 'Signature verification',
                body: 'Signed payloads and a rotating secret, plus copy-paste verification snippets in nine languages.',
              },
              {
                title: 'A log for your customers',
                body: 'An embeddable portal where they see their own deliveries, inspect payloads, and retry without opening a ticket.',
              },
              {
                title: 'Ordering when it matters',
                body: 'Per-key FIFO for the events where sequence is the whole point, and parallel delivery everywhere else.',
              },
            ],
            { columns: 2, background: '#f6f7f9' },
          ),
          showcase(
            {
              eyebrow: 'Five minutes',
              title: 'One endpoint change and you are done',
              body: 'Point your existing emitter at Relay. Your payloads, your headers, your event names. Nothing about your application has to learn a new vocabulary.',
              bullets: [
                'Drop-in SDKs for Node, Python, Go and Ruby',
                'Local tunnel for development',
                'Full event history on every plan',
              ],
            },
            mockPanel('relay.send(event)', { rows: 4 }),
          ),
          cta(
            {
              title: 'Send your first event',
              lede: 'Ten thousand events a month, free, with no card and no trial clock.',
              primary: 'Get an API key',
              secondary: 'Read the docs',
            },
            { radius: '6px' },
          ),
        ],
      },
      {
        at: RELAY_DOCS,
        sections: [
          pageHead({
            eyebrow: 'Docs',
            title: 'Send an event in four lines.',
            lede: 'The whole API is one POST and three optional headers. Everything below is detail you can come back for.',
          }),
          showcase(
            {
              eyebrow: 'Quickstart',
              title: 'Install, key, send',
              body: 'Install the SDK for your language, set RELAY_KEY in the environment, and call send with an event name and a payload. Relay does the delivery, the retries and the log.',
              bullets: [
                'npm install @relay/node',
                'export RELAY_KEY=rk_live_…',
                'await relay.send("invoice.paid", invoice)',
              ],
            },
            mockPanel('quickstart.ts', { rows: 5 }),
            { background: '#f6f7f9' },
          ),
          features(
            { eyebrow: 'Reference', title: 'The four things worth reading first' },
            [
              {
                title: 'Signing and verification',
                body: 'Every delivery carries an HMAC over the raw body and a timestamp. Verify both — comparing only the signature leaves you open to replay.',
              },
              {
                title: 'Retry schedule',
                body: 'Ten attempts over 24 hours, exponential with jitter. A 2xx stops it; a 410 stops it permanently and disables the endpoint.',
              },
              {
                title: 'Idempotency',
                body: 'Each delivery repeats an event id across every attempt. Key your handler on it and a retry costs nothing.',
              },
              {
                title: 'The customer portal',
                body: 'One embed script and a signed session token. Your customers see their own deliveries and nobody else’s.',
              },
            ],
            { columns: 2 },
          ),
          closer({
            title: 'Get a key and send a test event.',
            action: 'Get an API key',
            note: 'Test keys deliver to a sandbox endpoint you can watch in the dashboard.',
          }),
        ],
      },
      {
        at: PRICING,
        sections: [
          pageHead({
            eyebrow: 'Pricing',
            title: 'Priced per event, and only on delivery.',
            lede: 'A retry is our failure to deliver, not your usage. You are billed once per event however many attempts it takes.',
          }),
          tiers(
            {},
            [
              {
                name: 'Free',
                price: '$0',
                cadence: 'to 10k events/mo',
                includes: 'Full retries, signing, 7-day history and the customer portal.',
              },
              {
                name: 'Growth',
                price: '$0.40',
                cadence: 'per 1k events',
                includes: '90-day history, FIFO keys, custom domains for the portal.',
              },
              {
                name: 'Scale',
                price: 'From $900',
                cadence: 'per month',
                includes: 'Committed volume, 2-year history, SSO, 99.99% SLA.',
              },
            ],
            { background: '#f6f7f9' },
          ),
          notes({ title: 'The small print, up front' }, [
            {
              question: 'Are retries billed?',
              answer: 'No. One event is one charge whether it lands first time or on the ninth attempt.',
            },
            {
              question: 'What is an event, exactly?',
              answer: 'One call to send. Fanning it out to six of a customer’s endpoints is still one event.',
            },
            {
              question: 'Is there an overage cliff?',
              answer: 'No. Free stops delivering above the limit and tells you; paid plans meter continuously and never stop.',
            },
            {
              question: 'Can I self-host?',
              answer: 'Not today, and we would rather say so than list it as coming soon.',
            },
          ]),
          closer({ title: 'Ten thousand events a month, free.', action: 'Get an API key' }),
        ],
      },
    ],
  }),
};

/* -------------------------------------------------------------- Ledgerly -- */

const LEDGERLY_SECURITY = { label: 'Security', path: '/security' };
const LEDGERLY_MAP = siteMap(PRICING, LEDGERLY_SECURITY);

export const ledgerly: TemplateDef = {
  id: 'ledgerly',
  name: 'Ledgerly',
  kind: 'Fintech',
  category: 'product',
  description:
    'Accounting software in navy and warm ivory. Leads with trust rather than features, and uses a serif display so it reads as an institution instead of a startup.',
  swatches: ['#fbfaf7', '#12203a', '#1f5f4f'],
  theme: theme(
    {
      background: '#fbfaf7',
      surface: '#f2efe9',
      text: '#12203a',
      textMuted: '#5a6478',
      accent: '#1f5f4f',
      accentText: '#ffffff',
      border: '#e0dcd3',
    },
    FACES.editorial,
  ),
  pages: site({
    brand: 'Ledgerly',
    tagline: 'Bookkeeping that is finished before you look at it.',
    cta: 'Open an account',
    map: LEDGERLY_MAP,
    columns: [
      { heading: 'Product', links: [HOME, PRICING] },
      { heading: 'Trust', links: [LEDGERLY_SECURITY] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              eyebrow: 'Bookkeeping, closed monthly',
              title: 'Books that are already right on the first of the month.',
              lede: 'Ledgerly reconciles as transactions arrive instead of in a panic before the quarter ends. Your accountant opens it and finds nothing to fix.',
              primary: 'Open an account',
              secondary: 'Talk to an accountant',
            },
            { scale: 1.1 },
          ),
          features(
            { eyebrow: 'What it does', title: 'The month-end close, unbundled' },
            [
              {
                title: 'Continuous reconciliation',
                body: 'Every transaction is matched as it lands. The close becomes a review rather than a reconstruction.',
              },
              {
                title: 'Audit trail by default',
                body: 'Every change records who, when and what it replaced. Nothing is edited in place and nothing disappears.',
              },
              {
                title: 'Your accountant, included',
                body: 'Invite them free. They see the same ledger you do, with the adjustments they make visible to both of you.',
              },
            ],
            { background: '#f2efe9' },
          ),
          showcase(
            {
              eyebrow: 'Security',
              title: 'Built for money, not for demos',
              body: 'Read-only bank connections, encryption at rest and in transit, and a permission model that assumes people leave companies.',
              bullets: [
                'SOC 2 Type II controls in place',
                'Role-based access with approval chains',
                'Data export in standard formats, always',
              ],
            },
            mockPanel('Reconciliation · March', { rows: 5 }),
          ),
          cta({
            title: 'Close this month properly',
            lede: 'Set up in an afternoon. Bring your accountant, or use ours.',
            primary: 'Open an account',
            secondary: 'See pricing',
          }),
        ],
      },
      {
        at: PRICING,
        sections: [
          pageHead({
            eyebrow: 'Pricing',
            title: 'One price per company, and your accountant is free.',
            lede: 'Charging for the person who checks your books is charging you for doing it properly.',
          }),
          tiers(
            {},
            [
              {
                name: 'Sole trader',
                price: '£19',
                cadence: 'per month',
                includes: 'One entity, two bank connections, unlimited transactions, your accountant free.',
              },
              {
                name: 'Company',
                price: '£49',
                cadence: 'per month',
                includes: 'Three entities, payroll journals, VAT returns, approval chains, audit export.',
              },
              {
                name: 'Practice',
                price: '£12',
                cadence: 'per client/mo',
                includes: 'For accountants. Every client in one console, bulk close, white-labelled portal.',
              },
            ],
            { background: '#f2efe9' },
          ),
          notes({ title: 'Before you move your books' }, [
            {
              question: 'Can you import from my current system?',
              answer: 'Two years of history from the four common ones, reconciled and checked against your closing balances before you switch.',
            },
            {
              question: 'What happens at year end?',
              answer: 'Nothing special. The books are already closed monthly, so the year is twelve closes you have already reviewed.',
            },
            {
              question: 'Do I need an accountant?',
              answer: 'For a sole trader, often not. For a company, yes, and Ledgerly is better with one — which is why they do not cost extra.',
            },
            {
              question: 'Is my data exportable?',
              answer: 'Always, in full, as CSV and as a standard journal file. It is in the licence, not just in the marketing.',
            },
          ]),
          closer(
            {
              title: 'Open an account and connect one bank.',
              action: 'Open an account',
              note: 'Thirty days, no card. Your accountant can be in it on day one.',
            },
            { background: '#f2efe9' },
          ),
        ],
      },
      {
        at: LEDGERLY_SECURITY,
        sections: [
          pageHead({
            eyebrow: 'Security',
            title: 'What we do with your money data.',
            lede: 'Written plainly, because a security page nobody can read is a security page nobody has checked.',
          }),
          features(
            { eyebrow: 'Controls', title: 'The four that matter most' },
            [
              {
                title: 'Read-only bank access',
                body: 'Ledgerly can see transactions and cannot move money. There is no code path that initiates a payment, so a compromise cannot make one.',
              },
              {
                title: 'Encryption everywhere',
                body: 'TLS 1.3 in transit, AES-256 at rest, and per-entity keys so one tenant’s data cannot be read with another tenant’s key.',
              },
              {
                title: 'Access that expires',
                body: 'Roles are scoped per entity and per period. An accountant you stop working with loses access the day you say so, including to exports.',
              },
              {
                title: 'An audit log you own',
                body: 'Every read and every write, retained for seven years and exportable. We can read it; we cannot edit it.',
              },
            ],
            { columns: 2, background: '#f2efe9' },
          ),
          notes({ title: 'Questions auditors ask' }, [
            {
              question: 'What certifications do you hold?',
              answer: 'SOC 2 Type II, renewed annually. The report is available under NDA on request from security@ledgerly.example.',
            },
            {
              question: 'Where is data stored?',
              answer: 'In the region of the entity: London for UK companies, Frankfurt for EU. It does not leave, including for backups.',
            },
            {
              question: 'How do you handle a breach?',
              answer: 'Notification within 72 hours to every affected customer, with what was accessed and what we did, before any public statement.',
            },
            {
              question: 'Do you have a disclosure programme?',
              answer: 'Yes. Scope, safe harbour and rewards are at /.well-known/security.txt, and we answer within two working days.',
            },
          ]),
          contact({ title: 'Reach the security team directly' }, [
            {
              label: 'Disclosure',
              value: 'security@ledgerly.example',
              href: 'mailto:security@ledgerly.example',
              note: 'PGP key fingerprint published at the same address.',
            },
            {
              label: 'Compliance',
              value: 'compliance@ledgerly.example',
              href: 'mailto:compliance@ledgerly.example',
              note: 'SOC 2 reports, DPAs and sub-processor lists.',
            },
          ]),
        ],
      },
    ],
  }),
};

/* ----------------------------------------------------------------- Thrum -- */

const THRUM_SCIENCE = { label: 'Science', path: '/science' };
const THRUM_MAP = siteMap(THRUM_SCIENCE, PRICING);

export const thrum: TemplateDef = {
  id: 'thrum',
  name: 'Thrum',
  kind: 'Wellness app',
  category: 'product',
  description:
    'A sleep and focus app in dusk purple and soft cream. Geometric type, generous spacing, and a hero that leads with a feeling rather than a feature list.',
  swatches: ['#171327', '#f3efe9', '#c9a6ff'],
  theme: theme(
    {
      background: '#171327',
      surface: '#211c36',
      text: '#f3efe9',
      textMuted: '#a49bbd',
      accent: '#c9a6ff',
      accentText: '#221a36',
      border: '#312a4a',
    },
    FACES.geometric,
  ),
  pages: site({
    brand: 'Thrum',
    tagline: 'Sleep and focus, designed rather than generated.',
    cta: 'Try free',
    map: THRUM_MAP,
    nav: { radius: '999px' },
    columns: [
      { heading: 'App', links: [HOME, PRICING] },
      { heading: 'Learn', links: [THRUM_SCIENCE] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              title: 'Fall asleep without negotiating with yourself.',
              lede: 'Thrum builds a wind-down that adapts to the day you actually had, not the one you planned on Sunday.',
              primary: 'Try free for 14 days',
              secondary: 'How it works',
            },
            { scale: 1.15, radius: '999px' },
          ),
          features(
            { title: 'Three things, done well' },
            [
              {
                title: 'It notices the day you had',
                body: 'A late meeting, a hard run, a long flight. The evening adjusts before you have to think about it.',
              },
              {
                title: 'Sound that is actually designed',
                body: 'Recorded, not generated. Long-form pieces that do not loop audibly at the eleven-minute mark.',
              },
              {
                title: 'It stops talking eventually',
                body: 'Every session tapers to nothing. No voice cutting in twenty minutes after you have gone under.',
              },
            ],
            { background: '#211c36' },
          ),
          showcase(
            {
              eyebrow: 'The mornings',
              title: 'A wake-up that does not use an alarm',
              body: 'Thrum watches for the lightest part of your sleep in the window you set, then brings you up over ten minutes. You wake before it finishes.',
              bullets: [
                'Works with the phone face down',
                'No wearable required',
                'A hard backstop, so you are never late',
              ],
            },
            mockPanel('Tonight · 22:40', { rows: 4 }),
            { reverse: true },
          ),
          cta(
            {
              title: 'Sleep tonight',
              lede: 'Fourteen days free, then twelve a month. Cancel from inside the app in two taps.',
              primary: 'Try free',
            },
            { background: '#211c36', radius: '999px' },
          ),
        ],
      },
      {
        at: THRUM_SCIENCE,
        sections: [
          pageHead({
            eyebrow: 'Science',
            title: 'What we can support, and what we cannot.',
            lede: 'Sleep is a field with a great deal of confident marketing in it. Here is where the evidence for each part of Thrum actually stands.',
          }),
          features(
            { eyebrow: 'Well supported', title: 'The parts with real evidence behind them' },
            [
              {
                title: 'A consistent wind-down',
                body: 'Regular pre-sleep routines shorten sleep onset latency across dozens of trials. It is the least glamorous finding in the field and the most robust.',
              },
              {
                title: 'Light management',
                body: 'Evening light suppresses melatonin; morning light advances the clock. Thrum schedules around both, which is the mechanism with the strongest support.',
              },
              {
                title: 'Waking in light sleep',
                body: 'Waking from a lighter stage reduces grogginess. The effect is real and modest, which is how we describe it in the app too.',
              },
            ],
            { background: '#211c36' },
          ),
          notes({ eyebrow: 'Honestly', title: 'Where we are less sure' }, [
            {
              question: 'Does binaural audio do anything?',
              answer: 'The evidence for entrainment is weak. Our long-form pieces are designed to be pleasant and unobtrusive, which we can defend; we do not claim they change your brainwaves.',
            },
            {
              question: 'How accurate is phone-based sleep staging?',
              answer: 'Good at asleep-versus-awake, poor at distinguishing stages. Thrum uses it for a wake window, not for the graphs some apps show you.',
            },
            {
              question: 'Will this treat insomnia?',
              answer: 'No. Chronic insomnia has an effective treatment — CBT-I, with a clinician — and Thrum is not a substitute for it. The app says so where it matters.',
            },
            {
              question: 'Do you publish anything?',
              answer: 'Our internal analyses are not peer-reviewed and we do not present them as though they were. The references behind this page are listed in the app.',
            },
          ]),
        ],
      },
      {
        at: PRICING,
        sections: [
          pageHead({
            eyebrow: 'Pricing',
            title: 'One price, cancelled from inside the app.',
            lede: 'No annual-only trick, no discount for hiding the cancel button somewhere else.',
          }),
          tiers(
            {},
            [
              {
                name: 'Trial',
                price: '£0',
                cadence: '14 days',
                includes: 'Everything. No card, and it ends rather than converting.',
              },
              {
                name: 'Monthly',
                price: '£12',
                cadence: 'per month',
                includes: 'The full library, adaptive wind-down, the wake window, offline downloads.',
              },
              {
                name: 'Yearly',
                price: '£96',
                cadence: 'per year',
                includes: 'The same, at eight a month. Refunded pro rata if you stop.',
              },
            ],
            { background: '#211c36' },
          ),
          notes({ title: 'The things that usually annoy people' }, [
            {
              question: 'Does the trial ask for a card?',
              answer: 'No. It ends on day fourteen and the app tells you the day before. Nothing charges without you choosing it.',
            },
            {
              question: 'How do I cancel?',
              answer: 'Settings, then Subscription, then Cancel. Two taps, in the app, with no retention screen in the way.',
            },
            {
              question: 'Is there a family plan?',
              answer: 'Not yet. When there is, it will be on this page rather than announced as though it already existed.',
            },
            {
              question: 'What happens to my history if I stop?',
              answer: 'It stays on your phone. Thrum does not need an account to work and does not hold your sleep data hostage.',
            },
          ]),
          closer(
            { title: 'Fourteen nights, then decide.', action: 'Try free' },
            { background: '#211c36' },
          ),
        ],
      },
    ],
  }),
};

/* ------------------------------------------------------------- Formation -- */

export const formation: TemplateDef = {
  id: 'formation',
  name: 'Formation',
  kind: 'HR platform',
  category: 'product',
  description:
    'People operations software in forest green on bone. Warm without being soft, and structured around the awkward parts of the job rather than the pleasant ones.',
  swatches: ['#fdfcf9', '#1b2a22', '#2f6b4f'],
  theme: theme(
    {
      background: '#fdfcf9',
      surface: '#f1f0ea',
      text: '#1b2a22',
      textMuted: '#5d6b62',
      accent: '#2f6b4f',
      accentText: '#ffffff',
      border: '#e0dfd7',
    },
    FACES.grotesque,
  ),
  pages: site({
    brand: 'Formation',
    tagline: 'People operations for companies between twenty and five hundred.',
    cta: 'Book a walkthrough',
    map: MAP,
    columns: [
      { heading: 'Product', links: [HOME, PRICING] },
      { heading: 'Company', links: [CONTACT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroSplit(
            {
              eyebrow: 'People operations',
              title: 'The parts of the job nobody built software for.',
              lede: 'Onboarding, reviews, leave, and the twelve small processes that live in a spreadsheet somebody left behind. Formation holds all of them.',
              primary: 'Book a walkthrough',
              secondary: 'See pricing',
            },
            mockPanel('Onboarding · Week one', { rows: 5 }),
          ),
          features(
            { eyebrow: 'Modules', title: 'Start with one, add the rest when you need them' },
            [
              {
                title: 'Onboarding',
                body: 'A checklist per role that assigns itself, chases the people who owe something, and closes when the work is actually done.',
              },
              {
                title: 'Reviews',
                body: 'Cycles that run on a schedule with prompts that produce sentences instead of scores nobody believes.',
              },
              {
                title: 'Time away',
                body: 'Requests, balances and coverage in one view, with the policy encoded rather than remembered.',
              },
              {
                title: 'Documents',
                body: 'Contracts and policies with acknowledgement tracking, so you can prove who has read what.',
              },
            ],
            { columns: 2, background: '#f1f0ea' },
          ),
          stats([
            { value: '9 days', label: 'average setup' },
            { value: '4', label: 'modules included' },
            { value: '1', label: 'system of record' },
          ]),
          cta({
            title: 'See it with your own processes',
            lede: 'Bring the spreadsheet you are trying to replace. Forty minutes, no slides.',
            primary: 'Book a walkthrough',
            secondary: 'See pricing',
          }),
        ],
      },
      {
        at: PRICING,
        sections: [
          pageHead({
            eyebrow: 'Pricing',
            title: 'Per employee, with every module included.',
            lede: 'Charging separately for each module means the awkward processes stay in the spreadsheet, which is the problem you were solving.',
          }),
          tiers(
            {},
            [
              {
                name: 'Starting out',
                price: '£5',
                cadence: 'per person/mo',
                includes: 'Up to 50 people. All four modules, unlimited admins, standard support.',
              },
              {
                name: 'Growing',
                price: '£4',
                cadence: 'per person/mo',
                includes: '50–250 people. SSO, custom fields, an API, and a named contact.',
              },
              {
                name: 'Established',
                price: 'Talk to us',
                cadence: 'over 250',
                includes: 'Multi-entity, SCIM, data residency, a security review we actually turn up to.',
              },
            ],
            { background: '#f1f0ea' },
          ),
          notes({ title: 'What HR teams ask us' }, [
            {
              question: 'Who counts as an employee?',
              answer: 'Anybody with a record you actively manage. Leavers stay readable for your retention period and are not billed.',
            },
            {
              question: 'Can we migrate mid-year?',
              answer: 'Yes, and most do. Leave balances and review history import; we reconcile balances with you before go-live rather than after.',
            },
            {
              question: 'Is there an implementation fee?',
              answer: 'No. Nine days is the average and we do it as part of the subscription, because a setup fee is a bet against our own product.',
            },
            {
              question: 'What if we only want one module?',
              answer: 'You still get four. Splitting them would price you into the situation you are trying to leave.',
            },
          ]),
          closer(
            {
              title: 'Forty minutes with your own processes on screen.',
              action: 'Book a walkthrough',
              note: 'No slides, and no second call with somebody more senior.',
            },
            { background: '#f1f0ea' },
          ),
        ],
      },
      {
        at: CONTACT,
        sections: [
          pageHead({
            eyebrow: 'Contact',
            title: 'A person, on the first call.',
            lede: 'Whoever you speak to can answer the awkward questions, because they have run this job somewhere else.',
          }),
          contact({ title: 'How to get hold of us' }, [
            {
              label: 'Sales',
              value: 'hello@formation.example',
              href: 'mailto:hello@formation.example',
              note: 'Or book directly — the walkthrough link goes to a real calendar.',
            },
            {
              label: 'Support',
              value: 'help@formation.example',
              href: 'mailto:help@formation.example',
              note: 'Weekdays 08:00–18:00 GMT. Median first reply under two hours.',
            },
            {
              label: 'Data protection',
              value: 'dpo@formation.example',
              href: 'mailto:dpo@formation.example',
              note: 'DPAs, sub-processors and subject access requests.',
            },
          ]),
          closer(
            { title: 'Or bring the spreadsheet and we will walk through it.', action: 'Book a walkthrough' },
            { background: '#f1f0ea' },
          ),
        ],
      },
    ],
  }),
};

/* ---------------------------------------------------------------- Almanac -- */

const ALMANAC_EXAMPLES = { label: 'Examples', path: '/examples' };
const ALMANAC_MAP = siteMap(ALMANAC_EXAMPLES, PRICING);

export const almanac: TemplateDef = {
  id: 'almanac',
  name: 'Almanac',
  kind: 'Docs platform',
  category: 'product',
  description:
    'A documentation product set as a reading surface: warm paper, a literary serif and a measure you can actually read. The design argues for the thing it sells.',
  swatches: ['#f7f4ee', '#211d18', '#8a4b2a'],
  theme: theme(
    {
      background: '#f7f4ee',
      surface: '#efeae1',
      text: '#211d18',
      textMuted: '#6a6157',
      accent: '#8a4b2a',
      accentText: '#ffffff',
      border: '#ddd6c9',
    },
    FACES.literary,
  ),
  pages: site({
    brand: 'Almanac',
    tagline: 'A documentation platform that treats reading as the feature.',
    cta: 'Start writing',
    map: ALMANAC_MAP,
    nav: { radius: '4px' },
    columns: [
      { heading: 'Product', links: [HOME, PRICING] },
      { heading: 'See it', links: [ALMANAC_EXAMPLES] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroCentred(
            {
              eyebrow: 'Documentation',
              title: 'Docs people finish reading.',
              lede: 'Almanac is a writing surface first and a publishing system second. Good typography is not decoration when the product is words.',
              primary: 'Start writing',
              secondary: 'See an example',
            },
            { scale: 1.05, radius: '4px' },
          ),
          features(
            { title: 'What makes them readable' },
            [
              {
                title: 'A measure, enforced',
                body: 'Sixty-eight characters, everywhere, on every screen. Nobody has to remember to keep the line short.',
              },
              {
                title: 'Versioned with your code',
                body: 'Docs live in your repository and publish on merge, so they cannot drift from the thing they describe.',
              },
              {
                title: 'Search that reads prose',
                body: 'Full-text search tuned for sentences rather than identifiers, with the answer excerpted in place.',
              },
            ],
            { background: '#efeae1' },
          ),
          showcase(
            {
              eyebrow: 'Authoring',
              title: 'Markdown, and nothing to learn',
              body: 'Write in the editor or in your own. Components for callouts, tabs and code, and no proprietary syntax to migrate away from later.',
              bullets: [
                'MDX with a small component set',
                'Broken-link checking on every build',
                'Export to plain Markdown at any time',
              ],
            },
            mockPanel('getting-started.mdx', { rows: 5 }),
          ),
          cta(
            {
              title: 'Publish your first page',
              lede: 'Free for open projects, and free for the first three private ones.',
              primary: 'Start writing',
            },
            { background: '#efeae1', radius: '4px' },
          ),
        ],
      },
      {
        at: ALMANAC_EXAMPLES,
        sections: [
          pageHead({
            eyebrow: 'Examples',
            title: 'Four shapes of documentation.',
            lede: 'Most docs fail by being one of these four when they needed to be another. The templates start you in the right one.',
          }),
          features(
            { eyebrow: 'Shapes', title: 'Pick the one that matches the job' },
            [
              {
                title: 'A tutorial',
                body: 'Someone who has never used the thing, going from nothing to a working result. Linear, opinionated, and it never says "simply".',
              },
              {
                title: 'A how-to',
                body: 'Someone who knows the tool and has a specific problem. Titled by the goal, not by the feature, so search finds it.',
              },
              {
                title: 'A reference',
                body: 'Complete, dry, and organised for lookup rather than reading. Generated where it can be, so it cannot go stale.',
              },
              {
                title: 'An explanation',
                body: 'Why the thing works the way it does. The one most teams skip, and the one that stops the same question being asked forever.',
              },
            ],
            { columns: 2, background: '#efeae1' },
          ),
          showcase(
            {
              eyebrow: 'Starting points',
              title: 'Each shape ships as a template',
              body: 'Every one comes with a structure, a worked example and a set of prompts in the margin. Delete the prompts as you replace them; the build warns about the ones you left.',
              bullets: [
                'Four templates, in your repository',
                'A vocabulary check for hedging and "simply"',
                'Reading-time and grade-level shown as you write',
              ],
            },
            mockPanel('tutorial/index.mdx', { rows: 4 }),
          ),
          closer(
            { title: 'Start from a shape rather than a blank page.', action: 'Start writing' },
            { background: '#efeae1' },
          ),
        ],
      },
      {
        at: PRICING,
        sections: [
          pageHead({
            eyebrow: 'Pricing',
            title: 'Free where docs should be public.',
            lede: 'Documentation for an open project is a public good, and charging for it would be charging the wrong person.',
          }),
          tiers(
            {},
            [
              {
                name: 'Open',
                price: '$0',
                cadence: 'forever',
                includes: 'Unlimited public docs, custom domain, search, and the full component set.',
              },
              {
                name: 'Private',
                price: '$20',
                cadence: 'per month',
                includes: 'Three private sites, password or SSO access, versioned releases, analytics.',
              },
              {
                name: 'Company',
                price: '$120',
                cadence: 'per month',
                includes: 'Unlimited sites, SSO with groups, staging previews per pull request, audit log.',
              },
            ],
            { background: '#efeae1' },
          ),
          notes({ title: 'The usual questions' }, [
            {
              question: 'What counts as an open project?',
              answer: 'Docs anybody can read without an account. The source repository can be private; the published pages cannot.',
            },
            {
              question: 'Do I keep my content?',
              answer: 'It is Markdown in your repository the entire time. Cancelling stops the hosting and touches nothing else.',
            },
            {
              question: 'Is there a build-minute limit?',
              answer: 'No. A docs build is seconds and metering it would make people batch changes, which is the opposite of what you want.',
            },
            {
              question: 'Can I self-host?',
              answer: 'The renderer is open source and self-hostable. Search and previews are the hosted parts, and we say which is which.',
            },
          ]),
          closer(
            { title: 'Publish something today and see how it reads.', action: 'Start writing' },
            { background: '#efeae1' },
          ),
        ],
      },
    ],
  }),
};

/* -------------------------------------------------------------- Switchyard */

const SWITCHYARD_PLATFORM = { label: 'Platform', path: '/platform' };
const SWITCHYARD_MAP = siteMap(SWITCHYARD_PLATFORM, CONTACT);

export const switchyard: TemplateDef = {
  id: 'switchyard',
  name: 'Switchyard',
  kind: 'Logistics SaaS',
  category: 'product',
  description:
    'Freight software in signal orange on slate, with a condensed display face. Industrial and legible at a glance, which is how it would be used.',
  swatches: ['#151a1f', '#eef1f4', '#ff7a1a'],
  theme: theme(
    {
      background: '#151a1f',
      surface: '#1d242b',
      text: '#eef1f4',
      textMuted: '#8f9aa6',
      accent: '#ff7a1a',
      accentText: '#1a0e04',
      border: '#2a333c',
    },
    FACES.condensed,
  ),
  pages: site({
    brand: 'Switchyard',
    tagline: 'Freight visibility for shippers who move more than they can watch.',
    cta: 'Request access',
    map: SWITCHYARD_MAP,
    nav: { radius: '4px' },
    columns: [
      { heading: 'Platform', links: [HOME, SWITCHYARD_PLATFORM] },
      { heading: 'Company', links: [CONTACT] },
    ],
    pages: [
      {
        at: HOME,
        sections: [
          heroSplit(
            {
              eyebrow: 'Freight operations',
              title: 'Know where it is before the customer asks.',
              lede: 'Switchyard pulls status from every carrier you use into one board, and tells you which shipments are about to become a problem.',
              primary: 'Request access',
              secondary: 'See the platform',
              note: 'Integrates with 40 carriers out of the box.',
            },
            mockPanel('Board · In transit', { rows: 5 }),
            { radius: '4px' },
          ),
          features(
            { eyebrow: 'Platform', title: 'One board, every carrier' },
            [
              {
                title: 'Normalised tracking',
                body: 'Forty carriers, forty status vocabularies, one set of states that mean the same thing everywhere.',
              },
              {
                title: 'Exceptions first',
                body: 'The board sorts by what is going wrong. Shipments that are fine stay out of the way until they are not.',
              },
              {
                title: 'Customer updates that send themselves',
                body: 'Your branding, your wording, triggered by real status changes rather than by a schedule.',
              },
            ],
            { background: '#1d242b' },
          ),
          stats(
            [
              { value: '40+', label: 'carrier integrations' },
              { value: '15min', label: 'status refresh' },
              { value: '1', label: 'board to watch' },
            ],
            { background: '#1d242b' },
          ),
          cta(
            {
              title: 'Put your lanes on one board',
              lede: 'We will connect your three largest carriers before the first call ends.',
              primary: 'Request access',
            },
            { background: '#1d242b', radius: '4px' },
          ),
        ],
      },
      {
        at: SWITCHYARD_PLATFORM,
        sections: [
          pageHead({
            eyebrow: 'Platform',
            title: 'What the board is actually doing.',
            lede: 'Freight software is usually sold on a screenshot. This is the mechanism underneath it.',
          }),
          showcase(
            {
              eyebrow: 'Ingest',
              title: 'Forty vocabularies, one set of states',
              body: 'Every carrier describes the same event differently, and half of them change the wording without telling anybody. Switchyard maps each one onto eight states and flags a mapping it stops being sure about rather than guessing.',
              bullets: [
                'EDI, API and portal scraping where there is no API',
                'Mappings versioned, with the raw status kept beside the normalised one',
                'A confidence flag when a carrier changes its wording',
              ],
            },
            mockPanel('carrier_status_map.yml', { rows: 5 }),
            { background: '#1d242b' },
          ),
          features(
            { eyebrow: 'Exceptions', title: 'How it decides what is a problem' },
            [
              {
                title: 'Against the promise, not the plan',
                body: 'Lateness is measured against what the customer was told, which is often not what the carrier committed to. The board shows both.',
              },
              {
                title: 'Silence counts',
                body: 'A shipment that has not updated in longer than its lane normally goes quiet is an exception, even though nothing bad has been reported.',
              },
              {
                title: 'Ranked by consequence',
                body: 'Two days late on a pallet of packaging is not two days late on a clinical shipment. Priority comes from the lane, not the delay.',
              },
            ],
          ),
          closer(
            {
              title: 'Bring three carriers and a week of history.',
              action: 'Request access',
              note: 'We map them live on the call and you keep the mapping either way.',
            },
            { background: '#1d242b' },
          ),
        ],
      },
      {
        at: CONTACT,
        sections: [
          pageHead({
            eyebrow: 'Contact',
            title: 'Operations people, on operations hours.',
            lede: 'Freight does not stop at five, so neither does the number below.',
          }),
          contact(
            { title: 'How to reach us' },
            [
              {
                label: 'New accounts',
                value: 'access@switchyard.example',
                href: 'mailto:access@switchyard.example',
                note: 'Tell us your three largest carriers and we will have them mapped before the call.',
              },
              {
                label: 'Operations desk',
                value: '+44 20 7946 0912',
                href: 'tel:+442079460912',
                note: '05:00–22:00 UK, seven days. A person, not a queue.',
              },
              {
                label: 'Depot',
                value: 'Unit 7, Fairway Estate\nBarking IG11 0AZ',
                note: 'Where the integration team sits. Not a warehouse.',
              },
            ],
            { background: '#1d242b' },
          ),
          closer({ title: 'Or start with the board and one lane.', action: 'Request access' }),
        ],
      },
    ],
  }),
};

export const SAAS_TEMPLATES: TemplateDef[] = [
  northwind,
  relay,
  ledgerly,
  thrum,
  formation,
  almanac,
  switchyard,
];
