import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Target } from "lucide-react";
import type { CrmStage, CrmForecastCategory, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatCurrency, formatDate } from "@/lib/utils";
import { can } from "@/lib/rbac";
import {
  CRM_LINES,
  lineFromSlug,
  STAGE_LABELS,
  STAGE_ORDER,
  BILLING_FREQUENCY_LABELS,
  isOpenStage,
  fiscalYearFor,
} from "@/lib/crm/constants";
import { OpportunitiesTable, type OpportunityRow } from "./opportunities-table";
import { CrmFilterBar } from "./filter-bar";

function parseDay(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function CrmLinePage({
  params,
  searchParams,
}: {
  params: Promise<{ line: string }>;
  searchParams: Promise<{ stage?: string; from?: string; to?: string }>;
}) {
  const user = await requirePermission("crm:read");
  const { line: slug } = await params;
  const line = lineFromSlug(slug);
  if (!line) notFound();

  const config = CRM_LINES[line];
  const canWrite = can(user.role, "crm:write");

  const isProducts = line === "PRODUCTS";
  // Every CRM line is scoped to the current fiscal year (Oct 1 – Sep 30) by
  // close date, unless the user narrows it further with the date filter.
  const fy = fiscalYearFor(new Date());

  const sp = await searchParams;
  const stage = STAGE_ORDER.includes(sp.stage as CrmStage)
    ? (sp.stage as CrmStage)
    : undefined;
  // User-supplied bounds override the fiscal-year default per side.
  const fromDate = parseDay(sp.from) ?? fy.start;
  const toDate = (sp.to ? parseDay(`${sp.to}T23:59:59.999`) : undefined) ?? fy.end;

  const where: Prisma.CrmOpportunityWhereInput = { line };
  if (stage) where.stage = stage;
  if (fromDate || toDate) {
    where.closeDate = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  // Default newest opportunity first (the table also supports column sorting).
  const opps = await prisma.crmOpportunity.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: { owner: { select: { name: true, email: true } } },
  });

  // Per forecast category over the filtered set: MRR (recurring lines), plus
  // gross revenue (from Price = TCV) and gross margin (Price × margin %) for the
  // Products view, which sells one-off product deals rather than recurring MRR.
  const zeroByCategory = (): Record<CrmForecastCategory, number> => ({
    CLOSED: 0,
    COMMIT: 0,
    BEST_CASE: 0,
    PIPELINE: 0,
    OMITTED: 0,
  });
  const mrrByCategory = zeroByCategory();
  const revenueByCategory = zeroByCategory();
  const marginByCategory = zeroByCategory();
  const countByCategory = zeroByCategory();
  for (const o of opps) {
    const price = o.amount != null ? Number(o.amount) : 0;
    const marginPct = o.marginPercentage != null ? Number(o.marginPercentage) : 0;
    mrrByCategory[o.forecastCategory] += o.monthlyAmount ? Number(o.monthlyAmount) : 0;
    revenueByCategory[o.forecastCategory] += price;
    marginByCategory[o.forecastCategory] += price * (marginPct / 100);
    countByCategory[o.forecastCategory] += 1;
  }

  const cards: { label: string; category: CrmForecastCategory }[] = [
    { label: "MRR — Closed", category: "CLOSED" },
    { label: "MRR — Commit", category: "COMMIT" },
    { label: "MRR — Best Case", category: "BEST_CASE" },
    { label: "MRR — Open", category: "PIPELINE" },
  ];

  // Category columns for the Products revenue/margin card rows.
  const productCategories: { label: string; category: CrmForecastCategory }[] = [
    { label: "Closed", category: "CLOSED" },
    { label: "Commit", category: "COMMIT" },
    { label: "Best Case", category: "BEST_CASE" },
    { label: "Open", category: "PIPELINE" },
  ];

  const rows: OpportunityRow[] = opps.map((o) => ({
    id: o.id,
    name: o.name,
    account: o.accountName,
    owner: o.owner.name ?? o.owner.email,
    stage: o.stage,
    stageLabel: STAGE_LABELS[o.stage],
    stageOrder: STAGE_ORDER.indexOf(o.stage),
    tcv: o.amount != null ? Number(o.amount) : null,
    mrr: o.monthlyAmount != null ? Number(o.monthlyAmount) : null,
    marginPct: o.marginPercentage != null ? Number(o.marginPercentage) : null,
    termYears: o.termYears,
    billingLabel: BILLING_FREQUENCY_LABELS[o.billingFrequency],
    closeDate: o.closeDate.toISOString(),
    createdAt: o.createdAt.toISOString(),
    probability: o.probability,
    isOpen: isOpenStage(o.stage),
    locked: o.lockedFields.length > 0,
  }));

  // "Filtered" for the empty-state copy reflects USER filters, not the implicit
  // fiscal-year scoping applied to Products.
  const filtered = Boolean(stage || sp.from || sp.to);

  return (
    <div>
      <PageHeader
        title={config.label}
        description={`${config.blurb} Fiscal year ${fy.label}: ${formatDate(fy.start)} – ${formatDate(fy.end)}.`}
        actions={
          canWrite ? (
            <Link
              href={`/crm/new?line=${config.slug}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> New Opportunity
            </Link>
          ) : undefined
        }
      />
      <div className="space-y-6 p-4 sm:p-8">
        <CrmFilterBar />

        {isProducts ? (
          <div className="space-y-4">
            {/* Gross revenue (from Price) per forecast category. */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {productCategories.map((c) => (
                <Card key={c.category}>
                  <p className="text-sm text-muted-foreground">Gross Revenue — {c.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {formatCurrency(revenueByCategory[c.category])}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {countByCategory[c.category]}{" "}
                    {countByCategory[c.category] === 1 ? "opportunity" : "opportunities"}
                  </p>
                </Card>
              ))}
            </div>
            {/* Gross margin (Price × margin %) per forecast category. */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {productCategories.map((c) => {
                const rev = revenueByCategory[c.category];
                const mgn = marginByCategory[c.category];
                const pct = rev > 0 ? Math.round((mgn / rev) * 1000) / 10 : 0;
                return (
                  <Card key={c.category}>
                    <p className="text-sm text-muted-foreground">Gross Margin — {c.label}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">
                      {formatCurrency(mgn)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{pct}% margin</p>
                  </Card>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* MRR per forecast category. */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {cards.map((c) => (
                <Card key={c.category}>
                  <p className="text-sm text-muted-foreground">{c.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {formatCurrency(mrrByCategory[c.category])}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {countByCategory[c.category]}{" "}
                    {countByCategory[c.category] === 1 ? "opportunity" : "opportunities"}
                  </p>
                </Card>
              ))}
            </div>
            {/* ARR = MRR × 12 per forecast category (fiscal-year annualized). */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {productCategories.map((c) => (
                <Card key={c.category}>
                  <p className="text-sm text-muted-foreground">ARR — {c.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {formatCurrency(mrrByCategory[c.category] * 12)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">annualized (MRR × 12)</p>
                </Card>
              ))}
            </div>
          </div>
        )}

        {opps.length === 0 ? (
          <EmptyState
            icon={<Target className="h-8 w-8" />}
            title={filtered ? "No matching opportunities" : "No opportunities yet"}
            description={
              filtered
                ? "No opportunities match the current filters. Try widening the stage or date range."
                : canWrite
                  ? `Add your first ${config.label} opportunity to start forecasting.`
                  : `No ${config.label} opportunities have been added yet.`
            }
          />
        ) : (
          <OpportunitiesTable
            rows={rows}
            canWrite={canWrite}
            variant={line === "PRODUCTS" ? "products" : "default"}
          />
        )}
      </div>
    </div>
  );
}
