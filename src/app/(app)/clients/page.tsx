import Link from "next/link";
import { Building2, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { recurringSummary, toRecurringInput } from "@/lib/billing/recurring";

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

  // Per-client recurring margin from synced M365 licensing.
  const rows = clients.map((c) => {
    const subs = c.tdSynnexCustomer?.subscriptions ?? [];
    const summary = recurringSummary(subs.map(toRecurringInput));
    const currency = subs.find((s) => s.currency)?.currency ?? "CAD";
    return { client: c, subs, summary, currency };
  });

  const withTd = clients.filter((c) => c.tdSynnexCustomer).length;
  const totalLicenses = rows.reduce((a, r) => a + r.subs.length, 0);
  const negativeMargin = rows.filter(
    (r) => r.summary.activeCount > 0 && r.summary.monthlyMargin < 0,
  );

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
              {negativeMargin.map((r) => r.client.name).join(", ")}.
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
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 font-medium">TD SYNNEX #</th>
                  <th className="px-4 py-2 font-medium">Subscriptions</th>
                  <th className="px-4 py-2 font-medium">Monthly margin</th>
                  <th className="px-4 py-2 font-medium">QBO</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ client: c, subs, summary, currency }) => {
                  const negative =
                    summary.activeCount > 0 && summary.monthlyMargin < 0;
                  return (
                    <tr
                      key={c.id}
                      className={`border-t hover:bg-accent/40 ${negative ? "bg-danger/5" : ""}`}
                    >
                      <td className="px-4 py-2 font-medium">
                        <Link
                          href={`/clients/${c.id}`}
                          className="flex items-center gap-1.5 hover:underline"
                        >
                          {negative && (
                            <TriangleAlert className="h-4 w-4 shrink-0 text-danger" />
                          )}
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {c.tdSynnexCustomer?.stellrId ?? "—"}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {c.tdSynnexCustomer ? subs.length : "—"}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {summary.activeCount > 0 ? (
                          <span className={negative ? "font-medium text-danger" : ""}>
                            {formatCurrency(summary.monthlyMargin, currency)}
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({summary.marginPct}%)
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {c.qboCustomer ? (
                          <span className="text-success">Linked</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {c.tdSynnexCustomer?.active === false ? (
                          <span className="text-warning">Inactive</span>
                        ) : (
                          <span className="text-muted-foreground">Active</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
