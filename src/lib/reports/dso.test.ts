import { describe, it, expect } from "vitest";
import { computeCashFlowReport, type CashFlowInvoice, type CashFlowPayment } from "@/lib/reports/dso";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("computeCashFlowReport", () => {
  const invoices: CashFlowInvoice[] = [
    // Acme: two invoices, one paid on time, one paid 10 days late.
    { qboId: "i1", customerId: "acme", customerName: "Acme", txnDate: d("2025-01-01"), dueDate: d("2025-01-31"), total: 1000 },
    { qboId: "i2", customerId: "acme", customerName: "Acme", txnDate: d("2025-02-01"), dueDate: d("2025-02-28"), total: 1000 },
    // Globex: paid 60 days late (big deal).
    { qboId: "i3", customerId: "globex", customerName: "Globex", txnDate: d("2025-03-01"), dueDate: d("2025-03-31"), total: 5000 },
    // Initech: invoiced but never paid (no matched cash).
    { qboId: "i4", customerId: "initech", customerName: "Initech", txnDate: d("2025-04-01"), dueDate: d("2025-05-01"), total: 2000 },
    // Acme prior-year cohort (2024) paid on time — for YoY.
    { qboId: "i0", customerId: "acme", customerName: "Acme", txnDate: d("2024-01-01"), dueDate: d("2024-01-31"), total: 800 },
  ];
  const payments: CashFlowPayment[] = [
    { txnDate: d("2025-01-20"), lines: [{ invoiceId: "i1", amount: 1000 }] }, // 11 days early
    { txnDate: d("2025-03-10"), lines: [{ invoiceId: "i2", amount: 1000 }] }, // 10 days late
    { txnDate: d("2025-05-30"), lines: [{ invoiceId: "i3", amount: 5000 }] }, // 60 days late
    { txnDate: d("2024-01-15"), lines: [{ invoiceId: "i0", amount: 800 }] }, // 2024, on time
  ];

  const r = computeCashFlowReport(invoices, payments);

  it("has data and counts customers", () => {
    expect(r.hasData).toBe(true);
    expect(r.kpis.customers).toBe(3); // acme, globex, initech
  });

  it("classifies tiers by cash-weighted days late", () => {
    const byTier = Object.fromEntries(r.tiers.map((t) => [t.tier, t.customers]));
    // Acme cash-weighted late = (1000×-11 + 1000×10 + 800×-14)/2800 < 0 → early/on-time
    expect(byTier["Early / on-time"]).toBe(1);
    expect(byTier["31-90 days late"]).toBe(1); // Globex at 60
    expect(byTier["No matched cash"]).toBe(1); // Initech
  });

  it("computes cash-flow drag only on late dollars", () => {
    const globex = r.customers.find((c) => c.customer === "Globex")!;
    expect(globex.drag).toBe(5000 * 60);
    const acme = r.customers.find((c) => c.customer === "Acme")!;
    expect(acme.drag).toBe(1000 * 10); // only the late invoice contributes
  });

  it("ranks top revenue by cash received", () => {
    expect(r.topRevenue[0]!.customer).toBe("Globex"); // 5000
    expect(r.topDrag[0]!.customer).toBe("Globex");
  });

  it("flags worst late and best reliable", () => {
    expect(r.worstLate[0]!.customer).toBe("Globex");
    expect(r.bestReliable.some((c) => c.customer === "Acme")).toBe(true);
  });

  it("ranks follow-up by dollars × days over 30 (only > 30 days late)", () => {
    // Globex: $5000 paid 60 days late → score 5000 × (60-30) = 150000.
    // Acme's late invoice is only 10 days late → excluded.
    expect(r.followUp).toHaveLength(1);
    expect(r.followUp[0]!.customer).toBe("Globex");
    expect(r.followUp[0]!.score).toBe(150000);
    expect(r.followUp[0]!.lateAmount).toBe(5000);
    expect(r.followUp[0]!.large).toBe(false); // 5000 < 10000
  });

  it("computes YoY cohorts on the two most recent invoice years", () => {
    expect(r.compareYear).toBe(2025);
    expect(r.priorYear).toBe(2024);
    // Acme spend up 2000 (2025) vs 800 (2024).
    const up = r.spendMovers.up.find((s) => s.customer === "Acme");
    expect(up?.change).toBe(1200);
  });

  it("builds a monthly DSO timeline (invoice cohort → cash-weighted days-to-cash)", () => {
    const byPeriod = Object.fromEntries(r.timeline.map((p) => [p.period, p.dso]));
    // i3 (Globex) invoiced 2025-03-01, paid 2025-05-30 → 90 days.
    expect(byPeriod["2025-03"]).toBe(90);
    // i0 (Acme) invoiced 2024-01-01, paid 2024-01-15 → 14 days.
    expect(byPeriod["2024-01"]).toBe(14);
    // Ascending by period.
    expect(r.timeline.map((p) => p.period)).toEqual([...r.timeline.map((p) => p.period)].sort());
  });

  it("is empty-safe", () => {
    const empty = computeCashFlowReport([], []);
    expect(empty.hasData).toBe(false);
    expect(empty.kpis.realDso).toBe(0);
  });
});
