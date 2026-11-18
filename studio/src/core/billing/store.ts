import { create } from 'zustand';
import type { EntitlementState, Feature, PlanId } from '@zory/core';
import { FREE_STATE, checkFeature, effectivePlan, limits } from '@zory/core';

/**
 * OpenLeads Studio is open source with nothing to buy: every template, every
 * feature, unlimited history. The store keeps the shape editor code reads.
 */
const OPEN: EntitlementState = { ...FREE_STATE, plan: 'team', status: 'active', seats: 1 };

export interface BillingState {
  entitlements: EntitlementState;
}

export const useBillingStore = create<BillingState>(() => ({ entitlements: OPEN }));

export const selectPlan = (s: BillingState): PlanId => effectivePlan(s.entitlements).id;
export const selectEntitlements = (s: BillingState): EntitlementState => s.entitlements;
export const selectLimits = (s: BillingState) => limits(s.entitlements);
export function useCan(feature: Feature): boolean {
  return checkFeature(OPEN, feature) === null;
}
export function useFeatureGate(_feature: Feature): { blocked: boolean; upgradeTo: PlanId } {
  return { blocked: false, upgradeTo: 'team' };
}
export function useBillingSession(): void {}
