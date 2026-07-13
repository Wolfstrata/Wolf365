import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, de-duplicating Tailwind conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a Decimal/number as USD-ish currency for display. */
export function formatCurrency(
  value: number | string | null | undefined,
  currency = "USD",
): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    n,
  );
}

/**
 * Timestamp formatting for "last sync"/log labels. Pass an IANA `timeZone`
 * (e.g. "America/Toronto") to render in the user's timezone; defaults to UTC so
 * server-rendered times are unambiguous when no preference is set.
 */
export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone?: string | null,
): string {
  if (!value) return "Never";
  const d = typeof value === "string" ? new Date(value) : value;
  // NOTE: dateStyle/timeStyle cannot be combined with timeZoneName, so we use
  // explicit component options to include the timezone abbreviation.
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...opts,
      timeZone: timeZone || "UTC",
    }).format(d);
  } catch {
    // Invalid timezone string — fall back to UTC.
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(d);
  }
}

/**
 * Lexically-sortable, timezone-aware timestamp ("2026-06-26 05:30"). Used by
 * table columns that both display and sort on a timestamp string. Pass the
 * user's IANA `timeZone`; falls back to UTC when it's missing or invalid.
 */
export function formatSortableDateTime(
  value: Date | string | null | undefined,
  timeZone?: string | null,
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const format = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: tz }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  };
  try {
    return format(timeZone || "UTC");
  } catch {
    return format("UTC");
  }
}

/** Date-only formatting (no time) for due/close dates. Rendered in UTC so a
 *  date-only value isn't shifted across midnight by the server's timezone. */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}
