/**
 * Duration parsing, rounding and formatting for timesheets.
 *
 * Techs enter time in several shapes ("1.5", "1:30", "90m", "1h30m"), so entry is
 * normalized to decimal hours here rather than in each form. Pure and tested.
 */
import type { TimeBand } from "@/lib/silverfang/rates";
import {
  isHoliday,
  isWeekend,
  isWithinBusinessHours,
  type BusinessCalendar,
} from "@/lib/silverfang/business-hours";

/**
 * Parse a duration into decimal hours. Accepts:
 *   "1.5" | "1,5"   → 1.5
 *   "1:30"          → 1.5
 *   "90m" | "90min" → 1.5
 *   "1h30m" | "1h"  → 1.5 | 1
 * Returns null when the input isn't a usable positive duration.
 */
export function parseHours(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) && input > 0 ? input : null;
  }
  const raw = input.trim().toLowerCase().replace(",", ".");
  if (!raw) return null;

  // h/m combined, e.g. "1h30m", "2h", "45m"
  const hm = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in)?)?$/.exec(raw);
  if (hm && (hm[1] || hm[2])) {
    const h = hm[1] ? Number(hm[1]) : 0;
    const m = hm[2] ? Number(hm[2]) : 0;
    const total = h + m / 60;
    return total > 0 ? total : null;
  }

  // Colon form, e.g. "1:30"
  const colon = /^(\d+):([0-5]?\d)$/.exec(raw);
  if (colon) {
    const total = Number(colon[1]) + Number(colon[2]) / 60;
    return total > 0 ? total : null;
  }

  // Plain decimal
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Round hours up to the next billing increment (default 15 minutes, the PSA
 * norm). `increment` is in minutes; 0 or less means no rounding.
 */
export function roundHours(hours: number, increment = 15): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  if (increment <= 0) return round4(hours);
  const step = increment / 60;
  return round4(Math.ceil(hours / step - 1e-9) * step);
}

/** Format decimal hours as "Xh Ym" (or "0h"). */
export function formatHours(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return "0h";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Format decimal hours as a decimal string, e.g. "1.50". */
export function formatDecimalHours(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "0.00";
  return hours.toFixed(2);
}

/** Hours between two instants (elapsed, not business hours). */
export function hoursBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return ms > 0 ? round4(ms / 3_600_000) : 0;
}

/**
 * Classify when work happened, for time-of-day rate banding. Holiday wins over
 * weekend, which wins over after-hours.
 */
export function classifyTimeBand(cal: BusinessCalendar, at: Date): TimeBand {
  if (isHoliday(cal, at)) return "HOLIDAY";
  if (isWeekend(cal, at)) return "WEEKEND";
  return isWithinBusinessHours(cal, at) ? "DAY" : "AFTER_HOURS";
}

/** Monday (UTC midnight) of the week containing `date` — the timesheet key. */
export function weekStartOf(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // getUTCDay: 0=Sun … 6=Sat. Shift back to Monday.
  const shift = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - shift * 86_400_000);
}

/** Date-only normalization (UTC midnight), matching how workDate is stored. */
export function toWorkDate(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}
