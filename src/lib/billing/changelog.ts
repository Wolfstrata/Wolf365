/**
 * Pure helpers for TD SYNNEX (Stellr) subscription change logs.
 *
 * Co-terminous seat additions (seats added to an existing subscription line mid
 * term) do NOT change the subscription's start date — they fold into the line's
 * total quantity. The `listSubscriptionChangeLogs` endpoint is the only place the
 * real add date + delta live, as free-text entries like:
 *
 *   changeLog: "Add 3 seats"   entryDatetime: "2026-07-09T11:21:25.733-0400"
 *   changeLog: "Remove 1 seat"
 *   changeLog: "Set to Renew with current plan"   (not a seat change)
 *
 * These functions parse those entries and reduce them to the seat additions that
 * fall in a billing month, so mid-month adds can be pro-rated on their own line.
 * Kept dependency-free and unit-tested per the pure-billing-math rule.
 */

/**
 * Parse the signed seat delta from a change-log entry's free text.
 * "Add 3 seats" → +3, "Remove 2 seats" → −2, non-quantity entries → 0.
 */
export function parseSeatDelta(changeLog: string | null | undefined): number {
  if (!changeLog) return 0;
  const m = /(add|added|remove|removed|reduce|reduced)\s+(\d+)\s+seats?/i.exec(
    changeLog,
  );
  if (!m) return 0;
  const verb = m[1]!.toLowerCase();
  const n = Number(m[2]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const negative = verb.startsWith("remove") || verb.startsWith("reduce");
  return negative ? -n : n;
}

export interface ChangeLogEntryInput {
  /** Free-text change description, e.g. "Add 3 seats". */
  changeLog: string | null;
  /** When the change was recorded. */
  entryDatetime: Date;
}

export interface SeatAddition {
  /** Exact date the seats were added. */
  date: Date;
  /** Number of seats added (always > 0). */
  seats: number;
  /** Original change-log text, for display/audit. */
  note: string;
}

/**
 * Reduce change-log entries to the seat ADDITIONS whose date falls within the
 * given month window [monthStart, monthEnd). Removals and non-seat entries are
 * ignored (removals reduce the base line, not a pro-rated add). Returned newest
 * first is NOT guaranteed; callers sort as needed.
 */
export function monthlySeatAdditions(
  entries: ChangeLogEntryInput[],
  monthStart: Date,
  monthEnd: Date,
): SeatAddition[] {
  const startMs = monthStart.getTime();
  const endMs = monthEnd.getTime();
  const out: SeatAddition[] = [];
  for (const e of entries) {
    const t = e.entryDatetime.getTime();
    if (t < startMs || t >= endMs) continue;
    const delta = parseSeatDelta(e.changeLog);
    if (delta > 0) {
      out.push({ date: e.entryDatetime, seats: delta, note: e.changeLog ?? "" });
    }
  }
  return out;
}

/** Total seats added within the month (sum of positive deltas). */
export function totalSeatsAddedThisMonth(
  entries: ChangeLogEntryInput[],
  monthStart: Date,
  monthEnd: Date,
): number {
  return monthlySeatAdditions(entries, monthStart, monthEnd).reduce(
    (acc, a) => acc + a.seats,
    0,
  );
}
