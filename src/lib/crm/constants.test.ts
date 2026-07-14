import { describe, it, expect } from "vitest";
import {
  lineFromName,
  lineFromSlug,
  isProductIncomeRevenueType,
  CRM_LINES,
} from "@/lib/crm/constants";

describe("lineFromName", () => {
  it("routes by name keyword", () => {
    expect(lineFromName("Contoso Microsoft 365 E3")).toBe("M365");
    expect(lineFromName("Acme 365 renewal")).toBe("M365");
    expect(lineFromName("Globex Managed NOC")).toBe("MANAGED_NOC");
  });

  it("365 wins when several keywords appear", () => {
    expect(lineFromName("Managed NOC + Microsoft 365")).toBe("M365");
  });

  it("uses the fallback for keyword-less names (Products is not name-driven)", () => {
    expect(lineFromName("Firewall hardware bundle")).toBe("MANAGED_SERVICES");
    expect(lineFromName("Firewall hardware bundle", "M365")).toBe("M365");
    expect(lineFromName(null)).toBe("MANAGED_SERVICES");
  });
});

describe("isProductIncomeRevenueType", () => {
  it("matches Product Income (case/space tolerant)", () => {
    expect(isProductIncomeRevenueType("Product Income")).toBe(true);
    expect(isProductIncomeRevenueType("  product income  ")).toBe(true);
    expect(isProductIncomeRevenueType("PRODUCT INCOME")).toBe(true);
  });

  it("does not match other revenue types", () => {
    expect(isProductIncomeRevenueType("Managed Services")).toBe(false);
    expect(isProductIncomeRevenueType("Professional Services")).toBe(false);
    expect(isProductIncomeRevenueType("")).toBe(false);
    expect(isProductIncomeRevenueType(null)).toBe(false);
    expect(isProductIncomeRevenueType(undefined)).toBe(false);
  });
});

describe("CRM lines", () => {
  it("has a Products line resolvable by slug", () => {
    expect(lineFromSlug("products")).toBe("PRODUCTS");
    expect(CRM_LINES.PRODUCTS.label).toBe("Products");
  });
});
