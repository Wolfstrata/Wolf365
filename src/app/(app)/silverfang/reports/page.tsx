import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState, StatItem } from "@/components/ui/primitives";
import { formatHours } from "@/lib/silverfang/time";
import { serviceReport } from "@/lib/silverfang/reporting-service";
import { PERIODS, PERIOD_LABELS, parsePeriod, periodRange } from "./period";

export const dynamic = "force-dynamic";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** A percentage, or an em dash when it is genuinely undefined rather than zero. */
const pct = (n: number | null) => (n == null ? "—" : `${n}%`);

const rate = (n: number | null) => (n == null ? "—" : money(n));

/**
 * Service-delivery reporting: are the techs busy, did we get paid for it, and was
 * it worth doing.
 *
 * Gated on `time:approve` rather than `tickets:read`: this shows every tech's
 * utilisation and every client's margin, which is a service-manager view. A
 * technician holds `tickets:read` and should not see their colleagues' numbers.
 */
export default async function SilverFangReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requirePermission("time:approve");

  const period = parsePeriod((await searchParams).period);
  const { start, end } = periodRange(period, new Date());
  const report = await serviceReport(start, end);

  const hasData = report.techs.length > 0 || report.clients.length > 0;
  const underwater = report.clients.filter((c) => c.underwater);

  return (
    <div>
      <PageHeader
        title="Service reporting"
        description="Utilisation, realisation and profitability for SilverFang service delivery."
      />
      <div className="space-y-6 p-4 sm:p-8">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`?period=${p}`}
              className={`rounded-md border px-2.5 py-1 ${
                p === period ? "bg-accent font-medium" : ""
              }`}
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
          <span className="text-muted-foreground">
            {start.toISOString().slice(0, 10)} to {end.toISOString().slice(0, 10)} (end exclusive)
          </span>
        </div>

        {!hasData ? (
          <EmptyState
            title="Nothing logged in this period"
            description="These figures come from time entries and pushed billing runs. Log time against tickets and push a billing run, then the utilisation, realisation and margin tables fill in."
          />
        ) : (
          <>
            {/* Headline */}
            <Card>
              <h2 className="mb-3 text-sm font-semibold">Headline</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                <StatItem
                  label="Billable hours"
                  value={formatHours(report.techs.reduce((a, t) => a + t.billableHours, 0))}
                />
                <StatItem
                  label="Worked value"
                  value={money(report.realisation.workedValue)}
                />
                <StatItem label="Billed for hours" value={money(report.realisation.billedValue)} />
                <StatItem
                  label="Realisation"
                  value={pct(report.realisation.realisationPct)}
                />
                <StatItem
                  label="Margin"
                  value={
                    <span className={report.clientTotal.underwater ? "text-danger" : undefined}>
                      {money(report.clientTotal.margin)}
                    </span>
                  }
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Revenue is counted from billing runs that were actually pushed to QuickBooks,
                matched to the period by invoice date. Cost comes from each hour&rsquo;s own cost
                rate as resolved when it was logged, matched by work date. Those are different
                windows — normal for service work, but it means a month&rsquo;s revenue and its
                cost do not line up exactly.
              </p>
            </Card>

            {/* The things worth acting on */}
            {(report.unratedHours > 0 || report.unapprovedHours > 0 || underwater.length > 0) && (
              <Card>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <TriangleAlert className="h-4 w-4 text-warning" />
                  Worth a look
                </h2>
                <ul className="space-y-1.5 text-sm">
                  {report.unratedHours > 0 && (
                    <li>
                      <span className="font-medium">
                        {formatHours(report.unratedHours)} billable hours have no rate.
                      </span>{" "}
                      <span className="text-muted-foreground">
                        These are hours nobody priced, which is different from hours somebody
                        decided to give away. Check the charge codes and agreement rates.
                      </span>
                    </li>
                  )}
                  {report.unapprovedHours > 0 && (
                    <li>
                      <span className="font-medium">
                        {formatHours(report.unapprovedHours)} hours are not approved yet.
                      </span>{" "}
                      <span className="text-muted-foreground">
                        They are included in utilisation but cannot be billed until approved, so
                        realisation understates until they are.
                      </span>
                    </li>
                  )}
                  {underwater.length > 0 && (
                    <li>
                      <span className="font-medium text-danger">
                        {underwater.length} client(s) cost more than they billed.
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {underwater
                          .slice(0, 4)
                          .map((c) => c.name)
                          .join(", ")}
                        {underwater.length > 4 && ` and ${underwater.length - 4} more`}.
                      </span>
                    </li>
                  )}
                </ul>
              </Card>
            )}

            {/* Utilisation */}
            <Card>
              <h2 className="mb-1 text-sm font-semibold">Utilisation</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Billable hours against {formatHours(report.techs[0]?.capacityHours ?? 0)} of
                capacity ({report.hoursPerDay}h × weekdays in the period). Capacity is deliberately
                naive about holidays and part-time schedules — an approximation everyone can
                reproduce beats a precise figure nobody can.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-4 font-medium">Tech</th>
                      <th className="py-1 pr-4 text-right font-medium">Billable</th>
                      <th className="py-1 pr-4 text-right font-medium">Non-billable</th>
                      <th className="py-1 pr-4 text-right font-medium">Total</th>
                      <th className="py-1 pr-4 text-right font-medium">Utilisation</th>
                      <th className="py-1 pr-4 text-right font-medium">Billable ratio</th>
                      <th className="py-1 pr-4 text-right font-medium">Effective rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.techs.map((t) => (
                      <tr key={t.userId} className="border-t">
                        <td className="py-1.5 pr-4">{t.name}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {formatHours(t.billableHours)}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
                          {formatHours(t.nonBillableHours)}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {formatHours(t.totalHours)}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {pct(t.utilisationPct)}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
                          {pct(t.billableRatioPct)}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {rate(t.effectiveRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Realisation */}
            <Card>
              <h2 className="mb-1 text-sm font-semibold">Realisation</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                How much of the value worked was charged for. Below 100% is expected and usually
                correct — hours inside a managed-services inclusion or drawn from a prepaid block
                were paid for elsewhere. What matters is whether the gap is explained.
              </p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatItem label="Worked value" value={money(report.realisation.workedValue)} />
                <StatItem label="Billed for hours" value={money(report.realisation.billedValue)} />
                <StatItem label="Gap" value={money(report.realisation.gap)} />
                <StatItem label="Realisation" value={pct(report.realisation.realisationPct)} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                &ldquo;Billed for hours&rdquo; counts only time and overage lines. Recurring fees,
                block purchases and project fees are revenue but are not payment for a specific
                hour, so including them would flatter this figure.
              </p>
            </Card>

            {/* Profitability */}
            <Card>
              <h2 className="mb-1 text-sm font-semibold">Profitability by client</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Worst margin first — this table is for finding problems, not admiring wins. A
                client with hours and no revenue either has not been billed yet or is being worked
                for free.
              </p>
              <ProfitTable rows={report.clients} total={report.clientTotal} />
            </Card>

            {report.agreements.length > 0 && (
              <Card>
                <h2 className="mb-1 text-sm font-semibold">Profitability by agreement</h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  The effective rate is the single most useful number on an agreement: revenue
                  divided by the hours actually delivered against it.
                </p>
                <ProfitTable rows={report.agreements} />
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ProfitTable({
  rows,
  total,
}: {
  rows: { id: string; name: string; revenue: number; cost: number; margin: number; marginPct: number | null; hours: number; effectiveRate: number | null; underwater: boolean }[];
  total?: { revenue: number; cost: number; margin: number; marginPct: number | null; hours: number; effectiveRate: number | null; underwater: boolean };
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-1 pr-4 font-medium">Name</th>
            <th className="py-1 pr-4 text-right font-medium">Hours</th>
            <th className="py-1 pr-4 text-right font-medium">Revenue</th>
            <th className="py-1 pr-4 text-right font-medium">Cost</th>
            <th className="py-1 pr-4 text-right font-medium">Margin</th>
            <th className="py-1 pr-4 text-right font-medium">Margin %</th>
            <th className="py-1 pr-4 text-right font-medium">Eff. rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-1.5 pr-4">{r.name}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{formatHours(r.hours)}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{money(r.revenue)}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
                {money(r.cost)}
              </td>
              <td
                className={`py-1.5 pr-4 text-right tabular-nums ${
                  r.underwater ? "font-medium text-danger" : ""
                }`}
              >
                {money(r.margin)}
              </td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{pct(r.marginPct)}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{rate(r.effectiveRate)}</td>
            </tr>
          ))}
          {total && (
            <tr className="border-t-2 font-medium">
              <td className="py-1.5 pr-4">Total</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{formatHours(total.hours)}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{money(total.revenue)}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{money(total.cost)}</td>
              <td
                className={`py-1.5 pr-4 text-right tabular-nums ${
                  total.underwater ? "text-danger" : ""
                }`}
              >
                {money(total.margin)}
              </td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{pct(total.marginPct)}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums">{rate(total.effectiveRate)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
