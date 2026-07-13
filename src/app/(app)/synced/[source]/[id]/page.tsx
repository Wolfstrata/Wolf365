import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LinkIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { formatCurrency, formatDateTime, formatDate } from "@/lib/utils";
import { isSourceSlug, SOURCE_LABELS } from "@/lib/connector-sources";
import { renewalWindow, type RenewalBucket } from "@/lib/licensing/renewal";
import { previousMonthCosts } from "@/lib/licensing/snapshot";
import { costChanges, type CostChange } from "@/lib/licensing/cost-change";

interface Field {
  label: string;
  value: string | number;
}

/** Small "changed vs last month" marker for a cost/price cell. */
function CostBadge({ change }: { change?: CostChange }) {
  if (!change) return null;
  const sign = change.delta > 0 ? "+" : "";
  return (
    <span className="ml-2 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
      {change.direction === "up" ? "▲" : "▼"} {sign}
      {change.delta}
      {change.pct != null ? ` (${change.pct > 0 ? "+" : ""}${change.pct}%)` : ""} vs last mo
    </span>
  );
}

/** Renewal-window styling for the 30/60/90-day buckets. */
const RENEWAL_BADGE: Record<RenewalBucket, string> = {
  30: "bg-danger/15 text-danger",
  60: "bg-warning/15 text-warning",
  90: "bg-accent text-accent-foreground",
};
const RENEWAL_ROW: Record<RenewalBucket, string> = {
  30: "bg-danger/5",
  60: "bg-warning/5",
  90: "",
};

function fmtAddr(addr: unknown): string {
  if (!addr || typeof addr !== "object") return "—";
  const a = addr as Record<string, unknown>;
  const parts = [a.Line1 ?? a.line1, a.City ?? a.city, a.CountrySubDivisionCode ?? a.region, a.PostalCode ?? a.postalCode]
    .filter(Boolean)
    .map(String);
  return parts.length ? parts.join(", ") : "—";
}

export default async function SyncedDetailPage({
  params,
}: {
  params: Promise<{ source: string; id: string }>;
}) {
  const user = await requirePermission("clients:read");
  const { source, id } = await params;
  if (!isSourceSlug(source)) notFound();

  let title = "";
  let clientId: string | null = null;
  let fields: Field[] = [];
  let raw: unknown = null;
  // TD SYNNEX subscriptions, when applicable.
  let subscriptions: Awaited<ReturnType<typeof prisma.tdSynnexSubscription.findMany>> = [];

  if (source === "td-synnex") {
    const c = await prisma.tdSynnexCustomer.findUnique({
      where: { id },
      include: { subscriptions: { orderBy: { productName: "asc" } } },
    });
    if (!c) notFound();
    title = c.name;
    clientId = c.clientId;
    raw = c.raw;
    subscriptions = c.subscriptions;
    fields = [
      { label: "Name", value: c.name },
      { label: "StreamOne ID", value: c.stellrId },
      { label: "Domain", value: c.domain ?? "—" },
      { label: "MS tenant ID", value: c.microsoftTenantId ?? "—" },
      { label: "Service address", value: fmtAddr(c.serviceAddress) },
      { label: "Subscriptions", value: c.subscriptions.length },
      { label: "Status", value: c.active ? "Active" : "Inactive" },
      { label: "Last synced", value: formatDateTime(c.lastSyncedAt, user.timezone) },
    ];
  } else if (source === "qbo") {
    const c = await prisma.qboCustomer.findUnique({ where: { id } });
    if (!c) notFound();
    title = c.displayName;
    clientId = c.clientId;
    raw = c.raw;
    fields = [
      { label: "Display name", value: c.displayName },
      { label: "Company", value: c.companyName ?? "—" },
      { label: "QBO Customer ID", value: c.qboId },
      { label: "Billing email", value: c.billingEmail ?? "—" },
      { label: "Billing address", value: fmtAddr(c.billingAddress) },
      { label: "Currency", value: c.currency ?? "—" },
      { label: "Payment terms", value: c.paymentTerms ?? "—" },
      {
        label: "Tax status",
        value: c.taxStatus ?? (c.taxable == null ? "Unknown" : c.taxable ? "Taxable" : "Non-taxable"),
      },
      { label: "Status", value: c.active ? "Active" : "Inactive" },
      { label: "Last synced", value: formatDateTime(c.lastSyncedAt, user.timezone) },
    ];
  } else if (source === "superops") {
    const c = await prisma.superOpsClient.findUnique({ where: { id } });
    if (!c) notFound();
    title = c.name;
    clientId = c.clientId;
    raw = c.raw;
    fields = [
      { label: "Name", value: c.name },
      { label: "SuperOps ID", value: c.superOpsId },
      { label: "Last synced", value: formatDateTime(c.lastSyncedAt, user.timezone) },
    ];
  } else {
    const c = await prisma.huduCompany.findUnique({ where: { id } });
    if (!c) notFound();
    title = c.name;
    clientId = c.clientId;
    raw = c.raw;
    fields = [
      { label: "Name", value: c.name },
      { label: "Hudu ID", value: c.huduId },
      { label: "Last synced", value: formatDateTime(c.lastSyncedAt, user.timezone) },
    ];
  }

  const now = new Date();
  const renewingSoon = subscriptions.filter(
    (s) => renewalWindow(s.renewalDate, now) !== null,
  ).length;

  // Month-over-month cost/price changes (per subscription). Degrades to empty
  // when the snapshot table isn't there yet or has no prior-month data.
  const prevCosts =
    source === "td-synnex"
      ? await previousMonthCosts(subscriptions.map((s) => s.stellrSubscriptionId), now)
      : new Map();
  const subCostChanges = new Map<string, CostChange[]>();
  for (const s of subscriptions) {
    subCostChanges.set(
      s.id,
      costChanges(
        {
          unitCost: s.unitCost != null ? Number(s.unitCost) : null,
          customerPrice: s.customerPrice != null ? Number(s.customerPrice) : null,
        },
        prevCosts.get(s.stellrSubscriptionId) ?? null,
      ),
    );
  }
  const costChangedCount = [...subCostChanges.values()].filter((c) => c.length > 0).length;

  return (
    <div>
      <PageHeader title={title} description={`Synced from ${SOURCE_LABELS[source]}`} />
      <div className="space-y-6 p-4 sm:p-8">
        <Link
          href={`/synced/${source}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to {SOURCE_LABELS[source]}
        </Link>

        {clientId && (
          <Link
            href={`/clients/${clientId}`}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
          >
            <LinkIcon className="h-4 w-4" /> View linked Wolf365 client
          </Link>
        )}

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Synced fields</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {fields.map((f) => (
              <StatItem key={f.label} label={f.label} value={f.value} />
            ))}
          </div>
        </Card>

        {source === "td-synnex" && (
          <Card>
            <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
              Microsoft 365 licensing ({subscriptions.length})
              {renewingSoon > 0 && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                  {renewingSoon} renewing ≤90d
                </span>
              )}
              {costChangedCount > 0 && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                  {costChangedCount} cost change{costChangedCount === 1 ? "" : "s"} vs last mo
                </span>
              )}
            </h2>
            {subscriptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subscriptions synced.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-4 font-medium">SKU</th>
                      <th className="py-1 pr-4 font-medium">Product</th>
                      <th className="py-1 pr-4 font-medium">Qty</th>
                      <th className="py-1 pr-4 font-medium">Cost</th>
                      <th className="py-1 pr-4 font-medium">Cust. price</th>
                      <th className="py-1 pr-4 font-medium">Term</th>
                      <th className="py-1 pr-4 font-medium">Renewal</th>
                      <th className="py-1 pr-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((s) => {
                      const win = renewalWindow(s.renewalDate, now);
                      const changes = subCostChanges.get(s.id) ?? [];
                      return (
                        <tr
                          key={s.id}
                          className={`border-t align-top ${win ? RENEWAL_ROW[win.bucket] : ""}`}
                        >
                          <td className="py-1.5 pr-4 font-mono text-xs">{s.productSku ?? "—"}</td>
                          <td className="py-1.5 pr-4">{s.productName ?? "—"}</td>
                          <td className="py-1.5 pr-4 tabular-nums">{s.quantity}</td>
                          <td className="py-1.5 pr-4 whitespace-nowrap tabular-nums">
                            {s.unitCost != null ? formatCurrency(Number(s.unitCost), s.currency ?? "CAD") : "—"}
                            <CostBadge change={changes.find((c) => c.field === "unitCost")} />
                          </td>
                          <td className="py-1.5 pr-4 whitespace-nowrap tabular-nums">
                            {s.customerPrice != null ? formatCurrency(Number(s.customerPrice), s.currency ?? "CAD") : "—"}
                            <CostBadge change={changes.find((c) => c.field === "customerPrice")} />
                          </td>
                          <td className="py-1.5 pr-4">{s.commitmentTerm ?? "—"}</td>
                          <td className="py-1.5 pr-4 whitespace-nowrap">
                            <span className={win ? "font-medium" : ""}>
                              {formatDate(s.renewalDate)}
                            </span>
                            {win && (
                              <span
                                className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${RENEWAL_BADGE[win.bucket]}`}
                              >
                                in {win.daysUntil}d
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-4">{s.status ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {source === "td-synnex" && subscriptions.length > 0 && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold">
              Raw subscription payloads ({subscriptions.length})
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              The full TD SYNNEX response stored per subscription — used to map fields
              like MSRP. Search this for a known MSRP value to find its key.
            </p>
            <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(subscriptions.map((s) => s.raw), null, 2)}
            </pre>
          </Card>
        )}

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Raw synced payload</h2>
          {raw ? (
            <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(raw, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">No raw payload stored for this record.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
