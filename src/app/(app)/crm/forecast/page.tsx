import Link from "next/link";
import { TrendingUp, Scale, Trophy, Percent, Layers } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { computeForecast, forecastGrid } from "@/lib/crm/forecast";
import {
  CRM_LINES,
  CRM_LINE_ORDER,
  STAGE_ORDER,
  STAGE_LABELS,
  fiscalYearFor,
  effectiveMarginAmount,
} from "@/lib/crm/constants";

/** Horizontal bar relative to a max, with a value label. */
function Bar({
  label,
  amount,
  max,
  sub,
}: {
  label: string;
  amount: number;
  max: number;
  sub?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((amount / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 shrink-0 truncate text-sm">{label}</div>
      <div className="flex-1">
        <div className="h-5 rounded bg-muted">
          <div
            className="h-5 rounded bg-primary/80"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="w-32 shrink-0 text-right text-sm tabular-nums">
        {formatCurrency(amount)}
        {sub && <span className="ml-1 text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

/** A forecast-grid cell: gross revenue on top, gross margin beneath it. */
function ForecastCell({ revenue, margin }: { revenue: number; margin: number }) {
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      <div>{formatCurrency(revenue)}</div>
      <div className="text-xs font-normal text-muted-foreground">
        GM {formatCurrency(margin)}
      </div>
    </td>
  );
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString(
    "en-US",
    { month: "short", year: "numeric", timeZone: "UTC" },
  );
}

export default async function ForecastPage() {
  await requirePermission("crm:read");

  // Scope the whole forecast to the current fiscal year (Oct 1 – Sep 30) by close date.
  const fy = fiscalYearFor(new Date());
  const opps = await prisma.crmOpportunity.findMany({
    where: { closeDate: { gte: fy.start, lte: fy.end } },
    select: {
      line: true,
      stage: true,
      amount: true,
      marginAmount: true,
      probability: true,
      forecastCategory: true,
      closeDate: true,
    },
  });

  const inputs = opps.map((o) => {
    const amount = o.amount ? Number(o.amount) : 0;
    return {
      line: o.line,
      stage: o.stage,
      amount,
      // Managed Services is assumed 100% margin (full revenue); other lines use
      // the imported margin amount.
      marginAmount: effectiveMarginAmount(
        o.line,
        amount,
        o.marginAmount != null ? Number(o.marginAmount) : null,
      ),
      probability: o.probability,
      closeMonth: o.closeDate.toISOString().slice(0, 7),
    };
  });
  const f = computeForecast(inputs);
  const grid = forecastGrid(inputs);

  const headline = [
    {
      label: "Open pipeline",
      value: formatCurrency(f.openAmount),
      icon: TrendingUp,
      sub: `${f.openCount} open`,
    },
    {
      label: "Weighted pipeline",
      value: formatCurrency(f.weightedPipeline),
      icon: Scale,
      sub: "amount × probability",
    },
    {
      label: "Won",
      value: formatCurrency(f.wonAmount),
      icon: Trophy,
      sub: `${f.wonCount} deals · ${formatCurrency(f.wonMargin)} margin`,
    },
    {
      label: "Win rate",
      value: `${f.winRatePct}%`,
      icon: Percent,
      sub: `${f.wonCount} won / ${f.wonCount + f.lostCount} closed`,
    },
  ];

  // Gross revenue (deal amount) per forecast category, for the category cards.
  const revenueByCategory: Record<string, number> = {};
  for (const o of opps) {
    revenueByCategory[o.forecastCategory] =
      (revenueByCategory[o.forecastCategory] ?? 0) + (o.amount ? Number(o.amount) : 0);
  }
  const categoryCards: { label: string; category: string }[] = [
    { label: "Closed", category: "CLOSED" },
    { label: "Commit", category: "COMMIT" },
    { label: "Best Case", category: "BEST_CASE" },
    { label: "Open", category: "PIPELINE" },
  ];

  const lineMax = Math.max(1, ...CRM_LINE_ORDER.map((l) => f.byLine[l].amount));
  const stageMax = Math.max(1, ...STAGE_ORDER.map((s) => f.byStage[s].amount));

  return (
    <div>
      <PageHeader
        title="Sales Forecast"
        description={`Pipeline across all Salesforce opportunities — Products, Managed Services, Managed NOC and Microsoft 365. Fiscal year ${fy.label}: ${formatDate(fy.start)} – ${formatDate(fy.end)}.`}
      />
      <div className="space-y-6 p-4 sm:p-8">
        {opps.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="No opportunities yet"
            description="Add opportunities under Products, Managed Services, Managed NOC, or Microsoft 365 to build your forecast."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {headline.map((h) => (
                <Card key={h.label}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{h.label}</p>
                    <h.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{h.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{h.sub}</p>
                </Card>
              ))}
            </div>

            {/* Gross revenue by forecast category */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {categoryCards.map((c) => (
                <Card key={c.category}>
                  <p className="text-sm text-muted-foreground">Gross Revenue — {c.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {formatCurrency(revenueByCategory[c.category] ?? 0)}
                  </p>
                </Card>
              ))}
            </div>

            {/* Forecast sheet: months × cumulative categories */}
            <Card>
              <h2 className="mb-1 text-sm font-semibold">Forecast by month</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                Closed = 100% (PO) · Commit = 99% (verbal) · Best Case = 75%+ ·
                Open Pipeline = 0–74%. Closed/Commit/Best Case are cumulative.
                Each cell shows <span className="font-medium">Gross Revenue</span> with{" "}
                <span className="font-medium">Gross Margin</span> beneath it.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Month</th>
                      <th className="px-3 py-2 text-right font-medium">Closed Only</th>
                      <th className="px-3 py-2 text-right font-medium">Commit Forecast</th>
                      <th className="px-3 py-2 text-right font-medium">Best Case Forecast</th>
                      <th className="px-3 py-2 text-right font-medium">Open Pipeline</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-y bg-muted/50 font-semibold">
                      <td className="px-3 py-2">Total · {grid.rows.length} mo</td>
                      <ForecastCell revenue={grid.total.closedOnly} margin={grid.total.closedOnlyMargin} />
                      <ForecastCell revenue={grid.total.commit} margin={grid.total.commitMargin} />
                      <ForecastCell revenue={grid.total.bestCase} margin={grid.total.bestCaseMargin} />
                      <ForecastCell revenue={grid.total.openPipeline} margin={grid.total.openPipelineMargin} />
                    </tr>
                    {grid.rows.map((r) => (
                      <tr key={r.month} className="border-t">
                        <td className="px-3 py-2">{monthLabel(r.month)}</td>
                        <ForecastCell revenue={r.closedOnly} margin={r.closedOnlyMargin} />
                        <ForecastCell revenue={r.commit} margin={r.commitMargin} />
                        <ForecastCell revenue={r.bestCase} margin={r.bestCaseMargin} />
                        <ForecastCell revenue={r.openPipeline} margin={r.openPipelineMargin} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <h2 className="mb-4 text-sm font-semibold">Pipeline by line of business</h2>
                <div className="space-y-3">
                  {CRM_LINE_ORDER.map((l) => (
                    <Link key={l} href={`/crm/${CRM_LINES[l].slug}`} className="block">
                      <Bar
                        label={CRM_LINES[l].label}
                        amount={f.byLine[l].amount}
                        max={lineMax}
                        sub={`${f.byLine[l].count}`}
                      />
                    </Link>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Total amount of all opportunities per line. Click a line to manage it.
                </p>
              </Card>

              <Card>
                <h2 className="mb-4 text-sm font-semibold">Funnel by stage</h2>
                <div className="space-y-3">
                  {STAGE_ORDER.map((s) => (
                    <Bar
                      key={s}
                      label={STAGE_LABELS[s]}
                      amount={f.byStage[s].amount}
                      max={stageMax}
                      sub={`${f.byStage[s].count}`}
                    />
                  ))}
                </div>
              </Card>

            </div>
          </>
        )}
      </div>
    </div>
  );
}
