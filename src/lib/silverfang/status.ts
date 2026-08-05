/**
 * Ticket, time-entry and timesheet state machines.
 *
 * Mirrors src/lib/billing/state.ts: structurally illegal transitions throw, and
 * RBAC is enforced separately by the caller. Ticket *statuses* are user-defined
 * rows (SfStatus), so the ticket machine works on the lifecycle flags a status
 * carries rather than a fixed enum.
 */
import type { SfTimeEntryStatus, SfTimesheetStatus } from "@prisma/client";

/** The lifecycle-relevant shape of a configurable ticket status. */
export interface StatusLike {
  id: string;
  name: string;
  isOpen: boolean;
  isClosed: boolean;
  stopsSlaClock: boolean;
}

/**
 * Whether a ticket may move between two configurable statuses. Closed is
 * terminal-ish: reopening is allowed (support reality), but only explicitly.
 */
export function canTransitionTicket(from: StatusLike, to: StatusLike): boolean {
  if (from.id === to.id) return false; // no-op is not a transition
  return true;
}

export function assertTicketTransition(from: StatusLike, to: StatusLike): void {
  if (!canTransitionTicket(from, to)) {
    throw new Error(`Illegal ticket status transition: ${from.name} -> ${to.name}`);
  }
}

/** True when moving into `to` closes the ticket. */
export function closesTicket(from: StatusLike, to: StatusLike): boolean {
  return !from.isClosed && to.isClosed;
}

/** True when moving out of a closed status reopens the ticket. */
export function reopensTicket(from: StatusLike, to: StatusLike): boolean {
  return from.isClosed && !to.isClosed;
}

/** True when the SLA clock should pause on entering `to`. */
export function pausesSlaClock(from: StatusLike, to: StatusLike): boolean {
  return !from.stopsSlaClock && to.stopsSlaClock;
}

/** True when the SLA clock should resume on entering `to`. */
export function resumesSlaClock(from: StatusLike, to: StatusLike): boolean {
  return from.stopsSlaClock && !to.stopsSlaClock;
}

// --- Time entries ----------------------------------------------------------
// INVOICED is terminal: once time is on an invoice it must not be rewritten.

const TIME_ENTRY_TRANSITIONS: Record<SfTimeEntryStatus, SfTimeEntryStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED", "DRAFT"],
  REJECTED: ["DRAFT", "SUBMITTED"],
  APPROVED: ["INVOICED", "SUBMITTED"],
  INVOICED: [], // terminal
};

export function canTransitionTimeEntry(
  from: SfTimeEntryStatus,
  to: SfTimeEntryStatus,
): boolean {
  return TIME_ENTRY_TRANSITIONS[from].includes(to);
}

export function assertTimeEntryTransition(
  from: SfTimeEntryStatus,
  to: SfTimeEntryStatus,
): void {
  if (!canTransitionTimeEntry(from, to)) {
    throw new Error(`Illegal time entry transition: ${from} -> ${to}`);
  }
}

/** Time may only be edited before it is approved/invoiced. */
export function timeEntryEditable(status: SfTimeEntryStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

export function isTimeEntryTerminal(status: SfTimeEntryStatus): boolean {
  return TIME_ENTRY_TRANSITIONS[status].length === 0;
}

// --- Timesheets ------------------------------------------------------------

const TIMESHEET_TRANSITIONS: Record<SfTimesheetStatus, SfTimesheetStatus[]> = {
  OPEN: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED", "OPEN"],
  REJECTED: ["OPEN", "SUBMITTED"],
  APPROVED: [], // terminal
};

export function canTransitionTimesheet(
  from: SfTimesheetStatus,
  to: SfTimesheetStatus,
): boolean {
  return TIMESHEET_TRANSITIONS[from].includes(to);
}

export function assertTimesheetTransition(
  from: SfTimesheetStatus,
  to: SfTimesheetStatus,
): void {
  if (!canTransitionTimesheet(from, to)) {
    throw new Error(`Illegal timesheet transition: ${from} -> ${to}`);
  }
}
