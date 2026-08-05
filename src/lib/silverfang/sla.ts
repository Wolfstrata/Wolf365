/**
 * SLA clock computation.
 *
 * Response/resolution targets are expressed in minutes per priority and are
 * measured in business hours (unless the SLA opts out), so due dates are derived
 * from the business calendar rather than raw elapsed time. Time spent in a
 * "waiting on client" status pauses the clock; paused minutes are accumulated on
 * the ticket and pushed the due date out.
 *
 * Pure and dependency-free — I/O lives in the server actions that call this.
 */
import {
  addBusinessMinutes,
  businessMinutesBetween,
  type BusinessCalendar,
} from "@/lib/silverfang/business-hours";

export type SlaPriority = "P1" | "P2" | "P3" | "P4";
export type SlaTargetKind = "RESPONSE" | "RESOLUTION";

export interface SlaTargetLike {
  priority: SlaPriority;
  kind: SlaTargetKind;
  minutes: number;
}

export interface SlaLike {
  /** When false the clock runs on calendar time instead of business hours. */
  useBusinessHours: boolean;
  targets: SlaTargetLike[];
  calendar: BusinessCalendar;
}

/** A 24/7 calendar: no windows means "count elapsed time". */
const ALWAYS_ON: BusinessCalendar = { windows: [], holidays: [], timezone: "UTC" };

function calendarFor(sla: SlaLike): BusinessCalendar {
  return sla.useBusinessHours ? sla.calendar : ALWAYS_ON;
}

/** The target minutes for a priority+kind, or null when the SLA doesn't set one. */
export function targetMinutes(
  sla: SlaLike,
  priority: SlaPriority,
  kind: SlaTargetKind,
): number | null {
  const t = sla.targets.find((x) => x.priority === priority && x.kind === kind);
  return t ? t.minutes : null;
}

export interface SlaDueDates {
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
}

/**
 * Due dates for a ticket opened at `openedAt`. `pausedMinutes` (already
 * accumulated waiting-on-client time) shifts the deadlines out.
 */
export function computeDueDates(
  sla: SlaLike,
  priority: SlaPriority,
  openedAt: Date,
  pausedMinutes = 0,
): SlaDueDates {
  const cal = calendarFor(sla);
  const response = targetMinutes(sla, priority, "RESPONSE");
  const resolution = targetMinutes(sla, priority, "RESOLUTION");
  const pause = Math.max(0, pausedMinutes);
  return {
    responseDueAt:
      response == null ? null : addBusinessMinutes(cal, openedAt, response + pause),
    resolutionDueAt:
      resolution == null ? null : addBusinessMinutes(cal, openedAt, resolution + pause),
  };
}

/**
 * Business minutes elapsed on a ticket's clock, excluding paused time. Measured
 * to `now`, or to the moment the clock stopped (responded/resolved).
 */
export function elapsedMinutes(
  sla: SlaLike,
  openedAt: Date,
  now: Date,
  pausedMinutes = 0,
): number {
  const gross = businessMinutesBetween(calendarFor(sla), openedAt, now);
  return Math.max(0, gross - Math.max(0, pausedMinutes));
}

export interface SlaState {
  /** Minutes remaining before the deadline; negative once breached. */
  remainingMinutes: number | null;
  breached: boolean;
  /** True within the warning threshold (default 25% of the target) and not breached. */
  atRisk: boolean;
}

/**
 * Evaluate one SLA target. When `metAt` is set the clock has stopped, so the
 * verdict is fixed: breached only if it stopped after the deadline.
 */
export function evaluateTarget(
  sla: SlaLike,
  priority: SlaPriority,
  kind: SlaTargetKind,
  openedAt: Date,
  now: Date,
  opts: { metAt?: Date | null; pausedMinutes?: number; riskFraction?: number } = {},
): SlaState {
  const target = targetMinutes(sla, priority, kind);
  if (target == null) {
    return { remainingMinutes: null, breached: false, atRisk: false };
  }
  const paused = opts.pausedMinutes ?? 0;
  const riskFraction = opts.riskFraction ?? 0.25;
  const stopAt = opts.metAt ?? now;
  const used = elapsedMinutes(sla, openedAt, stopAt, paused);
  const remaining = target - used;
  if (opts.metAt) {
    // Clock stopped — the outcome is settled, so nothing is "at risk".
    return { remainingMinutes: remaining, breached: remaining < 0, atRisk: false };
  }
  return {
    remainingMinutes: remaining,
    breached: remaining < 0,
    atRisk: remaining >= 0 && remaining <= target * riskFraction,
  };
}

/**
 * Additional paused minutes contributed by a stretch spent in a clock-stopping
 * status, measured in business minutes so it cancels out cleanly.
 */
export function pausedMinutesFor(
  sla: SlaLike,
  pausedAt: Date,
  resumedAt: Date,
): number {
  return businessMinutesBetween(calendarFor(sla), pausedAt, resumedAt);
}
