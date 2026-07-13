import Link from "next/link";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, EmptyState, Card } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";
import { setExceptionStatusAction } from "./actions";
import { ReconcileButton } from "./reconcile-button";

// Reconciliation scans every client; allow the same window as the cron.
export const maxDuration = 300;

const SEVERITY_STYLES: Record<string, string> = {
  error: "text-danger",
  warning: "text-warning",
  info: "text-muted-foreground",
};

/** Exception / reconciliation queue. Real rows produced by sync + discrepancy
 * detection; empty when there is genuinely nothing to resolve. */
export default async function ExceptionsPage() {
  const user = await requirePermission("reports:read");
  const canPropose = can(user.role, "mappings:propose");
  const exceptions = await prisma.exception.findMany({
    where: { status: { not: "RESOLVED" } },
    orderBy: { createdAt: "desc" },
    include: { client: true },
    take: 300,
  });

  return (
    <div>
      <PageHeader
        title="Exceptions"
        description="Unmapped clients/SKUs, missing prices, discrepancies, and connector failures."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canPropose && <ReconcileButton />}
            {can(user.role, "reports:export") && exceptions.length > 0 && (
              <a
                href="/api/export?type=exceptions"
                className="rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
              >
                Export CSV
              </a>
            )}
          </div>
        }
      />
      <div className="p-4 sm:p-8">
        {exceptions.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-8 w-8 text-success" />}
            title="No open exceptions"
            description="Reconciliation issues will appear here as connectors sync and billing runs are generated."
          />
        ) : (
          <div className="space-y-2">
            {exceptions.map((e) => (
              <Card key={e.id} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${SEVERITY_STYLES[e.severity] ?? ""}`}>
                    {e.type.replaceAll("_", " ")}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{e.message}</p>
                  {e.client && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Client:{" "}
                      <Link
                        href={`/clients/${e.client.id}`}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {e.client.name}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="text-xs text-muted-foreground">
                    <LocalTime value={e.createdAt} />
                  </span>
                  {canPropose && (
                    <div className="flex gap-2">
                      {e.client && (
                        <Link
                          href={`/clients/${e.client.id}/associations`}
                          className="rounded-md border px-2.5 py-1 text-xs font-medium transition hover:bg-accent"
                        >
                          Manage links
                        </Link>
                      )}
                      <form action={setExceptionStatusAction}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="status" value="RESOLVED" />
                        <button
                          type="submit"
                          className="rounded-md border px-2.5 py-1 text-xs font-medium transition hover:bg-accent"
                        >
                          Dismiss
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
