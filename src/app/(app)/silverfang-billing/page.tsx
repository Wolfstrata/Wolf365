import Link from "next/link";
import { ReceiptText, Settings } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, EmptyState, Card } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { LocalTime } from "@/components/ui/local-time";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  REVIEWED: "bg-accent text-accent-foreground",
  APPROVED: "bg-warning/15 text-warning",
  PUSHED: "bg-success/15 text-success",
  PARTIALLY_FAILED: "bg-danger/15 text-danger",
  CANCELLED: "bg-muted text-muted-foreground",
};

/**
 * SilverFang billing runs: service work (time, agreements, projects) staged for
 * QuickBooks. Separate from the M365 runs on purpose — different sources, and one
 * screen answering two questions would serve neither.
 */
export default async function SilverFangBillingPage() {
  const user = await requirePermission("billing:read");
  const [runs, unbilled] = await Promise.all([
    prisma.sfBillingRun.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { id: true, name: true } },
        lines: { select: { total: true } },
      },
      take: 100,
    }),
    // Approved time nobody has billed yet: the number that says whether this page
    // is up to date.
    prisma.sfTimeEntry.aggregate({
      where: { status: "APPROVED", invoicedAt: null, billable: true },
      _sum: { hours: true, amount: true },
      _count: true,
    }),
  ]);

  const canEdit = can(user.role, "billing:edit");
  const unbilledHours = Number(unbilled._sum.hours ?? 0);
  const unbilledValue = Number(unbilled._sum.amount ?? 0);

  return (
    <div>
      <PageHeader
        help={<PawTip topic="billing" />}
        title="SilverFang Billing"
        description="Turn approved time, agreements and projects into QuickBooks invoices — reviewed and approved by a human first."
        actions={
          <div className="flex items-center gap-3">
            <Link
              href="/silverfang-billing/settings"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
            >
              <Settings className="h-4 w-4" /> Item mapping
            </Link>
            {canEdit && (
              <Link
                href="/silverfang-billing/new"
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                New billing run
              </Link>
            )}
          </div>
        }
      />
      <div className="space-y-6 p-4 sm:p-8">
        {unbilled._count > 0 && (
          <Card>
            <p className="text-sm">
              <span className="font-medium">{unbilled._count} approved time entr{unbilled._count === 1 ? "y" : "ies"}</span>{" "}
              ({unbilledHours.toFixed(2)}h, {formatCurrency(unbilledValue)}) have not been billed.
              Generate a run for the period to stage them.
            </p>
          </Card>
        )}

        {runs.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="h-8 w-8" />}
            title="No SilverFang billing runs yet"
            description="A run gathers a client's approved time, recurring agreement fees, prepaid block purchases, project fees and deposits for a period. Nothing reaches QuickBooks until you approve and push it."
          />
        ) : (
          <div className="space-y-2">
            {runs.map((r) => {
              const total = r.lines.reduce((a, l) => a + Number(l.total), 0);
              return (
                <Link key={r.id} href={`/silverfang-billing/${r.id}`}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 transition hover:border-primary/40">
                    <div>
                      <p className="text-sm font-medium">{r.client.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <LocalTime value={r.periodStart} dateOnly /> –{" "}
                        <LocalTime
                          value={new Date(r.periodEnd.getTime() - 86_400_000)}
                          dateOnly
                        />{" "}
                        · {r.lines.length} line{r.lines.length === 1 ? "" : "s"} ·{" "}
                        invoice <LocalTime value={r.invoiceDate} dateOnly />
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium tabular-nums">
                        {formatCurrency(total)}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status] ?? ""}`}
                      >
                        {r.status.replaceAll("_", " ")}
                      </span>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
