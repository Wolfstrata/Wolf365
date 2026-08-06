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

  it("lists every price that moves, and by how much", () => {
    const p = renewalPreview(agreement(), asOf);
    expect(p.applicable).toBe(true);
    expect(p.percent).toBe(15);
    expect(p.changes).toEqual([
      { field: "monthlyAmount", label: "Recurring amount", from: 2_000, to: 2_300 },
      { field: "overageRate", label: "Overage rate", from: 175, to: 201.25 },
      { field: "standardRate", label: "Standard rate", from: 150, to: 172.5 },
    ]);
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

  it("skips prices the agreement does not carry", () => {
    const p = renewalPreview(
      agreement({ monthlyAmount: null, overageRate: null, standardRate: 200 }),
      asOf,
    );
    expect(p.changes).toHaveLength(1);
    expect(p.changes[0]!.field).toBe("standardRate");
    expect(p.annualDelta).toBeNull();
  });

  it("has no renewal date for an open-ended agreement", () => {
    const p = renewalPreview(agreement({ endDate: null }), asOf);
    expect(p.renewsOn).toBeNull();
    expect(p.newEndDate).toBeNull();
    expect(p.due).toBe(false);
    // The uplift is still configured and still previewable.
    expect(p.changes).toHaveLength(3);
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
