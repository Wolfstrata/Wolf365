import { describe, it, expect } from "vitest";
import {
  lineFromName,
  lineFromSlug,
  isProductIncomeRevenueType,
  fiscalYearFor,
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

describe("fiscalYearFor", () => {
  it("maps a mid-year date to the Oct 1 – Sep 30 window (named by end year)", () => {
    const fy = fiscalYearFor(new Date("2026-07-16T12:00:00Z"));
    expect(fy.start.toISOString()).toBe("2025-10-01T00:00:00.000Z");
    expect(fy.end.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(fy.label).toBe("FY2026");
  });

  it("Oct 1 begins a new fiscal year", () => {
    const fy = fiscalYearFor(new Date("2025-10-01T00:00:00Z"));
    expect(fy.start.toISOString()).toBe("2025-10-01T00:00:00.000Z");
    expect(fy.label).toBe("FY2026");
  });

  it("Sep 30 still belongs to the prior fiscal year", () => {
    const fy = fiscalYearFor(new Date("2025-09-30T23:00:00Z"));
    expect(fy.start.toISOString()).toBe("2024-10-01T00:00:00.000Z");
    expect(fy.end.toISOString()).toBe("2025-09-30T23:59:59.999Z");
    expect(fy.label).toBe("FY2025");
  });
});

describe("CRM lines", () => {
  it("has a Products line resolvable by slug", () => {
    expect(lineFromSlug("products")).toBe("PRODUCTS");
    expect(CRM_LINES.PRODUCTS.label).toBe("Products");
  });
});
