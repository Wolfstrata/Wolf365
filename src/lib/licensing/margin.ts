/**
 * Margin-exception rule for M365 lines.
 *
 * A line is a "margin exception" when its margin on the suggested customer price
 * is at or below MARGIN_EXCEPTION_PCT — this catches both under-cost (negative
 * margin) lines and razor-thin ones. Kept pure and dependency-free so the
 * report query, the dashboard card, and the client profile all flag identically.
 */

/** Margin % at or below which an M365 line is flagged as a margin exception. */
export const MARGIN_EXCEPTION_PCT = 3;

/**
 * Margin percentage on price: (price − cost) / price × 100. Returns null when
 * either input is missing or not a number. A non-positive price yields −100 when
 * there is a cost (a total loss) and 0 when there is no cost.
 */
export function marginPercent(
  unitCost: number | null | undefined,
  customerPrice: number | null | undefined,
): number | null {
  if (unitCost == null || customerPrice == null) return null;
  const cost = Number(unitCost);
  const price = Number(customerPrice);
  if (Number.isNaN(cost) || Number.isNaN(price)) return null;
  if (price <= 0) return cost > 0 ? -100 : 0;
  return ((price - cost) / price) * 100;
}

/** Whether an M365 line's margin is a flagged exception (≤ MARGIN_EXCEPTION_PCT). */
export function isMarginException(
  unitCost: number | null | undefined,
  customerPrice: number | null | undefined,
): boolean {
  const pct = marginPercent(unitCost, customerPrice);
  return pct != null && pct <= MARGIN_EXCEPTION_PCT;
}
