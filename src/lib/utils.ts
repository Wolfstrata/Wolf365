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
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timeZone || "UTC",
      timeZoneName: "short",
    }).format(d);
  } catch {
    // Invalid timezone string — fall back to UTC.
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(d);
  }
}
