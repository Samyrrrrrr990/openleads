/**
 * Workspaces and seats.
 *
 * A workspace exists when somebody buys a plan with more than one seat. It
 * holds a roster and it holds projects, and its plan is what its members are
 * entitled to — which is the whole point of paying per seat rather than per
 * person.
 *
 * The shape here is deliberately small. There is no org hierarchy, no nested
 * teams and no per-project permissions, because none of those are things a
 * five-person studio asks for and all of them are things that make the
 * permission check in every route harder to be sure about.
 *
 * Three roles, and the difference between them is stated as capabilities
 * rather than as a rank, so a route asks "may this person do X" instead of
 * comparing strings.
 */

import type { PlanId } from './plans';
import { PLANS } from './plans';

export type Role = 'owner' | 'admin' | 'member';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export const ROLE_HINT: Record<Role, string> = {
  owner: 'Pays for the workspace. Cannot be removed.',
  admin: 'Can invite and remove people.',
  member: 'Can open and edit shared projects.',
};

export interface Member {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  joinedAt: number;
}

export interface Invite {
  id: string;
  /** Lower-cased. Matching is on the address, so it has to be normalised. */
  email: string;
  role: Exclude<Role, 'owner'>;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  ownerUid: string;
  plan: PlanId;
  /** Seats bought. May exceed the plan's included count. */
  seats: number;
  members: Member[];
  invites: Invite[];
  createdAt: number;
  updatedAt: number;
}

/** What a member's own account records, so entitlements can resolve locally. */
export interface Membership {
  workspaceId: string;
  workspaceName: string;
  role: Role;
  plan: PlanId;
  joinedAt: number;
}

/** An invite is valid for two weeks. Long enough to be seen, short enough
    that a stale address stops granting access to a workspace. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// ------------------------------------------------------------ capabilities --

/**
 * Who may do what.
 *
 * Written as a table rather than as `role !== 'member'` checks scattered
 * through four routes, because the second kind is how a permission bug ships:
 * one route gets the comparison backwards and nobody notices until somebody
 * removes their own boss.
 */
export type Capability = 'invite' | 'remove-member' | 'rename-workspace' | 'manage-billing';

const CAPABILITIES: Record<Role, Capability[]> = {
  owner: ['invite', 'remove-member', 'rename-workspace', 'manage-billing'],
  admin: ['invite', 'remove-member', 'rename-workspace'],
  member: [],
};

/**
 * Whether a role carries a capability.
 *
 * Total on purpose. `role` reaches this table from an API response, and the
 * network has never read a type declaration: an unrecognised or missing role
 * used to index the table to `undefined` and throw, which took the settings
 * page down rather than hiding one button. A permission check that cannot
 * answer must deny, not crash.
 */
export function roleCan(role: Role, capability: Capability): boolean {
  return CAPABILITIES[role]?.includes(capability) === true;
}

/** Narrows an untrusted value to a role this table actually defines. */
export function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'admin' || value === 'member';
}

/** The owner is never removable — the workspace is billed to them. */
export function canRemove(actor: Role, target: Role): boolean {
  if (target === 'owner') return false;
  if (!roleCan(actor, 'remove-member')) return false;
  // An admin cannot remove another admin; only the owner can.
  if (target === 'admin' && actor !== 'owner') return false;
  return true;
}

// -------------------------------------------------------------------- seats --

export interface SeatCount {
  /** Seats the workspace has paid for. */
  total: number;
  /** Members currently in the workspace. */
  used: number;
  /** Invites sent and not yet accepted. These hold a seat. */
  pending: number;
  /** What is left. Never negative. */
  free: number;
}

/**
 * Counts seats, with pending invites holding one each.
 *
 * Not counting them is the obvious shortcut and it is wrong: five invites
 * against five seats would all be accepted, and the sixth person would find
 * out they were over the limit after joining. Holding the seat means the
 * refusal happens at the point somebody can still do something about it.
 *
 * Expired invites do not hold a seat, which is what stops a workspace slowly
 * filling up with addresses that never replied.
 */
export function countSeats(workspace: Workspace, now = Date.now()): SeatCount {
  const used = workspace.members.length;
  const pending = workspace.invites.filter((invite) => invite.expiresAt > now).length;
  const total = Math.max(workspace.seats, PLANS[workspace.plan].limits.seats);
  return { total, used, pending, free: Math.max(0, total - used - pending) };
}

export function hasFreeSeat(workspace: Workspace, now = Date.now()): boolean {
  return countSeats(workspace, now).free > 0;
}

/**
 * `Name's team`, from whatever we know about them.
 *
 * Falls back to a plain "My team" when there is nothing to work with, rather
 * than to a possessive of a placeholder — a workspace called "My's team" is
 * the kind of detail that makes a product feel like nobody used it.
 */
export function defaultWorkspaceName(email: string | null, displayName: string | null): string {
  const from = displayName?.trim() || email?.split('@')[0]?.trim();
  if (!from) return 'My team';
  const owner = from.charAt(0).toUpperCase() + from.slice(1);
  return `${owner}${owner.endsWith('s') ? "'" : "'s"} team`;
}

/** Normalises an address for storage and comparison. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether an address looks like one at all.
 *
 * Deliberately loose. Validating email properly is famously impossible and the
 * real check is that an invite to a wrong address simply never gets accepted —
 * this is here to catch a typo, not to be a specification.
 */
export function looksLikeEmail(email: string): boolean {
  const value = normaliseEmail(email);
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Plans that come with more than one seat, and therefore a workspace. */
export function isTeamPlan(plan: PlanId): boolean {
  return PLANS[plan].limits.seats > 1;
}
