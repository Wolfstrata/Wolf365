import { describe, it, expect } from "vitest";
import {
  parseSeatDelta,
  monthlySeatAdditions,
  totalSeatsAddedThisMonth,
} from "@/lib/billing/changelog";

describe("parseSeatDelta", () => {
  it("parses singular and plural additions", () => {
    expect(parseSeatDelta("Add 1 seat")).toBe(1);
    expect(parseSeatDelta("Add 3 seats")).toBe(3);
    expect(parseSeatDelta("Add 8 seats")).toBe(8);
  });

  it("parses removals as negative", () => {
    expect(parseSeatDelta("Remove 2 seats")).toBe(-2);
    expect(parseSeatDelta("Reduce 1 seat")).toBe(-1);
  });

  it("returns 0 for non-seat entries", () => {
    expect(parseSeatDelta("Set to Renew with current plan")).toBe(0);
    expect(parseSeatDelta("Send Renewal Notification")).toBe(0);
    expect(parseSeatDelta(null)).toBe(0);
    expect(parseSeatDelta("")).toBe(0);
  });

  it("is case-insensitive and tolerant of surrounding text", () => {
    expect(parseSeatDelta("added 5 SEATS to the plan")).toBe(5);
  });
});

describe("monthlySeatAdditions", () => {
  const monthStart = new Date("2026-07-01T00:00:00.000Z");
  const monthEnd = new Date("2026-08-01T00:00:00.000Z");

  const entries = [
    { changeLog: "Add 1 seat", entryDatetime: new Date("2026-07-09T15:21:25.733Z") },
    { changeLog: "Add 3 seats", entryDatetime: new Date("2026-06-30T15:21:24.970Z") }, // prior month
    { changeLog: "Set to Renew with current plan", entryDatetime: new Date("2026-07-15T12:00:00Z") },
    { changeLog: "Remove 2 seats", entryDatetime: new Date("2026-07-20T12:00:00Z") }, // removal ignored
    { changeLog: "Add 2 seats", entryDatetime: new Date("2026-07-28T12:00:00Z") },
  ];

  it("returns only positive seat adds within the month", () => {
    const adds = monthlySeatAdditions(entries, monthStart, monthEnd);
    expect(adds).toHaveLength(2);
    expect(adds.map((a) => a.seats)).toEqual([1, 2]);
  });

  it("excludes prior-month and next-month entries at the boundaries", () => {
    const boundary = [
      { changeLog: "Add 4 seats", entryDatetime: monthStart }, // inclusive start
      { changeLog: "Add 9 seats", entryDatetime: monthEnd }, // exclusive end
    ];
    const adds = monthlySeatAdditions(boundary, monthStart, monthEnd);
    expect(adds.map((a) => a.seats)).toEqual([4]);
  });

  it("sums seats added this month", () => {
    expect(totalSeatsAddedThisMonth(entries, monthStart, monthEnd)).toBe(3);
  });
});
