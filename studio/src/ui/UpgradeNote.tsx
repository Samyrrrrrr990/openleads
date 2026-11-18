/**
 * What a gate looks like, everywhere.
 *
 * Zory sells four plans and, until this existed, enforced exactly one of the
 * things it sold: `github-push`. Zory Motion and custom templates were listed
 * on the Pro card, priced into $20 a month, and worked perfectly well on Free
 * — so paying changed almost nothing, which is the version of this problem
 * that costs a business its customers rather than its reputation.
 *
 * Wiring the gates means drawing them, and drawing them badly is its own
 * failure. Three rules hold here:
 *
 *   **Name the plan, not the wall.** `checkFeature` already answers which plan
 *   is the cheapest one with this capability, so the copy says "Pro" because
 *   the table says Pro, and a feature that moves between plans moves here too.
 *
 *   **Say what it does, not that it is locked.** The reason comes from
 *   `FEATURE_REASON`, which is the same sentence the pricing page shows. A
 *   person who has just been stopped is the person most entitled to know what
 *   they would be buying.
 *
 *   **Never block the surrounding work.** A gate replaces one control, not a
 *   panel. Everything that was free before any of this stays exactly where it
 *   was — see `MotionSection`, where entrance and hover are untouched and only
 *   the scroll trigger, stagger and press are behind this.
 */

import { Link } from 'react-router-dom';
import type { Feature } from '@zory/core';
import { FEATURE_REASON, PLANS, checkFeature } from '@zory/core';
import { useBillingStore } from '../core/billing/store';
import { LockIcon } from './icons';
import styles from './UpgradeNote.module.css';

export function UpgradeNote({
  feature,
  title,
  body,
  compact = false,
}: {
  feature: Feature;
  /** Overrides the feature label when the surrounding UI already names it. */
  title?: string;
  /** Overrides `FEATURE_REASON`, for a wall that needs local context. */
  body?: string;
  compact?: boolean;
}): React.ReactElement | null {
  const entitlements = useBillingStore((s) => s.entitlements);
  const gate = checkFeature(entitlements, feature);

  // Allowed, or a deployment that sells nothing. Either way, no wall.
  if (!gate) return null;

  const plan = PLANS[gate.upgradeTo];

  return (
    <div className={`${styles.note} ${compact ? styles.inline : ''}`}>
      <p className={styles.head}>
        <span className={styles.mark}>
          <LockIcon size={12} />
        </span>
        {title ?? plan.name}
        <span className={styles.plan}>
          {plan.perSeat ? `$${plan.monthly}/seat` : `$${plan.monthly}/mo`}
        </span>
      </p>
      <p className={styles.body}>{body ?? FEATURE_REASON[feature]}</p>
      <Link className={styles.link} to={`/app/checkout?plan=${plan.id}`}>
        Get {plan.name} →
      </Link>
    </div>
  );
}

/**
 * The same question without the markup, for a control that greys itself out
 * rather than being replaced.
 */
export function useBlocked(feature: Feature): boolean {
  return useBillingStore((s) => checkFeature(s.entitlements, feature) !== null);
}
