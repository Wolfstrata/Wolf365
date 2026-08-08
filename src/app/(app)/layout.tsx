import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/auth/session";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { canAccessRoute, homeRouteFor } from "@/lib/workspaces";
import { NAV_ITEMS } from "@/components/shell/nav";
import { AppShell } from "@/components/shell/app-shell";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
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
 * items are filtered before reaching the client.
 *
 * Two independent gates, both applied here:
 *
 *   1. WORKSPACE — may this role be on this route at all? Each product (Finance,
 *      SilverFang, CRM, …) is its own territory and only Administrators and Power
 *      Users cross between them. Enforced here rather than per page because a
 *      single choke point cannot be forgotten when a new page is added; the
 *      pathname arrives as a header set by the middleware, since a layout is not
 *      told its own route.
 *   2. PERMISSION — may this role do this kind of thing? Still checked per page
 *      and per server action, as before. The layout guard is a boundary, not a
 *      replacement for those.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  // Set by the middleware from the real URL on every request.
  const pathname = (await headers()).get("x-pathname") ?? "/";
  // The same cookie the root layout used to stamp <html>, so the button starts on
  // the theme the page is already rendered in rather than disagreeing with it.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  // Send anyone standing outside their territory to the start of their own,
  // rather than showing a page that would leak another product's data. An
  // unmapped route resolves to no workspace and is left alone, so this cannot
  // trap a page that simply is not in the map yet.
  if (!canAccessRoute(user.role, pathname)) {
    redirect(homeRouteFor(user.role));
  }

  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      (!item.permission || can(user.role, item.permission)) &&
      // Nav mirrors the boundary: a section the user may not enter is not offered.
      canAccessRoute(user.role, item.href),
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
      {/* Light / dark / system. Sits here rather than in the account popover so it
          is one click from anywhere, not two behind a menu. */}
      <div className="mt-2">
        <ThemeToggle initial={theme} />
      </div>
      {/* Administrators can preview the app as any role. */}
      {user.realRole === "ADMINISTRATOR" && <ViewAsControl effectiveRole={user.role} />}
    </div>
  );

  return (
    <TimeZoneProvider timeZone={user.timezone}>
      <AppShell items={visibleItems} footer={footer} fallbackHome={homeRouteFor(user.role)}>
        {user.viewingAs && <ViewAsBanner role={user.viewingAs} />}
        {children}
      </AppShell>
    </TimeZoneProvider>
  );
}
