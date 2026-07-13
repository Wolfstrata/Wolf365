"use client";

import { createContext, useContext, type ReactNode } from "react";
import { formatDateTime, formatDate } from "@/lib/utils";

/**
 * App-wide timezone for rendering timestamps. Seeded once from the signed-in
 * user's timezone setting in the app layout, so every timestamp — in both server
 * and client components — renders in that zone instead of UTC.
 */
const TimeZoneContext = createContext<string>("UTC");

export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <TimeZoneContext.Provider value={timeZone || "UTC"}>
      {children}
    </TimeZoneContext.Provider>
  );
}

export function useTimeZone(): string {
  return useContext(TimeZoneContext);
}

/**
 * Render a timestamp in the user's timezone.
 * - default: date + time + zone abbreviation (real instants: syncs, created-at…).
 * - `dateOnly`: a stable calendar date with no time/zone — for UTC-midnight
 *   business dates (billing period, invoice date, renewals) that must not shift
 *   across midnight.
 */
export function LocalTime({
  value,
  dateOnly = false,
}: {
  value: Date | string | null | undefined;
  dateOnly?: boolean;
}) {
  const tz = useTimeZone();
  return <>{dateOnly ? formatDate(value) : formatDateTime(value, tz)}</>;
}
