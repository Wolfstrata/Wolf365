import { describe, expect, it } from "vitest";
import {
  allowedWorkspaces,
  canAccessRoute,
  canAccessWorkspace,
  canCrossWorkspaces,
  homeRouteFor,
  isUniversalRoute,
  WORKSPACE_HOME,
  workspaceOf,
  type Workspace,
} from "./workspaces";

describe("workspaceOf", () => {
  it("puts the root dashboard in Finance", () => {
    expect(workspaceOf("/")).toBe("FINANCE");
  });

  it("maps the finance routes", () => {
    for (const p of [
      "/clients",
      "/clients/abc123",
      "/archived-licensing",
      "/billing",
      "/billing/abc/edit",
      "/cash-flow",
      "/suppliers-dpo",
      "/superops-billing",
    ]) {
      expect(workspaceOf(p), p).toBe("FINANCE");
    }
  });

  it("maps SilverFang routes", () => {
    for (const p of ["/silverfang", "/silverfang/tickets", "/silverfang/clients/abc"]) {
      expect(workspaceOf(p), p).toBe("SILVERFANG");
    }
  });

  it("puts SilverFang Billing in Finance, not SilverFang", () => {
    // The longest-prefix rule matters here: /silverfang would otherwise shadow it.
    expect(workspaceOf("/silverfang-billing")).toBe("FINANCE");
    expect(workspaceOf("/silverfang-billing/abc")).toBe("FINANCE");
    expect(workspaceOf("/silverfang-billing/settings")).toBe("FINANCE");
  });

  it("maps the remaining workspaces", () => {
    expect(workspaceOf("/crm/forecast")).toBe("CRM");
    expect(workspaceOf("/synced/hudu")).toBe("CONNECTORS");
    expect(workspaceOf("/mappings")).toBe("RECONCILIATION");
    expect(workspaceOf("/exceptions")).toBe("RECONCILIATION");
    expect(workspaceOf("/reports")).toBe("RECONCILIATION");
    expect(workspaceOf("/admin/users")).toBe("ADMIN");
  });

  it("treats a user's own settings as universal", () => {
    expect(workspaceOf("/settings")).toBeNull();
    expect(isUniversalRoute("/settings")).toBe(true);
    expect(isUniversalRoute("/settings/profile")).toBe(true);
  });

  it("does not match a prefix that is merely a string prefix of a longer segment", () => {
    // "/clientsomething" must not be read as "/clients".
    expect(workspaceOf("/clientsomething")).toBeNull();
    expect(workspaceOf("/billingxyz")).toBeNull();
  });

  it("returns null for an unmapped route rather than guessing", () => {
    expect(workspaceOf("/nowhere")).toBeNull();
  });
});

describe("role territories", () => {
  it("lets only Administrator and Power User reach every workspace", () => {
    const all: Workspace[] = [
      "FINANCE",
      "SILVERFANG",
      "CRM",
      "CONNECTORS",
      "RECONCILIATION",
      "ADMIN",
    ];
    for (const ws of all) {
      expect(canAccessWorkspace("ADMINISTRATOR", ws), ws).toBe(true);
      expect(canAccessWorkspace("POWER_USER", ws), ws).toBe(true);
    }
  });

  it("keeps SilverFang roles inside SilverFang", () => {
    for (const role of ["SILVERFANG_ADMIN", "SILVERFANG_USER"] as const) {
      expect(allowedWorkspaces(role)).toEqual(["SILVERFANG"]);
      expect(canAccessWorkspace(role, "SILVERFANG")).toBe(true);
      expect(canAccessWorkspace(role, "FINANCE")).toBe(false);
      expect(canAccessWorkspace(role, "CRM")).toBe(false);
      expect(canAccessWorkspace(role, "CONNECTORS")).toBe(false);
      expect(canAccessWorkspace(role, "ADMIN")).toBe(false);
    }
  });

  it("is the specific bug that was reported: a technician cannot reach the M365 client list", () => {
    // They hold clients:read — permission is not the axis that stops them.
    expect(canAccessRoute("SILVERFANG_USER", "/clients")).toBe(false);
    expect(canAccessRoute("SILVERFANG_USER", "/clients/abc123")).toBe(false);
    // But their own client screen is fine.
    expect(canAccessRoute("SILVERFANG_USER", "/silverfang/clients/abc123")).toBe(true);
  });

  it("keeps Sales inside the CRM", () => {
    expect(allowedWorkspaces("SALES")).toEqual(["CRM"]);
    expect(canAccessRoute("SALES", "/crm/forecast")).toBe(true);
    expect(canAccessRoute("SALES", "/")).toBe(false);
    expect(canAccessRoute("SALES", "/silverfang/tickets")).toBe(false);
  });

  it("keeps finance out of SilverFang and Administration", () => {
    expect(canAccessRoute("FINANCIAL_POWER_USER", "/billing")).toBe(true);
    expect(canAccessRoute("FINANCIAL_POWER_USER", "/silverfang-billing")).toBe(true);
    expect(canAccessRoute("FINANCIAL_POWER_USER", "/silverfang/tickets")).toBe(false);
    expect(canAccessRoute("FINANCIAL_POWER_USER", "/admin/users")).toBe(false);
  });

  it("keeps the reviewer to numbers and reports", () => {
    expect(canAccessRoute("REVIEWER", "/")).toBe(true);
    expect(canAccessRoute("REVIEWER", "/reports")).toBe(true);
    expect(canAccessRoute("REVIEWER", "/silverfang/tickets")).toBe(false);
    expect(canAccessRoute("REVIEWER", "/crm/forecast")).toBe(false);
  });

  it("lets everyone reach their own settings", () => {
    for (const role of [
      "ADMINISTRATOR",
      "SILVERFANG_USER",
      "SALES",
      "REVIEWER",
      "FINANCIAL_POWER_USER",
    ] as const) {
      expect(canAccessRoute(role, "/settings"), role).toBe(true);
    }
  });

  it("denies an absent role everything except universal routes", () => {
    expect(canAccessRoute(null, "/")).toBe(false);
    expect(canAccessRoute(undefined, "/silverfang/tickets")).toBe(false);
    expect(canAccessRoute(null, "/settings")).toBe(true);
  });
});

describe("canCrossWorkspaces", () => {
  it("is true for roles with more than one territory", () => {
    expect(canCrossWorkspaces("ADMINISTRATOR")).toBe(true);
    expect(canCrossWorkspaces("FINANCIAL_POWER_USER")).toBe(true);
  });

  it("is false for single-workspace roles", () => {
    expect(canCrossWorkspaces("SILVERFANG_USER")).toBe(false);
    expect(canCrossWorkspaces("SILVERFANG_ADMIN")).toBe(false);
    expect(canCrossWorkspaces("SALES")).toBe(false);
  });
});

describe("homeRouteFor", () => {
  it("lands each role somewhere it is allowed to be", () => {
    const roles = [
      "ADMINISTRATOR",
      "POWER_USER",
      "FINANCIAL_POWER_USER",
      "SALES",
      "SILVERFANG_ADMIN",
      "SILVERFANG_USER",
      "REVIEWER",
    ] as const;
    for (const role of roles) {
      const home = homeRouteFor(role);
      expect(canAccessRoute(role, home), `${role} → ${home}`).toBe(true);
    }
  });

  it("sends SilverFang roles to the SilverFang dashboard, not the M365 one", () => {
    expect(homeRouteFor("SILVERFANG_USER")).toBe("/silverfang/dashboard");
    expect(homeRouteFor("SILVERFANG_ADMIN")).toBe("/silverfang/dashboard");
  });

  it("sends Sales to the CRM", () => {
    expect(homeRouteFor("SALES")).toBe("/crm/forecast");
  });

  it("falls back to settings rather than looping when a role has no workspace", () => {
    expect(homeRouteFor(null)).toBe("/settings");
  });

  it("every workspace home is inside its own workspace", () => {
    for (const [ws, home] of Object.entries(WORKSPACE_HOME)) {
      expect(workspaceOf(home), `${ws} → ${home}`).toBe(ws);
    }
  });
});
