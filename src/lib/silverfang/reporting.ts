import { roundMoney } from "@/lib/silverfang/project-billing";

/**
 * Service-delivery reporting: utilisation, realisation, and profitability.
 *
 * Pure, because these are contested definitions rather than obvious arithmetic.
 * A PSA that computes "utilisation" two slightly different ways in two places
 * produces arguments, not insight — so every ratio here is defined once, in the
 * open, and tested.
 *
 * The three questions this answers, in the order they matter:
 *
 *   utilisation   — are the techs busy?          billable hours ÷ capacity
 *   realisation   — did we get paid for it?      billed value ÷ worked value
 *   profitability — was it worth doing?          revenue − cost
 *
 * Utilisation without realisation flatters you: a tech can be 100% utilised on
 * hours that were all absorbed by an agreement inclusion and billed nothing.
 */

/** Percentages are returned 0–100, rounded to one place, or null when undefined. */
export function ratioPct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function roundHours4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Utilisation
// ---------------------------------------------------------------------------

export interface TechHoursInput {
  userId: string;
  name: string;
  /** Hours logged as billable, whether or not they were ultimately charged. */
  billableHours: number;
  /** Hours logged as non-billable (internal, admin, warranty rework…). */
  nonBillableHours: number;
  /** Value of the billable hours at the rate resolved when they were logged. */
  workedValue: number;
  /** Our cost of all hours logged. */
  cost: number;
  /**
   * Expected working hours for the period. Null when unknown — reported as
   * unknown rather than assumed, since a made-up denominator makes every
   * utilisation figure fiction.
   */
  capacityHours: number | null;
}

export interface TechUtilisation {
  userId: string;
  name: string;
  billableHours: number;
  nonBillableHours: number;
  totalHours: number;
  capacityHours: number | null;
  /** Billable ÷ capacity. The number people mean by "utilisation". */
  utilisationPct: number | null;
  /** Billable ÷ total logged. High here with low utilisation means undertime. */
  billableRatioPct: number | null;
  workedValue: number;
  cost: number;
  /** Worked value ÷ billable hours — what an hour of this tech is worth. */
  effectiveRate: number | null;
}

export function techUtilisation(input: TechHoursInput): TechUtilisation {
  const billable = roundHours4(input.billableHours);
  const nonBillable = roundHours4(input.nonBillableHours);
  const total = roundHours4(billable + nonBillable);
  return {
    userId: input.userId,
    name: input.name,
    billableHours: billable,
    nonBillableHours: nonBillable,
    totalHours: total,
    capacityHours: input.capacityHours,
    utilisationPct:
      input.capacityHours != null ? ratioPct(billable, input.capacityHours) : null,
    billableRatioPct: ratioPct(billable, total),
    workedValue: roundMoney(input.workedValue),
    cost: roundMoney(input.cost),
    effectiveRate: billable > 0 ? roundMoney(input.workedValue / billable) : null,
  };
}

/**
 * Working hours in a period, from whole weekdays × hours per day. Deliberately
 * naive about holidays: an approximation everyone understands beats a precise
 * figure nobody can reproduce, and the number is shown as capacity, not truth.
 */
export function weekdayCapacity(
  periodStart: Date,
  periodEnd: Date,
  hoursPerDay = 8,
): number {
  let days = 0;
  const cursor = new Date(
    Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate()),
  );
  while (cursor < periodEnd) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days * hoursPerDay;
}

// ---------------------------------------------------------------------------
// Realisation
// ---------------------------------------------------------------------------

export interface RealisationInput {
  /** Value of billable hours at their logged rates. */
  workedValue: number;
  /** What actually reached an invoice for those hours. */
  billedValue: number;
  /** Hours that produced no charge, by reason — for explaining the gap. */
  coveredHours?: { prepaid?: number; inclusion?: number; fixedFee?: number; unrated?: number };
}

export interface Realisation {
  workedValue: number;
  billedValue: number;
  /** Billed ÷ worked. Under 100% is normal for agreement work; near 0% is a bug. */
  realisationPct: number | null;
  /** Worked value that never became revenue. */
  gap: number;
  coveredHours: { prepaid: number; inclusion: number; fixedFee: number; unrated: number };
}

/**
 * How much of the value worked was actually billed.
 *
 * Below 100% is expected and usually correct — hours inside a managed-services
 * inclusion or drawn from a prepaid block were paid for elsewhere. What matters is
 * whether the gap is explained: `unrated` hours are the alarming component,
 * because those are hours nobody decided to give away.
 */
export function realisation(input: RealisationInput): Realisation {
  const worked = roundMoney(input.workedValue);
  const billed = roundMoney(input.billedValue);
  const c = input.coveredHours ?? {};
  return {
    workedValue: worked,
    billedValue: billed,
    realisationPct: ratioPct(billed, worked),
    gap: roundMoney(Math.max(0, worked - billed)),
    coveredHours: {
      prepaid: roundHours4(c.prepaid ?? 0),
      inclusion: roundHours4(c.inclusion ?? 0),
      fixedFee: roundHours4(c.fixedFee ?? 0),
      unrated: roundHours4(c.unrated ?? 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Profitability
// ---------------------------------------------------------------------------

export interface ProfitInput {
  id: string;
  name: string;
  /** What was invoiced: recurring fees, overage, block purchases, project fees. */
  revenue: number;
  /** Our cost of the hours delivered against it. */
  cost: number;
  hours: number;
}

export interface Profit {
  id: string;
  name: string;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  hours: number;
  /** Revenue ÷ hours. The single most useful number on an agreement. */
  effectiveRate: number | null;
  /** Cost exceeds revenue — losing money on this one. */
  underwater: boolean;
}

export function profitability(input: ProfitInput): Profit {
  const revenue = roundMoney(input.revenue);
  const cost = roundMoney(input.cost);
  const margin = roundMoney(revenue - cost);
  const hours = roundHours4(input.hours);
  return {
    id: input.id,
    name: input.name,
    revenue,
    cost,
    margin,
    // Margin as a share of revenue. Null with no revenue: an agreement that
    // billed nothing has no margin percentage, and showing -100% would imply a
    // precision that is not there.
    marginPct: ratioPct(margin, revenue),
    hours,
    effectiveRate: hours > 0 ? roundMoney(revenue / hours) : null,
    underwater: margin < 0,
  };
}

/** Roll a set of profitability rows into one total. */
export function totalProfit(rows: Profit[]): Profit {
  const revenue = roundMoney(rows.reduce((a, r) => a + r.revenue, 0));
  const cost = roundMoney(rows.reduce((a, r) => a + r.cost, 0));
  const hours = roundHours4(rows.reduce((a, r) => a + r.hours, 0));
  return profitability({ id: "__total", name: "Total", revenue, cost, hours });
}

/** Worst margins first — the list is for finding problems, not admiring wins. */
export function byWorstMargin(rows: Profit[]): Profit[] {
  return [...rows].sort((a, b) => a.margin - b.margin);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Quote a CSV field, defending against the spreadsheet formula-injection trap. */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  const raw = String(value);
  // A leading =, +, -, @ makes Excel evaluate the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
}
