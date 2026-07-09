import { describe, it, expect } from "vitest";
import { costChanges, hasCostChange } from "@/lib/licensing/cost-change";

describe("costChanges", () => {
  it("returns nothing without a previous snapshot", () => {
    expect(costChanges({ unitCost: 10, customerPrice: 15 }, null)).toEqual([]);
  });

  it("returns nothing when unchanged", () => {
    expect(
      costChanges({ unitCost: 10, customerPrice: 15 }, { unitCost: 10, customerPrice: 15 }),
    ).toEqual([]);
  });

  it("detects an increase in our cost", () => {
    const c = costChanges(
      { unitCost: 12, customerPrice: 15 },
      { unitCost: 10, customerPrice: 15 },
    )[0]!;
    expect(c).toMatchObject({ field: "unitCost", previous: 10, current: 12, delta: 2, direction: "up", pct: 20 });
  });

  it("detects a decrease in customer price", () => {
    const c = costChanges(
      { unitCost: 10, customerPrice: 12 },
      { unitCost: 10, customerPrice: 15 },
    )[0]!;
    expect(c).toMatchObject({ field: "customerPrice", previous: 15, current: 12, delta: -3, direction: "down" });
    expect(c.pct).toBe(-20);
  });

  it("reports both fields when both change", () => {
    const changes = costChanges(
      { unitCost: 11, customerPrice: 16 },
      { unitCost: 10, customerPrice: 15 },
    );
    expect(changes.map((c) => c.field)).toEqual(["unitCost", "customerPrice"]);
  });

  it("skips comparison when a figure is missing on either side", () => {
    expect(costChanges({ unitCost: null, customerPrice: 15 }, { unitCost: 10, customerPrice: 15 })).toEqual([]);
    expect(costChanges({ unitCost: 10, customerPrice: 15 }, { unitCost: null, customerPrice: 15 })).toEqual([]);
  });

  it("uses null pct when previous is zero", () => {
    const c = costChanges({ unitCost: 5, customerPrice: 15 }, { unitCost: 0, customerPrice: 15 })[0]!;
    expect(c.pct).toBeNull();
  });

  it("hasCostChange mirrors costChanges", () => {
    expect(hasCostChange({ unitCost: 12, customerPrice: 15 }, { unitCost: 10, customerPrice: 15 })).toBe(true);
    expect(hasCostChange({ unitCost: 10, customerPrice: 15 }, { unitCost: 10, customerPrice: 15 })).toBe(false);
  });
});
