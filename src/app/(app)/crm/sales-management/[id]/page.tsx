import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState, StatItem } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { fiscalYearFor, effectiveMarginAmount } from "@/lib/crm/constants";
import { commissionAmount, productCommission } from "@/lib/crm/pricing";
import { quotaPeriodRange, quotaPeriodLabel } from "@/lib/crm/quota";
import { QuotaForm } from "../quota-form";
import { deleteQuotaAction } from "../actions";
import { RepCompForm } from "./rep-comp-form";

export default async function SalespersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requirePermission("crm:read");
  const canManage = can(viewer.role, "crm:manage");
  const { id } = await params;

  const person = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true },
  });
  if (!person) notFound();

  const comp = await prisma.salesRepComp.findUnique({ where: { userId: id } });
  const baseSalary = comp ? Number(comp.baseSalary) : 0;
  const productPct = comp ? Number(comp.productCommissionPct) : 0;
  const servicesMult = comp ? Number(comp.servicesCommissionMultiplier) : 1;

  // The rep's opportunities, used for fiscal-year commission and quota attainment.
  const opps = await prisma.crmOpportunity.findMany({
    where: { ownerId: id },
    select: {
      line: true,
      stage: true,
      termYears: true,
      monthlyAmount: true,
      amount: true,
      marginAmount: true,
      closeDate: true,
    },
  });

  const fy = fiscalYearFor(new Date());
  const wonInFy = opps.filter(
    (o) => o.stage === "CLOSED_WON" && o.closeDate >= fy.start && o.closeDate <= fy.end,
  );

  // Product commission = pct × gross margin on product deals.
  const productGrossMargin = wonInFy
    .filter((o) => o.line === "PRODUCTS")
    .reduce(
      (sum, o) =>
        sum +
        effectiveMarginAmount(
          o.line,
          o.amount != null ? Number(o.amount) : 0,
          o.marginAmount != null ? Number(o.marginAmount) : null,
        ),
      0,
    );
  const productComm = productCommission(productPct, productGrossMargin);

  // Services commission = standard month-of-MRR schedule × the rep's multiplier.
  const servicesComm =
    wonInFy.reduce(
      (sum, o) =>
        sum + commissionAmount(o.line, o.termYears, o.monthlyAmount != null ? Number(o.monthlyAmount) : 0),
      0,
    ) * servicesMult;

  const totalComp = baseSalary + productComm + servicesComm;

  // Quotas for the current calendar year.
  const year = fy.end.getUTCFullYear();
  const quotas = await prisma.salesQuota.findMany({
    where: { userId: id, year },
    orderBy: { quarter: "asc" },
  });
  const quotaRows = quotas.map((q) => {
    const range = quotaPeriodRange(q.year, q.quarter);
    const target = Number(q.targetAmount);
    const closedWon = opps
      .filter((o) => o.stage === "CLOSED_WON" && o.closeDate >= range.start && o.closeDate < range.end)
      .reduce((s, o) => s + (o.amount != null ? Number(o.amount) : 0), 0);
    return {
      id: q.id,
      label: `${q.year} ${quotaPeriodLabel(q.quarter)}`,
      target,
      closedWon,
      attainment: target > 0 ? (closedWon / target) * 100 : 0,
    };
  });

  return (
    <div>
      <PageHeader
        title={person.name ?? person.email}
        description={`Compensation and quota settings. Commission figures cover ${fy.label} (${fy.start.toISOString().slice(0, 10)} – ${fy.end.toISOString().slice(0, 10)}).`}
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Link
          href="/crm/sales-management"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Sales Management
        </Link>

        {/* Estimated compensation for the fiscal year */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <StatItem label="Base salary" value={formatCurrency(baseSalary)} />
          </Card>
          <Card>
            <StatItem
              label={`Product commission (${fy.label})`}
              value={formatCurrency(productComm)}
            />
          </Card>
          <Card>
            <StatItem
              label={`Services commission (${fy.label})`}
              value={formatCurrency(servicesComm)}
            />
          </Card>
          <Card>
            <StatItem
              label={`Total estimated (${fy.label})`}
              value={formatCurrency(totalComp)}
            />
          </Card>
        </div>

        {/* Compensation settings */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Compensation</h2>
          {canManage ? (
            <RepCompForm
              userId={person.id}
              baseSalary={baseSalary}
              productCommissionPct={productPct}
              servicesCommissionMultiplier={servicesMult}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatItem label="Base salary" value={formatCurrency(baseSalary)} />
              <StatItem label="Product commission" value={`${productPct}% of gross margin`} />
              <StatItem label="Services multiplier" value={`${servicesMult}×`} />
            </div>
          )}
        </Card>

        {/* Quota targets */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Quota targets — {year}</h2>
          {canManage && (
            <div className="mb-4">
              <QuotaForm
                salespeople={[{ id: person.id, label: person.name ?? person.email }]}
                year={year}
              />
            </div>
          )}
          {quotaRows.length === 0 ? (
            <EmptyState
              title="No quota targets set"
              description={
                canManage
                  ? "Use the form above to set an annual or quarterly target."
                  : "No targets have been set for this year yet."
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Period</th>
                    <th className="px-4 py-2 text-right font-medium">Target</th>
                    <th className="px-4 py-2 text-right font-medium">Closed won</th>
                    <th className="px-4 py-2 text-right font-medium">Attainment</th>
                    {canManage && <th className="px-4 py-2 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {quotaRows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-4 py-2">{r.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.target)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.closedWon)}</td>
                      <td
                        className={`px-4 py-2 text-right font-medium tabular-nums ${
                          r.attainment >= 100
                            ? "text-success"
                            : r.attainment >= 60
                              ? "text-warning"
                              : "text-danger"
                        }`}
                      >
                        {r.attainment.toFixed(0)}%
                      </td>
                      {canManage && (
                        <td className="px-4 py-2 text-right">
                          <form action={deleteQuotaAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <button className="rounded-md border px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger/10">
                              Remove
                            </button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
