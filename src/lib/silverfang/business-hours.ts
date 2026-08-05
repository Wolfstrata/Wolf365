/**
 * Business-hours arithmetic for SLA clocks and time-of-day rate banding.
 *
 * The existing proration math (src/lib/billing/proration.ts) counts whole
 * calendar days in UTC; SLA targets are expressed in *working minutes*, so this
 * module is separate. Everything here is pure and dependency-free.
 *
 * Windows are defined per weekday as minutes-from-midnight in a named IANA
 * timezone, which avoids storing wall-clock times that shift under DST. All
 * conversions go through `Intl.DateTimeFormat`, so no date library is required.
 */

/** A working window for one weekday: 0 = Sunday … 6 = Saturday. */
export interface BusinessWindow {
  weekday: number;
  /** Minutes from local midnight, e.g. 480 = 08:00. */
  startMinute: number;
  /** Minutes from local midnight, e.g. 1020 = 17:00. */
  endMinute: number;
  /** IANA timezone the window is expressed in. */
  timezone: string;
}

export interface BusinessCalendar {
  windows: BusinessWindow[];
  /** Holiday dates (any instant on the local day is treated as a holiday). */
  holidays: Date[];
  /** Fallback timezone when a window doesn't supply one. */
  timezone: string;
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 1440;

/** Local calendar parts for an instant in a given IANA timezone. */
export function zonedParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; minutes: number; weekday: number } {
  // en-CA gives ISO-like ordering; weekday is derived from the formatted date so
  // it reflects the target timezone rather than the host's.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  // `hour` can format as "24" at midnight in some environments.
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  // Day-of-week of that local date, computed in UTC to avoid host-tz drift.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, minutes: hour * 60 + minute, weekday };
}

/** A stable key for a local calendar day, e.g. "2026-08-05". */
function dayKey(p: { year: number; month: number; day: number }): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function calendarTimezone(cal: BusinessCalendar): string {
  return cal.windows[0]?.timezone ?? cal.timezone;
}

/**
 * Holiday keys. Holidays are DATE-ONLY values (stored at UTC midnight), so they
 * are read in UTC — converting them into the local zone would shift them a day.
 * The key is then compared against the *local* day of the instant being tested,
 * so "August 6" is a holiday for the whole of local August 6.
 */
function holidayKeys(cal: BusinessCalendar): Set<string> {
  return new Set(
    cal.holidays.map((h) =>
      dayKey({ year: h.getUTCFullYear(), month: h.getUTCMonth() + 1, day: h.getUTCDate() }),
    ),
  );
}

/** The working window that applies on the local day of `date`, if any. */
function windowFor(
  cal: BusinessCalendar,
  date: Date,
): { startMinute: number; endMinute: number } | null {
  const tz = calendarTimezone(cal);
  const p = zonedParts(date, tz);
  if (holidayKeys(cal).has(dayKey(p))) return null;
  const w = cal.windows.find((x) => x.weekday === p.weekday);
  if (!w) return null;
  if (w.endMinute <= w.startMinute) return null; // ignore malformed windows
  return { startMinute: w.startMinute, endMinute: w.endMinute };
}

/** True when `date` falls inside a working window (and is not a holiday). */
export function isWithinBusinessHours(cal: BusinessCalendar, date: Date): boolean {
  const w = windowFor(cal, date);
  if (!w) return false;
  const { minutes } = zonedParts(date, calendarTimezone(cal));
  return minutes >= w.startMinute && minutes < w.endMinute;
}

/** True when the local day of `date` is a configured holiday. */
export function isHoliday(cal: BusinessCalendar, date: Date): boolean {
  const tz = calendarTimezone(cal);
  return holidayKeys(cal).has(dayKey(zonedParts(date, tz)));
}

/** True when no working window is defined for the local weekday (i.e. a weekend). */
export function isWeekend(cal: BusinessCalendar, date: Date): boolean {
  const tz = calendarTimezone(cal);
  const p = zonedParts(date, tz);
  return !cal.windows.some((w) => w.weekday === p.weekday);
}

/**
 * The zone's UTC offset (in minutes) in effect at `date`, i.e. local − UTC.
 * Winnipeg in summer (CDT) yields −300.
 */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day) + p.minutes * MS_PER_MINUTE;
  return Math.round((localAsUtc - date.getTime()) / MS_PER_MINUTE);
}

/** Start of the local day containing `date`, as an instant. */
function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  const localMidnightAsUtc = Date.UTC(p.year, p.month - 1, p.day);
  // Undo the zone offset to get the real instant of local midnight, then correct
  // once using the offset actually in effect then (handles DST boundaries).
  let instant = localMidnightAsUtc - offsetMinutes(date, timeZone) * MS_PER_MINUTE;
  const corrected = localMidnightAsUtc - offsetMinutes(new Date(instant), timeZone) * MS_PER_MINUTE;
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

/** Working minutes between two instants (0 when `to` <= `from`). */
export function businessMinutesBetween(
  cal: BusinessCalendar,
  from: Date,
  to: Date,
): number {
  if (to.getTime() <= from.getTime()) return 0;
  if (cal.windows.length === 0) {
    // No calendar configured → fall back to elapsed time so SLAs still work.
    return Math.round((to.getTime() - from.getTime()) / MS_PER_MINUTE);
  }
  const tz = calendarTimezone(cal);
  let total = 0;
  let cursor = startOfLocalDay(from, tz);
  // Bound the walk so a bad range can never spin (about 2 years of days).
  for (let i = 0; i < 800 && cursor.getTime() < to.getTime(); i += 1) {
    const w = windowFor(cal, cursor);
    if (w) {
      const dayStart = cursor.getTime();
      const openAt = dayStart + w.startMinute * MS_PER_MINUTE;
      const closeAt = dayStart + w.endMinute * MS_PER_MINUTE;
      const overlapStart = Math.max(openAt, from.getTime());
      const overlapEnd = Math.min(closeAt, to.getTime());
      if (overlapEnd > overlapStart) {
        total += (overlapEnd - overlapStart) / MS_PER_MINUTE;
      }
    }
    cursor = nextLocalDay(cursor, tz);
  }
  return Math.round(total);
}

/** Advance one local day, re-anchoring to local midnight (DST-safe). */
function nextLocalDay(dayStart: Date, timeZone: string): Date {
  // Step 26h to be certain we land on the following local day, then re-anchor.
  return startOfLocalDay(new Date(dayStart.getTime() + 26 * 60 * MS_PER_MINUTE), timeZone);
}

/**
 * The instant that is `minutes` working minutes after `from`. Used to turn an
 * SLA target ("240 business minutes to respond") into a concrete due date.
 * Returns `from` when minutes <= 0.
 */
export function addBusinessMinutes(
  cal: BusinessCalendar,
  from: Date,
  minutes: number,
): Date {
  if (minutes <= 0) return from;
  if (cal.windows.length === 0) {
    return new Date(from.getTime() + minutes * MS_PER_MINUTE);
  }
  const tz = calendarTimezone(cal);
  let remaining = minutes;
  let cursor = startOfLocalDay(from, tz);
  for (let i = 0; i < 800; i += 1) {
    const w = windowFor(cal, cursor);
    if (w) {
      const dayStart = cursor.getTime();
      const openAt = dayStart + w.startMinute * MS_PER_MINUTE;
      const closeAt = dayStart + w.endMinute * MS_PER_MINUTE;
      // Start consuming from the later of "window open" and "from".
      const spanStart = Math.max(openAt, from.getTime());
      if (closeAt > spanStart) {
        const available = (closeAt - spanStart) / MS_PER_MINUTE;
        if (available >= remaining) {
          return new Date(spanStart + remaining * MS_PER_MINUTE);
        }
        remaining -= available;
      }
    }
    cursor = nextLocalDay(cursor, tz);
  }
  // Calendar exhausted (e.g. no working days at all) — fail open with elapsed time.
  return new Date(from.getTime() + minutes * MS_PER_MINUTE);
}

/** A Mon–Fri window in one timezone, for seeding and tests. */
export function weekdayWindows(
  startMinute: number,
  endMinute: number,
  timezone: string,
): BusinessWindow[] {
  return [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute,
    endMinute,
    timezone,
  }));
}

export { MINUTES_PER_DAY };
