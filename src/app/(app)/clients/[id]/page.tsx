import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Archive, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { LocalTime } from "@/components/ui/local-time";
import { recurringSummary, monthlyRevenue, toRecurringInput } from "@/lib/billing/recurring";
import { computeProration } from "@/lib/billing/proration";
import { renewalWindow, isMonthToMonth, isExpired } from "@/lib/licensing/renewal";
import { isM365Subscription } from "@/lib/licensing/vendor";
import { isMarginException } from "@/lib/licensing/margin";
import { previousMonthCosts } from "@/lib/licensing/snapshot";
import { ensureArchiveColumn } from "@/lib/licensing/archive";
import { ClientArchiveToggle } from "@/components/clients/client-archive-toggle";
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
  await ensureArchiveColumn();

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
  // Single "now" for expiry checks across recurring totals + the licensing table.
  const attentionNow = new Date();

  // Current calendar month (UTC), for classifying/pro-rating licenses added
  // mid-month. A subscription whose start date falls in this window is billed
  // pro-rated for its first month; it becomes "existing" (full month) next cycle.
  const monthStart = new Date(Date.UTC(attentionNow.getUTCFullYear(), attentionNow.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(attentionNow.getUTCFullYear(), attentionNow.getUTCMonth() + 1, 1));
  const monthLabel = monthStart.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // Group rollup: cumulative recurring across this client + all its
  // subsidiaries' M365 licensing. Each subscription belongs to exactly one
  // client, so this query counts each once (no double-counting).
  const groupSubs = (
    isGroup
      ? await prisma.tdSynnexSubscription.findMany({
          where: {
            customer: { client: { OR: [{ id: client.id }, { parentClientId: client.id }] } },
            archived: false,
          },
          select: {
            productSku: true,
            productName: true,
            vendor: true,
            customerPrice: true,
            unitCost: true,
            quantity: true,
            billingFrequency: true,
            status: true,
            currency: true,
            renewalDate: true,
          },
        })
      : []
  ).filter(
    // M365 only (exclude Cisco et al.) and exclude expired from recurring rollups.
    (s) => isM365Subscription(s) && !isExpired(s.renewalDate, s.status, attentionNow),
  );
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
  // Archived (filed-away) licenses are hidden from the client screen — they show
  // only under "M365 Archived Clients" until restored.
  const visibleSubs = (td?.subscriptions ?? []).filter(
    (s) => !s.archived && isM365Subscription(s),
  );

  // Per-client recurring totals from this customer's M365 licensing. Expired
  // licenses are excluded — a lapsed term is not recurring revenue.
  const recurring = td
    ? recurringSummary(
        visibleSubs
          .filter((s) => !isExpired(s.renewalDate, s.status, attentionNow))
          .map((s) => ({
          customerPrice: s.customerPrice != null ? Number(s.customerPrice) : null,
          unitCost: s.unitCost != null ? Number(s.unitCost) : null,
          quantity: s.quantity,
          billingFrequency: s.billingFrequency,
          status: s.status,
        })),
      )
    : null;
  const recurringCurrency =
    visibleSubs.find((s) => s.currency)?.currency ?? "CAD";

  // Previous-month cost snapshot per subscription, to flag month-over-month
  // margin changes (degrades to empty when no snapshots exist yet).
  const prevCosts = td
    ? await previousMonthCosts(
        visibleSubs.map((s) => s.stellrSubscriptionId),
        attentionNow,
      )
    : new Map();

  // Rows for the enhanced, sortable/filterable M365 licensing table.
  const m365Rows: M365LicensingRow[] = visibleSubs.map((s) => {
    const currency = s.currency ?? "CAD";
    const unitCost = s.unitCost != null ? Number(s.unitCost) : null;
    const customerPrice = s.customerPrice != null ? Number(s.customerPrice) : null;
    const oneTime =
      (s.commitmentTerm ?? s.billingFrequency ?? "").toLowerCase() === "one_time";
    const monthToMonth = isMonthToMonth(s.commitmentTerm, s.billingFrequency);
    const expired = isExpired(s.renewalDate, s.status, attentionNow);
    const rawObj =
      s.raw && typeof s.raw === "object" && !Array.isArray(s.raw)
        ? (s.raw as Record<string, unknown>)
        : {};
    const contractNo = rawObj.contractNo != null ? String(rawObj.contractNo) : null;
    const marginPerUnit =
      unitCost != null && customerPrice != null ? round2(customerPrice - unitCost) : null;
    const underCost = unitCost != null && customerPrice != null && customerPrice < unitCost;
    const marginException = isMarginException(unitCost, customerPrice);

    // Month-over-month margin change (current margin vs last month's snapshot).
    const prev = prevCosts.get(s.stellrSubscriptionId) ?? null;
    const prevMargin =
      prev && prev.unitCost != null && prev.customerPrice != null
        ? prev.customerPrice - prev.unitCost
        : null;
    const marginDelta =
      marginPerUnit != null && prevMargin != null ? round2(marginPerUnit - prevMargin) : null;
    let attention: "good" | "bad" | null = null;
    if (marginException || (marginDelta != null && marginDelta < 0)) attention = "bad";
    else if (marginDelta != null && marginDelta > 0) attention = "good";

    // Licenses whose start date falls in the current month are pro-rated for
    // their first month (billed from the add day to month end).
    const addedThisMonth =
      s.startDate != null &&
      s.startDate.getTime() >= monthStart.getTime() &&
      s.startDate.getTime() < monthEnd.getTime();
    let proratedFactor: number | null = null;
    let proratedExtendedPrice: number | null = null;
    if (addedThisMonth && s.startDate) {
      // Count from the start of the add day so the add day is billed in full.
      const activeStart = new Date(
        Date.UTC(s.startDate.getUTCFullYear(), s.startDate.getUTCMonth(), s.startDate.getUTCDate()),
      );
      const pr = computeProration({
        periodStart: monthStart,
        periodEnd: monthEnd,
        activeStart,
        activeEnd: s.cancellationWindowEnds ?? null,
      });
      proratedFactor = pr.factor;
      proratedExtendedPrice =
        customerPrice != null ? round2(customerPrice * s.quantity * pr.factor) : null;
    }

    return {
      id: s.id,
      sku: s.productSku,
      product: s.productName,
      contractNo,
      billingType: billingTypeLabel(s.commitmentTerm, s.billingFrequency),
      oneTime,
      monthToMonth,
      expired,
      quantity: s.quantity,
      unitCost,
      extendedCost: unitCost != null ? round2(unitCost * s.quantity) : null,
      customerPrice,
      extendedPrice: customerPrice != null ? round2(customerPrice * s.quantity) : null,
      marginPerUnit,
      underCost,
      marginException,
      marginDelta,
      attention,
      mrr: monthlyRevenue(toRecurringInput(s)),
      term: s.commitmentTerm,
      renewalDate: s.renewalDate ? s.renewalDate.toISOString() : null,
      status: s.status,
      reducible: s.reducible,
      currency,
      startDate: s.startDate ? s.startDate.toISOString() : null,
      proratedFactor,
      proratedExtendedPrice,
    };
  });

  // Split into existing licensing vs. licenses added (and pro-rated) this month.
  const addedThisMonthRows = m365Rows.filter((r) => r.proratedFactor != null);
  const existingRows = m365Rows.filter((r) => r.proratedFactor == null);

  // Per-client attention summary: upcoming renewals + under-cost lines.
  const clientRenewals = m365Rows
    .map((r) => ({
      r,
      win:
        r.renewalDate && !r.monthToMonth && !r.expired
          ? renewalWindow(new Date(r.renewalDate), attentionNow)
          : null,
    }))
    .filter((x): x is { r: M365LicensingRow; win: NonNullable<ReturnType<typeof renewalWindow>> } => x.win !== null)
    .sort((a, b) => a.win.daysUntil - b.win.daysUntil);
  const marginExRows = m365Rows.filter((r) => r.marginException);
  const attentionCurrency = m365Rows.find((r) => r.currency)?.currency ?? "CAD";

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
        description={
          client.archived
            ? "Archived client"
            : client.active
              ? "Active client"
              : "Inactive client"
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ClientArchiveToggle
              clientId={client.id}
              clientName={client.name}
              archived={client.archived}
              canArchive={can(user.role, "billing:edit")}
              variant="full"
            />
            {!client.archived && (
              <Link
                href={`/billing/new?clientId=${client.id}`}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                Generate billing run
              </Link>
            )}
          </div>
        }
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Link
          href="/clients"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All clients
        </Link>

        {client.archived && (
          <div className="flex items-start gap-2 rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-sm text-orange-700 dark:text-orange-400">
            <Archive className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This client is archived — hidden from the clients list, dashboard,
              reports, and billing. Restore it to bring it back.
            </span>
          </div>
        )}

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
                <StatItem label="Last QBO sync" value={<LocalTime value={qbo.lastSyncedAt} />} />
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
                <StatItem label="Subscriptions" value={visibleSubs.length} />
                <StatItem label="Status" value={td.active ? "Active" : "Inactive"} />
                <StatItem label="Last TD SYNNEX sync" value={<LocalTime value={td.lastSyncedAt} />} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No linked TD SYNNEX customer.</p>
            )}
          </Card>
        </div>

        {/* Renewals & margin exceptions — highlighted attention section */}
        {(clientRenewals.length > 0 || marginExRows.length > 0) && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card
              className={
                clientRenewals.length > 0 ? "border-warning/40 bg-warning/5" : undefined
              }
            >
              <h2 className="text-sm font-semibold">
                Upcoming renewals
                {clientRenewals.length > 0 ? ` (${clientRenewals.length})` : ""}
              </h2>
              {clientRenewals.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No M365 licensing renewing in the next 90 days.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {clientRenewals.map(({ r, win }) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate">{r.product ?? r.sku ?? "—"}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {r.sku ?? "—"} · qty {r.quantity}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          win.bucket === 30
                            ? "bg-danger/15 text-danger"
                            : win.bucket === 60
                              ? "bg-warning/15 text-warning"
                              : "bg-accent text-accent-foreground"
                        }`}
                      >
                        in {win.daysUntil}d
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              className={
                marginExRows.length > 0 ? "border-danger/40 bg-danger/5" : undefined
              }
            >
              <h2 className="text-sm font-semibold">
                Margin exceptions
                {marginExRows.length > 0 ? ` (${marginExRows.length})` : ""}
              </h2>
              {marginExRows.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No M365 lines at or below 3% margin.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {marginExRows.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate">{r.product ?? r.sku ?? "—"}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {r.sku ?? "—"} · qty {r.quantity}
                        </div>
                      </div>
                      <span className="shrink-0 font-medium tabular-nums text-danger">
                        {r.marginPerUnit != null
                          ? formatCurrency(r.marginPerUnit, attentionCurrency)
                          : "—"}
                        <span className="ml-1 rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px]">
                          below cost
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

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
          <>
            <Card>
              <h2 className="mb-3 text-sm font-semibold">
                Existing Licensing ({existingRows.length})
              </h2>
              {visibleSubs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No subscriptions synced for this customer. Run a TD SYNNEX sync,
                  or this customer may have no active TD SYNNEX subscriptions.
                </p>
              ) : existingRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  All current licensing was added this month — see the section below.
                </p>
              ) : (
                <M365LicensingTable rows={existingRows} canArchive={can(user.role, "billing:edit")} />
              )}
            </Card>

            <Card>
              <h2 className="mb-1 text-sm font-semibold">
                Pro-rated Licensing Added This Month ({addedThisMonthRows.length})
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Licenses whose start date falls in {monthLabel}, billed pro-rated from the day
                they were added through month-end. They roll into Existing Licensing next month.
              </p>
              {addedThisMonthRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No licenses added this month.</p>
              ) : (
                <M365LicensingTable
                  rows={addedThisMonthRows}
                  canArchive={can(user.role, "billing:edit")}
                  variant="added"
                />
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
