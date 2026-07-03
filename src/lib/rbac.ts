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
  | "backups:manage";

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
  ],
  // Power User — can operate the whole billing pipeline and run syncs / test
  // connections, but CANNOT change connector credentials or other admin-only
  // settings (SSO, user management). Note the absence of connectors:configure.
  POWER_USER: [
    "connectors:read",
    "connectors:sync",
    "debuglogs:read",
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
  ],
  // Sales — CRM only. Manage opportunities and view the sales forecast; no
  // access to billing, connectors, or admin settings.
  SALES: ["crm:read", "crm:write"],
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
  SALES: "Sales",
  REVIEWER: "Reviewer",
};

/** One-line description of what each role can do, for the admin UI. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMINISTRATOR:
    "Full access to everything, including connector credentials, security, and user management.",
  POWER_USER:
    "Can run billing, approve/push invoices, and sync or test connectors — but cannot change connector credentials or admin settings.",
  SALES:
    "CRM only. Can create and manage sales opportunities and view the forecast. No access to billing, connectors, or admin settings.",
  REVIEWER:
    "Read-only. Can view numbers, charts and reports. Cannot run billing, sync, or change anything.",
};

/** Roles assignable in the UI, ordered most → least privileged. */
export const ASSIGNABLE_ROLES: Role[] = [
  "ADMINISTRATOR",
  "POWER_USER",
  "SALES",
  "REVIEWER",
];
