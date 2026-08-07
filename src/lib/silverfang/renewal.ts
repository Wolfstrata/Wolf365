/**
 * Auto-renewal arithmetic for agreements — pure, so the uplift a reviewer is
 * shown and the uplift that gets written are the same number.
 *
 * An agreement marked auto-renew carries a percentage increase, 15% by default.
 * Ticking auto-renew is the consent: once the term ends, the sub-daily cron
 * applies the uplift and rolls the term forward (see `renewal-service.ts`). This
 * module stays pure — it decides what *would* happen, which is what makes both
 * the automatic sweep and the on-screen preview describe the same thing.
 *
 * `due` and `alreadyRenewed` are the safety-critical pair. The sweep runs every
 * 15 minutes, so without `alreadyRenewed` a 15% uplift would compound into 32%
 * inside half an hour.
 */

export interface RenewableAgreement {
  autoRenew: boolean;
  /** Percentage uplift on renewal, e.g. 15 for 15%. */
  renewalIncreasePercent: number;
  startDate: Date;
  endDate: Date | null;
  lastRenewedAt: Date | null;
  /** "MONTHLY" | "YEARLY" — decides what the annual delta multiplies by. */
  billingFrequency: string | null;
  monthlyAmount: number | null;
  /** Read for context only — the uplift does not move hourly rates. See FIELDS. */
  overageRate: number | null;
  standardRate: number | null;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Apply a percentage uplift. `null` in, `null` out — an absent price stays absent. */
export function increaseBy(amount: number | null, percent: number): number | null {
  if (amount == null) return null;
  if (!Number.isFinite(percent)) return roundMoney(amount);
  return roundMoney(amount * (1 + percent / 100));
}

const DAY_MS = 86_400_000;

/**
 * The length of one term, in whole months, taken from the agreement's own dates.
 * Falls back to 12 when there is no end date: an open-ended agreement renews
 * annually, which is the common case and the least surprising guess.
 */
export function termMonths(agreement: Pick<RenewableAgreement, "startDate" | "endDate">): number {
  if (!agreement.endDate) return 12;
  const months =
    (agreement.endDate.getUTCFullYear() - agreement.startDate.getUTCFullYear()) * 12 +
    (agreement.endDate.getUTCMonth() - agreement.startDate.getUTCMonth());
  // A term shorter than a month is almost certainly a data-entry slip; treat it
  // as monthly rather than renewing every zero days forever.
  return months >= 1 ? months : 1;
}

/** Add whole months in UTC, clamping the day so 31 Jan + 1 month is 28/29 Feb. */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(d, lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ),
  );
}

/**
 * When the current term ends — the date the uplift would take effect. `null` for
 * an agreement with no end date, because an open-ended term has no renewal
 * moment to point at; the term length is only used once one is set.
 */
export function renewalDate(
  agreement: Pick<RenewableAgreement, "endDate">,
): Date | null {
  return agreement.endDate;
}

/** Days until renewal; negative once the term has passed. `null` with no end date. */
export function daysUntilRenewal(
  agreement: Pick<RenewableAgreement, "endDate">,
  asOf: Date,
): number | null {
  const date = renewalDate(agreement);
  if (!date) return null;
  return Math.ceil((date.getTime() - asOf.getTime()) / DAY_MS);
}

export interface RenewalPreview {
  /** Whether an uplift is configured at all. */
  applicable: boolean;
  percent: number;
  renewsOn: Date | null;
  /** The end date the agreement would carry after renewing. */
  newEndDate: Date | null;
  termMonths: number;
  daysUntil: number | null;
  /** True once the term has ended and the uplift has not been applied for it. */
  due: boolean;
  /** Already renewed for this term — applying again would double the increase. */
  alreadyRenewed: boolean;
  changes: {
    field: "monthlyAmount";
    label: string;
    from: number;
    to: number;
  }[];
  /** Extra annual revenue the uplift represents, for a recurring agreement. */
  annualDelta: number | null;
}

/**
 * What the uplift moves: the recurring fee, and only the recurring fee.
 *
 * Hourly rates are deliberately left alone. A rate is what the work is worth and
 * gets repriced on its own schedule; the renewal uplift is an escalator on the
 * contracted subscription. Raising both at renewal would compound one decision
 * into two price rises the client did not agree to.
 */
const FIELDS: {
  field: RenewalPreview["changes"][number]["field"];
  label: string;
  of: (a: RenewableAgreement) => number | null;
}[] = [{ field: "monthlyAmount", label: "Recurring amount", of: (a) => a.monthlyAmount }];

/**
 * What renewing this agreement would do: the recurring fee's before and after,
 * and the new term. Reported rather than summarised, because "15%" on its own
 * does not tell anyone what the client will actually see.
 */
export function renewalPreview(
  agreement: RenewableAgreement,
  asOf: Date = new Date(),
): RenewalPreview {
  const percent = Number.isFinite(agreement.renewalIncreasePercent)
    ? agreement.renewalIncreasePercent
    : 0;
  const months = termMonths(agreement);
  const renewsOn = renewalDate(agreement);
  const daysUntil = daysUntilRenewal(agreement, asOf);

  const changes = FIELDS.flatMap((f) => {
    const from = f.of(agreement);
    if (from == null) return [];
    const to = increaseBy(from, percent);
    if (to == null || to === from) return [];
    return [{ field: f.field, label: f.label, from, to }];
  });

  // Renewed already if the last renewal happened at or after the term's end —
  // i.e. the end date has already been rolled forward for this cycle.
  const alreadyRenewed =
    agreement.lastRenewedAt != null && renewsOn != null && agreement.lastRenewedAt >= renewsOn;

  const monthly = agreement.monthlyAmount;
  // A monthly fee's uplift is felt twelve times a year; a yearly fee's once.
  const periodsPerYear =
    (agreement.billingFrequency ?? "MONTHLY").toUpperCase() === "YEARLY" ? 1 : 12;
  const annualDelta =
    monthly != null && percent !== 0
      ? roundMoney(((increaseBy(monthly, percent) ?? monthly) - monthly) * periodsPerYear)
      : null;

  return {
    applicable: agreement.autoRenew && percent !== 0,
    percent,
    renewsOn,
    newEndDate: renewsOn ? addMonths(renewsOn, months) : null,
    termMonths: months,
    daysUntil,
    due: agreement.autoRenew && renewsOn != null && renewsOn <= asOf && !alreadyRenewed,
    alreadyRenewed,
    changes,
    annualDelta,
  };
}

/** Is the agreement inside the window where a renewal should be flagged? */
export function renewalApproaching(
  agreement: Pick<RenewableAgreement, "autoRenew" | "endDate">,
  asOf: Date,
  windowDays = 60,
): boolean {
  if (!agreement.autoRenew) return false;
  const days = daysUntilRenewal(agreement, asOf);
  return days != null && days <= windowDays;
}
