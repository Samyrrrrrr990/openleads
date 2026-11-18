/**
 * Plans and what each one includes.
 *
 * One table, in the open package, read by the pricing page, the entitlement
 * checks, the settings screen and the server that verifies a webhook. There is
 * exactly one place where "what does Pro include" is answered, because the
 * failure mode of pricing code is always the same: the marketing page and the
 * enforcement drift, and a customer pays for something the product refuses.
 *
 * Nothing here is enforced by being in this file. See `entitlements.ts` for
 * the check, and the server routes for the enforcement that actually matters.
 */

export type PlanId = 'free' | 'pro' | 'team' | 'agency';

export const PLAN_IDS: readonly PlanId[] = ['free', 'pro', 'team', 'agency'];

/**
 * A capability someone either has or does not.
 *
 * Named after what the user does, not after the plan that unlocks it, so that
 * moving a feature between plans is a one-line change here rather than a
 * search for `plan === 'pro'` across the codebase.
 */
export type Feature =
  | 'private-projects'
  | 'cloud-sync'
  | 'section-library'
  | 'shared-library'
  | 'custom-templates'
  | 'premium-templates'
  | 'code-edit'
  | 'advanced-motion'
  | 'github-push'
  | 'local-bridge'
  | 'agent-bridge'
  | 'terminal-editor'
  | 'layer-sync'
  | 'byok'
  | 'export'
  | 'version-history'
  | 'roles'
  | 'priority-support';

/**
 * Features that exist in this table but are not shipped yet.
 *
 * A plan may list one — that is the promise of where it will land — but **no
 * surface may advertise it**, because a bullet point on a pricing page is a
 * thing somebody pays for.
 *
 * Empty since the CLI was published to npm as `zory-cli`. The CLI, the agent
 * bridge and `zory code` sat here while the install command answered with a
 * 404, and then while the bare name `zory` was refused. Add an entry the
 * day something is priced before it ships, and delete it the day it does:
 * `sellableFeatures` is what every marketing surface reads.
 */
export const UNRELEASED: ReadonlySet<Feature> = new Set<Feature>();

/** Whether a feature may appear in copy a buyer reads. */
export function isSellable(feature: Feature): boolean {
  return !UNRELEASED.has(feature);
}

/** A plan's features, minus anything not shipped. For marketing only. */
export function sellableFeatures(plan: Plan): Feature[] {
  return plan.features.filter(isSellable);
}

export interface PlanLimits {
  /**
   * Projects this account may have at once. `null` is unlimited.
   *
   * Every project, not only the cloud-backed ones. It used to mean "projects
   * synced to an account", which left local projects unbounded — so the free
   * plan was an unlimited website builder that also happened to offer three
   * backups, and nothing about it ran out.
   */
  projects: number | null;
  /** Existing source repositories linked on this device. `null` is unlimited. */
  repositories: number | null;
  /** Hosted AI proposals per day. BYOK is not counted against this. */
  aiRequestsPerDay: number;
  /** Saved sections in a personal library. */
  librarySections: number | null;
  /** Personal templates. */
  templates: number | null;
  /** Seats included. On a per-seat plan this is the minimum purchase. */
  seats: number;
  /** Days of project version history retained. */
  historyDays: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  /**
   * Monthly price in USD. On a per-seat plan this is the price *per seat*.
   */
  monthly: number;
  /** Annual price in USD per month, billed yearly. Display only; see `annualTotal`. */
  annualMonthly: number;
  /**
   * Whether the buyer chooses how many seats.
   *
   * A per-seat plan is sold with a quantity: the checkout passes it to Stripe,
   * the webhook reads it back off the subscription item, and the workspace is
   * provisioned with that many seats. A flat plan always has quantity 1 and
   * takes its seat count from `limits.seats`.
   */
  perSeat: boolean;
  /** Smallest quantity that may be bought. Always 1 on a flat plan. */
  minSeats: number;
  /** Largest quantity, so a typo cannot create a 900-seat subscription. */
  maxSeats: number;
  /** Who this is for, in one line. */
  audience: string;
  /** The single reason to choose it. */
  headline: string;
  features: Feature[];
  limits: PlanLimits;
  /** Shown on the card. Keep to four; the table carries the detail. */
  highlights: string[];
}

/*
 * Annual pricing is ten months for twelve.
 *
 * `annualTotal` is the number Stripe charges and the number the page must
 * quote. `annualFromMonthly` is the per-month figure shown beside it, and it
 * is rounded — which is why it may not multiply back to the total, and why
 * nothing may compute a yearly charge from it. Doing that is how the page can
 * advertise "2 months free" above a $156 total on a $150 subscription.
 */
export function annualTotal(monthly: number): number {
  return monthly * 10;
}

export function annualFromMonthly(monthly: number): number {
  return Math.round(annualTotal(monthly) / 12);
}

/*
 * What Free includes, and the one thing it deliberately still does.
 *
 * `export` stays here. Every other lever in this table was tightened because
 * a free plan that never runs out is not a free plan, it is the product — but
 * the code leaving as ordinary source you own is the promise the whole thing
 * is built on, said on the landing page, the pricing page, the checkout page
 * and in the licence. Paywalling it would win the argument about conversion
 * and lose the one about what Zory is.
 *
 * So Free exports, without limit, forever. What Free does not get is the
 * catalogue to build from at scale, the room to build many things, or the
 * cloud around it.
 */
const FREE_FEATURES: Feature[] = [
  'export',
  'byok',
  'local-bridge',
  'agent-bridge',
  'section-library',
  'code-edit',
];

/*
 * `terminal-editor` is Pro and `local-bridge` is free, and the split is the
 * point rather than an oversight.
 *
 * The bridge, the audit and the agent context are the tooling: they make Zory
 * worth trying on a repository somebody already has, and a free plan that
 * cannot do that has no way in. `zory code` is a second editor — selection,
 * inspector, responsive preview, undo, the whole surface — running where the
 * work already happens. That is the product, not the tooling around it, and
 * it is the one command in an Apache-2.0 package behind a plan.
 */
const PRO_FEATURES: Feature[] = [
  ...FREE_FEATURES,
  'terminal-editor',
  'private-projects',
  'cloud-sync',
  'custom-templates',
  'premium-templates',
  'advanced-motion',
  'github-push',
  'layer-sync',
  'version-history',
];

/*
 * `roles` is here rather than on Agency, because that is where it works.
 *
 * The role system — owner, admin, member, and a capability table deciding what
 * each may do — is implemented for every workspace: the invite route takes a
 * role, `roleCan` gates the UI, `canRemove` protects the owner. It was listed
 * as an Agency feature anyway, so Agency's advertised differentiator was a
 * thing Team subscribers already had, and Team's comparison row said "not
 * included" about a control its members were using.
 *
 * Agency's differentiators are its limits: ten seats flat, the largest hosted
 * AI allowance, and a year of history. Those are real and they are enough.
 */
const TEAM_FEATURES: Feature[] = [...PRO_FEATURES, 'shared-library', 'roles', 'priority-support'];

const AGENCY_FEATURES: Feature[] = [...TEAM_FEATURES];

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    monthly: 0,
    annualMonthly: 0,
    perSeat: false,
    minSeats: 1,
    maxSeats: 1,
    audience: 'Anyone trying Zory, and anyone building one site for themselves.',
    headline: 'Try the real workflow. Edit one repository, then take the code.',
    features: FREE_FEATURES,
    limits: {
      projects: 2,
      repositories: 1,
      aiRequestsPerDay: 5,
      librarySections: 10,
      templates: 0,
      seats: 1,
      historyDays: 0,
    },
    highlights: [
      'Open and edit one React repository',
      'Two projects at a time',
      'Seven starter templates',
      'Unlimited export and BYOK or local Intent',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthly: 15,
    annualMonthly: annualFromMonthly(15),
    perSeat: false,
    minSeats: 1,
    maxSeats: 1,
    audience: 'Developers, designers and freelancers shipping real work.',
    headline: 'The whole template bank, unlimited projects, motion and GitHub.',
    features: PRO_FEATURES,
    limits: {
      projects: null,
      repositories: null,
      aiRequestsPerDay: 400,
      librarySections: null,
      templates: null,
      seats: 1,
      historyDays: 30,
    },
    highlights: [
      'Every template, including the premium bank',
      'Open and edit your own React repository',
      'Zory Motion: scroll, stagger and press',
      'Push straight to a GitHub repository',
    ],
  },
  team: {
    id: 'team',
    name: 'Team',
    monthly: 25,
    annualMonthly: annualFromMonthly(25),
    /*
     * Per seat, and the reason is the shape of the old ladder.
     *
     * Pro is $15 for an individual. Team adds collaboration at $25 per person,
     * with a minimum of two, so the shared tier is never cheaper per person
     * than the individual plan it includes.
     */
    perSeat: true,
    minSeats: 2,
    maxSeats: 50,
    audience: 'Two or more people working on the same projects.',
    headline: 'Everything in Pro for everyone, on shared projects.',
    features: TEAM_FEATURES,
    limits: {
      projects: null,
      repositories: null,
      aiRequestsPerDay: 2000,
      librarySections: null,
      templates: null,
      seats: 2,
      historyDays: 90,
    },
    highlights: [
      'Everything in Pro, for every seat',
      'A shared section library and shared projects',
      'Roles: who can edit, invite and publish',
      'Add or remove seats whenever you like',
    ],
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    monthly: 159,
    annualMonthly: annualFromMonthly(159),
    perSeat: false,
    minSeats: 1,
    maxSeats: 1,
    audience: 'Agencies running many clients and many parallel builds.',
    headline: 'Ten seats at a fixed price, with room to work at volume.',
    features: AGENCY_FEATURES,
    limits: {
      projects: null,
      repositories: null,
      aiRequestsPerDay: 5000,
      librarySections: null,
      templates: null,
      seats: 10,
      historyDays: 365,
    },
    highlights: [
      'Ten seats, flat — cheaper than nine on Team',
      'Five thousand hosted AI edits a day',
      'A year of version history',
      'Everything Team has, at a fixed price',
    ],
  },
};

export const PLAN_ORDER: readonly PlanId[] = ['free', 'pro', 'team', 'agency'];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function planOf(id: unknown): Plan {
  return isPlanId(id) ? PLANS[id] : PLANS.free;
}

/**
 * A quantity this plan may actually be sold at.
 *
 * Every place that turns a number into money runs through this: the seat
 * stepper, the order summary, and the checkout route, which clamps again on
 * the server because a quantity in a request body is a quantity anyone can
 * type.
 */
export function clampSeats(plan: Plan, seats: number): number {
  if (!plan.perSeat) return 1;
  if (!Number.isFinite(seats)) return plan.minSeats;
  return Math.min(plan.maxSeats, Math.max(plan.minSeats, Math.floor(seats)));
}

/** What a subscription costs, in whole dollars, for real. */
export function priceOf(plan: Plan, interval: 'monthly' | 'annual', seats = plan.minSeats): number {
  const quantity = clampSeats(plan, seats);
  return interval === 'annual'
    ? annualTotal(plan.monthly) * quantity
    : plan.monthly * quantity;
}

/** Human label for a feature, used by the comparison table and upgrade notes. */
export const FEATURE_LABEL: Record<Feature, string> = {
  'private-projects': 'Private cloud projects',
  'cloud-sync': 'Cloud sync across devices',
  'section-library': 'Personal section library',
  'shared-library': 'Shared team library',
  'custom-templates': 'Your own templates',
  'premium-templates': 'The full template bank',
  'code-edit': 'Edit your own repository',
  'advanced-motion': 'Zory Motion',
  'github-push': 'Push to GitHub',
  'local-bridge': 'Zory CLI and local projects',
  'agent-bridge': 'Coding agent bridge (MCP)',
  'terminal-editor': 'Zory Code, the editor in your terminal',
  'layer-sync': 'Sync your Layer changes between machines',
  byok: 'Bring your own AI key',
  export: 'Export React and TypeScript',
  'version-history': 'Version history',
  roles: 'Roles and permissions',
  'priority-support': 'Priority support',
};

/** Why a feature is worth having, for the moment somebody hits the wall. */
export const FEATURE_REASON: Record<Feature, string> = {
  'private-projects': 'Projects that only you and the people you invite can open.',
  'cloud-sync': 'Open the same project on another machine and carry on.',
  'section-library': 'Save a hero once and drop it into the next project.',
  'shared-library': 'One library your whole team inserts from.',
  'custom-templates': 'Turn a finished project into the starting point for the next one.',
  'premium-templates': 'Every template in the catalogue, not the seven the free plan opens with.',
  'code-edit': 'Open a folder of React source and change the copy and classes in place.',
  'advanced-motion': 'Scroll, stagger and press motion that exports as plain CSS.',
  'github-push': 'Commit a Zory project straight into a repository you own.',
  'local-bridge': 'Open a real repository in Zory with the CLI.',
  'agent-bridge': 'Give Claude Code and other agents your visual context.',
  'terminal-editor': 'Select, edit and preview a page without leaving the terminal.',
  'layer-sync': 'Your Zory Layer customisations, on every machine you sign in to.',
  byok: 'Use your own provider key with no allowance from us.',
  export: 'Every project leaves as ordinary source you own.',
  'version-history': 'Go back to how a project looked last week.',
  roles: 'Decide who can edit, who can publish and who can only look.',
  'priority-support': 'A person, not a queue.',
};
