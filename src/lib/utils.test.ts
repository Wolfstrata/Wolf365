import { describe, it, expect } from "vitest";
import { formatDateTime, formatCurrency, formatSortableDateTime } from "@/lib/utils";

const d = new Date("2026-06-17T17:48:00.000Z");

describe("formatDateTime", () => {
  it("formats without throwing (regression: dateStyle + timeZoneName combo)", () => {
    expect(() => formatDateTime(d)).not.toThrow();
    expect(formatDateTime(d)).toMatch(/2026/);
  });

  it("includes a timezone abbreviation", () => {
    // UTC default
    expect(formatDateTime(d)).toMatch(/UTC|GMT/);
  });

  it("respects an explicit IANA timezone", () => {
    const eastern = formatDateTime(d, "America/Toronto");
    expect(eastern).toMatch(/EDT|EST/);
  });

  it("falls back to UTC for an invalid timezone instead of throwing", () => {
    expect(() => formatDateTime(d, "Not/AZone")).not.toThrow();
    expect(formatDateTime(d, "Not/AZone")).toMatch(/UTC|GMT/);
  });

  it("handles null/undefined", () => {
    expect(formatDateTime(null)).toBe("Never");
    expect(formatDateTime(undefined)).toBe("Never");
  });
});

describe("formatSortableDateTime", () => {
  it("produces a lexically-sortable UTC timestamp by default", () => {
    expect(formatSortableDateTime(d)).toBe("2026-06-17 17:48");
  });

  it("respects an explicit IANA timezone", () => {
    // 17:48 UTC = 13:48 EDT
    expect(formatSortableDateTime(d, "America/Toronto")).toBe("2026-06-17 13:48");
  });

  it("falls back to UTC for an invalid timezone instead of throwing", () => {
    expect(() => formatSortableDateTime(d, "Not/AZone")).not.toThrow();
    expect(formatSortableDateTime(d, "Not/AZone")).toBe("2026-06-17 17:48");
  });

  it("handles null/undefined", () => {
    expect(formatSortableDateTime(null)).toBe("—");
    expect(formatSortableDateTime(undefined)).toBe("—");
  });
});

describe("formatCurrency", () => {
  it("formats USD and handles nullish", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
    expect(formatCurrency(null)).toBe("—");
  });
});
