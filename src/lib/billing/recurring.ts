/**
 * Recurring-revenue / cost / margin math for the dashboard and client profiles.
 *
 * MRR = sum of each subscription's monthly customer price × quantity. Cost uses
 * the TD SYNNEX unit cost. One-time charges and inactive/expired/cancelled
 * subscriptions are excluded; annually-billed lines contribute their monthly
 * share (÷12). ARR = MRR × 12. Pure + unit-tested.
 */
export interface RecurringSubscriptionInput {
  /** Vendor-suggested customer price (revenue). Falls back to unitCost. */
  customerPrice: number | null;
  unitCost: number | null;
  quantity: number;
  billingFrequency: string | null;
  status: string | null;
}

/**
 * Map a stored TD SYNNEX subscription row (Decimal money columns) into the
 * plain-number shape this module works with. Accepts anything with the
 * relevant fields so callers don't repeat the Decimal→Number coercion.
 */
export function toRecurringInput(row: {
  customerPrice: unknown;
  unitCost: unknown;
  quantity: number;
  billingFrequency: string | null;
  status: string | null;
}): RecurringSubscriptionInput {
  return {
    customerPrice: row.customerPrice != null ? Number(row.customerPrice) : null,
    unitCost: row.unitCost != null ? Number(row.unitCost) : null,
    quantity: row.quantity,
    billingFrequency: row.billingFrequency,
    status: row.status,
  };
}

/**
 * Statuses that mean a subscription is NOT live. Shared source of truth for
 * "active vs inactive" across recurring totals and the billing-run picker.
 */
export const INACTIVE = /expire|cancel|inactiv|suspend|discontinu/i;

/** Whether a subscription counts toward recurring totals. */
export function isRecurringActive(sub: RecurringSubscriptionInput): boolean {
  if (sub.status && INACTIVE.test(sub.status)) return false;
  const freq = (sub.billingFrequency ?? "").toLowerCase();
  if (freq.includes("one")) return false; // one_time → not recurring
  return true;
}

/**
 * Number of months the price covers, derived from the BILLING frequency (how
 * often you're billed = the period one price covers). Monthly billing → 1 even
 * for an annual commitment, because the price is already per-month. Unknown /
 * blank defaults to 1 (treated as monthly) rather than guessing.
 */
export function billingPeriodMonths(billingFrequency: string | null): number {
  const f = (billingFrequency ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (!f) return 1;
  if (/(trienn|3year|3yr|36month|p3y)/.test(f)) return 36;
  if (/(bienn|2year|2yr|24month|p2y)/.test(f)) return 24;
  if (/(ann|year|yr|p1y|12month)/.test(f)) return 12;
  return 1; // monthly, monthly-billed, or unknown
}

/** Monthly amount for a unit price, normalizing by the billing period. */
function lineMonthly(unitPrice: number, sub: RecurringSubscriptionInput): number {
  const line = unitPrice * sub.quantity;
  return line / billingPeriodMonths(sub.billingFrequency);
}

/** Monthly recurring revenue for one subscription (0 if one-time/inactive). */
export function monthlyRevenue(sub: RecurringSubscriptionInput): number {
  if (!isRecurringActive(sub)) return 0;
  return lineMonthly(sub.customerPrice ?? sub.unitCost ?? 0, sub);
}

/** Monthly recurring cost for one subscription (0 if one-time/inactive). */
export function monthlyCost(sub: RecurringSubscriptionInput): number {
  if (!isRecurringActive(sub)) return 0;
  return lineMonthly(sub.unitCost ?? 0, sub);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeMrr(subs: RecurringSubscriptionInput[]): number {
  return round2(subs.reduce((acc, s) => acc + monthlyRevenue(s), 0));
}

export function computeArr(mrr: number): number {
  return round2(mrr * 12);
}

export interface RecurringSummary {
  mrr: number;
  arr: number;
  monthlyCost: number;
  annualCost: number;
  monthlyMargin: number;
  annualMargin: number;
  /** Margin as a percentage of revenue (0 when there's no revenue). */
  marginPct: number;
  /** Count of subscriptions counted as active & recurring. */
  activeCount: number;
}

/** Full recurring revenue/cost/margin rollup for a set of subscriptions. */
export function recurringSummary(
  subs: RecurringSubscriptionInput[],
): RecurringSummary {
  let mrr = 0;
  let cost = 0;
  let activeCount = 0;
  for (const s of subs) {
    if (!isRecurringActive(s)) continue;
    activeCount += 1;
    mrr += monthlyRevenue(s);
    cost += monthlyCost(s);
  }
  mrr = round2(mrr);
  cost = round2(cost);
  const monthlyMargin = round2(mrr - cost);
  return {
    mrr,
    arr: round2(mrr * 12),
    monthlyCost: cost,
    annualCost: round2(cost * 12),
    monthlyMargin,
    annualMargin: round2(monthlyMargin * 12),
    marginPct: mrr > 0 ? Math.round((monthlyMargin / mrr) * 1000) / 10 : 0,
    activeCount,
  };
}
