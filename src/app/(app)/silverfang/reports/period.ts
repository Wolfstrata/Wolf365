/**
 * Reporting periods, as UTC half-open ranges [start, end).
 *
 * Half-open on purpose: a closed range either double-counts the boundary day or
 * drops it, depending on how the comparison is written, and that argument is not
 * worth having every time someone reads the report.
 *
 * Pure so the boundaries are testable — an off-by-one-day period silently
 * misstates every figure on the page.
 */

export const PERIODS = ["this-month", "last-month", "last-90", "this-year"] as const;
export type PeriodKey = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "last-90": "Last 90 days",
  "this-year": "This year",
};

/** The requested period, defaulting to this month for anything unrecognised. */
export function parsePeriod(value: string | undefined): PeriodKey {
  return PERIODS.includes(value as PeriodKey) ? (value as PeriodKey) : "this-month";
}

export function periodRange(key: PeriodKey, now: Date): { start: Date; end: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  switch (key) {
    case "this-month":
      return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
    case "last-month":
      return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
    case "last-90": {
      // Ends tomorrow so today's work is included — a report that silently omits
      // today reads as "nobody logged anything this morning".
      const end = new Date(Date.UTC(y, m, now.getUTCDate() + 1));
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 90);
      return { start, end };
    }
    case "this-year":
      return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)) };
  }
}
