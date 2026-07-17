import { describe, it, expect } from "vitest";
import {
  totalContractValue,
  commissionAmount,
  lineHasCommission,
  productCommission,
} from "@/lib/crm/pricing";

describe("totalContractValue", () => {
  it("is monthly × 12 × term", () => {
    expect(totalContractValue(1000, 1)).toBe(12000);
    expect(totalContractValue(1000, 2)).toBe(24000);
    expect(totalContractValue(1000, 3)).toBe(36000);
    expect(totalContractValue(250.5, 1)).toBe(3006);
  });
  it("is 0 with no monthly amount", () => {
    expect(totalContractValue(null, 3)).toBe(0);
  });
});

describe("commissionAmount", () => {
  it("Managed Services / NOC: 1yr=1mo, 2yr=1.5mo, 3yr=2mo of MRR", () => {
    expect(commissionAmount("MANAGED_SERVICES", 1, 1000)).toBe(1000);
    expect(commissionAmount("MANAGED_SERVICES", 2, 1000)).toBe(1500);
    expect(commissionAmount("MANAGED_SERVICES", 3, 1000)).toBe(2000);
    expect(commissionAmount("MANAGED_NOC", 2, 800)).toBe(1200);
  });
  it("M365 pays no commission", () => {
    expect(commissionAmount("M365", 3, 5000)).toBe(0);
    expect(lineHasCommission("M365")).toBe(false);
  });
  it("unknown term pays nothing", () => {
    expect(commissionAmount("MANAGED_NOC", 5, 1000)).toBe(0);
  });
});

describe("productCommission", () => {
  it("is a percentage of gross margin", () => {
    expect(productCommission(10, 5000)).toBe(500);
    expect(productCommission(7.5, 2000)).toBe(150);
  });
  it("is 0 with no rate or no margin", () => {
    expect(productCommission(0, 5000)).toBe(0);
    expect(productCommission(10, null)).toBe(0);
    expect(productCommission(null, 5000)).toBe(0);
  });
});
