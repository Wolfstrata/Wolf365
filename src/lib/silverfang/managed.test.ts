import { describe, it, expect } from "vitest";
import {
  classifyManaged,
  defaultManagedAgreement,
  describeVerdict,
  startOfUtcDay,
} from "@/lib/silverfang/managed";

describe("classifyManaged", () => {
  it("matches a managed-services stage", () => {
    const v = classifyManaged({ stage: "Managed Services" });
    expect(v.kind).toBe("MANAGED_SERVICES");
    expect(v.source).toBe("stage");
    expect(v.label).toBe("Managed Services");
  });

  it("matches a bare 'Managed' label", () => {
    expect(classifyManaged({ stage: "Managed" }).kind).toBe("MANAGED_SERVICES");
    expect(classifyManaged({ status: "MANAGED" }).kind).toBe("MANAGED_SERVICES");
  });

  it("matches labels with punctuation and odd spacing", () => {
    expect(classifyManaged({ stage: " managed-services  " }).kind).toBe("MANAGED_SERVICES");
    expect(classifyManaged({ stage: "Client/Managed" }).kind).toBe("MANAGED_SERVICES");
  });

  it("treats co-managed as managed", () => {
    // Co-managed customers are managed customers with an internal IT counterpart.
    expect(classifyManaged({ stage: "Co-Managed" }).kind).toBe("MANAGED_SERVICES");
  });

  it("reads NOC as MANAGED_NOC only when the label also says managed", () => {
    expect(classifyManaged({ stage: "Managed NOC" }).kind).toBe("MANAGED_NOC");
    // "NOC" on its own is not enough to assert a managed relationship.
    expect(classifyManaged({ stage: "NOC" }).kind).toBeNull();
  });

  it("keeps a managed-services client on MANAGED_SERVICES despite a NOC contract", () => {
    const v = classifyManaged({
      stage: "Managed Services",
      contracts: [{ name: "Managed NOC monitoring" }],
    });
    expect(v.kind).toBe("MANAGED_SERVICES");
  });

  it("lets an explicit exclusion beat a positive contract", () => {
    const v = classifyManaged({
      stage: "Unmanaged",
      contracts: [{ name: "Managed Services Agreement" }],
    });
    expect(v.kind).toBeNull();
    expect(v.source).toBe("excluded");
    expect(v.label).toBe("Unmanaged");
  });

  it.each(["unmanaged", "Un-managed", "Not Managed", "No longer managed"])(
    "excludes %s",
    (label) => {
      expect(classifyManaged({ stage: label }).source).toBe("excluded");
    },
  );

  it("falls back to a live contract name", () => {
    const v = classifyManaged({
      stage: "Customer",
      contracts: [{ name: "Managed Services — Gold", status: "ACTIVE" }],
    });
    expect(v.kind).toBe("MANAGED_SERVICES");
    expect(v.source).toBe("contract");
  });

  it("ignores contracts that are cancelled or expired", () => {
    for (const status of ["CANCELLED", "canceled", "Terminated", "Expired", "inactive"]) {
      const v = classifyManaged({
        contracts: [{ name: "Managed Services", status }],
      });
      expect(v.kind, status).toBeNull();
    }
  });

  it("accepts a contract whose status is unknown or blank", () => {
    // SuperOps often leaves contract status empty; refusing those would drop real
    // managed customers on the floor.
    expect(classifyManaged({ contracts: [{ name: "Managed Services" }] }).kind).toBe(
      "MANAGED_SERVICES",
    );
    expect(
      classifyManaged({ contracts: [{ name: "Managed Services", status: "" }] }).kind,
    ).toBe("MANAGED_SERVICES");
  });

  it("says nothing about clients with no signal", () => {
    const v = classifyManaged({ stage: "Prospect", status: "Active", contracts: [] });
    expect(v.kind).toBeNull();
    expect(v.source).toBe("none");
    expect(v.label).toBeNull();
  });

  it("handles empty input without throwing", () => {
    expect(classifyManaged({}).kind).toBeNull();
    expect(classifyManaged({ stage: null, status: null, contracts: undefined }).kind).toBeNull();
  });

  it("does not match 'management' or other words containing managed", () => {
    expect(classifyManaged({ stage: "Account Management" }).kind).toBeNull();
    expect(classifyManaged({ stage: "Property Manager" }).kind).toBeNull();
  });
});

describe("describeVerdict", () => {
  it("explains every outcome without inventing a reason", () => {
    expect(describeVerdict(classifyManaged({ stage: "Managed Services" }))).toBe(
      'Managed Services — from stage "Managed Services"',
    );
    expect(describeVerdict(classifyManaged({ status: "Managed NOC" }))).toBe(
      'Managed NOC — from status "Managed NOC"',
    );
    expect(
      describeVerdict(classifyManaged({ contracts: [{ name: "Managed Services" }] })),
    ).toBe('Managed Services — from contract "Managed Services"');
    expect(describeVerdict(classifyManaged({ stage: "Unmanaged" }))).toBe(
      'Excluded — labelled "Unmanaged" in SuperOps',
    );
    expect(describeVerdict(classifyManaged({}))).toBe(
      "No managed-services signal in SuperOps",
    );
  });
});

describe("defaultManagedAgreement", () => {
  const startDate = new Date("2026-08-07T00:00:00Z");
  const endDate = new Date("2027-08-07T00:00:00Z");

  it("builds a DRAFT placeholder, never an active one", () => {
    const a = defaultManagedAgreement({
      clientName: "Acme Ltd",
      kind: "MANAGED_SERVICES",
      startDate,
      endDate,
      reason: 'Matched stage "Managed Services"',
    });
    // DRAFT is the whole safety story: no amount is known, so it must not bill.
    expect(a.status).toBe("DRAFT");
    expect(a.name).toBe("Managed Services — Acme Ltd");
    expect(a.type).toBe("MANAGED_SERVICES");
    expect(a.autoRenew).toBe(false);
    expect(a.startDate).toBe(startDate);
    expect(a.endDate).toBe(endDate);
  });

  it("records where it came from and what to do next", () => {
    const a = defaultManagedAgreement({
      clientName: "Acme",
      kind: "MANAGED_NOC",
      startDate,
      endDate,
      reason: 'Matched contract "NOC"',
    });
    expect(a.name).toBe("Managed NOC — Acme");
    expect(a.notes).toContain("2026-08-07");
    expect(a.notes).toContain('Matched contract "NOC"');
    expect(a.notes).toContain("Active");
  });

  it("sets no money fields at all", () => {
    const a = defaultManagedAgreement({
      clientName: "Acme",
      kind: "MANAGED_SERVICES",
      startDate,
      endDate,
      reason: "x",
    });
    expect("monthlyAmount" in a).toBe(false);
    expect("standardRate" in a).toBe(false);
  });
});

describe("startOfUtcDay", () => {
  it("drops the time of day", () => {
    expect(startOfUtcDay(new Date("2026-08-07T17:43:12.512Z")).toISOString()).toBe(
      "2026-08-07T00:00:00.000Z",
    );
  });
});
