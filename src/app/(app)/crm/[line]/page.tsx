import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Target } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatCurrency, formatDate } from "@/lib/utils";
import { can } from "@/lib/rbac";
import {
  CRM_LINES,
  lineFromSlug,
  STAGE_LABELS,
  BILLING_FREQUENCY_LABELS,
  isOpenStage,
} from "@/lib/crm/constants";
import { computeForecast } from "@/lib/crm/forecast";
import { lineHasCommission } from "@/lib/crm/pricing";

const STAGE_STYLES: Record<string, string> = {
  CLOSED_WON: "text-success",
  CLOSED_LOST: "text-danger",
};

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

  const opps = await prisma.crmOpportunity.findMany({
    where: { line },
    orderBy: [{ closeDate: "asc" }],
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

  const showCommission = lineHasCommission(line);
  // Projected commission on open (not-yet-closed) opportunities.
  const openCommission = opps
    .filter((o) => o.stage !== "CLOSED_WON" && o.stage !== "CLOSED_LOST")
    .reduce((sum, o) => sum + (o.commissionAmount ? Number(o.commissionAmount) : 0), 0);

  const stats = [
    { label: "Open opportunities", value: String(summary.openCount) },
    { label: "Open pipeline (TCV)", value: formatCurrency(summary.openAmount) },
    { label: "Weighted pipeline", value: formatCurrency(summary.weightedPipeline) },
    showCommission
      ? { label: "Commission (open)", value: formatCurrency(openCommission) }
      : { label: "Won", value: formatCurrency(summary.wonAmount) },
  ];

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
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Opportunity</th>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 font-medium">Stage</th>
                  <th className="px-4 py-2 font-medium">TCV</th>
                  <th className="px-4 py-2 font-medium">Margin</th>
                  {showCommission && (
                    <th className="px-4 py-2 font-medium">Commission</th>
                  )}
                  <th className="px-4 py-2 font-medium">Term</th>
                  <th className="px-4 py-2 font-medium">Billing</th>
                  <th className="px-4 py-2 font-medium">Close</th>
                  <th className="px-4 py-2 font-medium">Prob.</th>
                </tr>
              </thead>
              <tbody>
                {opps.map((o) => (
                  <tr key={o.id} className="border-t hover:bg-accent/40">
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/crm/edit/${o.id}`} className="hover:underline">
                        {o.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {o.owner.name ?? o.owner.email}
                      </div>
                    </td>
                    <td className="px-4 py-2">{o.accountName}</td>
                    <td className="px-4 py-2">
                      <span className={STAGE_STYLES[o.stage] ?? ""}>
                        {STAGE_LABELS[o.stage]}
                      </span>
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {o.amount != null ? formatCurrency(Number(o.amount)) : "—"}
                      {o.monthlyAmount != null && (
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(Number(o.monthlyAmount))}/mo
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {o.marginPercentage != null
                        ? `${Number(o.marginPercentage).toFixed(1)}%`
                        : "—"}
                    </td>
                    {showCommission && (
                      <td className="px-4 py-2 tabular-nums">
                        {o.commissionAmount != null
                          ? formatCurrency(Number(o.commissionAmount))
                          : "—"}
                      </td>
                    )}
                    <td className="px-4 py-2 tabular-nums">
                      {o.termYears} yr{o.termYears > 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-2">
                      {BILLING_FREQUENCY_LABELS[o.billingFrequency]}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {formatDate(o.closeDate)}
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {isOpenStage(o.stage) ? `${o.probability}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
