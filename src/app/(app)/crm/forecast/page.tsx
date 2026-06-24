import Link from "next/link";
import { TrendingUp, Scale, Trophy, Percent, Layers, Coins } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { computeForecast, type Bucket } from "@/lib/crm/forecast";
import {
  CRM_LINES,
  CRM_LINE_ORDER,
  STAGE_ORDER,
  STAGE_LABELS,
  FORECAST_CATEGORY_LABELS,
} from "@/lib/crm/constants";
import type { CrmForecastCategory } from "@prisma/client";

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

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString(
    "en-US",
    { month: "short", year: "numeric", timeZone: "UTC" },
  );
}

export default async function ForecastPage() {
  await requirePermission("crm:read");

  const opps = await prisma.crmOpportunity.findMany({
    select: {
      line: true,
      stage: true,
      amount: true,
      marginAmount: true,
      commissionAmount: true,
      probability: true,
      forecastCategory: true,
      closeDate: true,
    },
  });

  // Projected commission on open (not-yet-closed) Managed Services & NOC deals.
  const openCommission = opps
    .filter((o) => o.stage !== "CLOSED_WON" && o.stage !== "CLOSED_LOST")
    .reduce(
      (sum, o) => sum + (o.commissionAmount ? Number(o.commissionAmount) : 0),
      0,
    );

  const f = computeForecast(
    opps.map((o) => ({
      line: o.line,
      stage: o.stage,
      amount: o.amount ? Number(o.amount) : 0,
      marginAmount: o.marginAmount ? Number(o.marginAmount) : 0,
      probability: o.probability,
      closeMonth: o.closeDate.toISOString().slice(0, 7),
    })),
  );

  // Forecast category rollup (open + closed) for the commit/best-case view.
  const byCategory: Record<string, Bucket> = {};
  for (const o of opps) {
    const b = (byCategory[o.forecastCategory] ??= { count: 0, amount: 0, weighted: 0 });
    b.count += 1;
    b.amount += o.amount ? Number(o.amount) : 0;
  }

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

  const lineMax = Math.max(1, ...CRM_LINE_ORDER.map((l) => f.byLine[l].amount));
  const stageMax = Math.max(1, ...STAGE_ORDER.map((s) => f.byStage[s].amount));
  const monthMax = Math.max(1, ...f.byMonth.map((m) => m.amount));
  const CATEGORY_ORDER: CrmForecastCategory[] = [
    "COMMIT",
    "BEST_CASE",
    "PIPELINE",
    "CLOSED",
    "OMITTED",
  ];
  const catMax = Math.max(
    1,
    ...CATEGORY_ORDER.map((c) => byCategory[c]?.amount ?? 0),
  );

  return (
    <div>
      <PageHeader
        title="Sales Forecast"
        description="Pipeline across Managed Services, Managed NOC and Microsoft 365."
      />
      <div className="space-y-6 p-8">
        {opps.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="No opportunities yet"
            description="Add opportunities under Managed Services, Managed NOC, or Microsoft 365 to build your forecast."
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

            <Card className="flex items-center gap-3">
              <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
              <p className="text-sm">
                Projected commission on open Managed Services &amp; NOC pipeline:{" "}
                <span className="font-semibold tabular-nums">
                  {formatCurrency(openCommission)}
                </span>
                <span className="ml-1 text-muted-foreground">
                  (1 yr = 1 mo MRR · 2 yr = 1.5 mo · 3 yr = 2 mo)
                </span>
              </p>
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

              <Card>
                <h2 className="mb-4 text-sm font-semibold">Open pipeline by close month</h2>
                {f.byMonth.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No open opportunities with a close date.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {f.byMonth.map((m) => (
                      <Bar
                        key={m.month}
                        label={monthLabel(m.month)}
                        amount={m.amount}
                        max={monthMax}
                        sub={`${m.count}`}
                      />
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <h2 className="mb-4 text-sm font-semibold">By forecast category</h2>
                <div className="space-y-3">
                  {CATEGORY_ORDER.map((c) => (
                    <Bar
                      key={c}
                      label={FORECAST_CATEGORY_LABELS[c]}
                      amount={byCategory[c]?.amount ?? 0}
                      max={catMax}
                      sub={`${byCategory[c]?.count ?? 0}`}
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
