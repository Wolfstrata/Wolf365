import { describe, expect, it } from "vitest";
import {
  byWorstMargin,
  csvCell,
  profitability,
  ratioPct,
  realisation,
  techUtilisation,
  toCsv,
  totalProfit,
  weekdayCapacity,
} from "./reporting";

describe("ratioPct", () => {
  it("returns a percentage to one decimal place", () => {
    expect(ratioPct(1, 3)).toBe(33.3);
    expect(ratioPct(3, 4)).toBe(75);
  });

  it("is null rather than Infinity or NaN with no denominator", () => {
    expect(ratioPct(5, 0)).toBeNull();
    expect(ratioPct(5, -1)).toBeNull();
    expect(ratioPct(5, Number.NaN)).toBeNull();
  });

  it("can exceed 100 — over-capacity is real and must not be hidden", () => {
    expect(ratioPct(50, 40)).toBe(125);
  });
});

describe("techUtilisation", () => {
  const base = {
    userId: "u1",
    name: "Alex",
    billableHours: 120,
    nonBillableHours: 30,
    workedValue: 18_000,
    cost: 6_000,
    capacityHours: 160,
  };

  it("computes utilisation against capacity and billable ratio against logged", () => {
    const u = techUtilisation(base);
    expect(u.totalHours).toBe(150);
    expect(u.utilisationPct).toBe(75); // 120/160
    expect(u.billableRatioPct).toBe(80); // 120/150
    expect(u.effectiveRate).toBe(150); // 18,000/120
  });

  it("reports utilisation as unknown rather than assuming a capacity", () => {
    const u = techUtilisation({ ...base, capacityHours: null });
    expect(u.utilisationPct).toBeNull();
    // The ratio that needs no capacity is still available.
    expect(u.billableRatioPct).toBe(80);
  });

  it("handles a tech who logged nothing without dividing by zero", () => {
    const u = techUtilisation({
      ...base,
      billableHours: 0,
      nonBillableHours: 0,
      workedValue: 0,
      cost: 0,
    });
    expect(u.utilisationPct).toBe(0);
    expect(u.billableRatioPct).toBeNull();
    expect(u.effectiveRate).toBeNull();
  });

  it("shows over-capacity rather than clamping it", () => {
    expect(techUtilisation({ ...base, billableHours: 200 }).utilisationPct).toBe(125);
  });
});

describe("weekdayCapacity", () => {
  it("counts weekdays in a month", () => {
    // July 2026: 1st is a Wednesday; 23 weekdays.
    expect(
      weekdayCapacity(new Date("2026-07-01T00:00:00Z"), new Date("2026-08-01T00:00:00Z"), 8),
    ).toBe(23 * 8);
  });

  it("excludes weekends", () => {
    // Sat 2026-07-04 and Sun 2026-07-05 only.
    expect(
      weekdayCapacity(new Date("2026-07-04T00:00:00Z"), new Date("2026-07-06T00:00:00Z")),
    ).toBe(0);
  });

  it("honours a different working day", () => {
    expect(
      weekdayCapacity(new Date("2026-07-06T00:00:00Z"), new Date("2026-07-11T00:00:00Z"), 7.5),
    ).toBe(5 * 7.5);
  });

  it("is zero for an empty period", () => {
    const d = new Date("2026-07-01T00:00:00Z");
    expect(weekdayCapacity(d, d)).toBe(0);
  });
});

describe("realisation", () => {
  it("reports the share of worked value that was billed", () => {
    const r = realisation({ workedValue: 10_000, billedValue: 7_500 });
    expect(r.realisationPct).toBe(75);
    expect(r.gap).toBe(2_500);
  });

  it("explains the gap by reason, so a low figure can be judged", () => {
    const r = realisation({
      workedValue: 10_000,
      billedValue: 4_000,
      coveredHours: { prepaid: 20, inclusion: 10, unrated: 2 },
    });
    expect(r.coveredHours).toEqual({ prepaid: 20, inclusion: 10, fixedFee: 0, unrated: 2 });
  });

  it("never reports a negative gap when more was billed than worked", () => {
    // Recurring fees mean billed can exceed the value of hours worked.
    const r = realisation({ workedValue: 1_000, billedValue: 5_000 });
    expect(r.gap).toBe(0);
    expect(r.realisationPct).toBe(500);
  });

  it("is null rather than zero when nothing was worked", () => {
    expect(realisation({ workedValue: 0, billedValue: 0 }).realisationPct).toBeNull();
  });
});

describe("profitability", () => {
  it("computes margin, percentage and effective rate", () => {
    const p = profitability({ id: "a1", name: "Acme MS", revenue: 10_000, cost: 6_000, hours: 50 });
    expect(p.margin).toBe(4_000);
    expect(p.marginPct).toBe(40);
    expect(p.effectiveRate).toBe(200);
    expect(p.underwater).toBe(false);
  });

  it("flags an agreement that is losing money", () => {
    const p = profitability({ id: "a2", name: "Bad deal", revenue: 2_000, cost: 5_000, hours: 40 });
    expect(p.margin).toBe(-3_000);
    expect(p.marginPct).toBe(-150);
    expect(p.underwater).toBe(true);
  });

  it("has no margin percentage without revenue, rather than implying -100%", () => {
    const p = profitability({ id: "a3", name: "Unbilled", revenue: 0, cost: 900, hours: 6 });
    expect(p.marginPct).toBeNull();
    expect(p.margin).toBe(-900);
    expect(p.underwater).toBe(true);
  });

  it("has no effective rate with no hours", () => {
    // A recurring agreement nobody worked on this period.
    const p = profitability({ id: "a4", name: "Quiet", revenue: 2_000, cost: 0, hours: 0 });
    expect(p.effectiveRate).toBeNull();
    expect(p.margin).toBe(2_000);
  });
});

describe("totalProfit", () => {
  it("sums the rows and recomputes the ratios from the totals", () => {
    const rows = [
      profitability({ id: "a", name: "A", revenue: 10_000, cost: 6_000, hours: 50 }),
      profitability({ id: "b", name: "B", revenue: 5_000, cost: 5_500, hours: 40 }),
    ];
    const t = totalProfit(rows);
    expect(t.revenue).toBe(15_000);
    expect(t.cost).toBe(11_500);
    expect(t.margin).toBe(3_500);
    expect(t.hours).toBe(90);
    // Recomputed from totals, not averaged from the rows' percentages.
    expect(t.marginPct).toBeCloseTo(23.3, 1);
  });

  it("is safe on an empty set", () => {
    const t = totalProfit([]);
    expect(t.revenue).toBe(0);
    expect(t.marginPct).toBeNull();
  });
});

describe("byWorstMargin", () => {
  it("puts the losses first", () => {
    const rows = [
      profitability({ id: "good", name: "Good", revenue: 10_000, cost: 1_000, hours: 10 }),
      profitability({ id: "bad", name: "Bad", revenue: 1_000, cost: 9_000, hours: 10 }),
      profitability({ id: "ok", name: "OK", revenue: 5_000, cost: 4_000, hours: 10 }),
    ];
    expect(byWorstMargin(rows).map((r) => r.id)).toEqual(["bad", "ok", "good"]);
  });

  it("does not mutate the input", () => {
    const rows = [
      profitability({ id: "a", name: "A", revenue: 1, cost: 9, hours: 1 }),
      profitability({ id: "b", name: "B", revenue: 9, cost: 1, hours: 1 }),
    ];
    byWorstMargin(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("csv", () => {
  it("quotes fields containing commas, quotes or newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("neutralises spreadsheet formula injection", () => {
    // A client name beginning with = must not execute in Excel.
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("renders empty for null and undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("builds a full document", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"], [2, null]])).toBe('a,b\n1,"x,y"\n2,');
  });
});
