import { describe, it, expect } from "vitest";
import { isM365Subscription } from "@/lib/licensing/vendor";

describe("isM365Subscription", () => {
  it("keeps Microsoft-vendor lines", () => {
    expect(isM365Subscription({ vendor: "Microsoft" })).toBe(true);
    expect(isM365Subscription({ vendor: "Microsoft Corporation" })).toBe(true);
    expect(isM365Subscription({ vendor: "MSFT" })).toBe(true);
  });

  it("excludes recognized non-M365 vendors (Cisco family)", () => {
    expect(isM365Subscription({ vendor: "Cisco" })).toBe(false);
    expect(isM365Subscription({ vendor: "Cisco Systems" })).toBe(false);
    expect(isM365Subscription({ vendor: "Meraki" })).toBe(false);
  });

  it("falls back to product/SKU when vendor is blank/unknown", () => {
    expect(
      isM365Subscription({ vendor: null, productName: "Cisco Meraki MX licence" }),
    ).toBe(false);
    expect(
      isM365Subscription({ vendor: "", productName: "Webex Calling" }),
    ).toBe(false);
    expect(
      isM365Subscription({ vendor: null, productName: "NCE Microsoft 365 Copilot Business" }),
    ).toBe(true);
  });

  it("defaults unknown lines to M365 (majority of the data)", () => {
    expect(isM365Subscription({ vendor: null, productName: "M365 Business Std" })).toBe(true);
    expect(isM365Subscription({ vendor: null, productName: null, productSku: null })).toBe(true);
    // An unrecognized vendor with no non-M365 product signal stays visible.
    expect(isM365Subscription({ vendor: "Some Distributor", productName: "Windows Server CAL" })).toBe(true);
  });
});
