import { Role } from "@prisma/client";

/**
 * Role-based access control.
 *
 * Roles are hierarchical by capability, not strictly linear, so we model
 * permissions explicitly rather than as a single rank. Every sensitive server
 * action must call {@link assertCan} (or check {@link can}) — RBAC is enforced
 * server-side only; the UI merely hides what the user cannot do.
 */
export type Permission =
  | "connectors:read"
  | "connectors:configure"
  | "connectors:sync"
  | "debuglogs:read"
  | "sso:configure"
  | "users:manage"
  | "clients:read"
  | "mappings:read"
  | "mappings:propose"
  | "mappings:approve"
  | "billing:read"
  | "billing:edit"
  | "billing:approve"
  | "billing:push"
  | "reports:read"
  | "reports:export"
  | "audit:read"
  | "crm:read"
  | "crm:write"
  | "crm:manage"
  | "backups:manage"
  // SilverFang (ticketing / PSA).
  | "tickets:read"
  | "tickets:write"
  | "tickets:assign"
  | "tickets:close"
  | "time:log"
  | "time:approve"
  | "agreements:read"
  | "agreements:manage"
  | "projects:read"
  | "projects:manage"
  | "silverfang:configure";

/** Every SilverFang permission — the full module, for the roles that own it. */
const SILVERFANG_ALL: Permission[] = [
  "tickets:read",
  "tickets:write",
  "tickets:assign",
  "tickets:close",
  "time:log",
  "time:approve",
  "agreements:read",
  "agreements:manage",
  "projects:read",
  "projects:manage",
  "silverfang:configure",
];

/** SilverFang without configuration — day-to-day service delivery. */
const SILVERFANG_OPERATE: Permission[] = SILVERFANG_ALL.filter(
  (p) => p !== "silverfang:configure",
);

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Administrator — full control over everything.
  ADMINISTRATOR: [
    "connectors:read",
    "connectors:configure",
    "connectors:sync",
    "debuglogs:read",
    "sso:configure",
    "users:manage",
    "clients:read",
    "mappings:read",
    "mappings:propose",
    "mappings:approve",
    "billing:read",
    "billing:edit",
    "billing:approve",
    "billing:push",
    "reports:read",
    "reports:export",
    "audit:read",
    "crm:read",
    "crm:write",
    "crm:manage",
    "backups:manage",
    ...SILVERFANG_ALL,
  ],
  // Power User — the same as Administrator in every respect EXCEPT the ability to
  // CHANGE connector configuration/credentials. They can still view connectors
  // and run syncs; they just can't edit connector info. Note the deliberate
  // absence of connectors:configure — everything else Administrator has is here.
  POWER_USER: [
    "connectors:read",
    "connectors:sync",
    "debuglogs:read",
    "sso:configure",
    "users:manage",
    "clients:read",
    "mappings:read",
    "mappings:propose",
    "mappings:approve",
    "billing:read",
    "billing:edit",
    "billing:approve",
    "billing:push",
    "reports:read",
    "reports:export",
    "audit:read",
    "crm:read",
    "crm:write",
    "crm:manage",
    "backups:manage",
    // All of SilverFang except its configuration (mirrors the connector rule).
    ...SILVERFANG_OPERATE,
  ],
  // Financial Power User — the full billing pipeline and CRM, plus manual
  // syncs, reconciliation (mappings/exceptions/reports) and the synced-client
  // views. Deliberately has NO Administration access: no connector credentials
  // or read, no debug logs, no audit log, no user/SSO/backup management. This
  // is Power User minus the Administration-section permissions.
  FINANCIAL_POWER_USER: [
    "connectors:sync",
    "clients:read",
    "mappings:read",
    "mappings:propose",
    "mappings:approve",
    "billing:read",
    "billing:edit",
    "billing:approve",
    "billing:push",
    "reports:read",
    "reports:export",
    "crm:read",
    "crm:write",
    "crm:manage",
  ],
  // Sales — CRM only. Manage opportunities and view the sales forecast; no
  // access to billing, connectors, or admin settings.
  SALES: ["crm:read", "crm:write"],
  // SilverFang Admin — full control of the ticketing/PSA module, including
  // boards, statuses, SLAs, rate tables and charge codes, plus time approval.
  // Needs clients:read to pick the client a ticket belongs to. Deliberately NO
  // billing, CRM, connector or Administration access.
  SILVERFANG_ADMIN: ["clients:read", ...SILVERFANG_ALL],
  // SilverFang User — a technician. Works tickets and logs time; can read
  // agreements/projects for context. Deliberately cannot configure the module,
  // approve timesheets, or touch billing/CRM/admin.
  SILVERFANG_USER: [
    "clients:read",
    "tickets:read",
    "tickets:write",
    "time:log",
    "agreements:read",
    "projects:read",
  ],
  // Reviewer — read-only. Can view numbers, charts and reports, but cannot run
  // billing, sync anything, or change any setting.
  REVIEWER: [
    "connectors:read",
    "clients:read",
    "mappings:read",
    "billing:read",
    "reports:read",
  ],
};

export function can(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(perm);
}

/** Throws a typed error if the role lacks the permission. */
export function assertCan(
  role: Role | undefined | null,
  perm: Permission,
): void {
  if (!can(role, perm)) {
    throw new ForbiddenError(perm);
  }
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Forbidden: missing permission "${permission}"`);
    this.name = "ForbiddenError";
  }
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMINISTRATOR: "Administrator",
  POWER_USER: "Power User",
  FINANCIAL_POWER_USER: "Financial Power User",
  SALES: "Sales",
  SILVERFANG_ADMIN: "SilverFang Admin",
  SILVERFANG_USER: "SilverFang User",
  REVIEWER: "Reviewer",
};

/** One-line description of what each role can do, for the admin UI. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMINISTRATOR:
    "Full access to everything, including connector credentials, security, and user management.",
  POWER_USER:
    "Same as Administrator — billing, CRM, reports, users, security and backups — except they cannot change connector configuration or credentials (they can still view connectors and run syncs).",
  FINANCIAL_POWER_USER:
    "Same as Power User (full billing pipeline, CRM, reconciliation, and manual syncs) but with no access to the Administration section — no connector credentials, debug logs, audit log, users, security, or backups.",
  SALES:
    "CRM only. Can create and manage sales opportunities and view the forecast. No access to billing, connectors, or admin settings.",
  SILVERFANG_ADMIN:
    "Full control of SilverFang (ticketing/PSA): tickets, time and timesheet approval, agreements, projects, and its configuration — boards, statuses, SLAs, rates and charge codes. No billing, CRM, connector or Administration access.",
  SILVERFANG_USER:
    "SilverFang technician. Can work tickets and log time, and view agreements and projects for context. Cannot configure the module, approve timesheets, or access billing, CRM or admin settings.",
  REVIEWER:
    "Read-only. Can view numbers, charts and reports. Cannot run billing, sync, or change anything.",
};

/** Roles assignable in the UI, ordered most → least privileged. */
export const ASSIGNABLE_ROLES: Role[] = [
  "ADMINISTRATOR",
  "POWER_USER",
  "FINANCIAL_POWER_USER",
  "SILVERFANG_ADMIN",
  "SILVERFANG_USER",
  "SALES",
  "REVIEWER",
];
