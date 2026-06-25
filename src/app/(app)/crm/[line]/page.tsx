import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Target } from "lucide-react";
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
import { computeForecast } from "@/lib/crm/forecast";
import { OpportunitiesTable, type OpportunityRow } from "./opportunities-table";

export default async function CrmLinePage({
  params,
}: {
  params: Promise<{ line: string }>;
}) {
  const user = await requirePermission("crm:read");
  const { line: slug } = await params;
  const line = lineFromSlug(slug);
  if (!line) notFound();

  const config = CRM_LINES[line];
  const canWrite = can(user.role, "crm:write");

  // Default newest opportunity first (the table also supports column sorting).
  const opps = await prisma.crmOpportunity.findMany({
    where: { line },
    orderBy: [{ createdAt: "desc" }],
    include: { owner: { select: { name: true, email: true } } },
  });

  const summary = computeForecast(
    opps.map((o) => ({
      line: o.line,
      stage: o.stage,
      amount: o.amount ? Number(o.amount) : 0,
      marginAmount: o.marginAmount ? Number(o.marginAmount) : 0,
      probability: o.probability,
      closeMonth: o.closeDate.toISOString().slice(0, 7),
    })),
  );

  const stats = [
    { label: "Open opportunities", value: String(summary.openCount) },
    { label: "Open pipeline (TCV)", value: formatCurrency(summary.openAmount) },
    { label: "Weighted pipeline", value: formatCurrency(summary.weightedPipeline) },
    { label: "Won", value: formatCurrency(summary.wonAmount) },
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
    locked: o.locallyModifiedAt != null,
  }));

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
      <div className="space-y-6 p-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label}>
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{s.value}</p>
            </Card>
          ))}
        </div>

        {opps.length === 0 ? (
          <EmptyState
            icon={<Target className="h-8 w-8" />}
            title="No opportunities yet"
            description={
              canWrite
                ? `Add your first ${config.label} opportunity to start forecasting.`
                : `No ${config.label} opportunities have been added yet.`
            }
          />
        ) : (
          <OpportunitiesTable rows={rows} canWrite={canWrite} />
        )}
      </div>
    </div>
  );
}
