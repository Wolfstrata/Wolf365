import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";
import { formatCurrency } from "@/lib/utils";
import { formatHours } from "@/lib/silverfang/time";
import { canPush, linesEditable } from "@/lib/sfbilling/state";
import {
  deleteSfBillingRunAction,
  pushSfRunAction,
  transitionSfRunAction,
} from "../actions";
import { SfLinesCard, type SfEditableLine } from "./lines-card";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  REVIEWED: "bg-accent text-accent-foreground",
  APPROVED: "bg-warning/15 text-warning",
  PUSHED: "bg-success/15 text-success",
  PARTIALLY_FAILED: "bg-danger/15 text-danger",
  CANCELLED: "bg-muted text-muted-foreground",
};

const COVERED_LABELS: Record<string, string> = {
  NOT_BILLABLE: "marked non-billable",
  PREPAID_BLOCK: "drawn from prepaid hours",
  AGREEMENT_INCLUSION: "inside the agreement's included hours",
  FIXED_FEE_PROJECT: "covered by a fixed-fee project",
  NO_RATE: "no rate — NOT billed",
};

export default async function SfBillingRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "billing:read")) notFound();
  const { id } = await params;

  const run = await prisma.sfBillingRun.findUnique({
    where: { id },
    include: {
      client: {
        select: { id: true, name: true, qboCustomer: { select: { qboId: true, displayName: true } } },
      },
      lines: {
        orderBy: [{ kind: "asc" }, { description: "asc" }],
        include: {
          chargeCode: { select: { name: true } },
          _count: { select: { timeEntries: true } },
        },
      },
      edits: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  if (!run) notFound();

  const [items, itemNames] = await Promise.all([
    prisma.qboItem.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { qboId: true, name: true },
      take: 1000,
    }),
    prisma.qboItem.findMany({
      where: { qboId: { in: run.lines.map((l) => l.qboItemId).filter((v): v is string => v != null) } },
      select: { qboId: true, name: true },
    }),
  ]);
  const nameByItem = new Map(itemNames.map((i) => [i.qboId, i.name]));

  const canApprove = can(user.role, "billing:approve");
  const canEdit = can(user.role, "billing:edit");
  const canPushRun = can(user.role, "billing:push");
  const editable = linesEditable(run.status) && canEdit;
  const hasQbo = run.client.qboCustomer != null;

  const lines: SfEditableLine[] = run.lines.map((l) => ({
    id: l.id,
    kind: l.kind,
    description: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    discount: Number(l.discount),
    adjustment: Number(l.adjustment),
    subtotal: Number(l.subtotal),
    total: Number(l.total),
    estimatedCost: l.estimatedCost != null ? Number(l.estimatedCost) : null,
    taxStatus: l.taxStatus,
    qboItemId: l.qboItemId,
    qboItemName: l.qboItemId ? (nameByItem.get(l.qboItemId) ?? null) : null,
    hoursVisible: l.hoursVisible,
    timeEntryCount: l._count.timeEntries,
  }));

  const total = lines.reduce((a, l) => a + l.total, 0);
  const billedHours = lines
    .filter((l) => l.kind === "TIME" || l.kind === "OVERAGE")
    .reduce((a, l) => a + l.quantity, 0);

  // What was considered and not charged. Recomputed for display so a reviewer can
  // see that every hour is accounted for, not just the ones that bill.
  const coveredEntries = await prisma.sfTimeEntry.findMany({
    where: {
      workDate: { gte: run.periodStart, lt: run.periodEnd },
      OR: [
        { ticket: { clientId: run.clientId } },
        { agreement: { clientId: run.clientId } },
        { projectTask: { project: { clientId: run.clientId } } },
        { projectPhase: { project: { clientId: run.clientId } } },
      ],
      billingLines: { none: {} },
    },
    select: {
      id: true,
      hours: true,
      billable: true,
      status: true,
      rate: true,
      workDate: true,
      chargeCode: { select: { name: true } },
      ticket: { select: { number: true } },
    },
    orderBy: { workDate: "asc" },
    take: 200,
  });

  const eligibleCount = hasQbo ? lines.filter((l) => l.qboItemId).length : 0;
  const notReadyCount = lines.length - eligibleCount;

  return (
    <div>
      <PageHeader
        title={`SilverFang billing run — ${run.client.name}`}
        description="Approved service work staged for QuickBooks. Nothing is sent until you push it."
        actions={
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[run.status] ?? ""}`}
          >
            {run.status.replaceAll("_", " ")}
          </span>
        }
      />
      <div className="space-y-6 p-4 sm:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/silverfang-billing"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> SilverFang Billing
          </Link>
          <Link
            href={`/silverfang/clients/${run.client.id}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> {run.client.name}
          </Link>
        </div>

        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatItem label="Client" value={run.client.name} />
            <StatItem
              label="QuickBooks customer"
              value={run.client.qboCustomer?.displayName ?? "not matched"}
            />
            <StatItem
              label="Period"
              value={
                <span className="text-sm">
                  <LocalTime value={run.periodStart} dateOnly /> –{" "}
                  <LocalTime value={new Date(run.periodEnd.getTime() - 86_400_000)} dateOnly />
                </span>
              }
            />
            <StatItem label="Invoice date" value={<LocalTime value={run.invoiceDate} dateOnly />} />
            <StatItem label="Billable hours" value={formatHours(billedHours)} />
            <StatItem label="Total" value={formatCurrency(total)} />
          </div>
        </Card>

        {run.notes && (
          <Card>
            <h2 className="mb-2 text-sm font-semibold">Generation notes</h2>
            <ul className="space-y-1 text-sm">
              {run.notes.split("\n").map((n, i) => {
                const error = n.startsWith("[error]");
                const warning = n.startsWith("[warning]");
                return (
                  <li
                    key={i}
                    className={error ? "text-danger" : warning ? "text-warning" : "text-muted-foreground"}
                  >
                    {n.replace(/^\[(info|warning|error)\]\s*/, "")}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {run.pushError && (
          <Card>
            <p className="text-sm text-danger">{run.pushError}</p>
          </Card>
        )}

        {run.qboInvoiceId && (
          <Card>
            <p className="text-sm text-success">
              Pushed to QuickBooks as invoice {run.qboInvoiceId}
              {run.pushedAt && (
                <>
                  {" "}
                  on <LocalTime value={run.pushedAt} />
                </>
              )}
              .
            </p>
          </Card>
        )}

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Lines ({lines.length})</h2>
          <SfLinesCard lines={lines} editable={editable} hasQbo={hasQbo} items={items} />
        </Card>

        {coveredEntries.length > 0 && (
          <Card>
            <h2 className="mb-1 text-sm font-semibold">
              Time considered but not charged ({coveredEntries.length})
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Every hour in the period is accounted for. These produced no charge — mostly because
              something had already paid for them.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Date</th>
                    <th className="py-1 pr-3 font-medium">Ticket</th>
                    <th className="py-1 pr-3 font-medium">Charge code</th>
                    <th className="py-1 pr-3 text-right font-medium">Hours</th>
                    <th className="py-1 pr-3 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {coveredEntries.map((e) => {
                    const why = !e.billable
                      ? "NOT_BILLABLE"
                      : e.status !== "APPROVED" && e.status !== "INVOICED"
                        ? null
                        : e.rate == null
                          ? "NO_RATE"
                          : "PREPAID_BLOCK";
                    return (
                      <tr key={e.id} className="border-t">
                        <td className="py-1.5 pr-3">
                          <LocalTime value={e.workDate} dateOnly />
                        </td>
                        <td className="py-1.5 pr-3">
                          {e.ticket ? `#${e.ticket.number}` : "—"}
                        </td>
                        <td className="py-1.5 pr-3">{e.chargeCode.name}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {formatHours(Number(e.hours))}
                        </td>
                        <td
                          className={`py-1.5 pr-3 text-xs ${
                            why === "NO_RATE" ? "text-danger" : "text-muted-foreground"
                          }`}
                        >
                          {why
                            ? COVERED_LABELS[why]
                            : `not approved yet (${e.status.toLowerCase()})`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {(canApprove || canPushRun || canEdit) && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Workflow</h2>
            {lines.length > 0 && (
              <p className="mb-3 text-xs text-muted-foreground">
                {eligibleCount} of {lines.length} line(s) can be pushed.
                {notReadyCount > 0 &&
                  ` ${notReadyCount} cannot — ${hasQbo ? "no mapped QuickBooks item" : "this client has no QuickBooks customer"}.`}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {canApprove && run.status === "DRAFT" && (
                <TransitionButton runId={run.id} to="REVIEWED" label="Mark reviewed" />
              )}
              {canApprove && run.status === "REVIEWED" && (
                <>
                  <TransitionButton runId={run.id} to="APPROVED" label="Approve" />
                  <TransitionButton runId={run.id} to="DRAFT" label="Back to draft" subtle />
                </>
              )}
              {canPushRun && canPush(run.status) && (
                <form action={pushSfRunAction}>
                  <input type="hidden" name="runId" value={run.id} />
                  <button
                    type="submit"
                    disabled={eligibleCount === 0}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${
                      run.status === "PARTIALLY_FAILED"
                        ? "border border-danger/40 text-danger hover:bg-danger/10"
                        : "bg-primary text-primary-foreground hover:opacity-90"
                    }`}
                  >
                    {run.status === "PARTIALLY_FAILED"
                      ? "Retry push to QuickBooks"
                      : "Push invoice to QuickBooks Online"}
                  </button>
                </form>
              )}
              {canApprove &&
                (run.status === "DRAFT" ||
                  run.status === "REVIEWED" ||
                  run.status === "APPROVED") && (
                  <TransitionButton runId={run.id} to="CANCELLED" label="Cancel run" subtle />
                )}
              {canEdit && (run.status === "DRAFT" || run.status === "CANCELLED") && (
                <form action={deleteSfBillingRunAction} className="ml-auto">
                  <input type="hidden" name="runId" value={run.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-danger/40 px-3 py-2 text-sm font-medium text-danger transition hover:bg-danger/10"
                  >
                    Delete run
                  </button>
                </form>
              )}
            </div>
          </Card>
        )}

        {run.edits.length > 0 && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Edit trail ({run.edits.length})</h2>
            <ul className="space-y-1 text-xs">
              {run.edits.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  <LocalTime value={e.createdAt} />
                  <span className="font-medium">{e.field}</span>
                  <span className="text-muted-foreground">
                    {e.oldValue ?? "—"} → {e.newValue ?? "—"}
                  </span>
                  <span className="text-muted-foreground">{e.editedByEmail ?? ""}</span>
                </li>
              ))}
            </ul>
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
    <form action={transitionSfRunAction}>
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="to" value={to} />
      <button
        type="submit"
        className={
          subtle
            ? "rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
            : "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        }
      >
        {label}
      </button>
    </form>
  );
}
