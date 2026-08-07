import { describe, expect, it } from "vitest";
import {
  addMonths,
  daysUntilRenewal,
  increaseBy,
  renewalApproaching,
  renewalPreview,
  termMonths,
  type RenewableAgreement,
} from "./renewal";

function agreement(over: Partial<RenewableAgreement> = {}): RenewableAgreement {
  return {
    autoRenew: true,
    renewalIncreasePercent: 15,
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2026-12-31T00:00:00Z"),
    lastRenewedAt: null,
    billingFrequency: "MONTHLY",
    monthlyAmount: 2_000,
    overageRate: 175,
    standardRate: 150,
    ...over,
  };
}

describe("increaseBy", () => {
  it("applies the percentage and rounds to cents", () => {
    expect(increaseBy(2_000, 15)).toBe(2_300);
    expect(increaseBy(175, 15)).toBe(201.25);
    expect(increaseBy(99.99, 15)).toBe(114.99);
  });

  it("leaves an absent price absent rather than inventing one", () => {
    expect(increaseBy(null, 15)).toBeNull();
  });

  it("is a no-op at zero percent", () => {
    expect(increaseBy(2_000, 0)).toBe(2_000);
  });

  it("survives a nonsense percentage instead of producing NaN", () => {
    expect(increaseBy(2_000, Number.NaN)).toBe(2_000);
  });
});

describe("termMonths", () => {
  it("reads a one-year term from the dates", () => {
    expect(
      termMonths({
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
      }),
    ).toBe(11);
  });

  it("reads a clean 12-month term", () => {
    expect(
      termMonths({
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2027-01-01T00:00:00Z"),
      }),
    ).toBe(12);
  });

  it("assumes annual when there is no end date", () => {
    expect(termMonths({ startDate: new Date("2026-01-01T00:00:00Z"), endDate: null })).toBe(12);
  });

  it("treats a sub-month term as monthly rather than zero", () => {
    expect(
      termMonths({
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-01-10T00:00:00Z"),
      }),
    ).toBe(1);
  });
});

describe("addMonths", () => {
  it("adds whole months", () => {
    expect(addMonths(new Date("2026-01-15T00:00:00Z"), 12).toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });

  it("clamps the day so 31 January plus a month lands in February", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("handles a leap year", () => {
    expect(addMonths(new Date("2028-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });
});

describe("daysUntilRenewal", () => {
  it("counts forward to the end of the term", () => {
    expect(
      daysUntilRenewal(
        { endDate: new Date("2026-12-31T00:00:00Z") },
        new Date("2026-12-01T00:00:00Z"),
      ),
    ).toBe(30);
  });

  it("goes negative once the term has passed", () => {
    expect(
      daysUntilRenewal(
        { endDate: new Date("2026-01-01T00:00:00Z") },
        new Date("2026-01-11T00:00:00Z"),
      ),
    ).toBe(-10);
  });

  it("is null with no end date", () => {
    expect(daysUntilRenewal({ endDate: null }, new Date())).toBeNull();
  });
});

describe("renewalPreview", () => {
  const asOf = new Date("2026-11-01T00:00:00Z");

  it("raises the recurring fee and nothing else", () => {
    const p = renewalPreview(agreement(), asOf);
    expect(p.applicable).toBe(true);
    expect(p.percent).toBe(15);
    expect(p.changes).toEqual([
      { field: "monthlyAmount", label: "Recurring amount", from: 2_000, to: 2_300 },
    ]);
  });

  it("leaves hourly rates alone — they are repriced on their own schedule", () => {
    const p = renewalPreview(agreement({ overageRate: 175, standardRate: 150 }), asOf);
    expect(p.changes.map((c) => c.field)).toEqual(["monthlyAmount"]);
  });

  it("has nothing to raise on an agreement with rates but no recurring fee", () => {
    // A block-time agreement: renewing moves the term, not the hourly price.
    const p = renewalPreview(
      agreement({ monthlyAmount: null, overageRate: 175, standardRate: 150 }),
      asOf,
    );
    expect(p.changes).toEqual([]);
    expect(p.renewsOn?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("rolls the end date forward by one term", () => {
    const p = renewalPreview(
      agreement({
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2027-01-01T00:00:00Z"),
      }),
      asOf,
    );
    expect(p.termMonths).toBe(12);
    expect(p.newEndDate?.toISOString()).toBe("2028-01-01T00:00:00.000Z");
  });

  it("values a monthly uplift over a year", () => {
    // 2,300 − 2,000 = 300/month → 3,600/year.
    expect(renewalPreview(agreement(), asOf).annualDelta).toBe(3_600);
  });

  it("values a yearly uplift once", () => {
    expect(
      renewalPreview(agreement({ billingFrequency: "YEARLY", monthlyAmount: 24_000 }), asOf)
        .annualDelta,
    ).toBe(3_600);
  });

  it("is not applicable when auto-renew is off", () => {
    expect(renewalPreview(agreement({ autoRenew: false }), asOf).applicable).toBe(false);
  });

  it("is not applicable at zero percent, but still reports the dates", () => {
    const p = renewalPreview(agreement({ renewalIncreasePercent: 0 }), asOf);
    expect(p.applicable).toBe(false);
    expect(p.changes).toEqual([]);
    expect(p.renewsOn?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("is due once the term has ended", () => {
    const p = renewalPreview(agreement(), new Date("2027-01-05T00:00:00Z"));
    expect(p.due).toBe(true);
    expect(p.daysUntil).toBeLessThan(0);
  });

  it("is not due before the term ends", () => {
    expect(renewalPreview(agreement(), asOf).due).toBe(false);
  });

  it("will not renew twice for the same term", () => {
    const p = renewalPreview(
      agreement({ lastRenewedAt: new Date("2027-01-02T00:00:00Z") }),
      new Date("2027-01-05T00:00:00Z"),
    );
    expect(p.alreadyRenewed).toBe(true);
    expect(p.due).toBe(false);
  });

  it("does not consider an earlier renewal as covering this term", () => {
    const p = renewalPreview(
      agreement({ lastRenewedAt: new Date("2026-01-02T00:00:00Z") }),
      new Date("2027-01-05T00:00:00Z"),
    );
    expect(p.alreadyRenewed).toBe(false);
    expect(p.due).toBe(true);
  });

  it("has no change and no delta when there is no recurring fee at all", () => {
    const p = renewalPreview(
      agreement({ monthlyAmount: null, overageRate: null, standardRate: null }),
      asOf,
    );
    expect(p.changes).toEqual([]);
    expect(p.annualDelta).toBeNull();
  });

  it("has no renewal date for an open-ended agreement", () => {
    const p = renewalPreview(agreement({ endDate: null }), asOf);
    expect(p.renewsOn).toBeNull();
    expect(p.newEndDate).toBeNull();
    expect(p.due).toBe(false);
    // The uplift is still configured and still previewable.
    expect(p.changes).toHaveLength(1);
  });
});

describe("renewalApproaching", () => {
  const asOf = new Date("2026-11-15T00:00:00Z");

  it("flags an agreement inside the window", () => {
    expect(
      renewalApproaching({ autoRenew: true, endDate: new Date("2026-12-31T00:00:00Z") }, asOf),
    ).toBe(true);
  });

  it("does not flag one outside the window", () => {
    expect(
      renewalApproaching({ autoRenew: true, endDate: new Date("2027-06-30T00:00:00Z") }, asOf),
    ).toBe(false);
  });

  it("flags one already past its end date", () => {
    expect(
      renewalApproaching({ autoRenew: true, endDate: new Date("2026-01-01T00:00:00Z") }, asOf),
    ).toBe(true);
  });

  it("ignores agreements that do not auto-renew", () => {
    expect(
      renewalApproaching({ autoRenew: false, endDate: new Date("2026-12-01T00:00:00Z") }, asOf),
    ).toBe(false);
  });

  it("ignores an open-ended agreement", () => {
    expect(renewalApproaching({ autoRenew: true, endDate: null }, asOf)).toBe(false);
  });
});

/**
 * The sweep runs every 15 minutes, so these are the properties that keep an
 * automatic renewal from compounding. They exercise the pure predicates the
 * sweep and `applyAgreementRenewal` both gate on.
 */
describe("safety under a repeating sweep", () => {
  it("stops being due the moment the renewal is recorded", () => {
    const term = { startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2027-01-01T00:00:00Z") };
    const asOf = new Date("2027-01-01T00:05:00Z");

    const before = renewalPreview(agreement({ ...term, lastRenewedAt: null }), asOf);
    expect(before.due).toBe(true);

    // What the service writes: lastRenewedAt = now, endDate rolled forward.
    const after = renewalPreview(
      agreement({
        startDate: term.endDate,
        endDate: before.newEndDate,
        lastRenewedAt: asOf,
      }),
      asOf,
    );
    expect(after.due).toBe(false);
    expect(after.alreadyRenewed).toBe(false); // the *next* term simply is not due yet
  });

  it("stays not-due across many subsequent sweeps in the same term", () => {
    const renewed = agreement({
      startDate: new Date("2027-01-01T00:00:00Z"),
      endDate: new Date("2028-01-01T00:00:00Z"),
      lastRenewedAt: new Date("2027-01-01T00:05:00Z"),
    });
    // 96 sweeps a day for a month — none of them may fire.
    for (let i = 0; i < 96 * 30; i += 1) {
      const asOf = new Date(Date.parse("2027-01-01T00:10:00Z") + i * 15 * 60_000);
      if (asOf >= renewed.endDate!) break;
      expect(renewalPreview(renewed, asOf).due).toBe(false);
    }
  });

  it("becomes due again only once the new term ends", () => {
    const renewed = agreement({
      startDate: new Date("2027-01-01T00:00:00Z"),
      endDate: new Date("2028-01-01T00:00:00Z"),
      lastRenewedAt: new Date("2027-01-01T00:05:00Z"),
    });
    expect(renewalPreview(renewed, new Date("2027-12-31T00:00:00Z")).due).toBe(false);
    expect(renewalPreview(renewed, new Date("2028-01-01T00:00:00Z")).due).toBe(true);
  });

  it("never fires for an agreement with auto-renew off, however overdue", () => {
    expect(
      renewalPreview(
        agreement({ autoRenew: false, endDate: new Date("2020-01-01T00:00:00Z") }),
        new Date("2027-01-01T00:00:00Z"),
      ).due,
    ).toBe(false);
  });

  it("never fires for an open-ended agreement", () => {
    expect(renewalPreview(agreement({ endDate: null }), new Date("2030-01-01T00:00:00Z")).due).toBe(
      false,
    );
  });

  it("advances one term per application, so a stale agreement catches up in steps", () => {
    // Three years overdue on an annual term.
    const stale = agreement({
      startDate: new Date("2024-01-01T00:00:00Z"),
      endDate: new Date("2025-01-01T00:00:00Z"),
    });
    const asOf = new Date("2027-06-01T00:00:00Z");
    const first = renewalPreview(stale, asOf);
    expect(first.due).toBe(true);
    // One term, not a jump straight to today.
    expect(first.newEndDate?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
