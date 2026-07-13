import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Plug, Receipt, TriangleAlert, TrendingUp, CalendarClock, CalendarX, PiggyBank, ChevronRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { recurringSummary, toRecurringInput } from "@/lib/billing/recurring";
import { renewalWindow, isMonthToMonth, isExpired } from "@/lib/licensing/renewal";
import { isM365Subscription } from "@/lib/licensing/vendor";
import { isMarginException } from "@/lib/licensing/margin";
import { ensureArchiveColumn } from "@/lib/licensing/archive";
import { DashboardSyncButtons } from "./sync-buttons";

// On-demand connector syncs run inline; allow the same window as the cron.
export const maxDuration = 300;

/**
 * Dashboard. Shows real counts from the database. With an empty database every
 * figure is honestly zero — we never fabricate activity.
 */
export default async function DashboardPage() {
  const user = await requireUser();

  // CRM-only users (Sales) have no billing access — send them to the forecast.
  if (can(user.role, "crm:read") && !can(user.role, "billing:read")) {
    redirect("/crm/forecast");
  }

  await ensureArchiveColumn();
  const [clients, connectors, openExceptions, billingRuns, clientsWithSubs] =
    await Promise.all([
      prisma.client.count({ where: { archived: false } }),
      prisma.connector.count({ where: { enabled: true } }),
      prisma.exception.count({ where: { status: "OPEN" } }),
      prisma.billingRun.count(),
      prisma.client.findMany({
        where: { tdSynnexCustomer: { isNot: null }, archived: false },
        select: {
          tdSynnexCustomer: {
            select: {
              subscriptions: {
                select: {
                  customerPrice: true,
                  unitCost: true,
                  quantity: true,
                  billingFrequency: true,
                  commitmentTerm: true,
                  status: true,
                  currency: true,
                  renewalDate: true,
                  archived: true,
                  vendor: true,
                  productName: true,
                  productSku: true,
                },
              },
            },
          },
        },
      }),
    ]);

  // Recurring revenue / cost / margin from synced M365 licensing. Computed
  // per-client so we can also flag clients that bill below cost.
  // Archived (filed-away) licenses are excluded everywhere on the dashboard.
  const now = new Date();
  const allSubs = clientsWithSubs.flatMap((c) =>
    (c.tdSynnexCustomer?.subscriptions ?? []).filter(
      (s) => !s.archived && isM365Subscription(s),
    ),
  );
  // Recurring revenue/cost/margin exclude expired licenses — a lapsed term is
  // not recurring revenue. (Expired lines still feed the "expired" card below.)
  const recurringSubs = allSubs.filter((s) => !isExpired(s.renewalDate, s.status, now));
  const recurring = recurringSummary(recurringSubs.map(toRecurringInput));
  const negativeMarginClients = clientsWithSubs.filter((c) => {
    const s = recurringSummary(
      (c.tdSynnexCustomer?.subscriptions ?? [])
        .filter(
          (sub) =>
            !sub.archived &&
            isM365Subscription(sub) &&
            !isExpired(sub.renewalDate, sub.status, now),
        )
        .map(toRecurringInput),
    );
    return s.activeCount > 0 && s.monthlyMargin < 0;
  }).length;
  const currency = allSubs.find((s) => s.currency)?.currency ?? "USD";

  // Attention counts: subscriptions renewing within 90 days, and lines at or
  // below 3% margin (under cost or razor-thin).
  const upcomingRenewals = allSubs.filter(
    (s) =>
      !isMonthToMonth(s.commitmentTerm, s.billingFrequency) &&
      !isExpired(s.renewalDate, s.status, now) &&
      renewalWindow(s.renewalDate, now) !== null,
  ).length;
  const marginExceptions = allSubs.filter(
    (s) =>
      s.unitCost != null &&
      s.customerPrice != null &&
      isMarginException(Number(s.unitCost), Number(s.customerPrice)),
  ).length;
  const expiredLicenses = allSubs.filter((s) => isExpired(s.renewalDate, s.status, now)).length;

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
        actions={can(user.role, "connectors:sync") ? <DashboardSyncButtons /> : undefined}
      />
      <div className="p-4 sm:p-8">
        {/* Recurring revenue / cost / margin from synced M365 licensing */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                MRR — Monthly Recurring Revenue
              </p>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {formatCurrency(recurring.mrr, currency)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Active, recurring M365 licensing · customer price × quantity
            </p>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                ARR — Annual Recurring Revenue
              </p>
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {formatCurrency(recurring.arr, currency)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">MRR × 12</p>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Monthly margin
              </p>
              <PiggyBank className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {formatCurrency(recurring.monthlyMargin, currency)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              MRR − cost ({formatCurrency(recurring.monthlyCost, currency)}) ·{" "}
              {recurring.marginPct}% margin
            </p>
          </Card>
        </div>

        {/* Attention cards — renewals, margin exceptions & expired, clickable to reports */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/reports/renewals" className="block">
            <Card
              className={`flex items-center justify-between transition ${
                upcomingRenewals > 0
                  ? "border-warning/40 bg-warning/10 hover:bg-warning/15"
                  : "hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <CalendarClock
                  className={`h-5 w-5 shrink-0 ${upcomingRenewals > 0 ? "text-warning" : "text-muted-foreground"}`}
                />
                <div>
                  <p className="text-sm font-semibold">
                    {upcomingRenewals} renewal{upcomingRenewals === 1 ? "" : "s"} in the next 90 days
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    M365 licensing coming up for renewal — view the list.
                  </p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Card>
          </Link>
          <Link href="/reports/margin-exceptions" className="block">
            <Card
              className={`flex items-center justify-between transition ${
                marginExceptions > 0
                  ? "border-danger/40 bg-danger/10 hover:bg-danger/15"
                  : "hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <TriangleAlert
                  className={`h-5 w-5 shrink-0 ${marginExceptions > 0 ? "text-danger" : "text-muted-foreground"}`}
                />
                <div>
                  <p className="text-sm font-semibold">
                    {marginExceptions} margin exception{marginExceptions === 1 ? "" : "s"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    M365 lines sold under cost — review pricing.
                  </p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Card>
          </Link>
          <Link href="/reports/expired" className="block">
            <Card
              className={`flex items-center justify-between transition ${
                expiredLicenses > 0
                  ? "border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20"
                  : "hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <CalendarX
                  className={`h-5 w-5 shrink-0 ${expiredLicenses > 0 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}
                />
                <div>
                  <p className="text-sm font-semibold">
                    {expiredLicenses} expired license{expiredLicenses === 1 ? "" : "s"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    M365 licensing past its term — review or renew.
                  </p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Card>
          </Link>
        </div>

        {/* Negative-margin warning — clients billing below cost */}
        {negativeMarginClients > 0 && (
          <Link href="/clients" className="mb-4 block">
            <Card className="border-danger/40 bg-danger/10 transition hover:bg-danger/15">
              <div className="flex items-center gap-3">
                <TriangleAlert className="h-5 w-5 shrink-0 text-danger" />
                <div>
                  <p className="text-sm font-semibold text-danger">
                    {negativeMarginClients}{" "}
                    {negativeMarginClients === 1 ? "client is" : "clients are"}{" "}
                    billing below cost
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Negative monthly margin on synced M365 licensing. Review and
                    adjust pricing — view the client list.
                  </p>
                </div>
              </div>
            </Card>
          </Link>
        )}

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
