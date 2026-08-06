import { describe, expect, it } from "vitest";
import {
  billingPeriodsElapsed,
  defaultPhaseNames,
  depositAmountFor,
  depositStatus,
  effectiveContractedHours,
  hoursUsage,
  hoursVisibleToClient,
  nextBillingDate,
  phaseHoursCoverage,
  phaseHoursReconcile,
  phaseHoursTotal,
  projectTotal,
  remainderAfterDeposit,
  roundHours,
  roundMoney,
  splitHoursAcrossPhases,
} from "./project-billing";

describe("phaseHoursTotal", () => {
  it("sums quantified phases", () => {
    expect(phaseHoursTotal([{ hours: 10 }, { hours: 5.5 }, { hours: 0.25 }])).toBe(15.75);
  });

  it("ignores unquantified phases rather than treating them as zero", () => {
    expect(phaseHoursTotal([{ hours: 10 }, { hours: null }])).toBe(10);
  });

  it("is null when nothing is quantified, so 'unsized' is distinguishable from zero", () => {
    expect(phaseHoursTotal([{ hours: null }, { hours: null }])).toBeNull();
    expect(phaseHoursTotal([])).toBeNull();
    expect(phaseHoursTotal([{ hours: 0 }])).toBe(0);
  });
});

describe("phaseHoursCoverage", () => {
  it("counts sized and unsized phases", () => {
    expect(phaseHoursCoverage([{ hours: 4 }, { hours: null }, { hours: 0 }])).toEqual({
      quantified: 2,
      unquantified: 1,
    });
  });
});

describe("phaseHoursReconcile", () => {
  it("matches when the phases sum to the contracted total", () => {
    expect(phaseHoursReconcile(20, [{ hours: 12 }, { hours: 8 }])).toEqual({
      total: 20,
      matches: true,
      difference: 0,
    });
  });

  it("reports the difference when they disagree", () => {
    const r = phaseHoursReconcile(20, [{ hours: 12 }, { hours: 5 }]);
    expect(r.matches).toBe(false);
    expect(r.difference).toBe(-3);
  });

  it("treats sub-hundredth drift as a match", () => {
    expect(phaseHoursReconcile(10, [{ hours: 10.001 }]).matches).toBe(true);
  });

  it("cannot disagree when either side is unknown", () => {
    expect(phaseHoursReconcile(null, [{ hours: 5 }]).matches).toBe(true);
    expect(phaseHoursReconcile(5, [{ hours: null }]).matches).toBe(true);
  });
});

describe("effectiveContractedHours", () => {
  it("prefers the phase sum, which is the detail the total is built from", () => {
    expect(effectiveContractedHours(30, [{ hours: 12 }, { hours: 8 }])).toBe(20);
  });

  it("falls back to the project figure when no phase is sized", () => {
    expect(effectiveContractedHours(30, [{ hours: null }])).toBe(30);
    expect(effectiveContractedHours(30, [])).toBe(30);
  });

  it("is null when neither exists", () => {
    expect(effectiveContractedHours(null, [])).toBeNull();
  });
});

describe("hoursVisibleToClient", () => {
  it("shows hours on time and materials", () => {
    expect(hoursVisibleToClient("TIME_AND_MATERIALS")).toBe(true);
  });

  it("never shows hours on fixed fee", () => {
    expect(hoursVisibleToClient("FIXED_FEE")).toBe(false);
  });
});

describe("projectTotal", () => {
  it("uses the fixed fee on a fixed-fee project", () => {
    expect(
      projectTotal({ billingType: "FIXED_FEE", fixedFeeAmount: 12_000, budgetAmount: 9_000 }),
    ).toBe(12_000);
  });

  it("uses the budget on time and materials", () => {
    expect(
      projectTotal({ billingType: "TIME_AND_MATERIALS", fixedFeeAmount: 12_000, budgetAmount: 9_000 }),
    ).toBe(9_000);
  });

  it("is null with no figure, rather than inventing one", () => {
    expect(projectTotal({ billingType: "FIXED_FEE", fixedFeeAmount: null, budgetAmount: 9_000 })).toBeNull();
    expect(projectTotal({ billingType: "FIXED_FEE", fixedFeeAmount: 0, budgetAmount: 1 })).toBeNull();
  });
});

describe("depositAmountFor", () => {
  it("takes the percentage of the total", () => {
    expect(depositAmountFor(12_000, 25)).toBe(3_000);
    expect(depositAmountFor(9_999.99, 33.33)).toBe(3_333);
    expect(depositAmountFor(1_234.56, 12.5)).toBe(154.32);
  });

  it("is null without a total or a percentage", () => {
    expect(depositAmountFor(null, 25)).toBeNull();
    expect(depositAmountFor(12_000, null)).toBeNull();
    expect(depositAmountFor(12_000, 0)).toBeNull();
  });
});

describe("depositStatus", () => {
  const total = 10_000;

  it("reports what is outstanding before the deposit is invoiced", () => {
    const s = depositStatus(total, { percent: 20, amount: null, invoicedAt: null });
    expect(s.expected).toBe(2_000);
    expect(s.invoiced).toBeNull();
    expect(s.outstanding).toBe(2_000);
    expect(s.drifted).toBe(false);
  });

  it("keeps the invoiced amount once sent, even if the total changes", () => {
    const invoicedAt = new Date("2026-01-15T00:00:00Z");
    const s = depositStatus(20_000, { percent: 20, amount: 2_000, invoicedAt });
    expect(s.invoiced).toBe(2_000);
    expect(s.outstanding).toBeNull();
    // 20% of the new total would be 4,000 — flagged, not silently rewritten.
    expect(s.drifted).toBe(true);
  });

  it("does not flag drift when the invoiced amount still matches", () => {
    const s = depositStatus(10_000, {
      percent: 20,
      amount: 2_000,
      invoicedAt: new Date("2026-01-15T00:00:00Z"),
    });
    expect(s.drifted).toBe(false);
  });

  it("has nothing to report with no deposit configured", () => {
    const s = depositStatus(total, { percent: null, amount: null, invoicedAt: null });
    expect(s.expected).toBeNull();
    expect(s.outstanding).toBeNull();
  });
});

describe("remainderAfterDeposit", () => {
  it("treats the deposit as a payment against the total", () => {
    expect(remainderAfterDeposit(10_000, 2_000)).toBe(8_000);
  });

  it("counts the whole total when no deposit was taken", () => {
    expect(remainderAfterDeposit(10_000, null)).toBe(10_000);
  });

  it("never goes negative", () => {
    expect(remainderAfterDeposit(1_000, 5_000)).toBe(0);
  });

  it("is null with no total", () => {
    expect(remainderAfterDeposit(null, 500)).toBeNull();
  });
});

describe("nextBillingDate", () => {
  const start = new Date("2026-01-01T00:00:00Z");

  it("counts from the last invoice", () => {
    expect(
      nextBillingDate({
        startDate: start,
        lastBilledAt: new Date("2026-03-01T00:00:00Z"),
        intervalDays: 30,
      })?.toISOString(),
    ).toBe("2026-03-31T00:00:00.000Z");
  });

  it("counts from the start when nothing has been billed", () => {
    expect(
      nextBillingDate({ startDate: start, lastBilledAt: null, intervalDays: 30 })?.toISOString(),
    ).toBe("2026-01-31T00:00:00.000Z");
  });

  it("falls back to 30 days on a nonsense interval", () => {
    expect(
      nextBillingDate({ startDate: start, lastBilledAt: null, intervalDays: 0 })?.toISOString(),
    ).toBe("2026-01-31T00:00:00.000Z");
  });

  it("is null with no anchor date", () => {
    expect(nextBillingDate({ startDate: null, lastBilledAt: null, intervalDays: 30 })).toBeNull();
  });
});

describe("billingPeriodsElapsed", () => {
  const start = new Date("2026-01-01T00:00:00Z");

  it("counts the current period from day one", () => {
    expect(billingPeriodsElapsed({ startDate: start, asOf: start, intervalDays: 30 })).toBe(1);
    expect(
      billingPeriodsElapsed({
        startDate: start,
        asOf: new Date("2026-01-31T00:00:00Z"),
        intervalDays: 30,
      }),
    ).toBe(2);
  });

  it("is zero before the project starts, and with no start date", () => {
    expect(
      billingPeriodsElapsed({
        startDate: start,
        asOf: new Date("2025-12-01T00:00:00Z"),
        intervalDays: 30,
      }),
    ).toBe(0);
    expect(billingPeriodsElapsed({ startDate: null, asOf: start, intervalDays: 30 })).toBe(0);
  });
});

describe("hoursUsage", () => {
  it("reports remaining hours inside the contract", () => {
    const u = hoursUsage(12, 20);
    expect(u.remaining).toBe(8);
    expect(u.overage).toBe(0);
    expect(u.ratio).toBeCloseTo(0.6);
  });

  it("reports overage rather than hiding it", () => {
    const u = hoursUsage(25, 20);
    expect(u.remaining).toBe(0);
    expect(u.overage).toBe(5);
    expect(u.ratio).toBe(1);
  });

  it("has nothing to measure against with no contracted quantity", () => {
    const u = hoursUsage(12, null);
    expect(u.remaining).toBeNull();
    expect(u.ratio).toBeNull();
    expect(u.overage).toBe(0);
    expect(u.logged).toBe(12);
  });
});

describe("defaultPhaseNames", () => {
  it("names phases one through n", () => {
    expect(defaultPhaseNames(3)).toEqual(["Phase 1", "Phase 2", "Phase 3"]);
  });

  it("clamps nonsense counts", () => {
    expect(defaultPhaseNames(0)).toEqual([]);
    expect(defaultPhaseNames(-4)).toEqual([]);
    expect(defaultPhaseNames(500)).toHaveLength(50);
  });
});

describe("splitHoursAcrossPhases", () => {
  it("splits evenly when it divides", () => {
    expect(splitHoursAcrossPhases(30, 3)).toEqual([10, 10, 10]);
  });

  it("gives the remainder to the first phase so the parts sum to the whole", () => {
    const parts = splitHoursAcrossPhases(10, 3);
    expect(parts.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBe(10);
    expect(parts[0]).toBeGreaterThan(parts[1] as number);
  });

  it("leaves phases unsized when the total is unknown", () => {
    expect(splitHoursAcrossPhases(null, 2)).toEqual([null, null]);
    expect(splitHoursAcrossPhases(0, 2)).toEqual([null, null]);
  });

  it("returns nothing for no phases", () => {
    expect(splitHoursAcrossPhases(30, 0)).toEqual([]);
  });
});

describe("rounding", () => {
  it("rounds money to cents", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.344)).toBe(2.34);
  });

  it("rounds hours to four places", () => {
    expect(roundHours(1.00005)).toBe(1.0001);
    expect(roundHours(0.25)).toBe(0.25);
  });
});
