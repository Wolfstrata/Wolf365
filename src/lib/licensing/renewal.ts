/**
 * Microsoft 365 (TD SYNNEX) licensing renewal windows.
 *
 * Pure, dependency-free, unit-tested. Given a subscription's renewal date and a
 * reference "now", classifies how imminent the renewal is into the 30/60/90-day
 * buckets the business cares about, so pages and (later) alert emails agree on
 * the same definition. `now` is always passed in so the logic stays testable.
 */

/** The smallest day-threshold a renewal falls within. */
export type RenewalBucket = 30 | 60 | 90;

export interface RenewalWindow {
  /** Whole days from `now` until the renewal (0 = renews today). */
  daysUntil: number;
  /** 30, 60, or 90 — the tightest window the renewal falls inside. */
  bucket: RenewalBucket;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days from `now` until `renewalDate` (rounded up, so a renewal later
 * today counts as 0 and any future instant counts as at least the calendar
 * days remaining). Null when there is no renewal date.
 */
export function daysUntilRenewal(
  renewalDate: Date | null | undefined,
  now: Date,
): number | null {
  if (!renewalDate) return null;
  return Math.ceil((renewalDate.getTime() - now.getTime()) / MS_PER_DAY);
}

/**
 * The renewal window a subscription is in, or null when it has no renewal date,
 * already renewed (past), or renews more than 90 days out.
 */
export function renewalWindow(
  renewalDate: Date | null | undefined,
  now: Date,
): RenewalWindow | null {
  const daysUntil = daysUntilRenewal(renewalDate, now);
  if (daysUntil == null || daysUntil < 0 || daysUntil > 90) return null;
  const bucket: RenewalBucket = daysUntil <= 30 ? 30 : daysUntil <= 60 ? 60 : 90;
  return { daysUntil, bucket };
}
