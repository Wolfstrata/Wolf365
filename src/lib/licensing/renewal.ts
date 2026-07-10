/**
 * Microsoft 365 (TD SYNNEX) licensing renewal windows.
 *
 * Pure, dependency-free, unit-tested. Given a subscription's renewal date and a
 * reference "now", classifies how imminent the renewal is into the 30/60/90-day
 * buckets the business cares about, so pages and (later) alert emails agree on
 * the same definition. `now` is always passed in so the logic stays testable.
 */

import { INACTIVE } from "@/lib/billing/recurring";

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
 * Whether a subscription is month-to-month. A monthly commitment simply rolls
 * over every month, so it has no meaningful upcoming "renewal" to flag — only
 * annual/triennial (and similar) commitments do. The commitment term wins, with
 * billing frequency as the fallback, mirroring `billingTypeLabel`.
 */
export function isMonthToMonth(
  commitmentTerm: string | null | undefined,
  billingFrequency: string | null | undefined,
): boolean {
  const t = (commitmentTerm ?? billingFrequency ?? "").toLowerCase();
  return t === "month" || t === "monthly";
}

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
 * Whether a subscription's status counts as live, used to decide which clients
 * have M365 licensing worth showing in the billing-run client picker. Mirrors
 * `isRecurringActive` in `recurring.ts`: a subscription is active unless its
 * status is explicitly inactive (expired/cancelled/inactive/suspended/
 * discontinued). A null or blank status is treated as active — TD SYNNEX often
 * leaves it unset — so the picker isn't emptied by missing status values.
 * Deliberately status-only; expiry date is not considered.
 */
export function isActiveStatus(status: string | null | undefined): boolean {
  return !INACTIVE.test((status ?? "").trim());
}

/**
 * Whether a licensing subscription has expired. TD SYNNEX maps the term's
 * end/expiry date into `renewalDate`, so a renewal date in the past means the
 * term has lapsed. An explicit "expired" status counts too, even without a date.
 */
export function isExpired(
  renewalDate: Date | null | undefined,
  status: string | null | undefined,
  now: Date,
): boolean {
  if ((status ?? "").toLowerCase().trim() === "expired") return true;
  if (renewalDate && renewalDate.getTime() < now.getTime()) return true;
  return false;
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
