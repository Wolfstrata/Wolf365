import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { transitionRunAction, pushRunAction } from "../actions";
import { LinesCard, type EditableLine } from "./lines-card";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  REVIEWED: "bg-accent text-accent-foreground",
  APPROVED: "bg-warning/15 text-warning",
  PUSHED: "bg-success/15 text-success",
  PARTIALLY_FAILED: "bg-danger/15 text-danger",
  CANCELLED: "bg-muted text-muted-foreground",
};

export default async function BillingRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "billing:read")) notFound();
  const { id } = await params;

  const run = await prisma.billingRun.findUnique({
    where: { id },
    include: {
      client: { include: { qboCustomer: true } },
      lines: true,
    },
  });
  if (!run) notFound();

  const qbo = run.client?.qboCustomer;

  // When a run has no lines, explain why: no linked M365 subscriptions, or
  // subscriptions that were all skipped (e.g. unmapped SKUs).
  const subCount =
    run.lines.length === 0 && run.clientId
      ? await prisma.tdSynnexSubscription.count({
          where: { customer: { clientId: run.clientId } },
        })
      : 0;
  const skipReasons =
    run.lines.length === 0 && run.clientId
      ? await prisma.exception.findMany({
          where: {
            clientId: run.clientId,
            type: { in: ["UNMAPPED_SKU", "MISSING_PRICE"] },
            status: { not: "RESOLVED" },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, message: true },
        })
      : [];

  const canApprove = can(user.role, "billing:approve");
  const editable = run.status === "DRAFT" && can(user.role, "billing:edit");
  const lines: EditableLine[] = run.lines.map((l) => ({
    id: l.id,
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    prorationFactor: Number(l.prorationFactor),
    proratedDays: l.proratedDays,
    periodDays: l.periodDays,
    discount: Number(l.discount),
    adjustment: Number(l.adjustment),
    estimatedCost: l.estimatedCost != null ? Number(l.estimatedCost) : null,
    subtotal: Number(l.subtotal),
    total: Number(l.total),
    taxStatus: l.taxStatus,
    qboItemId: l.qboItemId,
  }));

  return (
    <div>
      <PageHeader
        title={`Billing run — ${run.client?.name ?? "Unknown client"}`}
        description="Pre-push report. Review every line before pushing to QuickBooks."
        actions={
          <div className="flex items-center gap-3">
            {can(user.role, "reports:export") && (
              <a
                href={`/api/export?type=run&runId=${run.id}`}
                className="rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
              >
                Export CSV
              </a>
            )}
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[run.status]}`}>
              {run.status.replaceAll("_", " ")}
            </span>
          </div>
        }
      />
      <div className="space-y-6 p-8">
        <Link href="/billing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Billing runs
        </Link>

        {/* Run summary */}
        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            <StatItem label="Client" value={run.client?.name ?? "—"} />
            <StatItem label="Matched QBO customer" value={qbo?.displayName ?? "Not matched"} />
            <StatItem label="Invoice date" value={formatDateTime(run.invoiceDate)} />
            <StatItem label="Period" value={`${formatDateTime(run.periodStart)} – ${formatDateTime(run.periodEnd)}`} />
            <StatItem label="Lines" value={run.lines.length} />
            <StatItem label="Version" value={`v${run.version}`} />
          </div>
        </Card>

        {/* Line items */}
        {run.lines.length === 0 ? (
          <Card>
            <div className="space-y-2 py-6 text-sm">
              <p className="font-medium">No billable lines were generated.</p>
              {subCount === 0 ? (
                <p className="text-muted-foreground">
                  This client has <strong>no linked TD SYNNEX (Microsoft 365)
                  subscriptions</strong>, so there is nothing for this run to bill.
                  Billing runs only bill TD SYNNEX licensing — if this client should
                  have M365 licensing, link it to its TD SYNNEX customer in Mappings
                  (or it may genuinely have no M365 with us).
                </p>
              ) : skipReasons.length > 0 ? (
                <>
                  <p className="text-muted-foreground">
                    {subCount} subscription{subCount === 1 ? "" : "s"} found, but every
                    line was skipped — usually because the SKU isn&apos;t mapped to a
                    QuickBooks item. Confirm the mappings on the{" "}
                    <Link href="/mappings" className="text-primary hover:underline">
                      Mappings
                    </Link>{" "}
                    page, then regenerate this run:
                  </p>
                  <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                    {skipReasons.map((e) => (
                      <li key={e.id}>{e.message}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {subCount} subscription{subCount === 1 ? "" : "s"} found but none
                  produced a billable line for this period — check the subscription
                  active/renewal dates and proration, and the exception queue.
                </p>
              )}
            </div>
          </Card>
        ) : (
          <LinesCard lines={lines} editable={editable} hasQbo={Boolean(qbo)} />
        )}
        {editable && (
          <p className="text-xs text-muted-foreground">
            This run is a draft — edit any line inline, then mark it reviewed. Edits are
            recorded in the run&apos;s change history.
          </p>
        )}

        {/* Workflow actions */}
        {canApprove && (
          <Card className="flex flex-wrap items-center gap-3">
            {run.status === "DRAFT" && (
              <TransitionButton runId={run.id} to="REVIEWED" label="Mark reviewed" />
            )}
            {run.status === "REVIEWED" && (
              <>
                <TransitionButton runId={run.id} to="APPROVED" label="Approve" />
                <TransitionButton runId={run.id} to="DRAFT" label="Back to draft" subtle />
              </>
            )}
            {run.status === "APPROVED" && can(user.role, "billing:push") && (
              <form action={pushRunAction}>
                <input type="hidden" name="runId" value={run.id} />
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                >
                  Approve &amp; Push Selected Invoices to QuickBooks Online
                </button>
              </form>
            )}
            {run.status === "PARTIALLY_FAILED" && can(user.role, "billing:push") && (
              <form action={pushRunAction}>
                <input type="hidden" name="runId" value={run.id} />
                <button
                  type="submit"
                  className="rounded-md border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10"
                >
                  Retry push to QuickBooks
                </button>
              </form>
            )}
            {(run.status === "DRAFT" || run.status === "REVIEWED" || run.status === "APPROVED") && (
              <TransitionButton runId={run.id} to="CANCELLED" label="Cancel run" subtle />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function TransitionButton({
  runId,
  to,
  label,
  subtle,
}: {
  runId: string;
  to: string;
  label: string;
  subtle?: boolean;
}) {
  return (
    <form action={transitionRunAction}>
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="to" value={to} />
      <button
        type="submit"
        className={
          subtle
            ? "rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent"
            : "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        }
      >
        {label}
      </button>
    </form>
  );
}
