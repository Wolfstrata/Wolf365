import type { Permission } from "@/lib/rbac";

/** A single left-navigation entry, optionally gated by a permission. */
export interface NavItem {
  label: string;
  href: string;
  /** Lucide icon name resolved in the client sidebar. */
  icon: string;
  permission?: Permission;
  /** Visually grouped under this section heading. */
  section:
    | "Finance Workspace"
    | "Connector Data"
    | "CRM"
    | "Reconciliation"
    | "Administration"
    | "Account";
}

export const NAV_ITEMS: NavItem[] = [
  { label: "M365 Dashboard", href: "/", icon: "LayoutDashboard", section: "Finance Workspace" },
  { label: "M365 Clients", href: "/clients", icon: "Building2", section: "Finance Workspace", permission: "clients:read" },
  { label: "M365 Archived Clients", href: "/archived-licensing", icon: "Archive", section: "Finance Workspace", permission: "clients:read" },
  { label: "TD SYNNEX Clients", href: "/synced/td-synnex", icon: "Boxes", section: "Connector Data", permission: "clients:read" },
  { label: "QBO Clients", href: "/synced/qbo", icon: "BookText", section: "Connector Data", permission: "clients:read" },
  { label: "SuperOps Clients", href: "/synced/superops", icon: "Headset", section: "Connector Data", permission: "clients:read" },
  { label: "Hudu Clients", href: "/synced/hudu", icon: "Building", section: "Connector Data", permission: "clients:read" },
  { label: "QBO Billing Runs", href: "/billing", icon: "Receipt", section: "Finance Workspace", permission: "billing:read" },
  { label: "SuperOps Billing", href: "/superops-billing", icon: "ReceiptText", section: "Finance Workspace", permission: "billing:read" },
  { label: "Forecast", href: "/crm/forecast", icon: "LineChart", section: "CRM", permission: "crm:read" },
  { label: "Managed Services", href: "/crm/managed-services", icon: "Wrench", section: "CRM", permission: "crm:read" },
  { label: "Managed NOC", href: "/crm/managed-noc", icon: "Network", section: "CRM", permission: "crm:read" },
  { label: "M365", href: "/crm/m365", icon: "Cloud", section: "CRM", permission: "crm:read" },
  { label: "Leads", href: "/crm/leads", icon: "Inbox", section: "CRM", permission: "crm:read" },
  { label: "Sales Management", href: "/crm/sales-management", icon: "Target", section: "CRM", permission: "crm:read" },
  { label: "Mappings", href: "/mappings", icon: "GitMerge", section: "Reconciliation", permission: "mappings:read" },
  { label: "Exceptions", href: "/exceptions", icon: "TriangleAlert", section: "Reconciliation", permission: "reports:read" },
  { label: "Reports", href: "/reports", icon: "BarChart3", section: "Reconciliation", permission: "reports:read" },
  { label: "Connectors", href: "/admin/connectors", icon: "Plug", section: "Administration", permission: "connectors:read" },
  { label: "Debug Logs", href: "/admin/debug-logs", icon: "Bug", section: "Administration", permission: "debuglogs:read" },
  { label: "API Probe", href: "/admin/probe", icon: "Plug", section: "Administration", permission: "connectors:configure" },
  { label: "M365 Alerts", href: "/admin/alerts", icon: "BellRing", section: "Administration", permission: "connectors:configure" },
  { label: "Audit Log", href: "/admin/audit", icon: "ScrollText", section: "Administration", permission: "audit:read" },
  { label: "Users", href: "/admin/users", icon: "Users", section: "Administration", permission: "users:manage" },
  { label: "Security & SSO", href: "/admin/security", icon: "ShieldCheck", section: "Administration", permission: "sso:configure" },
  { label: "Backups", href: "/admin/backup", icon: "DatabaseBackup", section: "Administration", permission: "backups:manage" },
  { label: "Settings", href: "/settings", icon: "Settings", section: "Account" },
];
