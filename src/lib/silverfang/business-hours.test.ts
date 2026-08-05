import { describe, it, expect } from "vitest";
import {
  addBusinessMinutes,
  businessMinutesBetween,
  isHoliday,
  isWeekend,
  isWithinBusinessHours,
  weekdayWindows,
  type BusinessCalendar,
} from "@/lib/silverfang/business-hours";

// Mon–Fri 08:00–17:00 (540 working minutes/day) in Winnipeg (UTC-5 in summer).
const TZ = "America/Winnipeg";
const cal: BusinessCalendar = {
  windows: weekdayWindows(480, 1020, TZ),
  holidays: [],
  timezone: TZ,
};

/** 2026-08-05 is a Wednesday. 13:00Z = 08:00 local (CDT, UTC-5). */
const wedOpen = new Date("2026-08-05T13:00:00Z");

describe("isWithinBusinessHours", () => {
  it("is true inside the window and false before/after", () => {
    expect(isWithinBusinessHours(cal, wedOpen)).toBe(true);
    expect(isWithinBusinessHours(cal, new Date("2026-08-05T17:00:00Z"))).toBe(true); // noon local
    expect(isWithinBusinessHours(cal, new Date("2026-08-05T12:59:00Z"))).toBe(false); // 07:59
    expect(isWithinBusinessHours(cal, new Date("2026-08-05T22:00:00Z"))).toBe(false); // 17:00 (exclusive end)
  });

  it("is false on weekends and holidays", () => {
    const sat = new Date("2026-08-08T17:00:00Z");
    expect(isWithinBusinessHours(cal, sat)).toBe(false);
    expect(isWeekend(cal, sat)).toBe(true);

    const withHoliday: BusinessCalendar = {
      ...cal,
      holidays: [new Date("2026-08-05T00:00:00Z")],
    };
    expect(isHoliday(withHoliday, wedOpen)).toBe(true);
    expect(isWithinBusinessHours(withHoliday, wedOpen)).toBe(false);
  });
});

describe("businessMinutesBetween", () => {
  it("counts only working time within a single day", () => {
    // 08:00 → 12:00 local = 240 working minutes.
    expect(businessMinutesBetween(cal, wedOpen, new Date("2026-08-05T17:00:00Z"))).toBe(240);
  });

  it("excludes evenings between two working days", () => {
    // Wed 16:00 local → Thu 09:00 local = 60 + 60 = 120 working minutes.
    const from = new Date("2026-08-05T21:00:00Z"); // 16:00 Wed
    const to = new Date("2026-08-06T14:00:00Z"); // 09:00 Thu
    expect(businessMinutesBetween(cal, from, to)).toBe(120);
  });

  it("skips the weekend", () => {
    // Fri 16:00 local → Mon 09:00 local = 60 (Fri) + 60 (Mon) = 120.
    const fri = new Date("2026-08-07T21:00:00Z");
    const mon = new Date("2026-08-10T14:00:00Z");
    expect(businessMinutesBetween(cal, fri, mon)).toBe(120);
  });

  it("returns 0 for a reversed or empty range", () => {
    expect(businessMinutesBetween(cal, wedOpen, wedOpen)).toBe(0);
    expect(businessMinutesBetween(cal, new Date("2026-08-06T14:00:00Z"), wedOpen)).toBe(0);
  });

  it("falls back to elapsed time when no calendar is configured", () => {
    const none: BusinessCalendar = { windows: [], holidays: [], timezone: TZ };
    expect(
      businessMinutesBetween(none, wedOpen, new Date("2026-08-05T14:00:00Z")),
    ).toBe(60);
  });
});

describe("addBusinessMinutes", () => {
  it("adds within the same working day", () => {
    // 08:00 + 120 = 10:00 local = 15:00Z.
    expect(addBusinessMinutes(cal, wedOpen, 120).toISOString()).toBe(
      "2026-08-05T15:00:00.000Z",
    );
  });

  it("rolls over to the next working day", () => {
    // Wed 16:00 local + 120 min → 60 left today, 60 into Thu = Thu 09:00 local.
    const from = new Date("2026-08-05T21:00:00Z");
    expect(addBusinessMinutes(cal, from, 120).toISOString()).toBe(
      "2026-08-06T14:00:00.000Z",
    );
  });

  it("skips the weekend", () => {
    // Fri 16:00 local + 120 → Mon 09:00 local.
    const fri = new Date("2026-08-07T21:00:00Z");
    expect(addBusinessMinutes(cal, fri, 120).toISOString()).toBe(
      "2026-08-10T14:00:00.000Z",
    );
  });

  it("starts the clock at the next opening when raised outside hours", () => {
    // Raised Wed 22:00 local (after close) + 60 → Thu 09:00 local.
    const afterHours = new Date("2026-08-06T03:00:00Z");
    expect(addBusinessMinutes(cal, afterHours, 60).toISOString()).toBe(
      "2026-08-06T14:00:00.000Z",
    );
  });

  it("skips a holiday", () => {
    const withHoliday: BusinessCalendar = {
      ...cal,
      holidays: [new Date("2026-08-06T00:00:00Z")], // Thursday off
    };
    // Wed 16:00 + 120 → 60 Wed, then Thu is a holiday, so 60 into Fri.
    const from = new Date("2026-08-05T21:00:00Z");
    expect(addBusinessMinutes(withHoliday, from, 120).toISOString()).toBe(
      "2026-08-07T14:00:00.000Z",
    );
  });

  it("returns the input for non-positive minutes", () => {
    expect(addBusinessMinutes(cal, wedOpen, 0).getTime()).toBe(wedOpen.getTime());
  });

  it("round-trips with businessMinutesBetween", () => {
    for (const mins of [30, 240, 540, 541, 1080, 2000]) {
      const due = addBusinessMinutes(cal, wedOpen, mins);
      expect(businessMinutesBetween(cal, wedOpen, due)).toBe(mins);
    }
  });
});
