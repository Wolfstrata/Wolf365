/**
 * Month-over-month M365 cost/price change detection. Pure and unit-tested.
 *
 * Compares a subscription's current cost figures against the previous month's
 * snapshot and reports which of `unitCost` (our cost) / `customerPrice` (what we
 * bill) changed, by how much, and in which direction. A missing figure on
 * either side is treated as "no comparison" rather than a change.
 */

export type CostField = "unitCost" | "customerPrice";

export interface CostFigures {
  unitCost: number | null;
  customerPrice: number | null;
}

export interface CostChange {
  field: CostField;
  previous: number;
  current: number;
  /** current − previous (rounded to 4dp). Positive = increase. */
  delta: number;
  /** Percent change vs previous, or null when previous is 0. */
  pct: number | null;
  direction: "up" | "down";
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/**
 * Changes between `previous` (last month's snapshot) and `current` (live). Empty
 * when there is no prior snapshot or nothing changed.
 */
export function costChanges(
  current: CostFigures,
  previous: CostFigures | null,
): CostChange[] {
  if (!previous) return [];
  const out: CostChange[] = [];
  const compare = (field: CostField, cur: number | null, prev: number | null) => {
    if (cur == null || prev == null) return;
    const c = round4(cur);
    const p = round4(prev);
    if (c === p) return;
    out.push({
      field,
      previous: p,
      current: c,
      delta: round4(c - p),
      pct: p === 0 ? null : Math.round(((c - p) / p) * 10000) / 100,
      direction: c > p ? "up" : "down",
    });
  };
  compare("unitCost", current.unitCost, previous.unitCost);
  compare("customerPrice", current.customerPrice, previous.customerPrice);
  return out;
}

/** Convenience: does either figure differ from last month? */
export function hasCostChange(current: CostFigures, previous: CostFigures | null): boolean {
  return costChanges(current, previous).length > 0;
}
