/**
 * Sales-quota period math. Pure — quarter 0 = annual (full calendar year),
 * 1–4 = calendar quarters. All ranges are half-open UTC [start, end).
 */

export function quotaPeriodRange(
  year: number,
  quarter: number,
): { start: Date; end: Date } {
  if (quarter >= 1 && quarter <= 4) {
    const m = (quarter - 1) * 3;
    return {
      start: new Date(Date.UTC(year, m, 1)),
      end: new Date(Date.UTC(year, m + 3, 1)),
    };
  }
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

export function quotaPeriodLabel(quarter: number): string {
  return quarter >= 1 && quarter <= 4 ? `Q${quarter}` : "Annual";
}

export const QUOTA_PERIOD_OPTIONS = [
  { value: 0, label: "Annual" },
  { value: 1, label: "Q1 (Jan–Mar)" },
  { value: 2, label: "Q2 (Apr–Jun)" },
  { value: 3, label: "Q3 (Jul–Sep)" },
  { value: 4, label: "Q4 (Oct–Dec)" },
] as const;
