import Link from "next/link";
import { Building2, Plug, Receipt, TriangleAlert, TrendingUp, CalendarClock, PiggyBank } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { recurringSummary, toRecurringInput } from "@/lib/billing/recurring";

/**
 * Dashboard. Shows real counts from the database. With an empty database every
 * figure is honestly zero — we never fabricate activity.
 */
export default async function DashboardPage() {
  const user = await requireUser();

  const [clients, connectors, openExceptions, billingRuns, clientsWithSubs] =
    await Promise.all([
      prisma.client.count(),
      prisma.connector.count({ where: { enabled: true } }),
      prisma.exception.count({ where: { status: "OPEN" } }),
      prisma.billingRun.count(),
      prisma.client.findMany({
        where: { tdSynnexCustomer: { isNot: null } },
        select: {
          tdSynnexCustomer: {
            select: {
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
      }),
    ]);

  // Recurring revenue / cost / margin from synced M365 licensing. Computed
  // per-client so we can also flag clients that bill below cost.
  const allSubs = clientsWithSubs.flatMap(
    (c) => c.tdSynnexCustomer?.subscriptions ?? [],
  );
  const recurring = recurringSummary(allSubs.map(toRecurringInput));
  const negativeMarginClients = clientsWithSubs.filter((c) => {
    const s = recurringSummary(
      (c.tdSynnexCustomer?.subscriptions ?? []).map(toRecurringInput),
    );
    return s.activeCount > 0 && s.monthlyMargin < 0;
  }).length;
  const currency = allSubs.find((s) => s.currency)?.currency ?? "USD";

  const stats = [
    { label: "Clients", value: clients, icon: Building2 },
    { label: "Active connectors", value: connectors, icon: Plug },
    { label: "Open exceptions", value: openExceptions, icon: TriangleAlert },
    { label: "Billing runs", value: billingRuns, icon: Receipt },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome${user.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        description="Microsoft 365 billing reconciliation workspace"
      />
      <div className="p-8">
        {/* Recurring revenue / cost / margin from synced M365 licensing */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                MRR — Monthly Recurring Revenue
              </p>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {formatCurrency(recurring.mrr, currency)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Active, recurring M365 licensing · customer price × quantity
            </p>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                ARR — Annual Recurring Revenue
              </p>
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {formatCurrency(recurring.arr, currency)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">MRR × 12</p>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Monthly margin
              </p>
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {formatCurrency(recurring.monthlyMargin, currency)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              MRR − cost ({formatCurrency(recurring.monthlyCost, currency)}) ·{" "}
              {recurring.marginPct}% margin
            </p>
          </Card>
        </div>

        {/* Negative-margin warning — clients billing below cost */}
        {negativeMarginClients > 0 && (
          <Link href="/clients" className="mb-4 block">
            <Card className="border-danger/40 bg-danger/10 transition hover:bg-danger/15">
              <div className="flex items-center gap-3">
                <TriangleAlert className="h-5 w-5 shrink-0 text-danger" />
                <div>
                  <p className="text-sm font-semibold text-danger">
                    {negativeMarginClients}{" "}
                    {negativeMarginClients === 1 ? "client is" : "clients are"}{" "}
                    billing below cost
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Negative monthly margin on synced M365 licensing. Review and
                    adjust pricing — view the client list.
                  </p>
                </div>
              </div>
            </Card>
          </Link>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label}>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="mt-2 text-3xl font-semibold tabular-nums">
                {s.value}
              </p>
            </Card>
          ))}
        </div>

        <Card className="mt-6">
          <h2 className="text-sm font-semibold">Getting started</h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Configure and enable your connectors (QuickBooks, TD SYNNEX).</li>
            <li>Run a sync to import customers, subscriptions, and items.</li>
            <li>Review client mappings and resolve any discrepancies.</li>
            <li>Generate a billing run, review the pre-push report, then push.</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
