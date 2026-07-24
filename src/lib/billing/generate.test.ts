import { describe, it, expect } from "vitest";
import {
  generateBillingLines,
  sumLineTotals,
  type GenerateInput,
} from "@/lib/billing/generate";

const d = (s: string) => new Date(s + "T00:00:00.000Z");

const base: GenerateInput = {
  clientId: "client-1",
  period: { start: d("2026-01-01"), end: d("2026-02-01") },
  subscriptions: [
    {
      id: "sub-1",
      sku: "M365BP",
      productName: "Microsoft 365 Business Premium",
      quantity: 10,
      unitCost: 20,
      currency: "USD",
    },
  ],
  mappings: { M365BP: { qboItemId: "qbo-item-1", qboItemName: "M365 BP" } },
  priceRules: [{ scope: "GLOBAL_MARKUP", markupPct: 25, active: true }],
};

describe("generateBillingLines", () => {
  it("generates a full-period line with markup pricing and cost", () => {
    const r = generateBillingLines(base);
    expect(r.exceptions).toHaveLength(0);
    expect(r.lines).toHaveLength(1);
    const line = r.lines[0]!;
    expect(line.unitPrice).toBe(25); // 20 * 1.25
    expect(line.prorationFactor).toBe(1);
    expect(line.subtotal).toBe(250); // 10 * 25 * 1
    expect(line.total).toBe(250);
    expect(line.estimatedCost).toBe(200); // 10 * 20 * 1
    expect(line.qboItemId).toBe("qbo-item-1");
  });

  it("prorates mid-period activation", () => {
    const r = generateBillingLines({
      ...base,
      subscriptions: [{ ...base.subscriptions[0]!, activeStart: d("2026-01-16") }],
    });
    const line = r.lines[0]!;
    expect(line.proratedDays).toBe(16);
    expect(line.subtotal).toBeCloseTo(250 * (16 / 31), 2);
  });

  it("includes an unmapped SKU as a flagged line (qboItemId null) and raises UNMAPPED_SKU", () => {
    const r = generateBillingLines({ ...base, mappings: {} });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.qboItemId).toBeNull();
    expect(r.lines[0]!.total).toBe(250); // still priced via the markup rule
    expect(r.exceptions[0]!.type).toBe("UNMAPPED_SKU");
  });

  it("raises MISSING_PRICE when no rule resolves and no cost/customer price", () => {
    const r = generateBillingLines({
      ...base,
      subscriptions: [{ ...base.subscriptions[0]!, unitCost: null }],
      priceRules: [{ scope: "GLOBAL_MARKUP", markupPct: 25, active: true }],
    });
    expect(r.lines).toHaveLength(0);
    expect(r.exceptions[0]!.type).toBe("MISSING_PRICE");
  });

  it("falls back to vendor customerPrice when no price rule resolves", () => {
    const r = generateBillingLines({
      ...base,
      subscriptions: [
        { ...base.subscriptions[0]!, unitCost: null, customerPrice: 29.93 },
      ],
      priceRules: [], // no rules at all
    });
    expect(r.exceptions).toHaveLength(0);
    expect(r.lines[0]!.unitPrice).toBe(29.93);
    expect(r.lines[0]!.subtotal).toBe(299.3); // 10 * 29.93
  });

  it("sums line totals across multiple subscriptions", () => {
    const r = generateBillingLines({
      ...base,
      subscriptions: [
        base.subscriptions[0]!,
        { id: "sub-2", sku: "M365BP", productName: "More", quantity: 2, unitCost: 20, currency: "USD" },
      ],
    });
    expect(r.lines).toHaveLength(2);
    expect(sumLineTotals(r.lines)).toBe(300); // 250 + 50
  });

  it("splits a mid-period seat addition onto its own pro-rated line", () => {
    // 31-day January; base 10 seats + 4 added on Jan 17 (activeStart Jan 17 →
    // billed Jan 17..Feb 1 = 15 days → factor 15/31).
    const r = generateBillingLines({
      ...base,
      subscriptions: [
        {
          ...base.subscriptions[0]!,
          quantity: 14, // total now includes the 4 added
          monthlyAdditions: [{ date: d("2026-01-17"), seats: 4, note: "Add 4 seats" }],
        },
      ],
    });
    expect(r.exceptions).toHaveLength(0);
    expect(r.lines).toHaveLength(2);

    const baseLine = r.lines.find((l) => !l.isProratedAddition)!;
    expect(baseLine.quantity).toBe(10); // 14 - 4 added
    expect(baseLine.prorationFactor).toBe(1);
    expect(baseLine.total).toBe(250); // 10 * 25

    const addLine = r.lines.find((l) => l.isProratedAddition)!;
    expect(addLine.quantity).toBe(4);
    expect(addLine.proratedDays).toBe(15);
    expect(addLine.periodDays).toBe(31);
    expect(addLine.prorationFactor).toBeCloseTo(15 / 31, 6);
    expect(addLine.total).toBeCloseTo(4 * 25 * (15 / 31), 2);
    expect(addLine.description).toContain("added Jan 17");
  });

  it("omits the base line when every seat was added this period", () => {
    const r = generateBillingLines({
      ...base,
      subscriptions: [
        {
          ...base.subscriptions[0]!,
          quantity: 4,
          monthlyAdditions: [{ date: d("2026-01-17"), seats: 4, note: "Add 4 seats" }],
        },
      ],
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]!.isProratedAddition).toBe(true);
    expect(r.lines[0]!.quantity).toBe(4);
  });
});
