import { describe, it, expect } from "vitest";
import { can } from "@/lib/rbac";

describe("RBAC three-role policy", () => {
  it("Administrator can do everything sensitive", () => {
    expect(can("ADMINISTRATOR", "connectors:configure")).toBe(true);
    expect(can("ADMINISTRATOR", "users:manage")).toBe(true);
    expect(can("ADMINISTRATOR", "sso:configure")).toBe(true);
    expect(can("ADMINISTRATOR", "billing:push")).toBe(true);
  });

  it("Power User can operate billing and sync, but not change credentials or admin settings", () => {
    expect(can("POWER_USER", "connectors:sync")).toBe(true);
    expect(can("POWER_USER", "billing:approve")).toBe(true);
    expect(can("POWER_USER", "billing:push")).toBe(true);
    // Cannot change connector credentials or other admin-only settings.
    expect(can("POWER_USER", "connectors:configure")).toBe(false);
    expect(can("POWER_USER", "sso:configure")).toBe(false);
    expect(can("POWER_USER", "users:manage")).toBe(false);
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

  it("denies when role is missing", () => {
    expect(can(null, "billing:read")).toBe(false);
    expect(can(undefined, "clients:read")).toBe(false);
  });
});
