import Link from "next/link";
import { Truck, TrendingUp, ArrowRight } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState, StatItem } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { resolveDateWindow } from "@/lib/reports/cash-flow";
import { getSuppliersReport } from "@/lib/reports/suppliers";
import { RangeBar } from "../cash-flow/range-bar";
import { DsoChart } from "../cash-flow/dso-chart";
import {
  CustomerTable,
  FollowUpTable,
  TierTable,
  MoverTable,
  SpendMoverTable,
  SUPPLIER_LABELS,
  num,
} from "../cash-flow/tables";

export const maxDuration = 120;

const dpoTone = (dpo: number) =>
  dpo <= 45 ? "text-success" : dpo <= 60 ? "text-warning" : "text-danger";

const AP_PLAN: { action: string; owner: string; timing: string; impact: string }[] = [
  { action: "Build a due-date payment calendar from this report", owner: "Finance/Admin", timing: "Week 1", impact: "Pay on terms — neither early (losing float) nor late (risking supply)." },
  { action: "Prioritise overdue suppliers on the follow-up list", owner: "Finance", timing: "Week 1", impact: "Clears the bills most likely to strain a key supplier relationship." },
  { action: "Negotiate longer terms with top-spend suppliers", owner: "Leadership + Finance", timing: "Weeks 2-4", impact: "Extends DPO safely on the largest spend, freeing working capital." },
  { action: "Capture early-payment discounts where offered", owner: "Finance", timing: "Ongoing", impact: "Trades a little float for a discount when the return beats the cash cost." },
  { action: "Review supplier concentration before large commitments", owner: "Leadership", timing: "Ongoing", impact: "Avoids over-reliance on a single supplier for critical spend." },
];

/**
 * Suppliers & Expenses / DPO report — supplier payment behaviour, days payable
 * outstanding and overdue-payable risk, built from synced QuickBooks vendor bills
 * and bill payments. Payroll, taxes, loans and credit cards/lines are excluded.
 * Finance users and administrators only (billing:read). Each table links to a
 * full-list screen (/suppliers-dpo/<table>).
 */
export default async function SuppliersDpoPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  await requirePermission("billing:read");
  const sp = await searchParams;
  const range = sp.range ?? "fiscal";
  const window = resolveDateWindow(range, sp.from, sp.to, new Date());
  const report = await getSuppliersReport(window);

  const rangeBar = <RangeBar range={range} from={sp.from} to={sp.to} />;

  // Preserve the active range when linking to a full-table screen.
  const qs = new URLSearchParams();
  if (sp.range) qs.set("range", sp.range);
  if (sp.from) qs.set("from", sp.from);
  if (sp.to) qs.set("to", sp.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  const viewAll = (table: string) => `/suppliers-dpo/${table}${suffix}`;

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
          title="Suppliers & Expenses — Days Payable Outstanding (DPO)"
          description="Supplier payment behaviour, DPO and overdue-payable risk, from QuickBooks bills and bill payments. Excludes payroll, taxes, loans and credit cards/lines."
        />
        <div className="space-y-6 p-4 sm:p-8">
          {rangeBar}
          <EmptyState
            icon={<Truck className="h-8 w-8" />}
            title="No QuickBooks bill data yet"
            description="Sync QuickBooks (Connectors → QuickBooks Online → Sync Now) to pull vendor bills and bill payments. A full sync covers annual figures; the per-bill dates also drive the monthly breakdowns."
          />
        </div>
      </div>
    );
  }

  if (!report.hasData) {
    return (
      <div>
        <PageHeader
          title="Suppliers & Expenses — Days Payable Outstanding (DPO)"
          description={`No bills in the selected range (${window.label}). Try a wider range.`}
        />
        <div className="space-y-6 p-4 sm:p-8">
          {rangeBar}
          <EmptyState
            icon={<Truck className="h-8 w-8" />}
            title="No bills in this date range"
            description="No QuickBooks vendor bills (excluding payroll, taxes, loans and credit cards/lines) fall inside the selected range. Choose a wider range (e.g. All-Time), or sync QuickBooks if you expect data here."
          />
        </div>
      </div>
    );
  }

  const k = report.kpis;

  return (
    <div>
      <PageHeader
        title="Suppliers & Expenses — Days Payable Outstanding (DPO)"
        description={`Supplier payment behaviour, DPO and overdue-payable risk — ${window.label}. Excludes payroll, taxes, loans and credit cards/lines. Source: QuickBooks bills and bill payments.`}
      />
      <div className="space-y-6 p-4 sm:p-8">
        {rangeBar}

        {/* Headline KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <p className="text-sm text-muted-foreground">Days payable outstanding</p>
            <p className={`mt-2 text-2xl font-semibold tabular-nums ${dpoTone(k.realDso)}`}>{k.realDso} days</p>
            <p className="mt-1 text-xs text-muted-foreground">Cash-weighted bill-to-payment</p>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground">On-time payments</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{k.onTimeCashPct}%</p>
            <p className="mt-1 text-xs text-muted-foreground">Paid on/before the due date</p>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground">Suppliers paid early / on-time</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{k.customersEarlyOnTime}/{k.customers}</p>
            <p className="mt-1 text-xs text-muted-foreground">{k.pctCustomersEarlyOnTime}% of suppliers</p>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground">Overdue-payable exposure</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{num(k.totalDrag)}</p>
            <p className="mt-1 text-xs text-muted-foreground">overdue dollar-days</p>
          </Card>
        </div>
        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatItem label="Avg days late vs terms" value={`${k.avgDaysLate} days`} />
            <StatItem label="Payments matched" value={formatCurrency(k.totalCashMatched)} />
            <StatItem label="Suppliers" value={k.customers} />
            <StatItem label="Late-paid suppliers" value={k.customers - k.customersEarlyOnTime} />
          </div>
        </Card>

        {report.timeline.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold">DPO performance over time</h2>
            <Card>
              <DsoChart points={report.timeline} unit="DPO" />
              <p className="mt-2 text-xs text-muted-foreground">
                Cash-weighted days-to-pay by bill-cohort month, across {window.label.toLowerCase()}.
                Steady, on-terms payment is the goal.
              </p>
            </Card>
          </section>
        )}

        <section>
          <SectionHead title="Supplier payment tiers" table="tiers" />
          <TierTable tiers={report.tiers} labels={SUPPLIER_LABELS} />
        </section>

        <section>
          <SectionHead title="Overdue suppliers to prioritise paying" table="follow-up" />
          <p className="mb-3 -mt-1 text-xs text-muted-foreground">
            Ranked by a priority score = dollars paid more than 30 days late × days over 30.
            Large ($10k+) and very-late bills rise to the top.
          </p>
          {report.followUp.length === 0 ? (
            <p className="text-sm text-muted-foreground">No suppliers paid more than 30 days late in this range.</p>
          ) : (
            <FollowUpTable rows={report.followUp} labels={SUPPLIER_LABELS} />
          )}
        </section>

        <section>
          <SectionHead title="Spend concentration — top suppliers by amount paid" table="revenue" />
          <CustomerTable rows={report.topRevenue} variant="revenue" labels={SUPPLIER_LABELS} />
        </section>

        <section>
          <SectionHead title="Largest overdue payables (drag $-days)" table="drag" />
          {report.topDrag.length === 0 ? (
            <p className="text-sm text-muted-foreground">No overdue dollar-days — everything paid on time.</p>
          ) : (
            <CustomerTable rows={report.topDrag} variant="drag" labels={SUPPLIER_LABELS} />
          )}
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <SectionHead title="Suppliers we pay latest" table="worst-late" />
            <CustomerTable rows={report.worstLate} variant="worst" labels={SUPPLIER_LABELS} />
          </section>
          <section>
            <SectionHead title="Suppliers we pay most reliably" table="best-reliable" />
            <CustomerTable rows={report.bestReliable} variant="best" labels={SUPPLIER_LABELS} />
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
                Change in cash-weighted average days late by bill-year cohort. Negative = paid faster.
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
              <p className="mb-3 -mt-1 text-xs text-muted-foreground">Billed spend by calendar year.</p>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <SpendMoverTable rows={report.spendMovers.up} priorYear={report.priorYear} compareYear={report.compareYear} kind="up" />
                <SpendMoverTable rows={report.spendMovers.down} priorYear={report.priorYear} compareYear={report.compareYear} kind="down" />
              </div>
            </section>
          </>
        )}

        {/* 30-day AP improvement plan */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">30-day AP improvement plan</h2>
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
                {AP_PLAN.map((a) => (
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
          . A full sync covers annual figures; per-bill dates drive the monthly detail.
        </p>
      </div>
    </div>
  );
}
