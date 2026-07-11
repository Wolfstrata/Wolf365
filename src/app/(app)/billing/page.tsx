import { Receipt } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, EmptyState, Card } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { ClearRunsButton } from "./clear-runs-button";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  REVIEWED: "bg-accent text-accent-foreground",
  APPROVED: "bg-warning/15 text-warning",
  PUSHED: "bg-success/15 text-success",
  PARTIALLY_FAILED: "bg-danger/15 text-danger",
  CANCELLED: "bg-muted text-muted-foreground",
};

/** Billing run history. Real runs only; empty until the first run is created. */
export default async function BillingPage() {
  const user = await requirePermission("billing:read");
  const [runs, clearableCount] = await Promise.all([
    prisma.billingRun.findMany({
      orderBy: { createdAt: "desc" },
      include: { client: true, _count: { select: { lines: true } } },
      take: 100,
    }),
    prisma.billingRun.count({ where: { status: { in: ["DRAFT", "CANCELLED"] } } }),
  ]);

  const canEdit = can(user.role, "billing:edit");

  return (
    <div>
      <PageHeader
        title="Billing Runs"
        description="Generate, review, approve, and push invoices to QuickBooks Online."
        actions={
          canEdit ? (
            <div className="flex items-center gap-3">
              <ClearRunsButton count={clearableCount} />
              <Link
                href="/billing/new"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                New billing run
              </Link>
            </div>
          ) : null
        }
      />
      <div className="p-4 sm:p-8">
        {runs.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-8 w-8" />}
            title="No billing runs yet"
            description="Once connectors are synced and clients mapped, you can generate a billing run, review the pre-push report, and push approved invoices."
          />
        ) : (
          <div className="space-y-2">
            {runs.map((r) => (
              <Link key={r.id} href={`/billing/${r.id}`}>
                <Card className="flex items-center justify-between transition hover:border-primary/40">
                <div>
                  <p className="font-medium">
                    {r.client?.name ?? "Bulk run"} · v{r.version}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Period {formatDateTime(r.periodStart)} – {formatDateTime(r.periodEnd)} ·{" "}
                    {r._count.lines} lines
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[r.status] ?? STATUS_STYLES.DRAFT
                  }`}
                >
                  {r.status.replaceAll("_", " ")}
                </span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
