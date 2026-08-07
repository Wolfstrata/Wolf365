import { describe, it, expect } from "vitest";
import {
  classifyTimeBand,
  formatDecimalHours,
  formatHours,
  hoursBetween,
  parseHours,
  quickHourLabel,
  roundHours,
  stepQuarterHours,
  toWorkDate,
  weekStartOf,
} from "@/lib/silverfang/time";
import { weekdayWindows, type BusinessCalendar } from "@/lib/silverfang/business-hours";

describe("parseHours", () => {
  it("parses decimals, commas and numbers", () => {
    expect(parseHours("1.5")).toBe(1.5);
    expect(parseHours("1,5")).toBe(1.5);
    expect(parseHours(2)).toBe(2);
  });
  it("parses colon form", () => {
    expect(parseHours("1:30")).toBe(1.5);
    expect(parseHours("0:45")).toBe(0.75);
  });
  it("parses h/m forms", () => {
    expect(parseHours("90m")).toBe(1.5);
    expect(parseHours("90min")).toBe(1.5);
    expect(parseHours("1h30m")).toBe(1.5);
    expect(parseHours("2h")).toBe(2);
  });
  it("rejects junk and non-positive values", () => {
    for (const v of ["", "   ", "abc", "0", "-1", null, undefined]) {
      expect(parseHours(v as string)).toBeNull();
    }
  });
});

describe("roundHours", () => {
  it("rounds up to the next 15-minute increment by default", () => {
    expect(roundHours(0.1)).toBe(0.25);
    expect(roundHours(0.25)).toBe(0.25);
    expect(roundHours(0.26)).toBe(0.5);
    expect(roundHours(1.5)).toBe(1.5);
    expect(roundHours(1.51)).toBe(1.75);
  });
  it("honors other increments and no rounding", () => {
    expect(roundHours(0.1, 30)).toBe(0.5);
    expect(roundHours(1.05, 60)).toBe(2);
    expect(roundHours(1.234, 0)).toBe(1.234);
  });
  it("returns 0 for non-positive input", () => {
    expect(roundHours(0)).toBe(0);
    expect(roundHours(-1)).toBe(0);
  });
});

describe("formatting", () => {
  it("formats hours and minutes", () => {
    expect(formatHours(1.5)).toBe("1h 30m");
    expect(formatHours(2)).toBe("2h");
    expect(formatHours(0.5)).toBe("30m");
    expect(formatHours(0)).toBe("0h");
    expect(formatHours(null)).toBe("0h");
  });
  it("formats decimal hours", () => {
    expect(formatDecimalHours(1.5)).toBe("1.50");
    expect(formatDecimalHours(null)).toBe("0.00");
  });
});

describe("hoursBetween", () => {
  it("computes elapsed hours and clamps reversed ranges", () => {
    const a = new Date("2026-08-05T13:00:00Z");
    const b = new Date("2026-08-05T14:30:00Z");
    expect(hoursBetween(a, b)).toBe(1.5);
    expect(hoursBetween(b, a)).toBe(0);
  });
});

describe("classifyTimeBand", () => {
  const TZ = "America/Winnipeg";
  const cal: BusinessCalendar = {
    windows: weekdayWindows(480, 1020, TZ),
    holidays: [new Date("2026-08-06T00:00:00Z")],
    timezone: TZ,
  };
  it("classifies day, after-hours, weekend and holiday", () => {
    expect(classifyTimeBand(cal, new Date("2026-08-05T15:00:00Z"))).toBe("DAY"); // Wed 10:00
    expect(classifyTimeBand(cal, new Date("2026-08-06T03:00:00Z"))).toBe("AFTER_HOURS"); // Wed 22:00
    expect(classifyTimeBand(cal, new Date("2026-08-08T17:00:00Z"))).toBe("WEEKEND"); // Sat
    expect(classifyTimeBand(cal, new Date("2026-08-06T15:00:00Z"))).toBe("HOLIDAY"); // Thu holiday
  });
});

describe("weekStartOf / toWorkDate", () => {
  it("returns Monday UTC midnight for any day of the week", () => {
    // 2026-08-05 is a Wednesday; its week starts Monday 2026-08-03.
    expect(weekStartOf(new Date("2026-08-05T23:59:00Z")).toISOString()).toBe(
      "2026-08-03T00:00:00.000Z",
    );
    // Sunday belongs to the week that started the previous Monday.
    expect(weekStartOf(new Date("2026-08-09T12:00:00Z")).toISOString()).toBe(
      "2026-08-03T00:00:00.000Z",
    );
    // Monday maps to itself.
    expect(weekStartOf(new Date("2026-08-10T08:00:00Z")).toISOString()).toBe(
      "2026-08-10T00:00:00.000Z",
    );
  });
  it("normalizes a work date to UTC midnight", () => {
    expect(toWorkDate(new Date("2026-08-05T18:42:11Z")).toISOString()).toBe(
      "2026-08-05T00:00:00.000Z",
    );
  });
});

describe("quickHourLabel", () => {
  it("labels sub-hour blocks in minutes", () => {
    expect(quickHourLabel(0.25)).toBe("15m");
    expect(quickHourLabel(0.5)).toBe("30m");
    expect(quickHourLabel(0.75)).toBe("45m");
  });

  it("labels whole and part hours", () => {
    expect(quickHourLabel(1)).toBe("1h");
    expect(quickHourLabel(1.5)).toBe("1h30");
    expect(quickHourLabel(2.25)).toBe("2h15");
    expect(quickHourLabel(8)).toBe("8h");
  });
});

describe("stepQuarterHours", () => {
  it("walks the quarter-hour grid upward", () => {
    expect(stepQuarterHours(0.25, 1)).toBe(0.5);
    expect(stepQuarterHours(1, 1)).toBe(1.25);
  });

  it("walks downward and never below one block", () => {
    expect(stepQuarterHours(0.5, -1)).toBe(0.25);
    expect(stepQuarterHours(0.25, -1)).toBe(0.25);
    expect(stepQuarterHours(0, -1)).toBe(0.25);
    expect(stepQuarterHours(null, -1)).toBe(0.25);
  });

  it("snaps an off-grid value onto the grid in the direction of travel", () => {
    // 0.3h is 18 minutes: up lands on 30m, down lands on 15m.
    expect(stepQuarterHours(0.3, 1)).toBe(0.5);
    expect(stepQuarterHours(0.3, -1)).toBe(0.25);
  });

  it("starts from one block when nothing is entered yet", () => {
    expect(stepQuarterHours(null, 1)).toBe(0.25);
  });
});
