import { describe, it, expect } from "vitest";
import { parsePeriod, periodRange } from "@/app/(app)/silverfang/reports/period";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("parsePeriod", () => {
  it("accepts the known keys", () => {
    expect(parsePeriod("last-month")).toBe("last-month");
    expect(parsePeriod("this-year")).toBe("this-year");
  });

  it("falls back to this month for anything else", () => {
    expect(parsePeriod(undefined)).toBe("this-month");
    expect(parsePeriod("")).toBe("this-month");
    expect(parsePeriod("../../etc/passwd")).toBe("this-month");
  });
});

describe("periodRange", () => {
  const now = new Date("2026-08-07T15:00:00Z");

  it("bounds this month half-open", () => {
    const r = periodRange("this-month", now);
    expect(iso(r.start)).toBe("2026-08-01");
    // Exclusive end: the 1st of the next month, so the 31st is included exactly once.
    expect(iso(r.end)).toBe("2026-09-01");
  });

  it("bounds last month", () => {
    const r = periodRange("last-month", now);
    expect(iso(r.start)).toBe("2026-07-01");
    expect(iso(r.end)).toBe("2026-08-01");
  });

  it("includes today in the last 90 days", () => {
    // A report that ends at midnight this morning omits today's work and reads as
    // if nobody has logged anything yet.
    const r = periodRange("last-90", now);
    expect(iso(r.end)).toBe("2026-08-08");
    expect(r.start < now).toBe(true);
    const days = (r.end.getTime() - r.start.getTime()) / 86_400_000;
    expect(days).toBe(90);
  });

  it("bounds this year", () => {
    const r = periodRange("this-year", now);
    expect(iso(r.start)).toBe("2026-01-01");
    expect(iso(r.end)).toBe("2027-01-01");
  });

  it("rolls the year back correctly in January", () => {
    const r = periodRange("last-month", new Date("2026-01-15T00:00:00Z"));
    expect(iso(r.start)).toBe("2025-12-01");
    expect(iso(r.end)).toBe("2026-01-01");
  });

  it("never produces an inverted or empty range", () => {
    for (const key of ["this-month", "last-month", "last-90", "this-year"] as const) {
      const r = periodRange(key, now);
      expect(r.start.getTime(), key).toBeLessThan(r.end.getTime());
    }
  });
});
