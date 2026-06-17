import type { Permission } from "@/lib/rbac";

/** A single left-navigation entry, optionally gated by a permission. */
export interface NavItem {
  label: string;
  href: string;
  /** Lucide icon name resolved in the client sidebar. */
  icon: string;
  permission?: Permission;
  /** Visually grouped under this section heading. */
  section: "Workspace" | "Reconciliation" | "Administration" | "Account";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: "LayoutDashboard", section: "Workspace" },
  { label: "Clients", href: "/clients", icon: "Building2", section: "Workspace", permission: "clients:read" },
  { label: "Billing Runs", href: "/billing", icon: "Receipt", section: "Workspace", permission: "billing:read" },
  { label: "Mappings", href: "/mappings", icon: "GitMerge", section: "Reconciliation", permission: "mappings:read" },
  { label: "Exceptions", href: "/exceptions", icon: "TriangleAlert", section: "Reconciliation", permission: "reports:read" },
  { label: "Reports", href: "/reports", icon: "BarChart3", section: "Reconciliation", permission: "reports:read" },
  { label: "Connectors", href: "/admin/connectors", icon: "Plug", section: "Administration", permission: "connectors:read" },
  { label: "Debug Logs", href: "/admin/debug-logs", icon: "Bug", section: "Administration", permission: "debuglogs:read" },
  { label: "Audit Log", href: "/admin/audit", icon: "ScrollText", section: "Administration", permission: "audit:read" },
  { label: "Security & SSO", href: "/admin/security", icon: "ShieldCheck", section: "Administration", permission: "sso:configure" },
  { label: "Settings", href: "/settings", icon: "Settings", section: "Account" },
];
