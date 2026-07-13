import { Receipt } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SyncSuperOpsButton } from "./sync-button";
import { reviewInvoiceAction, pushInvoiceAction } from "./actions";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  REVIEWED: "bg-accent text-accent-foreground",
  PUSHED: "bg-success/15 text-success",
  SKIPPED: "bg-muted text-muted-foreground",
};

/**
 * SuperOps billing review — a SEPARATE pipeline from M365/TD SYNNEX agreement
 * billing. Import SuperOps invoices, review them, and push to QuickBooks.
 */
export default async function SuperOpsBillingPage() {
  const user = await requireUser();
  if (!can(user.role, "billing:read")) {
    return <PageHeader title="SuperOps Billing" description="Insufficient permissions." />;
  }
  const canEdit = can(user.role, "billing:edit");
  const canPush = can(user.role, "billing:push");

  const invoices = await prisma.superOpsInvoice.findMany({
    orderBy: [{ reviewStatus: "asc" }, { invoiceDate: "desc" }],
    include: {
      lines: true,
      client: { include: { qboCustomer: true } },
    },
    take: 300,
  });

  return (
    <div>
      <PageHeader
        title="SuperOps Billing"
        description="Import SuperOps invoices, review them, and push to QuickBooks Online — separate from M365 agreement billing."
        actions={can(user.role, "connectors:sync") ? <SyncSuperOpsButton /> : null}
      />
      <div className="space-y-3 p-4 sm:p-8">
        {invoices.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-8 w-8" />}
            title="No SuperOps invoices imported"
            description="Configure and enable the SuperOps connector, then click 'Import from SuperOps' to pull invoices here for review."
          />
        ) : (
          invoices.map((inv) => {
            const qboLinked = Boolean(inv.client?.qboCustomer);
            const pushable =
              canPush &&
              qboLinked &&
              inv.lines.length > 0 &&
              inv.reviewStatus !== "PUSHED";
            return (
              <Card key={inv.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-medium">
                        {inv.invoiceNumber ?? inv.superOpsId}
                      </h2>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[inv.reviewStatus] ?? STATUS_STYLES.PENDING
                        }`}
                      >
                        {inv.reviewStatus}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {inv.client?.name ?? inv.superOpsClientName ?? "Unmatched client"}
                      {" · "}
                      {qboLinked ? (
                        <span className="text-success">QBO linked</span>
                      ) : (
                        <span className="text-danger">No QBO customer</span>
                      )}
                      {inv.invoiceDate ? ` · ${formatDate(inv.invoiceDate)}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">
                      {formatCurrency(inv.total != null ? Number(inv.total) : null, inv.currency ?? "USD")}
                    </p>
                    {inv.qboInvoiceId && (
                      <p className="text-xs text-success">QBO #{inv.qboInvoiceId}</p>
                    )}
                  </div>
                </div>

                {/* Line items */}
                <div className="mt-3 overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Description</th>
                        <th className="px-3 py-1.5 font-medium">Qty</th>
                        <th className="px-3 py-1.5 font-medium">Unit price</th>
                        <th className="px-3 py-1.5 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.lines.map((l) => (
                        <tr key={l.id} className="border-t">
                          <td className="px-3 py-1.5">{l.description}</td>
                          <td className="px-3 py-1.5 tabular-nums">{Number(l.quantity)}</td>
                          <td className="px-3 py-1.5 tabular-nums">{formatCurrency(Number(l.unitPrice), inv.currency ?? "USD")}</td>
                          <td className="px-3 py-1.5 tabular-nums">{formatCurrency(Number(l.amount), inv.currency ?? "USD")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {inv.pushError && (
                  <p className="mt-2 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
                    Push failed: {inv.pushError}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canEdit && inv.reviewStatus !== "PUSHED" && (
                    <>
                      <StatusForm id={inv.id} status="REVIEWED" label="Mark reviewed" />
                      <StatusForm id={inv.id} status="SKIPPED" label="Skip" subtle />
                      {inv.reviewStatus !== "PENDING" && (
                        <StatusForm id={inv.id} status="PENDING" label="Reset" subtle />
                      )}
                    </>
                  )}
                  {pushable && (
                    <form action={pushInvoiceAction}>
                      <input type="hidden" name="id" value={inv.id} />
                      <button
                        type="submit"
                        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                      >
                        Push to QuickBooks
                      </button>
                    </form>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatusForm({
  id,
  status,
  label,
  subtle,
}: {
  id: string;
  status: string;
  label: string;
  subtle?: boolean;
}) {
  return (
    <form action={reviewInvoiceAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className={
          subtle
            ? "rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
            : "rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
        }
      >
        {label}
      </button>
    </form>
  );
}
