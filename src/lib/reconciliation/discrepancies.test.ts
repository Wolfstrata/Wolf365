import { describe, it, expect } from "vitest";
import {
  detectDiscrepancies,
  normalizeName,
  type Discrepancy,
} from "@/lib/reconciliation/discrepancies";

const types = (d: Discrepancy[]) => d.map((x) => x.type);

describe("normalizeName", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(normalizeName("Acme, Inc.")).toBe("acme");
    expect(normalizeName("Acme LLC")).toBe("acme");
    expect(normalizeName("ACME  Corporation")).toBe("acme");
  });
});

describe("detectDiscrepancies", () => {
  it("flags a clean matched pair with no warnings", () => {
    const d = detectDiscrepancies({
      qbo: {
        companyName: "Acme Inc",
        billingEmail: "ap@acme.com",
        taxable: true,
        active: true,
        currency: "USD",
      },
      td: { name: "Acme", active: true, currency: "USD" },
    });
    expect(d).toHaveLength(0);
  });

  it("does NOT flag a QBO-only customer, but flags TD-only", () => {
    // A QuickBooks customer with no M365 is normal, not an exception.
    expect(
      types(detectDiscrepancies({ qbo: { taxable: true, billingEmail: "a@b.com" } })),
    ).not.toContain("CLIENT_ONLY_IN_QBO");
    // Licensing with nowhere to bill it is worth flagging.
    expect(types(detectDiscrepancies({ td: { name: "X" } }))).toContain(
      "CLIENT_ONLY_IN_TDSYNNEX",
    );
  });

  it("tolerates a name typo (same customer)", () => {
    const t = types(
      detectDiscrepancies({
        qbo: {
          companyName: "Manitoba Cardiac Institute (Reh-Fit) Inc.",
          billingEmail: "a@b.com",
          taxable: true,
          active: true,
        },
        td: { name: "Manitoba Cardiac Institue (Reh-Fit) Inc.", active: true },
      }),
    );
    expect(t).not.toContain("NAME_MISMATCH");
  });

  it("tolerates postal-code spacing and street/province abbreviations", () => {
    const t = types(
      detectDiscrepancies({
        qbo: {
          companyName: "Reh-Fit",
          billingEmail: "a@b.com",
          taxable: true,
          active: true,
          billingAddress: {
            Line1: "1390 Taylor Avenue",
            City: "Winnipeg",
            CountrySubDivisionCode: "Manitoba",
            PostalCode: "R3M 3V8",
          },
        },
        td: {
          name: "Reh-Fit",
          active: true,
          serviceAddress: {
            line1: "1390 Taylor Ave",
            city: "WINNIPEG",
            region: "MB",
            postalCode: "R3M3V8",
          },
        },
      }),
    );
    expect(t).not.toContain("ADDRESS_MISMATCH");
  });

  it("detects missing billing email and unknown tax status", () => {
    const t = types(detectDiscrepancies({ qbo: { companyName: "Acme", active: true }, td: { name: "Acme", active: true } }));
    expect(t).toContain("MISSING_BILLING_EMAIL");
    expect(t).toContain("TAX_MISMATCH");
  });

  it("detects name, active-status and currency mismatches", () => {
    const t = types(
      detectDiscrepancies({
        qbo: {
          companyName: "Acme Holdings",
          billingEmail: "a@b.com",
          taxable: true,
          active: true,
          currency: "USD",
        },
        td: { name: "Globex", active: false, currency: "CAD" },
      }),
    );
    expect(t).toContain("NAME_MISMATCH");
    expect(t).toContain("ACTIVE_STATUS_MISMATCH");
    expect(t).toContain("CURRENCY_MISMATCH");
  });

  it("does not flag name mismatch for suffix-only differences", () => {
    const t = types(
      detectDiscrepancies({
        qbo: { companyName: "Acme, Inc.", billingEmail: "a@b.com", taxable: false, active: true },
        td: { name: "Acme LLC", active: true },
      }),
    );
    expect(t).not.toContain("NAME_MISMATCH");
  });
});
