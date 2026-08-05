import { describe, it, expect } from "vitest";
import {
  assertTicketTransition,
  assertTimeEntryTransition,
  assertTimesheetTransition,
  canTransitionTimeEntry,
  canTransitionTimesheet,
  closesTicket,
  isTimeEntryTerminal,
  pausesSlaClock,
  reopensTicket,
  resumesSlaClock,
  timeEntryEditable,
  type StatusLike,
} from "@/lib/silverfang/status";

const s = (over: Partial<StatusLike> & { id: string; name: string }): StatusLike => ({
  isOpen: true,
  isClosed: false,
  stopsSlaClock: false,
  ...over,
});

const NEW = s({ id: "1", name: "New" });
const WAITING = s({ id: "2", name: "Waiting on Client", stopsSlaClock: true });
const CLOSED = s({ id: "3", name: "Closed", isOpen: false, isClosed: true });

describe("ticket transitions", () => {
  it("rejects a no-op transition", () => {
    expect(() => assertTicketTransition(NEW, NEW)).toThrow(/Illegal ticket status transition/);
  });

  it("allows moving between distinct statuses", () => {
    expect(() => assertTicketTransition(NEW, WAITING)).not.toThrow();
    expect(() => assertTicketTransition(CLOSED, NEW)).not.toThrow(); // reopen is allowed
  });

  it("detects close and reopen", () => {
    expect(closesTicket(NEW, CLOSED)).toBe(true);
    expect(closesTicket(CLOSED, CLOSED)).toBe(false);
    expect(reopensTicket(CLOSED, NEW)).toBe(true);
    expect(reopensTicket(NEW, WAITING)).toBe(false);
  });

  it("detects SLA clock pause and resume", () => {
    expect(pausesSlaClock(NEW, WAITING)).toBe(true);
    expect(pausesSlaClock(WAITING, WAITING)).toBe(false);
    expect(resumesSlaClock(WAITING, NEW)).toBe(true);
    expect(resumesSlaClock(NEW, CLOSED)).toBe(false);
  });
});

describe("time entry transitions", () => {
  it("follows the approval lifecycle", () => {
    expect(canTransitionTimeEntry("DRAFT", "SUBMITTED")).toBe(true);
    expect(canTransitionTimeEntry("SUBMITTED", "APPROVED")).toBe(true);
    expect(canTransitionTimeEntry("SUBMITTED", "REJECTED")).toBe(true);
    expect(canTransitionTimeEntry("REJECTED", "DRAFT")).toBe(true);
    expect(canTransitionTimeEntry("APPROVED", "INVOICED")).toBe(true);
  });

  it("blocks illegal jumps and treats INVOICED as terminal", () => {
    expect(canTransitionTimeEntry("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionTimeEntry("DRAFT", "INVOICED")).toBe(false);
    expect(canTransitionTimeEntry("INVOICED", "DRAFT")).toBe(false);
    expect(isTimeEntryTerminal("INVOICED")).toBe(true);
    expect(isTimeEntryTerminal("APPROVED")).toBe(false);
    expect(() => assertTimeEntryTransition("INVOICED", "APPROVED")).toThrow(
      /Illegal time entry transition/,
    );
  });

  it("only allows editing before approval", () => {
    expect(timeEntryEditable("DRAFT")).toBe(true);
    expect(timeEntryEditable("REJECTED")).toBe(true);
    expect(timeEntryEditable("SUBMITTED")).toBe(false);
    expect(timeEntryEditable("APPROVED")).toBe(false);
    expect(timeEntryEditable("INVOICED")).toBe(false);
  });
});

describe("timesheet transitions", () => {
  it("follows submit/approve/reject and treats APPROVED as terminal", () => {
    expect(canTransitionTimesheet("OPEN", "SUBMITTED")).toBe(true);
    expect(canTransitionTimesheet("SUBMITTED", "APPROVED")).toBe(true);
    expect(canTransitionTimesheet("SUBMITTED", "REJECTED")).toBe(true);
    expect(canTransitionTimesheet("REJECTED", "SUBMITTED")).toBe(true);
    expect(canTransitionTimesheet("OPEN", "APPROVED")).toBe(false);
    expect(canTransitionTimesheet("APPROVED", "OPEN")).toBe(false);
    expect(() => assertTimesheetTransition("OPEN", "APPROVED")).toThrow(
      /Illegal timesheet transition/,
    );
  });
});
