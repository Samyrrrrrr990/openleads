/**
 * What this account may do.
 *
 * One function answers every question — `can(state, feature)` — and one type
 * carries everything needed to answer it. Plan names appear here and in
 * `plans.ts` and nowhere else in Zory; a check written as `plan === 'pro'`
 * anywhere in a UI is a bug, because the next pricing change silently makes it
 * wrong for exactly one plan.
 *
 * The client-side answer is a *courtesy*, not a control. It exists so the
 * interface can be honest about what is available before somebody clicks. The
 * things that cost money — hosted AI, cloud storage — are checked again on the
 * server against the same table.
 */

import type { Feature, Plan, PlanId, PlanLimits } from './plans';
import { PLANS, PLAN_ORDER, planOf } from './plans';

export type SubscriptionStatus =
  | 'none'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

export interface EntitlementState {
  plan: PlanId;
  status: SubscriptionStatus;
  /** Epoch ms. A canceled subscription keeps its plan until this passes. */
  currentPeriodEnd: number | null;
  /** Seats the account has, which may exceed the plan's included count. */
  seats: number;
  /** Set when billing is not configured on this deployment at all. */
  billingConfigured: boolean;
  /**
   * A workspace this account is a member of, if any.
   *
   * A seat is a plan somebody else is paying for. Entitlements resolve to
   * whichever is better, so a person on Free who joins a Studio workspace gets
   * Studio — which is the only reading of "five seats" that a buyer would
   * accept — and a person who is already on Pro does not get downgraded by
   * joining a workspace on a cheaper plan.
   */
  membership: { workspaceId: string; workspaceName: string; plan: PlanId; role: string } | null;
}

export const FREE_STATE: EntitlementState = {
  plan: 'free',
  status: 'none',
  currentPeriodEnd: null,
  seats: 1,
  billingConfigured: false,
  membership: null,
};

/**
 * The plan actually in force.
 *
 * A subscription that failed payment does not lose its features instantly —
 * `past_due` keeps them while Stripe retries, because dropping someone's
 * private projects over a expired card is a worse outcome than a few days of
 * unpaid access. `canceled` keeps them until the period they paid for ends.
 */
export function effectivePlan(state: EntitlementState): Plan {
  return higherOf(ownPlan(state), state.membership ? planOf(state.membership.plan) : PLANS.free);
}

/** The plan this account pays for, ignoring any workspace it belongs to. */
export function ownPlan(state: EntitlementState): Plan {
  if (state.plan === 'free') return PLANS.free;

  switch (state.status) {
    case 'active':
    case 'trialing':
    case 'past_due':
      return planOf(state.plan);
    case 'canceled':
      if (state.currentPeriodEnd !== null && Date.now() < state.currentPeriodEnd) {
        return planOf(state.plan);
      }
      return PLANS.free;
    case 'incomplete':
    case 'none':
    default:
      return PLANS.free;
  }
}

/** The better of two plans, by position on the ladder. */
function higherOf(a: Plan, b: Plan): Plan {
  return PLAN_ORDER.indexOf(a.id) >= PLAN_ORDER.indexOf(b.id) ? a : b;
}

/**
 * Limits for a deployment that does not sell plans.
 *
 * A fork, a self-hosted copy, a local checkout: nothing there can be
 * purchased, so nothing there is withheld. Gating a feature behind a plan
 * nobody on that deployment could ever buy is not a business model, it is a
 * broken build.
 */
const UNMETERED: PlanLimits = {
  projects: null,
  repositories: null,
  aiRequestsPerDay: Number.MAX_SAFE_INTEGER,
  librarySections: null,
  templates: null,
  seats: 1,
  /*
   * Not zero.
   *
   * A retention of zero does not mean "unlimited retention", it means version
   * history is switched off — which is the opposite of what this table is for,
   * and is exactly how it shipped the first time. A year is the most generous
   * number any plan offers.
   */
  historyDays: 365,
};

export function can(state: EntitlementState, feature: Feature): boolean {
  // See UNMETERED: no billing, no gates.
  if (!state.billingConfigured) return true;
  return effectivePlan(state).features.includes(feature);
}

export function limits(state: EntitlementState): PlanLimits {
  if (!state.billingConfigured) return UNMETERED;
  return effectivePlan(state).limits;
}

/** `null` means unlimited, so a bare `<` comparison would be wrong. */
export function withinLimit(limit: number | null, used: number): boolean {
  return limit === null || used < limit;
}

/** Whether another repository identity may be linked on this device. */
export function withinRepositoryLimit(state: EntitlementState, linkedCount: number): boolean {
  return withinLimit(limits(state).repositories, linkedCount);
}

/** The cheapest plan that includes a feature, for "upgrade to X" copy. */
export function cheapestPlanWith(feature: Feature): Plan | null {
  for (const id of PLAN_ORDER) {
    if (PLANS[id].features.includes(feature)) return PLANS[id];
  }
  return null;
}

export interface Blocked {
  feature: Feature;
  /** The plan the user should move to. */
  upgradeTo: PlanId;
}

/**
 * `null` when allowed, or what to offer when not.
 *
 * Returning the upgrade target rather than a boolean is what lets every wall
 * in the product name the right plan without repeating the plan table.
 */
export function checkFeature(state: EntitlementState, feature: Feature): Blocked | null {
  if (can(state, feature)) return null;
  const target = cheapestPlanWith(feature);
  return { feature, upgradeTo: target?.id ?? 'pro' };
}

/** True when a plan sits above another in the ladder. */
export function isUpgrade(from: PlanId, to: PlanId): boolean {
  return PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from);
}

/**
 * A short, honest sentence about the billing state, for the settings screen.
 */
export function describeSubscription(state: EntitlementState): string {
  const plan = effectivePlan(state);
  if (!state.billingConfigured) return `${plan.name} — billing is not configured on this deployment.`;

  switch (state.status) {
    case 'active':
      return `${plan.name}, renewing${state.currentPeriodEnd ? ` on ${formatDate(state.currentPeriodEnd)}` : ''}.`;
    case 'trialing':
      return `${plan.name} trial${state.currentPeriodEnd ? `, ending ${formatDate(state.currentPeriodEnd)}` : ''}.`;
    case 'past_due':
      return `${plan.name} — the last payment did not go through. Update your card to keep it.`;
    case 'canceled':
      if (state.currentPeriodEnd !== null && Date.now() < state.currentPeriodEnd) {
        return `${plan.name} until ${formatDate(state.currentPeriodEnd)}, then Free.`;
      }
      return 'Free — your previous subscription has ended.';
    case 'incomplete':
      return 'Your subscription was not completed. Nothing has been charged.';
    case 'none':
    default:
      return 'Free — no subscription.';
  }
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
