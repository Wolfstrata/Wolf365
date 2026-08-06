import { describe, it, expect } from "vitest";
import {
  canSubmit,
  isoDateKey,
  parseDateKey,
  shiftWeeks,
  totalsFor,
  weekDays,
  weekRange,
} from "./timesheet";

const MONDAY = new Date(Date.UTC(2026, 7, 3)); // 2026-08-03

describe("weekDays", () => {
  it("returns Monday-first days with weekend flags", () => {
    const days = weekDays(MONDAY);
    expect(days).toHaveLength(7);
    expect(days[0]!.label).toBe("Mon");
    expect(days[0]!.key).toBe("2026-08-03");
    expect(days[6]!.label).toBe("Sun");
    expect(days[6]!.key).toBe("2026-08-09");
    expect(days.filter((d) => d.weekend).map((d) => d.label)).toEqual(["Sat", "Sun"]);
  });

  it("advances one calendar day at a time across a month boundary", () => {
    const days = weekDays(new Date(Date.UTC(2026, 7, 31)));
    expect(days.map((d) => d.key)).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });
});

describe("date keys", () => {
  it("round-trips", () => {
    expect(parseDateKey(isoDateKey(MONDAY))).toEqual(MONDAY);
  });

  it("rejects rubbish", () => {
    for (const v of ["", "not-a-date", "2026-8-3", null, undefined]) {
      expect(parseDateKey(v as string)).toBeNull();
    }
  });

  it("parses to UTC midnight, so a day never shifts", () => {
    const d = parseDateKey("2026-08-03")!;
    expect(d.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });
});

describe("shiftWeeks / weekRange", () => {
  it("moves whole weeks in both directions", () => {
    expect(isoDateKey(shiftWeeks(MONDAY, 1))).toBe("2026-08-10");
    expect(isoDateKey(shiftWeeks(MONDAY, -1))).toBe("2026-07-27");
    expect(isoDateKey(shiftWeeks(MONDAY, 0))).toBe("2026-08-03");
  });

  it("bounds a week half-open, so a Sunday entry is included and next Monday is not", () => {
    const { gte, lt } = weekRange(MONDAY);
    expect(gte.toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });
});

describe("totalsFor", () => {
  it("splits billable from non-billable and totals per day", () => {
    const t = totalsFor([
      { workDate: new Date(Date.UTC(2026, 7, 3)), hours: 1.5, billable: true },
      { workDate: new Date(Date.UTC(2026, 7, 3)), hours: 0.5, billable: false },
      { workDate: new Date(Date.UTC(2026, 7, 4)), hours: 2, billable: true },
    ]);
    expect(t.totalHours).toBe(4);
    expect(t.billableHours).toBe(3.5);
    expect(t.nonBillableHours).toBe(0.5);
    expect(t.byDay).toEqual({ "2026-08-03": 2, "2026-08-04": 2 });
  });

  it("handles an empty week", () => {
    expect(totalsFor([])).toEqual({
      totalHours: 0,
      billableHours: 0,
      nonBillableHours: 0,
      byDay: {},
    });
  });

  it("does not accumulate floating-point drift", () => {
    const entries = Array.from({ length: 3 }, () => ({
      workDate: MONDAY,
      hours: 0.1,
      billable: true,
    }));
    expect(totalsFor(entries).totalHours).toBe(0.3);
  });
});

describe("canSubmit", () => {
  it("allows an open week with time on it", () => {
    expect(canSubmit({ status: "OPEN", entryCount: 3 })).toEqual({ ok: true });
    expect(canSubmit({ status: "REJECTED", entryCount: 1 })).toEqual({ ok: true });
  });

  it("refuses an empty week", () => {
    const r = canSubmit({ status: "OPEN", entryCount: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no time logged");
  });

  it("refuses a week already submitted or approved", () => {
    expect(canSubmit({ status: "SUBMITTED", entryCount: 5 }).ok).toBe(false);
    expect(canSubmit({ status: "APPROVED", entryCount: 5 }).ok).toBe(false);
  });
});
