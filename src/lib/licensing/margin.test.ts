import { describe, it, expect } from "vitest";
import {
  MARGIN_EXCEPTION_PCT,
  marginPercent,
  isMarginException,
} from "@/lib/licensing/margin";

describe("marginPercent", () => {
  it("computes margin on price", () => {
    expect(marginPercent(90, 100)).toBeCloseTo(10);
    expect(marginPercent(97, 100)).toBeCloseTo(3);
    expect(marginPercent(50, 100)).toBeCloseTo(50);
  });

  it("is negative when sold under cost", () => {
    expect(marginPercent(120, 100)).toBeCloseTo(-20);
  });

  it("returns null when an input is missing or NaN", () => {
    expect(marginPercent(null, 100)).toBeNull();
    expect(marginPercent(10, undefined)).toBeNull();
    expect(marginPercent(Number.NaN, 100)).toBeNull();
  });

  it("handles a non-positive price", () => {
    expect(marginPercent(5, 0)).toBe(-100); // cost with no revenue = total loss
    expect(marginPercent(0, 0)).toBe(0);
  });
});

describe("isMarginException", () => {
  it("flags lines at or below 3% margin", () => {
    expect(isMarginException(97, 100)).toBe(true); // exactly 3%
    expect(isMarginException(98, 100)).toBe(true); // 2%
    expect(isMarginException(120, 100)).toBe(true); // under cost
  });

  it("does not flag healthy margins", () => {
    expect(isMarginException(90, 100)).toBe(false); // 10%
    expect(isMarginException(96, 100)).toBe(false); // 4%
  });

  it("does not flag when data is missing", () => {
    expect(isMarginException(null, 100)).toBe(false);
    expect(isMarginException(10, null)).toBe(false);
  });

  it("uses MARGIN_EXCEPTION_PCT as the threshold", () => {
    // A line exactly at the threshold is flagged.
    const priceAtThreshold = 100;
    const costAtThreshold = priceAtThreshold * (1 - MARGIN_EXCEPTION_PCT / 100);
    expect(isMarginException(costAtThreshold, priceAtThreshold)).toBe(true);
  });
});
