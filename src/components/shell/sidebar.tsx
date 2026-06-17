"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Receipt,
  GitMerge,
  TriangleAlert,
  BarChart3,
  Plug,
  Bug,
  ScrollText,
  ShieldCheck,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/components/shell/nav";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Building2,
  Receipt,
  GitMerge,
  TriangleAlert,
  BarChart3,
  Plug,
  Bug,
  ScrollText,
  ShieldCheck,
  Settings,
};

const SECTION_ORDER = [
  "Workspace",
  "Reconciliation",
  "Administration",
  "Account",
] as const;

/**
 * Tall vertical left navigation. Receives only the items the current user is
 * permitted to see (filtered server-side) and highlights the active route.
 */
export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  const grouped = SECTION_ORDER.map((section) => ({
    section,
    entries: items.filter((i) => i.section === section),
  })).filter((g) => g.entries.length > 0);

  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {grouped.map((group) => (
        <div key={group.section}>
          <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {group.section}
          </p>
          <ul className="space-y-0.5">
            {group.entries.map((item) => {
              const Icon = ICONS[item.icon] ?? LayoutDashboard;
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
