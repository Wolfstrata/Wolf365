import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Target } from "lucide-react";
import type { CrmStage, CrmForecastCategory, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { can } from "@/lib/rbac";
import {
  CRM_LINES,
  lineFromSlug,
  STAGE_LABELS,
  STAGE_ORDER,
  BILLING_FREQUENCY_LABELS,
  isOpenStage,
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

  const sp = await searchParams;
  const stage = STAGE_ORDER.includes(sp.stage as CrmStage)
    ? (sp.stage as CrmStage)
    : undefined;
  const fromDate = parseDay(sp.from);
  const toDate = sp.to ? parseDay(`${sp.to}T23:59:59.999`) : undefined;

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

  // Total MRR per forecast category over the filtered set.
  const mrrByCategory: Record<CrmForecastCategory, number> = {
    CLOSED: 0,
    COMMIT: 0,
    BEST_CASE: 0,
    PIPELINE: 0,
    OMITTED: 0,
  };
  const countByCategory: Record<CrmForecastCategory, number> = {
    CLOSED: 0,
    COMMIT: 0,
    BEST_CASE: 0,
    PIPELINE: 0,
    OMITTED: 0,
  };
  for (const o of opps) {
    mrrByCategory[o.forecastCategory] += o.monthlyAmount ? Number(o.monthlyAmount) : 0;
    countByCategory[o.forecastCategory] += 1;
  }

  const cards: { label: string; category: CrmForecastCategory }[] = [
    { label: "MRR — Closed", category: "CLOSED" },
    { label: "MRR — Commit", category: "COMMIT" },
    { label: "MRR — Best Case", category: "BEST_CASE" },
    { label: "MRR — Open", category: "PIPELINE" },
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

  const filtered = Boolean(stage || fromDate || toDate);

  return (
    <div>
      <PageHeader
        title={config.label}
        description={config.blurb}
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
