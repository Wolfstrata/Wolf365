import { describe, it, expect } from "vitest";
import { daysUntilRenewal, renewalWindow, isMonthToMonth, isExpired, isActiveStatus } from "@/lib/licensing/renewal";

const now = new Date("2026-07-09T00:00:00.000Z");
const inDays = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

describe("daysUntilRenewal", () => {
  it("returns null when there is no renewal date", () => {
    expect(daysUntilRenewal(null, now)).toBeNull();
    expect(daysUntilRenewal(undefined, now)).toBeNull();
  });

  it("counts whole days ahead", () => {
    expect(daysUntilRenewal(inDays(30), now)).toBe(30);
    expect(daysUntilRenewal(inDays(1), now)).toBe(1);
  });

  it("is negative for past renewals", () => {
    expect(daysUntilRenewal(inDays(-5), now)).toBe(-5);
  });
});

describe("renewalWindow", () => {
  it("returns null with no date, when past, or beyond 90 days", () => {
    expect(renewalWindow(null, now)).toBeNull();
    expect(renewalWindow(inDays(-1), now)).toBeNull();
    expect(renewalWindow(inDays(91), now)).toBeNull();
  });

  it("buckets by the tightest threshold", () => {
    expect(renewalWindow(inDays(0), now)?.bucket).toBe(30);
    expect(renewalWindow(inDays(30), now)?.bucket).toBe(30);
    expect(renewalWindow(inDays(31), now)?.bucket).toBe(60);
    expect(renewalWindow(inDays(60), now)?.bucket).toBe(60);
    expect(renewalWindow(inDays(61), now)?.bucket).toBe(90);
    expect(renewalWindow(inDays(90), now)?.bucket).toBe(90);
  });

  it("reports daysUntil alongside the bucket", () => {
    expect(renewalWindow(inDays(45), now)).toEqual({ daysUntil: 45, bucket: 60 });
  });
});

describe("isMonthToMonth", () => {
  it("is true for monthly commitment terms (case/label insensitive)", () => {
    expect(isMonthToMonth("month", null)).toBe(true);
    expect(isMonthToMonth("Monthly", null)).toBe(true);
    expect(isMonthToMonth(null, "MONTH")).toBe(true);
  });

  it("is false for annual, triennial, one-time, or unknown terms", () => {
    expect(isMonthToMonth("annual", null)).toBe(false);
    expect(isMonthToMonth("triennial", null)).toBe(false);
    expect(isMonthToMonth("one_time", null)).toBe(false);
    expect(isMonthToMonth(null, null)).toBe(false);
  });

  it("prefers the commitment term over billing frequency", () => {
    // Annual commitment billed monthly still renews annually.
    expect(isMonthToMonth("annual", "monthly")).toBe(false);
  });
});

describe("isExpired", () => {
  it("is true when the end/renewal date is in the past", () => {
    expect(isExpired(inDays(-1), null, now)).toBe(true);
    expect(isExpired(inDays(-90), "active", now)).toBe(true);
  });

  it("is true for an explicit expired status even without a date", () => {
    expect(isExpired(null, "expired", now)).toBe(true);
    expect(isExpired(null, "Expired", now)).toBe(true);
  });

  it("is false for future or missing dates with a non-expired status", () => {
    expect(isExpired(inDays(30), null, now)).toBe(false);
    expect(isExpired(inDays(0), "active", now)).toBe(false);
    expect(isExpired(null, null, now)).toBe(false);
  });
});

describe("isActiveStatus", () => {
  it("is true for active, unknown, or missing statuses (null = active)", () => {
    expect(isActiveStatus("active")).toBe(true);
    expect(isActiveStatus("ACTIVE")).toBe(true);
    expect(isActiveStatus("  Active ")).toBe(true);
    expect(isActiveStatus("provisioned")).toBe(true);
    expect(isActiveStatus("")).toBe(true);
    expect(isActiveStatus(null)).toBe(true);
    expect(isActiveStatus(undefined)).toBe(true);
  });

  it("is false only for explicitly inactive statuses", () => {
    expect(isActiveStatus("expired")).toBe(false);
    expect(isActiveStatus("cancelled")).toBe(false);
    expect(isActiveStatus("suspended")).toBe(false);
    expect(isActiveStatus("inactive")).toBe(false);
    expect(isActiveStatus("discontinued")).toBe(false);
  });
});
