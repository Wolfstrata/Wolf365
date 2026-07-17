import { describe, it, expect } from "vitest";
import { can } from "@/lib/rbac";

describe("RBAC three-role policy", () => {
  it("Administrator can do everything sensitive", () => {
    expect(can("ADMINISTRATOR", "connectors:configure")).toBe(true);
    expect(can("ADMINISTRATOR", "users:manage")).toBe(true);
    expect(can("ADMINISTRATOR", "sso:configure")).toBe(true);
    expect(can("ADMINISTRATOR", "billing:push")).toBe(true);
  });

  it("Power User is Administrator minus the ability to change connector config", () => {
    expect(can("POWER_USER", "connectors:read")).toBe(true);
    expect(can("POWER_USER", "connectors:sync")).toBe(true);
    expect(can("POWER_USER", "billing:approve")).toBe(true);
    expect(can("POWER_USER", "billing:push")).toBe(true);
    // Now has the same admin settings Administrator has…
    expect(can("POWER_USER", "sso:configure")).toBe(true);
    expect(can("POWER_USER", "users:manage")).toBe(true);
    expect(can("POWER_USER", "backups:manage")).toBe(true);
    expect(can("POWER_USER", "audit:read")).toBe(true);
    expect(can("POWER_USER", "debuglogs:read")).toBe(true);
    // …except changing connector configuration/credentials.
    expect(can("POWER_USER", "connectors:configure")).toBe(false);
  });

  it("Financial Power User has the finance pipeline and CRM but no Administration", () => {
    // Full billing pipeline + CRM + reconciliation + manual sync.
    expect(can("FINANCIAL_POWER_USER", "billing:edit")).toBe(true);
    expect(can("FINANCIAL_POWER_USER", "billing:approve")).toBe(true);
    expect(can("FINANCIAL_POWER_USER", "billing:push")).toBe(true);
    expect(can("FINANCIAL_POWER_USER", "connectors:sync")).toBe(true);
    expect(can("FINANCIAL_POWER_USER", "mappings:approve")).toBe(true);
    expect(can("FINANCIAL_POWER_USER", "reports:export")).toBe(true);
    expect(can("FINANCIAL_POWER_USER", "crm:manage")).toBe(true);
    // No Administration access whatsoever.
    expect(can("FINANCIAL_POWER_USER", "connectors:read")).toBe(false);
    expect(can("FINANCIAL_POWER_USER", "connectors:configure")).toBe(false);
    expect(can("FINANCIAL_POWER_USER", "debuglogs:read")).toBe(false);
    expect(can("FINANCIAL_POWER_USER", "audit:read")).toBe(false);
    expect(can("FINANCIAL_POWER_USER", "users:manage")).toBe(false);
    expect(can("FINANCIAL_POWER_USER", "sso:configure")).toBe(false);
    expect(can("FINANCIAL_POWER_USER", "backups:manage")).toBe(false);
  });

  it("Reviewer is strictly read-only", () => {
    expect(can("REVIEWER", "clients:read")).toBe(true);
    expect(can("REVIEWER", "billing:read")).toBe(true);
    expect(can("REVIEWER", "reports:read")).toBe(true);
    // No changes, no billing, no syncing.
    expect(can("REVIEWER", "connectors:sync")).toBe(false);
    expect(can("REVIEWER", "billing:edit")).toBe(false);
    expect(can("REVIEWER", "billing:approve")).toBe(false);
    expect(can("REVIEWER", "mappings:propose")).toBe(false);
    expect(can("REVIEWER", "reports:export")).toBe(false);
  });

  it("Sales has CRM access only", () => {
    expect(can("SALES", "crm:read")).toBe(true);
    expect(can("SALES", "crm:write")).toBe(true);
    // Nothing outside CRM.
    expect(can("SALES", "billing:read")).toBe(false);
    expect(can("SALES", "clients:read")).toBe(false);
    expect(can("SALES", "connectors:read")).toBe(false);
    expect(can("SALES", "reports:read")).toBe(false);
  });

  it("Administrator and Power User also have full CRM access", () => {
    for (const r of ["ADMINISTRATOR", "POWER_USER"] as const) {
      expect(can(r, "crm:read")).toBe(true);
      expect(can(r, "crm:write")).toBe(true);
    }
    // Reviewer does not get CRM.
    expect(can("REVIEWER", "crm:read")).toBe(false);
  });

  it("denies when role is missing", () => {
    expect(can(null, "billing:read")).toBe(false);
    expect(can(undefined, "clients:read")).toBe(false);
  });
});
