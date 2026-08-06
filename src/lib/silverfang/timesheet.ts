/**
 * Timesheet week arithmetic and submission rules. Pure and tested — the state
 * machine itself lives in status.ts.
 */

export interface WeekDay {
  /** UTC-midnight date for the day. */
  date: Date;
  /** ISO date key, e.g. "2026-08-06". */
  key: string;
  /** Mon…Sun label. */
  label: string;
  weekend: boolean;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The seven days of a timesheet week, Monday first. */
export function weekDays(weekStart: Date): WeekDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart.getTime() + i * 86_400_000);
    return {
      date,
      key: isoDateKey(date),
      label: DAY_LABELS[i]!,
      weekend: i >= 5,
    };
  });
}

/** "YYYY-MM-DD" for a UTC-midnight date. */
export function isoDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parse "YYYY-MM-DD" to a UTC-midnight Date, or null when unusable. */
export function parseDateKey(key: string | null | undefined): Date | null {
  if (!key) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Shift a week start by whole weeks (negative goes back). */
export function shiftWeeks(weekStart: Date, weeks: number): Date {
  return new Date(weekStart.getTime() + weeks * 7 * 86_400_000);
}

/** Inclusive/exclusive bounds for querying a week's entries. */
export function weekRange(weekStart: Date): { gte: Date; lt: Date } {
  return { gte: weekStart, lt: new Date(weekStart.getTime() + 7 * 86_400_000) };
}

export interface TimesheetTotals {
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  /** Per-day totals keyed by ISO date. */
  byDay: Record<string, number>;
}

/** Roll up a week's entries. Kept pure so the same numbers appear everywhere. */
export function totalsFor(
  entries: { workDate: Date; hours: number; billable: boolean }[],
): TimesheetTotals {
  const byDay: Record<string, number> = {};
  let totalHours = 0;
  let billableHours = 0;
  for (const e of entries) {
    const key = isoDateKey(e.workDate);
    byDay[key] = round4((byDay[key] ?? 0) + e.hours);
    totalHours = round4(totalHours + e.hours);
    if (e.billable) billableHours = round4(billableHours + e.hours);
  }
  return {
    totalHours,
    billableHours,
    nonBillableHours: round4(totalHours - billableHours),
    byDay,
  };
}

/**
 * Whether a week can be submitted, and why not when it can't. An empty week is
 * refused: submitting nothing is almost always a mistake, and an approver
 * signing off on zero hours conveys nothing.
 */
export function canSubmit(input: {
  status: string;
  entryCount: number;
}): { ok: true } | { ok: false; reason: string } {
  if (input.entryCount === 0) {
    return { ok: false, reason: "There is no time logged for this week." };
  }
  if (input.status === "SUBMITTED") {
    return { ok: false, reason: "This week has already been submitted." };
  }
  if (input.status === "APPROVED") {
    return { ok: false, reason: "This week has been approved and is locked." };
  }
  return { ok: true };
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}
