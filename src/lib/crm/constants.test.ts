import { describe, it, expect } from "vitest";
import { lineFromName, lineFromSlug, CRM_LINES } from "@/lib/crm/constants";

describe("lineFromName", () => {
  it("routes by keyword", () => {
    expect(lineFromName("Contoso Microsoft 365 E3")).toBe("M365");
    expect(lineFromName("Acme 365 renewal")).toBe("M365");
    expect(lineFromName("Globex Managed NOC")).toBe("MANAGED_NOC");
    expect(lineFromName("Initech Managed Services")).toBe("MANAGED_SERVICES");
    expect(lineFromName("Managed Service - Umbrella")).toBe("MANAGED_SERVICES");
  });

  it("routes anything else to Products (the catch-all)", () => {
    expect(lineFromName("Firewall hardware bundle")).toBe("PRODUCTS");
    expect(lineFromName("Cisco switches")).toBe("PRODUCTS");
    expect(lineFromName("Backup appliance")).toBe("PRODUCTS");
  });

  it("365 wins when several keywords appear", () => {
    expect(lineFromName("Managed NOC + Microsoft 365")).toBe("M365");
  });

  it("uses the fallback only for a blank name", () => {
    expect(lineFromName("", "MANAGED_SERVICES")).toBe("MANAGED_SERVICES");
    expect(lineFromName(null)).toBe("PRODUCTS");
  });
});

describe("CRM lines", () => {
  it("has a Products line resolvable by slug", () => {
    expect(lineFromSlug("products")).toBe("PRODUCTS");
    expect(CRM_LINES.PRODUCTS.label).toBe("Products");
  });
});
