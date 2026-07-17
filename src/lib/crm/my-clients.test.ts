import { describe, it, expect } from "vitest";
import { computeMyClients, type MyClientOppInput } from "@/lib/crm/my-clients";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const NOW = d("2026-07-17"); // within FY2026 (Oct 1 2025 – Sep 30 2026)

const opp = (over: Partial<MyClientOppInput> = {}): MyClientOppInput => ({
  accountName: "Acme",
  line: "M365",
  stage: "CLOSED_WON",
  amount: 1000,
  marginAmount: 300,
  closeDate: d("2026-01-15"),
  ...over,
});

describe("computeMyClients", () => {
  it("aggregates current-FY revenue/margin, lifetime spend and recency by account", () => {
    const r = computeMyClients(
      [
        opp({ accountName: "Acme", amount: 1000, marginAmount: 300, closeDate: d("2026-01-15") }),
        opp({ accountName: "Acme", amount: 500, marginAmount: 100, closeDate: d("2026-03-01") }),
        // Prior-FY purchase (FY2025) — counts toward lifetime spend, not current FY.
        opp({ accountName: "Acme", amount: 800, marginAmount: 200, closeDate: d("2025-05-01") }),
        // An open deal is ignored entirely.
        opp({ accountName: "Acme", stage: "PROSPECTING", amount: 9999, closeDate: d("2026-06-01") }),
      ],
      NOW,
    );
    expect(r.hasData).toBe(true);
    const acme = r.rows.find((x) => x.account === "Acme")!;
    expect(acme.grossRevenue).toBe(1500); // current FY only
    expect(acme.grossMargin).toBe(400);
    expect(acme.avgMarginPct).toBeCloseTo(26.7, 1);
    expect(acme.totalSpend).toBe(2300); // lifetime incl. prior FY
    expect(acme.lastPurchase).toEqual(d("2026-03-01"));
    // 2026-07-17 − 2026-03-01 = 138 days.
    expect(acme.daysSinceLastPurchase).toBe(138);
  });

  it("assumes 100% margin on Managed Services", () => {
    const r = computeMyClients(
      [opp({ accountName: "MSP Co", line: "MANAGED_SERVICES", amount: 1200, marginAmount: 10 })],
      NOW,
    );
    const row = r.rows.find((x) => x.account === "MSP Co")!;
    expect(row.grossMargin).toBe(1200); // full revenue, ignoring stored 10
    expect(row.avgMarginPct).toBe(100);
  });

  it("computes YoY spend movers (expanding vs contracting) by fiscal year", () => {
    const r = computeMyClients(
      [
        // Grower: 800 prior FY → 1500 current FY.
        opp({ accountName: "Grower", amount: 800, closeDate: d("2025-05-01") }),
        opp({ accountName: "Grower", amount: 1500, closeDate: d("2026-02-01") }),
        // Shrinker: 2000 prior FY → 500 current FY.
        opp({ accountName: "Shrinker", amount: 2000, closeDate: d("2025-06-01") }),
        opp({ accountName: "Shrinker", amount: 500, closeDate: d("2026-02-01") }),
      ],
      NOW,
    );
    expect(r.compareYear).toBe(2026);
    expect(r.priorYear).toBe(2025);

    const grower = r.spendMovers.up.find((m) => m.customer === "Grower")!;
    expect(grower.spendPrior).toBe(800);
    expect(grower.spendCurrent).toBe(1500);
    expect(grower.change).toBe(700);
    expect(grower.pctChange).toBeCloseTo(87.5, 1);

    const shrinker = r.spendMovers.down.find((m) => m.customer === "Shrinker")!;
    expect(shrinker.change).toBe(-1500);
    expect(shrinker.pctChange).toBe(-75);
  });

  it("is empty-safe", () => {
    const r = computeMyClients([], NOW);
    expect(r.hasData).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r.spendMovers.up).toEqual([]);
    expect(r.spendMovers.down).toEqual([]);
  });
});
