import { Building2, Plug, Receipt, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";

/**
 * Dashboard. Shows real counts from the database. With an empty database every
 * figure is honestly zero — we never fabricate activity.
 */
export default async function DashboardPage() {
  const user = await requireUser();

  const [clients, connectors, openExceptions, billingRuns] = await Promise.all([
    prisma.client.count(),
    prisma.connector.count({ where: { enabled: true } }),
    prisma.exception.count({ where: { status: "OPEN" } }),
    prisma.billingRun.count(),
  ]);

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
