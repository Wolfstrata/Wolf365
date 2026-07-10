import { describe, it, expect } from "vitest";
import { learnSkuMappings } from "@/lib/mapping/invoice-match";

describe("learnSkuMappings", () => {
  it("auto-confirms when the SKU appears literally in the invoice line", () => {
    const [m] = learnSkuMappings([
      {
        subs: [{ sku: "CFQ7TTC0MHBR-001", productName: "NCE Microsoft 365 Copilot Business" }],
        lines: [
          { itemId: "42", itemName: "M365 Copilot", description: "Copilot Business CFQ7TTC0MHBR-001 monthly" },
        ],
      },
    ]);
    expect(m).toBeDefined();
    expect(m!.sku).toBe("CFQ7TTC0MHBR-001");
    expect(m!.qboItemId).toBe("42");
    expect(m!.method).toBe("DETERMINISTIC");
    expect(m!.status).toBe("CONFIRMED");
  });

  it("proposes a fuzzy product-name match for review", () => {
    const [m] = learnSkuMappings([
      {
        subs: [{ sku: "ABCD", productName: "Microsoft 365 Business Premium" }],
        lines: [{ itemId: "7", itemName: null, description: "Microsoft 365 Business Premium Plan" }],
      },
    ]);
    expect(m).toBeDefined();
    expect(m!.qboItemId).toBe("7");
    expect(m!.method).toBe("AI_ASSISTED");
    expect(m!.status).toBe("PROPOSED");
    expect(m!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("picks the item billed most often (majority vote)", () => {
    const [m] = learnSkuMappings([
      {
        subs: [{ sku: "WIDGET-100", productName: "Widget" }],
        lines: [
          { itemId: "A", itemName: null, description: "WIDGET-100" },
          { itemId: "A", itemName: null, description: "WIDGET-100" },
          { itemId: "B", itemName: null, description: "WIDGET-100" },
        ],
      },
    ]);
    expect(m!.qboItemId).toBe("A");
    expect(m!.votes).toBe(2);
  });

  it("returns nothing when no line matches", () => {
    const out = learnSkuMappings([
      {
        subs: [{ sku: "ZZZZ-9", productName: "Nothing In Particular" }],
        lines: [{ itemId: "C", itemName: null, description: "Totally unrelated service" }],
      },
    ]);
    expect(out).toHaveLength(0);
  });

  it("ignores customers with no unmapped subs or no lines", () => {
    const out = learnSkuMappings([
      { subs: [], lines: [{ itemId: "A", itemName: null, description: "x" }] },
      { subs: [{ sku: "AAAA-1", productName: "A" }], lines: [] },
    ]);
    expect(out).toHaveLength(0);
  });
});
