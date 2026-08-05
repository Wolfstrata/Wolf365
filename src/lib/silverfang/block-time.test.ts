import { describe, it, expect } from "vitest";
import {
  availableHours,
  blockBalance,
  overageHours,
  planDraw,
  type BlockLike,
} from "@/lib/silverfang/block-time";

const NOW = new Date("2026-08-05T12:00:00Z");

const block = (over: Partial<BlockLike> & { id: string }): BlockLike => ({
  purchasedHours: 10,
  purchasedAt: new Date("2026-01-01T00:00:00Z"),
  hoursUsed: 0,
  ...over,
});

describe("blockBalance", () => {
  it("derives remaining hours and never goes negative", () => {
    expect(blockBalance(block({ id: "b1", hoursUsed: 4 }), NOW)).toMatchObject({
      hoursRemaining: 6,
      expired: false,
    });
    expect(blockBalance(block({ id: "b1", hoursUsed: 12 }), NOW).hoursRemaining).toBe(0);
  });

  it("flags an expired block", () => {
    const expired = block({ id: "b1", expiresAt: new Date("2026-07-01T00:00:00Z") });
    expect(blockBalance(expired, NOW).expired).toBe(true);
  });
});

describe("availableHours", () => {
  it("sums unexpired remaining hours only", () => {
    const blocks = [
      block({ id: "b1", hoursUsed: 4 }), // 6 left
      block({ id: "b2", purchasedHours: 5 }), // 5 left
      block({ id: "b3", expiresAt: new Date("2026-07-01T00:00:00Z") }), // expired
    ];
    expect(availableHours(blocks, NOW)).toBe(11);
  });
});

describe("planDraw", () => {
  it("draws from a single block when it covers the hours", () => {
    const plan = planDraw([block({ id: "b1" })], 3, NOW);
    expect(plan).toEqual({ allocations: [{ blockId: "b1", hours: 3 }], overageHours: 0 });
  });

  it("consumes the soonest-expiring block first", () => {
    const blocks = [
      block({ id: "later", expiresAt: new Date("2026-12-31T00:00:00Z"), purchasedHours: 10 }),
      block({ id: "sooner", expiresAt: new Date("2026-09-01T00:00:00Z"), purchasedHours: 4 }),
    ];
    const plan = planDraw(blocks, 6, NOW);
    expect(plan.allocations).toEqual([
      { blockId: "sooner", hours: 4 },
      { blockId: "later", hours: 2 },
    ]);
    expect(plan.overageHours).toBe(0);
  });

  it("falls back to purchase order when expiry ties", () => {
    const blocks = [
      block({ id: "new", purchasedAt: new Date("2026-06-01T00:00:00Z"), purchasedHours: 5 }),
      block({ id: "old", purchasedAt: new Date("2026-01-01T00:00:00Z"), purchasedHours: 5 }),
    ];
    expect(planDraw(blocks, 7, NOW).allocations[0]).toEqual({ blockId: "old", hours: 5 });
  });

  it("reports overage rather than driving a block negative", () => {
    const plan = planDraw([block({ id: "b1", purchasedHours: 2 })], 5, NOW);
    expect(plan.allocations).toEqual([{ blockId: "b1", hours: 2 }]);
    expect(plan.overageHours).toBe(3);
  });

  it("treats all hours as overage when no block is usable", () => {
    const expired = block({ id: "b1", expiresAt: new Date("2026-07-01T00:00:00Z") });
    expect(planDraw([expired], 4, NOW)).toEqual({ allocations: [], overageHours: 4 });
    expect(planDraw([], 4, NOW)).toEqual({ allocations: [], overageHours: 4 });
  });

  it("does nothing for non-positive hours", () => {
    expect(planDraw([block({ id: "b1" })], 0, NOW)).toEqual({ allocations: [], overageHours: 0 });
  });
});

describe("overageHours", () => {
  it("subtracts the included allowance", () => {
    expect(overageHours(12, 10)).toBe(2);
    expect(overageHours(8, 10)).toBe(0);
  });
  it("treats a missing allowance as fully billable", () => {
    expect(overageHours(6, null)).toBe(6);
    expect(overageHours(6, undefined)).toBe(6);
  });
});
