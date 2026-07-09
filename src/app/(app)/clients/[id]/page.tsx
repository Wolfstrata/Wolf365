import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { recurringSummary, monthlyRevenue, toRecurringInput } from "@/lib/billing/recurring";
import { extractMsrp } from "@/lib/licensing/msrp";
import { M365LicensingTable, type M365LicensingRow } from "./m365-licensing-table";
import {
  detectDiscrepancies,
  type AddressLike,
  type Discrepancy,
} from "@/lib/reconciliation/discrepancies";

/** Human label for the TD SYNNEX billing/commitment type. */
function billingTypeLabel(term: string | null, freq: string | null): string | null {
  const t = (term ?? freq ?? "").toLowerCase();
  if (t === "one_time") return "One-time";
  if (t === "monthly" || t === "month") return "Monthly";
  if (t === "annual" || t === "year") return "Annual";
  if (t === "triennial") return "Triennial";
  return term ?? freq ?? null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const SEVERITY_STYLES: Record<Discrepancy["severity"], string> = {
  error: "border-danger/40 bg-danger/10 text-danger",
  warning: "border-warning/40 bg-warning/10 text-warning",
  info: "border-border bg-muted text-muted-foreground",
};

function formatAddress(addr: unknown): string {
  if (!addr || typeof addr !== "object") return "—";
  const a = addr as AddressLike;
  const parts = [
    a.Line1 ?? a.line1,
    a.City ?? a.city,
    a.CountrySubDivisionCode ?? a.region,
    a.PostalCode ?? a.postalCode,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("clients:read");
  const { id } = await params;

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      qboCustomer: true,
      tdSynnexCustomer: { include: { subscriptions: true } },
      huduMatch: true,
      superOpsMatch: true,
      parentClient: { select: { id: true, name: true } },
      subsidiaries: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
  });
  if (!client) notFound();

  const canMap = can(user.role, "mappings:approve");
  const isGroup = client.subsidiaries.length > 0;

  // Group rollup: cumulative recurring across this client + all its
  // subsidiaries' M365 licensing. Each subscription belongs to exactly one
  // client, so this query counts each once (no double-counting).
  const groupSubs = isGroup
    ? await prisma.tdSynnexSubscription.findMany({
        where: {
          customer: { client: { OR: [{ id: client.id }, { parentClientId: client.id }] } },
        },
        select: {
          productSku: true,
          productName: true,
          customerPrice: true,
          unitCost: true,
          quantity: true,
          billingFrequency: true,
          status: true,
          currency: true,
        },
      })
    : [];
  const groupSummary = groupSubs.length > 0 ? recurringSummary(groupSubs.map(toRecurringInput)) : null;
  const groupCurrency = groupSubs.find((s) => s.currency)?.currency ?? "CAD";

  // Aggregate the group's licensing by SKU — one row per SKU with summed
  // quantity and recurring totals.
  type GroupSub = (typeof groupSubs)[number];
  const bySku = new Map<string, { sku: string; name: string; qty: number; subs: GroupSub[] }>();
  for (const s of groupSubs) {
    const key = s.productSku ?? s.productName ?? "—";
    const entry = bySku.get(key) ?? {
      sku: s.productSku ?? "—",
      name: s.productName ?? key,
      qty: 0,
      subs: [],
    };
    entry.qty += s.quantity;
    entry.subs.push(s);
    bySku.set(key, entry);
  }
  const groupSkuRows = [...bySku.values()]
    .map((e) => {
      const summary = recurringSummary(e.subs.map(toRecurringInput));
      return {
        sku: e.sku,
        name: e.name,
        qty: e.qty,
        mrr: summary.mrr,
        monthlyCost: summary.monthlyCost,
        monthlyMargin: summary.monthlyMargin,
      };
    })
    .sort((a, b) => b.mrr - a.mrr);

  const qbo = client.qboCustomer;
  const td = client.tdSynnexCustomer;

  // Per-client recurring totals from this customer's M365 licensing.
  const recurring = td
    ? recurringSummary(
        td.subscriptions.map((s) => ({
          customerPrice: s.customerPrice != null ? Number(s.customerPrice) : null,
          unitCost: s.unitCost != null ? Number(s.unitCost) : null,
          quantity: s.quantity,
          billingFrequency: s.billingFrequency,
          status: s.status,
        })),
      )
    : null;
  const recurringCurrency =
    td?.subscriptions.find((s) => s.currency)?.currency ?? "CAD";

  // Rows for the enhanced, sortable/filterable M365 licensing table.
  const m365Rows: M365LicensingRow[] = (td?.subscriptions ?? []).map((s) => {
    const currency = s.currency ?? "CAD";
    const unitCost = s.unitCost != null ? Number(s.unitCost) : null;
    const customerPrice = s.customerPrice != null ? Number(s.customerPrice) : null;
    const oneTime =
      (s.commitmentTerm ?? s.billingFrequency ?? "").toLowerCase() === "one_time";
    return {
      id: s.id,
      sku: s.productSku,
      product: s.productName,
      billingType: billingTypeLabel(s.commitmentTerm, s.billingFrequency),
      oneTime,
      quantity: s.quantity,
      unitCost,
      extendedCost: unitCost != null ? round2(unitCost * s.quantity) : null,
      msrp: extractMsrp(s.raw),
      customerPrice,
      marginPerUnit:
        unitCost != null && customerPrice != null ? round2(customerPrice - unitCost) : null,
      underCost: unitCost != null && customerPrice != null && customerPrice < unitCost,
      mrr: monthlyRevenue(toRecurringInput(s)),
      term: s.commitmentTerm,
      renewalDate: s.renewalDate ? s.renewalDate.toISOString() : null,
      status: s.status,
      reducible: s.reducible,
      currency,
    };
  });

  const discrepancies = detectDiscrepancies({
    qbo: qbo
      ? {
          displayName: qbo.displayName,
          companyName: qbo.companyName,
          billingEmail: qbo.billingEmail,
          billingAddress: qbo.billingAddress as AddressLike | null,
          currency: qbo.currency,
          taxable: qbo.taxable,
          active: qbo.active,
        }
      : null,
    td: td
      ? {
          name: td.name,
          domain: td.domain,
          serviceAddress: td.serviceAddress as AddressLike | null,
          active: td.active,
        }
      : null,
  });

  return (
    <div>
      <PageHeader
        title={client.name}
        description={client.active ? "Active client" : "Inactive client"}
        actions={
          <Link
            href={`/billing/new?clientId=${client.id}`}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Generate billing run
          </Link>
        }
      />
      <div className="space-y-6 p-8">
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All clients
        </Link>

        {/* Discrepancies */}
        {discrepancies.length > 0 && (
          <div className="space-y-2">
            {discrepancies.map((dz, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${SEVERITY_STYLES[dz.severity]}`}
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{dz.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Side-by-side comparison */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">QuickBooks Online</h2>
            {qbo ? (
              <div className="grid grid-cols-2 gap-3">
                <StatItem label="QBO Customer ID" value={qbo.qboId} />
                <StatItem label="Display name" value={qbo.displayName} />
                <StatItem label="Company" value={qbo.companyName ?? "—"} />
                <StatItem label="Billing email" value={qbo.billingEmail ?? "—"} />
                <StatItem label="Billing address" value={formatAddress(qbo.billingAddress)} />
                <StatItem label="Currency" value={qbo.currency ?? "—"} />
                <StatItem label="Payment terms" value={qbo.paymentTerms ?? "—"} />
                <StatItem label="Tax status" value={qbo.taxStatus ?? (qbo.taxable == null ? "Unknown" : qbo.taxable ? "Taxable" : "Non-taxable")} />
                <StatItem label="Status" value={qbo.active ? "Active" : "Inactive"} />
                <StatItem label="Last QBO sync" value={formatDateTime(qbo.lastSyncedAt)} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No linked QuickBooks customer.</p>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold">TD SYNNEX StreamOne</h2>
            {td ? (
              <div className="grid grid-cols-2 gap-3">
                <StatItem label="StreamOne ID" value={td.stellrId} />
                <StatItem label="Name" value={td.name} />
                <StatItem label="Domain" value={td.domain ?? "—"} />
                <StatItem label="MS tenant ID" value={td.microsoftTenantId ?? "—"} />
                <StatItem label="Service address" value={formatAddress(td.serviceAddress)} />
                <StatItem label="Subscriptions" value={td.subscriptions.length} />
                <StatItem label="Status" value={td.active ? "Active" : "Inactive"} />
                <StatItem label="Last TD SYNNEX sync" value={formatDateTime(td.lastSyncedAt)} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No linked TD SYNNEX customer.</p>
            )}
          </Card>
        </div>

        {/* Client associations — compact summary; editing lives on its own page */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Client associations</h2>
              {client.parentClient ? (
                <p className="mt-1 text-sm">
                  Subsidiary of{" "}
                  <Link
                    href={`/clients/${client.parentClient.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {client.parentClient.name}
                  </Link>
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  {client.subsidiaries.length > 0
                    ? `${client.subsidiaries.length} subsidiary${client.subsidiaries.length === 1 ? "" : "ies"}`
                    : "No parent or subsidiaries."}
                </p>
              )}
            </div>
            {canMap && (
              <Link
                href={`/clients/${client.id}/associations`}
                className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
              >
                Edit associations
              </Link>
            )}
          </div>
          {client.subsidiaries.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {client.subsidiaries.map((s) => (
                <Link
                  key={s.id}
                  href={`/clients/${s.id}`}
                  className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-accent"
                >
                  {s.name}
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Group rollup across parent + subsidiaries */}
        {client.subsidiaries.length > 0 && groupSummary && (
          <Card>
            <h2 className="text-sm font-semibold">
              Group totals — {client.name} + {client.subsidiaries.length}{" "}
              subsidiary{client.subsidiaries.length === 1 ? "" : "ies"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Cumulative recurring across this client and all its subsidiaries&apos;
              Microsoft 365 licensing.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatItem label="Group MRR" value={formatCurrency(groupSummary.mrr, groupCurrency)} />
              <StatItem label="Group ARR" value={formatCurrency(groupSummary.arr, groupCurrency)} />
              <StatItem
                label="Monthly cost"
                value={formatCurrency(groupSummary.monthlyCost, groupCurrency)}
              />
              <StatItem
                label={`Monthly margin (${groupSummary.marginPct}%)`}
                value={formatCurrency(groupSummary.monthlyMargin, groupCurrency)}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {groupSummary.activeCount} active subscription
              {groupSummary.activeCount === 1 ? "" : "s"} across{" "}
              {1 + client.subsidiaries.length} clients.
            </p>
          </Card>
        )}

        {/* Group licensing combined by SKU (counts each subscription once) */}
        {isGroup && groupSkuRows.length > 0 && (
          <Card>
            <h2 className="mb-1 text-sm font-semibold">
              Group Microsoft 365 licensing — by SKU
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              All licensing across {client.name} and its subsidiaries, combined per
              SKU.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">SKU</th>
                    <th className="py-1 pr-4 font-medium">Product</th>
                    <th className="py-1 pr-4 font-medium">Total qty</th>
                    <th className="py-1 pr-4 font-medium">Monthly cost</th>
                    <th className="py-1 pr-4 font-medium">MRR / mo</th>
                    <th className="py-1 pr-4 font-medium">Monthly margin</th>
                  </tr>
                </thead>
                <tbody>
                  {groupSkuRows.map((r) => (
                    <tr key={`${r.sku}|${r.name}`} className="border-t align-top">
                      <td className="py-1.5 pr-4 font-mono text-xs">{r.sku}</td>
                      <td className="py-1.5 pr-4">{r.name}</td>
                      <td className="py-1.5 pr-4 tabular-nums">{r.qty}</td>
                      <td className="py-1.5 pr-4 tabular-nums">
                        {formatCurrency(r.monthlyCost, groupCurrency)}
                      </td>
                      <td className="py-1.5 pr-4 tabular-nums">
                        {formatCurrency(r.mrr, groupCurrency)}
                      </td>
                      <td className="py-1.5 pr-4 tabular-nums">
                        {formatCurrency(r.monthlyMargin, groupCurrency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Per-client recurring totals from M365 licensing */}
        {recurring && recurring.activeCount > 0 && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold">
              Recurring totals ({recurring.activeCount} active)
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatItem
                label="MRR"
                value={formatCurrency(recurring.mrr, recurringCurrency)}
              />
              <StatItem
                label="ARR"
                value={formatCurrency(recurring.arr, recurringCurrency)}
              />
              <StatItem
                label="Monthly cost"
                value={formatCurrency(recurring.monthlyCost, recurringCurrency)}
              />
              <StatItem
                label={`Monthly margin (${recurring.marginPct}%)`}
                value={formatCurrency(recurring.monthlyMargin, recurringCurrency)}
              />
            </div>
          </Card>
        )}

        {/* Mapping boxes */}
        {(client.huduMatch || client.superOpsMatch) && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {client.huduMatch && (
              <Card>
                <h2 className="mb-2 text-sm font-semibold">Hudu</h2>
                <StatItem label="Company" value={client.huduMatch.name} />
              </Card>
            )}
            {client.superOpsMatch && (
              <Card>
                <h2 className="mb-2 text-sm font-semibold">SuperOps</h2>
                <StatItem label="Client" value={client.superOpsMatch.name} />
              </Card>
            )}
          </div>
        )}

        {/* This client's own licensing (groups show the combined by-SKU table
            above instead, to avoid a long duplicated list). */}
        {!isGroup && td && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold">
              Microsoft 365 licensing ({td.subscriptions.length})
            </h2>
            {td.subscriptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No subscriptions synced for this customer. Run a TD SYNNEX sync,
                or this customer may have no active TD SYNNEX subscriptions.
              </p>
            ) : (
              <M365LicensingTable rows={m365Rows} />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
