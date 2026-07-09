import { describe, it, expect } from "vitest";
import { extractMsrp } from "@/lib/licensing/msrp";

describe("extractMsrp", () => {
  it("returns null for non-objects", () => {
    expect(extractMsrp(null)).toBeNull();
    expect(extractMsrp(undefined)).toBeNull();
    expect(extractMsrp("x")).toBeNull();
  });

  it("reads known keys", () => {
    expect(extractMsrp({ msrp: 65 })).toBe(65);
    expect(extractMsrp({ MSRP: "14.28" })).toBe(14.28);
    expect(extractMsrp({ listPrice: 8.51 })).toBe(8.51);
    expect(extractMsrp({ suggestedRetailPrice: 595.7 })).toBe(595.7);
  });

  it("falls back to a case-insensitive msrp/retail key", () => {
    expect(extractMsrp({ Msrp_Unit: 21.42 })).toBe(21.42);
    expect(extractMsrp({ retailPricePerSeat: 17.85 })).toBe(17.85);
  });

  it("returns null when nothing looks like MSRP", () => {
    expect(extractMsrp({ unitCost: 10, customerPrice: 12 })).toBeNull();
  });

  it("ignores non-numeric values", () => {
    expect(extractMsrp({ msrp: "Usage Driven" })).toBeNull();
  });
});
