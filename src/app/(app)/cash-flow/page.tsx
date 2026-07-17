import Link from "next/link";
import { Banknote, TrendingUp, ArrowRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState, StatItem } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { getCashFlowReport, resolveDateWindow } from "@/lib/reports/cash-flow";
import { RangeBar } from "./range-bar";
import { DsoChart } from "./dso-chart";
import {
  CustomerTable,
  FollowUpTable,
  TierTable,
  MoverTable,
  SpendMoverTable,
  num,
} from "./tables";

export const maxDuration = 120;

const dsoTone = (dso: number) =>
  dso <= 45 ? "text-success" : dso <= 60 ? "text-warning" : "text-danger";

const AR_PLAN: { action: string; owner: string; timing: string; impact: string }[] = [
  { action: "Turn on automated invoice reminders", owner: "Finance/Admin", timing: "Week 1", impact: "Stops routine follow-up from being manual and inconsistent." },
  { action: "Create top-risk watchlist from this report", owner: "Finance + Account Managers", timing: "Week 1", impact: "Focuses effort on the customers with the greatest cash impact." },
  { action: "Contact top 10 cash-flow drag accounts", owner: "Account Managers", timing: "Weeks 1-2", impact: "Gets payment ETA, confirms AP contact and clears blockers." },
  { action: "Move repeat-late smaller accounts to stronger payment methods", owner: "Finance", timing: "Weeks 2-4", impact: "Reduces low-value collection work and residual AR." },
  { action: "Review payment discipline before large projects", owner: "Leadership + Sales", timing: "Ongoing", impact: "Prevents future cash drag from large one-off invoices." },
];

/**
 * Cash-Flow / DSO report — customer payment behaviour, DSO, revenue quality and
 * cash-flow risk built from synced QuickBooks invoices + received payments.
 * Finance users and administrators only (billing:read). Each table links to a
 * full-list screen (/cash-flow/<table>).
 */
export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  await requirePermission("billing:read");
  const sp = await searchParams;
  const range = sp.range ?? "fiscal";
  const window = resolveDateWindow(range, sp.from, sp.to, new Date());
  const report = await getCashFlowReport(window);

  const rangeBar = <RangeBar range={range} from={sp.from} to={sp.to} />;

  // Preserve the active range when linking to a full-table screen.
  const qs = new URLSearchParams();
  if (sp.range) qs.set("range", sp.range);
  if (sp.from) qs.set("from", sp.from);
  if (sp.to) qs.set("to", sp.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  const viewAll = (table: string) => `/cash-flow/${table}${suffix}`;

  function SectionHead({ title, table }: { title: string; table?: string }) {
    return (
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {table && (
          <Link
            href={viewAll(table)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    );
  }

  if (!report) {
    return (
      <div>
        <PageHeader
          title="Cash-Flow Days Sales Outstanding (DSO)"
          description="Customer payment behaviour, DSO, revenue quality and cash-flow risk, from QuickBooks invoices and payments."
        />
        <div className="space-y-6 p-4 sm:p-8">
          {rangeBar}
          <EmptyState
            icon={<Banknote className="h-8 w-8" />}
            title="No QuickBooks payment data yet"
            description="Sync QuickBooks (Connectors → QuickBooks Online → Sync Now) to pull invoices and received payments. A full sync covers annual figures; the per-invoice dates also drive the monthly breakdowns."
          />
        </div>
      </div>
    );
  }

  if (!report.hasData) {
    return (
      <div>
        <PageHeader
          title="Cash-Flow Days Sales Outstanding (DSO)"
          description={`No invoices in the selected range (${window.label}). Try a wider range.`}
        />
        <div className="space-y-6 p-4 sm:p-8">
          {rangeBar}
          <EmptyState
            icon={<Banknote className="h-8 w-8" />}
            title="No invoices in this date range"
            description="No QuickBooks invoices fall inside the selected range. Choose a wider range (e.g. All-Time), or sync QuickBooks if you expect data here."
          />
        </div>
      </div>
    );
  }

  const k = report.kpis;

  return (
    <div>
      <PageHeader
        title="Cash-Flow Days Sales Outstanding (DSO)"
        description={`Customer payment behaviour, DSO, revenue quality and cash-flow risk — ${window.label}. Source: QuickBooks invoices and received payments.`}
      />
      <div className="space-y-6 p-4 sm:p-8">
        {rangeBar}

        {/* Headline KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <p className="text-sm text-muted-foreground">Real collection DSO</p>
            <p className={`mt-2 text-2xl font-semibold tabular-nums ${dsoTone(k.realDso)}`}>{k.realDso} days</p>
            <p className="mt-1 text-xs text-muted-foreground">Cash-weighted invoice-to-cash</p>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground">On-time cash</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{k.onTimeCashPct}%</p>
            <p className="mt-1 text-xs text-muted-foreground">Cash received on/before due date</p>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground">Customers early / on-time</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{k.customersEarlyOnTime}/{k.customers}</p>
            <p className="mt-1 text-xs text-muted-foreground">{k.pctCustomersEarlyOnTime}% of customers</p>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground">Cash-flow drag</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{num(k.totalDrag)}</p>
            <p className="mt-1 text-xs text-muted-foreground">overdue dollar-days</p>
          </Card>
        </div>
        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatItem label="Avg days late vs terms" value={`${k.avgDaysLate} days`} />
            <StatItem label="Cash matched" value={formatCurrency(k.totalCashMatched)} />
            <StatItem label="Customers" value={k.customers} />
            <StatItem label="Late-tail customers" value={k.customers - k.customersEarlyOnTime} />
          </div>
        </Card>

        {report.timeline.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold">DSO performance over time</h2>
            <Card>
              <DsoChart points={report.timeline} />
              <p className="mt-2 text-xs text-muted-foreground">
                Cash-weighted collection DSO by invoice-cohort month, across {window.label.toLowerCase()}.
                Lower is better.
              </p>
            </Card>
          </section>
        )}

        <section>
          <SectionHead title="Customer payment tiers" table="tiers" />
          <TierTable tiers={report.tiers} />
        </section>

        <section>
          <SectionHead title="Top customers to follow up with (late payments)" table="follow-up" />
          <p className="mb-3 -mt-1 text-xs text-muted-foreground">
            Ranked by a priority score = dollars paid more than 30 days late × days over 30.
            Large ($10k+) and very-late accounts rise to the top.
          </p>
          {report.followUp.length === 0 ? (
            <p className="text-sm text-muted-foreground">No customers paid more than 30 days late in this range — nothing to chase.</p>
          ) : (
            <FollowUpTable rows={report.followUp} />
          )}
        </section>

        <section>
          <SectionHead title="Revenue concentration — top customers by cash received" table="revenue" />
          <CustomerTable rows={report.topRevenue} variant="revenue" />
        </section>

        <section>
          <SectionHead title="Who is hurting cash flow the most (drag $-days)" table="drag" />
          {report.topDrag.length === 0 ? (
            <p className="text-sm text-muted-foreground">No overdue dollar-days — everyone paid on time.</p>
          ) : (
            <CustomerTable rows={report.topDrag} variant="drag" />
          )}
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <SectionHead title="Worst repeat late payers" table="worst-late" />
            <CustomerTable rows={report.worstLate} variant="worst" />
          </section>
          <section>
            <SectionHead title="Best reliable revenue accounts" table="best-reliable" />
            <CustomerTable rows={report.bestReliable} variant="best" />
          </section>
        </div>

        {report.compareYear && report.priorYear && (
          <>
            <section>
              <SectionHead
                title={`Year-over-year payment movers: ${report.compareYear} vs ${report.priorYear}`}
                table="payment-movers"
              />
              <p className="mb-3 -mt-1 text-xs text-muted-foreground">
                Change in cash-weighted average days late by invoice-year cohort. Negative = paid faster (good).
              </p>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <MoverTable rows={report.paymentMovers.improved} priorYear={report.priorYear} compareYear={report.compareYear} kind="improved" />
                <MoverTable rows={report.paymentMovers.worsened} priorYear={report.priorYear} compareYear={report.compareYear} kind="worsened" />
              </div>
            </section>

            <section>
              <SectionHead
                title={`Year-over-year spend movers: ${report.compareYear} vs ${report.priorYear}`}
                table="spend-movers"
              />
              <p className="mb-3 -mt-1 text-xs text-muted-foreground">Invoiced revenue by calendar year.</p>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <SpendMoverTable rows={report.spendMovers.up} priorYear={report.priorYear} compareYear={report.compareYear} kind="up" />
                <SpendMoverTable rows={report.spendMovers.down} priorYear={report.priorYear} compareYear={report.compareYear} kind="down" />
              </div>
            </section>
          </>
        )}

        {/* 30-day AR improvement plan */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">30-day AR improvement plan</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Timing</th>
                  <th className="px-4 py-2 font-medium">Expected impact</th>
                </tr>
              </thead>
              <tbody>
                {AR_PLAN.map((a) => (
                  <tr key={a.action} className="border-t">
                    <td className="px-4 py-2">{a.action}</td>
                    <td className="px-4 py-2 text-muted-foreground">{a.owner}</td>
                    <td className="px-4 py-2 text-muted-foreground">{a.timing}</td>
                    <td className="px-4 py-2 text-muted-foreground">{a.impact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5" />
          Refresh this report by syncing QuickBooks:{" "}
          <Link href="/admin/connectors/QUICKBOOKS_ONLINE" className="text-primary hover:underline">
            Connectors → QuickBooks Online
          </Link>
          . A full sync covers annual figures; per-invoice dates drive the monthly detail.
        </p>
      </div>
    </div>
  );
}
