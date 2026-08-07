import type { Role } from "@prisma/client";

/**
 * Workspace isolation.
 *
 * Wolf365 hosts several products in one app — M365 billing, CRM, SilverFang
 * (ticketing/PSA), connector data, reconciliation, administration. A user belongs
 * to one or more workspaces and must not wander into the others: a technician has
 * no business on the finance dashboard, and a salesperson has none in the ticket
 * queue. Only Administrators cross borders freely.
 *
 * This is a SECOND axis, deliberately independent of {@link Permission}:
 *
 *   permission = "may you do this kind of thing"   (read a client, push a bill)
 *   workspace  = "may you be here at all"          (Finance, SilverFang, CRM)
 *
 * Both must pass. Keeping them separate is what lets a SilverFang technician hold
 * `clients:read` — which SilverFang genuinely needs to pick a ticket's client —
 * without that granting them the Finance workspace's M365 client list. Collapsing
 * the two axes is exactly how they ended up able to reach it.
 *
 * Pure: no I/O, so the route map and the role map are testable, and the same
 * answer is used by the nav filter, the layout guard, and any link that offers to
 * leave.
 */

export type Workspace =
  | "FINANCE"
  | "SILVERFANG"
  | "CRM"
  | "CONNECTORS"
  | "RECONCILIATION"
  | "ADMIN";

export const WORKSPACE_LABELS: Record<Workspace, string> = {
  FINANCE: "Finance Workspace",
  SILVERFANG: "SilverFang",
  CRM: "CRM",
  CONNECTORS: "Connector Data",
  RECONCILIATION: "Reconciliation",
  ADMIN: "Administration",
};

/**
 * Routes that belong to no workspace — reachable by anyone who is signed in.
 * Kept minimal on purpose: a user's own settings and the auth/error plumbing.
 */
const UNIVERSAL_PREFIXES = ["/settings", "/signin", "/error"];

/**
 * Route prefix → workspace. Order matters: the longest matching prefix wins, so
 * `/silverfang-billing` is Finance even though `/silverfang` is SilverFang.
 */
const ROUTE_WORKSPACES: { prefix: string; workspace: Workspace }[] = [
  // SilverFang's own billing pipeline is finance work, run by finance people —
  // it sits in the Finance workspace, matching the decision that SilverFang
  // roles hold no billing permissions.
  { prefix: "/silverfang-billing", workspace: "FINANCE" },
  { prefix: "/silverfang", workspace: "SILVERFANG" },
  { prefix: "/crm", workspace: "CRM" },
  { prefix: "/synced", workspace: "CONNECTORS" },
  { prefix: "/mappings", workspace: "RECONCILIATION" },
  { prefix: "/exceptions", workspace: "RECONCILIATION" },
  { prefix: "/reports", workspace: "RECONCILIATION" },
  { prefix: "/admin", workspace: "ADMIN" },
  { prefix: "/clients", workspace: "FINANCE" },
  { prefix: "/archived-licensing", workspace: "FINANCE" },
  { prefix: "/billing", workspace: "FINANCE" },
  { prefix: "/superops-billing", workspace: "FINANCE" },
  { prefix: "/cash-flow", workspace: "FINANCE" },
  { prefix: "/suppliers-dpo", workspace: "FINANCE" },
];

/** True for a path every signed-in user may reach regardless of workspace. */
export function isUniversalRoute(pathname: string): boolean {
  return UNIVERSAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Which workspace a path belongs to. `null` for a universal route, and for the
 * root dashboard — which is handled separately, since "/" means a different page
 * depending on who you are.
 */
export function workspaceOf(pathname: string): Workspace | null {
  if (isUniversalRoute(pathname)) return null;
  if (pathname === "/") return "FINANCE";

  // Longest prefix wins, so a more specific route cannot be shadowed by a
  // shorter one that happens to be listed first.
  let best: { prefix: string; workspace: Workspace } | null = null;
  for (const entry of ROUTE_WORKSPACES) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  return best?.workspace ?? null;
}

/**
 * Which workspaces each role may enter.
 *
 * Read this as territory, not capability. A role's permissions still decide what
 * it can do once inside; this decides whether it may be there.
 */
const ROLE_WORKSPACES: Record<Role, Workspace[]> = {
  // Administrators are the only role that crosses every border.
  ADMINISTRATOR: ["FINANCE", "SILVERFANG", "CRM", "CONNECTORS", "RECONCILIATION", "ADMIN"],
  // Power User is Administrator minus connector configuration, so it keeps the
  // same reach. The difference between them is capability, not territory.
  POWER_USER: ["FINANCE", "SILVERFANG", "CRM", "CONNECTORS", "RECONCILIATION", "ADMIN"],
  // Finance: the billing pipeline, the CRM it sells from, the synced source data
  // it reconciles against — but no SilverFang and no Administration.
  FINANCIAL_POWER_USER: ["FINANCE", "CRM", "CONNECTORS", "RECONCILIATION"],
  // Sales lives in the CRM and nowhere else.
  SALES: ["CRM"],
  // SilverFang roles stay in SilverFang. They hold `clients:read` because
  // SilverFang needs client records of its own; that must not put them on the
  // M365 client list.
  SILVERFANG_ADMIN: ["SILVERFANG"],
  SILVERFANG_USER: ["SILVERFANG"],
  // Reviewer reads the numbers: finance and the reconciliation reports.
  REVIEWER: ["FINANCE", "RECONCILIATION"],
};

export function allowedWorkspaces(role: Role | undefined | null): Workspace[] {
  if (!role) return [];
  return ROLE_WORKSPACES[role] ?? [];
}

export function canAccessWorkspace(
  role: Role | undefined | null,
  workspace: Workspace | null,
): boolean {
  // A universal route has no workspace to check.
  if (workspace === null) return true;
  return allowedWorkspaces(role).includes(workspace);
}

/** Whether a role may enter the workspace a given path belongs to. */
export function canAccessRoute(role: Role | undefined | null, pathname: string): boolean {
  return canAccessWorkspace(role, workspaceOf(pathname));
}

/** True only for roles that may move between workspaces. */
export function canCrossWorkspaces(role: Role | undefined | null): boolean {
  return allowedWorkspaces(role).length > 1;
}

/**
 * Where each workspace starts. Used to land a user somewhere they are allowed to
 * be, rather than bouncing them off the root dashboard they cannot see.
 */
export const WORKSPACE_HOME: Record<Workspace, string> = {
  FINANCE: "/",
  SILVERFANG: "/silverfang/dashboard",
  CRM: "/crm/forecast",
  CONNECTORS: "/synced/td-synnex",
  RECONCILIATION: "/reports",
  ADMIN: "/admin/connectors",
};

/**
 * The landing route for a role: the home of its first allowed workspace. Falls
 * back to `/settings`, which every signed-in user may reach — a user with no
 * workspace at all should see something rather than a redirect loop.
 */
export function homeRouteFor(role: Role | undefined | null): string {
  const first = allowedWorkspaces(role)[0];
  return first ? WORKSPACE_HOME[first] : "/settings";
}
