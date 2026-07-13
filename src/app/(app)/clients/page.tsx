import Link from "next/link";
import { Building2, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { recurringSummary, toRecurringInput } from "@/lib/billing/recurring";
import { isActiveStatus, isExpired } from "@/lib/licensing/renewal";
import { isM365Subscription } from "@/lib/licensing/vendor";
import { ensureArchiveColumn } from "@/lib/licensing/archive";
import { ClientsTable, type ClientListRow } from "./clients-table";

/** Master client list. Populated by connector syncs + mapping. */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requirePermission("clients:read");
  const canArchive = can(user.role, "billing:edit");
  await ensureArchiveColumn();
  const { view } = await searchParams;
  const showArchived = view === "archived";

  const clients = await prisma.client.findMany({
    where: { archived: showArchived },
    orderBy: { name: "asc" },
    include: {
      qboCustomer: { select: { id: true } },
      tdSynnexCustomer: {
        select: {
          stellrId: true,
          active: true,
          subscriptions: {
            select: {
              customerPrice: true,
              unitCost: true,
              quantity: true,
              billingFrequency: true,
              status: true,
              currency: true,
              renewalDate: true,
              archived: true,
              vendor: true,
              productName: true,
              productSku: true,
            },
          },
        },
      },
    },
    take: 1000,
  });

  // A live subscription = linked to TD SYNNEX, not archived, active status, and
  // not expired. In the active view only clients with at least one show — QBO-only
  // clients and clients whose M365 is all expired/inactive are excluded. The
  // archived view lists every archived client regardless of live licensing.
  const now = new Date();
  const rows: ClientListRow[] = clients
    .map((c) => {
      // M365 only — exclude other vendors (e.g. Cisco) that TD SYNNEX resells.
      const subs = (c.tdSynnexCustomer?.subscriptions ?? []).filter(isM365Subscription);
      const liveSubs = subs.filter(
        (s) => !s.archived && isActiveStatus(s.status) && !isExpired(s.renewalDate, s.status, now),
      );
      const summary = recurringSummary(
        subs
          .filter((s) => !s.archived && !isExpired(s.renewalDate, s.status, now))
          .map(toRecurringInput),
      );
      const currency = subs.find((s) => s.currency)?.currency ?? "CAD";
      const negative = summary.activeCount > 0 && summary.monthlyMargin < 0;
      return {
        id: c.id,
        name: c.name,
        archived: c.archived,
        hasTd: !!c.tdSynnexCustomer,
        liveCount: liveSubs.length,
        stellrId: c.tdSynnexCustomer?.stellrId ?? null,
        subsCount: liveSubs.length,
        activeCount: summary.activeCount,
        monthlyMargin: summary.monthlyMargin,
        marginPct: summary.marginPct,
        currency,
        hasQbo: !!c.qboCustomer,
        active: c.tdSynnexCustomer?.active !== false,
        negative,
      };
    })
    // Archived view shows every archived client; active view keeps the
    // "TD-linked with ≥1 live subscription" filter.
    .filter((r) => showArchived || (r.hasTd && r.liveCount > 0));

  const totalLicenses = rows.reduce((a, r) => a + r.subsCount, 0);
  const negativeMargin = rows.filter((r) => r.negative);

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
    }`;

  return (
    <div>
      <PageHeader
        title="Clients"
        description={
          showArchived
            ? `${rows.length} archived client${rows.length === 1 ? "" : "s"}. Restore one to bring it back to the list, dashboard, reports, and billing.`
            : `${rows.length} client${rows.length === 1 ? "" : "s"} with active Microsoft 365 licensing · ${totalLicenses} active subscription${totalLicenses === 1 ? "" : "s"}. Click a client to drill into records and licensing.`
        }
        actions={
          <div className="flex items-center gap-1 rounded-lg border p-1">
            <Link href="/clients" className={tabClass(!showArchived)}>
              Active
            </Link>
            <Link href="/clients?view=archived" className={tabClass(showArchived)}>
              Archived
            </Link>
          </div>
        }
      />
      <div className="p-4 sm:p-8">
        {!showArchived && negativeMargin.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {negativeMargin.length}{" "}
              {negativeMargin.length === 1 ? "client is" : "clients are"} billing
              below cost (negative margin):{" "}
              {negativeMargin.map((r) => r.name).join(", ")}.
            </span>
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title={showArchived ? "No archived clients" : "No clients with active M365 licensing"}
            description={
              showArchived
                ? "Archive a client from the Active list (or its profile) to file it away here. Archived clients stay out of the dashboard, reports, and billing until restored."
                : "This list shows clients linked to TD SYNNEX with at least one active (non-expired) subscription. Sync TD SYNNEX and run Mappings → auto-match, or check that subscriptions aren't all expired or archived."
            }
          />
        ) : (
          <ClientsTable rows={rows} canArchive={canArchive} />
        )}
      </div>
    </div>
  );
}
