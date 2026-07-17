import Link from "next/link";
import { Banknote, TrendingUp } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState, StatItem } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { getCashFlowReport } from "@/lib/reports/cash-flow";
import type { CustomerRow } from "@/lib/reports/dso";

export const maxDuration = 120;

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const dsoTone = (dso: number) =>
  dso <= 45 ? "text-success" : dso <= 60 ? "text-warning" : "text-danger";

function CustomerTable({
  rows,
  columns,
}: {
  rows: CustomerRow[];
  columns: { key: string; label: string; render: (r: CustomerRow) => React.ReactNode; right?: boolean }[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-2 font-medium ${c.right ? "text-right" : ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.customerId} className="border-t">
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-2 ${c.right ? "text-right tabular-nums" : ""}`}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
 * Finance users and administrators only (billing:read).
 */
export default async function CashFlowPage() {
  await requirePermission("billing:read");
  const report = await getCashFlowReport();

  if (!report || !report.hasData) {
    return (
      <div>
        <PageHeader
          title="Cash-Flow / DSO"
          description="Customer payment behaviour, DSO, revenue quality and cash-flow risk, from QuickBooks invoices and payments."
        />
        <div className="p-4 sm:p-8">
          <EmptyState
            icon={<Banknote className="h-8 w-8" />}
            title="No QuickBooks payment data yet"
            description="Sync QuickBooks (Connectors → QuickBooks Online → Sync Now) to pull invoices and received payments. A full sync covers annual figures; the per-invoice dates also drive the monthly breakdowns."
          />
        </div>
      </div>
    );
  }

  const k = report.kpis;

  return (
    <div>
      <PageHeader
        title="Cash-Flow / DSO"
        description="Customer payment behaviour, DSO, revenue quality and cash-flow risk. Source: QuickBooks invoices and received payments."
      />
      <div className="space-y-6 p-4 sm:p-8">
        {/* Headline KPIs */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <p className="text-sm text-muted-foreground">Real collection DSO</p>
            <p className={`mt-2 text-2xl font-semibold tabular-nums ${dsoTone(k.realDso)}`}>
              {k.realDso} days
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Cash-weighted invoice-to-cash</p>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground">On-time cash</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{k.onTimeCashPct}%</p>
            <p className="mt-1 text-xs text-muted-foreground">Cash received on/before due date</p>
          </Card>
          <Card>
            <p className="text-sm text-muted-foreground">Customers early / on-time</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {k.customersEarlyOnTime}/{k.customers}
            </p>
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
            <StatItem
              label="Late-tail customers"
              value={k.customers - k.customersEarlyOnTime}
            />
          </div>
        </Card>

        {/* Tier mix */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Customer payment tiers</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Tier</th>
                  <th className="px-4 py-2 text-right font-medium">Customers</th>
                  <th className="px-4 py-2 text-right font-medium">%</th>
                  <th className="px-4 py-2 text-right font-medium">Cash received</th>
                  <th className="px-4 py-2 text-right font-medium">Drag ($-days)</th>
                </tr>
              </thead>
              <tbody>
                {report.tiers.map((t) => (
                  <tr key={t.tier} className="border-t">
                    <td className="px-4 py-2">{t.tier}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{t.customers}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{t.pctCustomers}%</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(t.cashReceived)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{num(t.drag)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Top revenue */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Revenue concentration — top customers by cash received</h2>
          <CustomerTable
            rows={report.topRevenue}
            columns={[
              { key: "customer", label: "Customer", render: (r) => r.customer },
              { key: "cash", label: "Cash received", right: true, render: (r) => formatCurrency(r.cashReceived) },
              { key: "dso", label: "DSO", right: true, render: (r) => (r.dso ?? "—") },
              { key: "late", label: "Avg days late", right: true, render: (r) => (r.avgDaysLate ?? "—") },
              { key: "tier", label: "Tier", render: (r) => r.tier },
            ]}
          />
        </section>

        {/* Cash-flow drag ranking */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Who is hurting cash flow the most (drag $-days)</h2>
          {report.topDrag.length === 0 ? (
            <p className="text-sm text-muted-foreground">No overdue dollar-days — everyone paid on time.</p>
          ) : (
            <CustomerTable
              rows={report.topDrag}
              columns={[
                { key: "customer", label: "Customer", render: (r) => r.customer },
                { key: "cash", label: "Cash received", right: true, render: (r) => formatCurrency(r.cashReceived) },
                { key: "late", label: "Avg days late", right: true, render: (r) => (r.avgDaysLate ?? "—") },
                { key: "drag", label: "Drag ($-days)", right: true, render: (r) => num(r.drag) },
              ]}
            />
          )}
        </section>

        {/* Worst late / best reliable */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-3 text-sm font-semibold">Worst repeat late payers</h2>
            <CustomerTable
              rows={report.worstLate}
              columns={[
                { key: "customer", label: "Customer", render: (r) => r.customer },
                { key: "cash", label: "Revenue", right: true, render: (r) => formatCurrency(r.cashReceived) },
                { key: "late", label: "Avg late", right: true, render: (r) => (r.avgDaysLate ?? "—") },
              ]}
            />
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold">Best reliable revenue accounts</h2>
            <CustomerTable
              rows={report.bestReliable}
              columns={[
                { key: "customer", label: "Customer", render: (r) => r.customer },
                { key: "cash", label: "Revenue", right: true, render: (r) => formatCurrency(r.cashReceived) },
                { key: "ontime", label: "On-time $", right: true, render: (r) => (r.onTimeCashPct != null ? `${r.onTimeCashPct}%` : "—") },
              ]}
            />
          </section>
        </div>

        {/* YoY movers */}
        {report.compareYear && report.priorYear && (
          <>
            <section>
              <h2 className="mb-1 text-sm font-semibold">
                Year-over-year payment movers: {report.compareYear} vs {report.priorYear}
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Change in cash-weighted average days late by invoice-year cohort. Negative = paid faster (good).
              </p>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-medium">Improved</th>
                        <th className="px-4 py-2 text-right font-medium">{report.priorYear}</th>
                        <th className="px-4 py-2 text-right font-medium">{report.compareYear}</th>
                        <th className="px-4 py-2 text-right font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.paymentMovers.improved.map((m) => (
                        <tr key={m.customer} className="border-t">
                          <td className="px-4 py-2">{m.customer}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{m.prior}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{m.current}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-success">{m.change}</td>
                        </tr>
                      ))}
                      {report.paymentMovers.improved.length === 0 && (
                        <tr className="border-t"><td className="px-4 py-2 text-muted-foreground" colSpan={4}>None</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-medium">Worsened</th>
                        <th className="px-4 py-2 text-right font-medium">{report.priorYear}</th>
                        <th className="px-4 py-2 text-right font-medium">{report.compareYear}</th>
                        <th className="px-4 py-2 text-right font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.paymentMovers.worsened.map((m) => (
                        <tr key={m.customer} className="border-t">
                          <td className="px-4 py-2">{m.customer}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{m.prior}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{m.current}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-danger">+{m.change}</td>
                        </tr>
                      ))}
                      {report.paymentMovers.worsened.length === 0 && (
                        <tr className="border-t"><td className="px-4 py-2 text-muted-foreground" colSpan={4}>None</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-1 text-sm font-semibold">
                Year-over-year spend movers: {report.compareYear} vs {report.priorYear}
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">Invoiced revenue by calendar year.</p>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {(["up", "down"] as const).map((dir) => (
                  <div key={dir} className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 font-medium">{dir === "up" ? "Expanding" : "Contracting"}</th>
                          <th className="px-4 py-2 text-right font-medium">{report.priorYear}</th>
                          <th className="px-4 py-2 text-right font-medium">{report.compareYear}</th>
                          <th className="px-4 py-2 text-right font-medium">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.spendMovers[dir].map((s) => (
                          <tr key={s.customer} className="border-t">
                            <td className="px-4 py-2">{s.customer}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(s.spendPrior)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(s.spendCurrent)}</td>
                            <td className={`px-4 py-2 text-right tabular-nums ${dir === "up" ? "text-success" : "text-danger"}`}>
                              {s.change > 0 ? "+" : ""}
                              {formatCurrency(s.change)}
                              {s.pctChange != null ? ` (${s.pctChange > 0 ? "+" : ""}${s.pctChange}%)` : ""}
                            </td>
                          </tr>
                        ))}
                        {report.spendMovers[dir].length === 0 && (
                          <tr className="border-t"><td className="px-4 py-2 text-muted-foreground" colSpan={4}>None</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
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
