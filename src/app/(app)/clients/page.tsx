import { Building2, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { recurringSummary, toRecurringInput } from "@/lib/billing/recurring";
import { ClientsTable, type ClientListRow } from "./clients-table";

/** Master client list. Populated by connector syncs + mapping. */
export default async function ClientsPage() {
  await requirePermission("clients:read");
  const clients = await prisma.client.findMany({
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
            },
          },
        },
      },
    },
    take: 1000,
  });

  // Per-client recurring margin from synced M365 licensing → serializable rows.
  const rows: ClientListRow[] = clients.map((c) => {
    const subs = c.tdSynnexCustomer?.subscriptions ?? [];
    const summary = recurringSummary(subs.map(toRecurringInput));
    const currency = subs.find((s) => s.currency)?.currency ?? "CAD";
    const negative = summary.activeCount > 0 && summary.monthlyMargin < 0;
    return {
      id: c.id,
      name: c.name,
      hasTd: !!c.tdSynnexCustomer,
      stellrId: c.tdSynnexCustomer?.stellrId ?? null,
      subsCount: subs.length,
      activeCount: summary.activeCount,
      monthlyMargin: summary.monthlyMargin,
      marginPct: summary.marginPct,
      currency,
      hasQbo: !!c.qboCustomer,
      active: c.tdSynnexCustomer?.active !== false,
      negative,
    };
  });

  const withTd = rows.filter((r) => r.hasTd).length;
  const totalLicenses = rows.reduce((a, r) => a + r.subsCount, 0);
  const negativeMargin = rows.filter((r) => r.negative);

  return (
    <div>
      <PageHeader
        title="Clients"
        description={`${clients.length} clients · ${withTd} with TD SYNNEX · ${totalLicenses} M365 subscriptions. Click a client to drill into records and licensing.`}
      />
      <div className="p-8">
        {negativeMargin.length > 0 && (
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

        {clients.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No clients yet"
            description="Sync QuickBooks and TD SYNNEX, then run Mappings → auto-match to create client records."
          />
        ) : (
          <ClientsTable rows={rows} />
        )}
      </div>
    </div>
  );
}
