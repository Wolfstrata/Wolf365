import Link from "next/link";
import { Building2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { clientEmailAllowed } from "@/lib/silverfang/email-policy";
import { ImportSuperOpsButton } from "./import-button";

export const dynamic = "force-dynamic";

function tabClass(active: boolean): string {
  return active
    ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
    : "rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent";
}

/**
 * SilverFang Clients — the central Wolf365 clients seen through a service-delivery
 * lens (tickets, contacts, agreements, projects). Deliberately does NOT reuse the
 * /clients filter, which restricts to TD SYNNEX-linked clients with live M365
 * subscriptions and would hide most service clients.
 */
export default async function SilverFangClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("tickets:read");
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "activity";

  const clients = await prisma.client.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    take: 2000,
    include: {
      sfClientProfile: {
        select: { accountManager: true, vip: true, allowClientEmail: true },
      },
      superOpsMatch: { select: { id: true } },
      _count: {
        select: { sfTickets: true, sfContacts: true, sfAgreements: true, sfProjects: true },
      },
    },
  });

  // Open-ticket counts in one grouped query rather than N per-client queries.
  const openGroups = await prisma.sfTicket.groupBy({
    by: ["clientId"],
    where: { status: { isClosed: false } },
    _count: { _all: true },
  });
  const openByClient = new Map(openGroups.map((g) => [g.clientId, g._count._all]));

  const hasActivity = (c: (typeof clients)[number]) =>
    c._count.sfTickets > 0 ||
    c._count.sfContacts > 0 ||
    c._count.sfAgreements > 0 ||
    c._count.sfProjects > 0;

  const emailOn = clients.filter((c) => clientEmailAllowed(c.sfClientProfile)).length;
  const visible = view === "all" ? clients : clients.filter(hasActivity);
  const activityCount = clients.filter(hasActivity).length;

  const columns: DataColumn[] = [
    { key: "name", label: "Client" },
    { key: "manager", label: "Account manager" },
    { key: "open", label: "Open tickets", numeric: true },
    { key: "tickets", label: "Tickets", numeric: true },
    { key: "contacts", label: "Contacts", numeric: true },
    { key: "agreements", label: "Agreements", numeric: true },
    { key: "projects", label: "Projects", numeric: true },
    { key: "flags", label: "Flags" },
  ];

  const rows: DataRow[] = visible.map((c) => ({
    id: c.id,
    href: `/silverfang/clients/${c.id}`,
    cells: {
      name: c.name,
      manager: c.sfClientProfile?.accountManager ?? "—",
      open: openByClient.get(c.id) ?? 0,
      tickets: c._count.sfTickets,
      contacts: c._count.sfContacts,
      agreements: c._count.sfAgreements,
      projects: c._count.sfProjects,
      flags: [
        // Shown positively only: "Email on" is the exception worth noticing,
        // since off is the norm and the safe state.
        clientEmailAllowed(c.sfClientProfile) ? "Email on" : null,
        c.sfClientProfile?.vip ? "VIP" : null,
        c.superOpsMatch ? "SuperOps" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
  }));

  return (
    <div>
      <PageHeader
        help={<PawTip topic="clients" />}
        title="Clients"
        description="Wolf365 clients as seen by SilverFang — tickets, contacts, agreements and projects."
        actions={can(user.role, "silverfang:configure") ? <ImportSuperOpsButton /> : null}
      />
      <div className="space-y-4 p-4 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/silverfang/clients" className={tabClass(view === "activity")}>
            With activity ({activityCount})
          </Link>
          <Link href="/silverfang/clients?view=all" className={tabClass(view === "all")}>
            All ({clients.length})
          </Link>
        </div>

        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Building2 className="h-8 w-8" />}
              title={
                view === "activity"
                  ? "No clients have SilverFang activity yet"
                  : "No clients available"
              }
              description={
                view === "activity"
                  ? can(user.role, "silverfang:configure")
                    ? "Use “Import from SuperOps” to bring your SuperOps clients and their contacts into SilverFang, then switch to All to see every client."
                    : "No client has tickets, contacts, agreements or projects yet. Switch to All to see every client."
                  : "No active clients exist in Wolf365 yet. Sync a connector or create a client first."
              }
            />
          </Card>
        ) : (
          <Card>
            <DataTable columns={columns} rows={rows} searchPlaceholder="Filter clients…" />
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {emailOn} of {clients.length} clients can be emailed.
          </span>{" "}
          Email is off for every client until someone turns it on for that client
          individually — so no customer can be mailed by accident. Inbound email still creates
          tickets either way.
        </p>
        <p className="text-xs text-muted-foreground">
          SilverFang uses the same client records as the rest of Wolf365, so tickets, billing
          and CRM always agree. Importing from SuperOps links each SuperOps client to a
          Wolf365 client and brings its contacts across; re-running it updates rather than
          duplicating.
        </p>
      </div>
    </div>
  );
}
