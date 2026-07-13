import { LogOut } from "lucide-react";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/auth/session";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { NAV_ITEMS } from "@/components/shell/nav";
import { AppShell } from "@/components/shell/app-shell";
import { ConnectorStatusBadge } from "@/components/shell/connector-status";
import { ViewAsControl, ViewAsBanner } from "@/components/shell/view-as";
import { TimeZoneProvider } from "@/components/ui/local-time";

/**
 * Authenticated application shell.
 *
 * Layout mirrors the requested ChatGPT-style arrangement:
 * - tall vertical left navigation
 * - small horizontal account/status/settings panel in the lower-left
 * - large main work area on the right
 *
 * Route protection is enforced here (server component, Node runtime) and nav
 * items are filtered by the user's permissions before reaching the client.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || can(user.role, item.permission),
  );

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  // Lower-left account / status / settings panel, rendered server-side and
  // passed into the (client) shell so auth + the sign-out server action stay here.
  const footer = (
    <div className="border-t p-3">
      <ConnectorStatusBadge />
      <div className="mt-2 flex items-center gap-3 rounded-md px-2 py-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {(user.name ?? user.email).slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.name ?? user.email}</p>
          <p className="truncate text-xs text-muted-foreground">
            {ROLE_LABELS[user.role]}
          </p>
        </div>
        <form action={doSignOut}>
          <button
            type="submit"
            title="Sign out"
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
      {/* Administrators can preview the app as any role. */}
      {user.realRole === "ADMINISTRATOR" && <ViewAsControl effectiveRole={user.role} />}
    </div>
  );

  return (
    <TimeZoneProvider timeZone={user.timezone}>
      <AppShell items={visibleItems} footer={footer}>
        {user.viewingAs && <ViewAsBanner role={user.viewingAs} />}
        {children}
      </AppShell>
    </TimeZoneProvider>
  );
}
