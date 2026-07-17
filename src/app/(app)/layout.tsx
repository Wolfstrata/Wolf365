import Link from "next/link";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/auth/session";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { NAV_ITEMS } from "@/components/shell/nav";
import { AppShell } from "@/components/shell/app-shell";
import { ConnectorStatusBadge } from "@/components/shell/connector-status";
import { AccountMenu } from "@/components/shell/account-menu";
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

  // Administration menu items (permission-filtered) now live in the account menu.
  const adminItems = visibleItems
    .filter((i) => i.section === "Administration")
    .map((i) => ({ label: i.label, href: i.href }));
  const canReadConnectors = can(user.role, "connectors:read");

  // Lower-left status + account panel, rendered server-side and passed into the
  // (client) shell so auth + the sign-out server action stay here.
  const footer = (
    <div className="border-t p-3">
      {canReadConnectors ? (
        <Link
          href="/admin/connectors"
          title="View connectors"
          className="block rounded-md transition hover:opacity-80"
        >
          <ConnectorStatusBadge />
        </Link>
      ) : (
        <ConnectorStatusBadge />
      )}
      <div className="mt-2">
        <AccountMenu
          name={user.name ?? user.email}
          roleLabel={ROLE_LABELS[user.role]}
          initials={(user.name ?? user.email).slice(0, 2).toUpperCase()}
          adminItems={adminItems}
          signOutAction={doSignOut}
        />
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
