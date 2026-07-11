import { Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { quotaPeriodRange, quotaPeriodLabel } from "@/lib/crm/quota";
import { QuotaForm } from "./quota-form";
import { deleteQuotaAction } from "./actions";

function attainmentTone(pct: number): string {
  if (pct >= 100) return "text-success";
  if (pct >= 60) return "text-warning";
  return "text-danger";
}

export default async function SalesManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const user = await requirePermission("crm:read");
  const canManage = can(user.role, "crm:manage");

  const sp = await searchParams;
  const now = new Date();
  const parsedYear = Number(sp.year);
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2020 && parsedYear <= 2100
      ? parsedYear
      : now.getUTCFullYear();
  const { start: yearStart, end: yearEnd } = quotaPeriodRange(year, 0);

  // Salespeople = WolfStrata users who own opportunities (from Salesforce or
  // created in-app).
  const ownerGroups = await prisma.crmOpportunity.groupBy({
    by: ["ownerId"],
    _count: { _all: true },
  });
  const ownerIds = ownerGroups.map((g) => g.ownerId);
  const owners = await prisma.user.findMany({
    where: { id: { in: ownerIds } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  const oppCountByOwner = new Map(ownerGroups.map((g) => [g.ownerId, g._count._all]));

  // All of this year's opportunities for those owners, once; aggregate in memory.
  const opps = await prisma.crmOpportunity.findMany({
    where: {
      ownerId: { in: ownerIds },
      closeDate: { gte: yearStart, lt: yearEnd },
    },
    select: { ownerId: true, stage: true, amount: true, closeDate: true },
  });

  function sumFor(
    ownerId: string,
    start: Date,
    end: Date,
    kind: "won" | "open",
  ): number {
    let total = 0;
    for (const o of opps) {
      if (o.ownerId !== ownerId) continue;
      if (o.closeDate < start || o.closeDate >= end) continue;
      const isWon = o.stage === "CLOSED_WON";
      const isOpen = o.stage !== "CLOSED_WON" && o.stage !== "CLOSED_LOST";
      if ((kind === "won" && isWon) || (kind === "open" && isOpen)) {
        total += o.amount != null ? Number(o.amount) : 0;
      }
    }
    return total;
  }

  const quotas = await prisma.salesQuota.findMany({
    where: { year },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ userId: "asc" }, { quarter: "asc" }],
  });

  const quotaRows = quotas.map((q) => {
    const range = quotaPeriodRange(q.year, q.quarter);
    const target = Number(q.targetAmount);
    const closedWon = sumFor(q.userId, range.start, range.end, "won");
    const openPipeline = sumFor(q.userId, range.start, range.end, "open");
    const attainment = target > 0 ? (closedWon / target) * 100 : 0;
    return { q, target, closedWon, openPipeline, attainment };
  });

  const salespeople = owners.map((o) => ({
    id: o.id,
    label: o.name ?? o.email,
  }));

  return (
    <div>
      <PageHeader
        title="Sales Management"
        description="Salespeople from your opportunities, their quota targets by quarter or year, and attainment against closed-won contract value."
      />
      <div className="space-y-6 p-4 sm:p-8">
        {/* Year selector */}
        <form method="get" className="flex items-end gap-3">
          <label className="block text-xs font-medium text-muted-foreground">
            Year
            <input
              name="year"
              type="number"
              defaultValue={year}
              min={2020}
              max={2100}
              className="mt-1 block w-24 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <button className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent">
            Apply
          </button>
        </form>

        {/* Salespeople overview */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Salespeople ({owners.length})</h2>
          {owners.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title="No salespeople yet"
              description="Salespeople appear here once opportunities are imported from Salesforce (or created in-app) with them as owner."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Salesperson</th>
                    <th className="px-4 py-2 font-medium">Opportunities (all time)</th>
                    <th className="px-4 py-2 font-medium">Closed won ({year})</th>
                    <th className="px-4 py-2 font-medium">Open pipeline ({year})</th>
                  </tr>
                </thead>
                <tbody>
                  {owners.map((o) => (
                    <tr key={o.id} className="border-t">
                      <td className="px-4 py-2 font-medium">
                        {o.name ?? o.email}
                        {o.name && (
                          <div className="text-xs text-muted-foreground">{o.email}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {oppCountByOwner.get(o.id) ?? 0}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {formatCurrency(sumFor(o.id, yearStart, yearEnd, "won"))}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {formatCurrency(sumFor(o.id, yearStart, yearEnd, "open"))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Set quota */}
        {canManage && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Set a quota target</h2>
            <QuotaForm salespeople={salespeople} year={year} />
          </Card>
        )}

        {/* Quotas & attainment */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">
            Quotas &amp; attainment — {year}
          </h2>
          {quotaRows.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title="No quotas set for this year"
              description={
                canManage
                  ? "Use “Set a quota target” above to give a salesperson an annual or quarterly target."
                  : "No targets have been set for this year yet."
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Salesperson</th>
                    <th className="px-4 py-2 font-medium">Period</th>
                    <th className="px-4 py-2 font-medium">Target</th>
                    <th className="px-4 py-2 font-medium">Closed won</th>
                    <th className="px-4 py-2 font-medium">Attainment</th>
                    <th className="px-4 py-2 font-medium">Open pipeline</th>
                    {canManage && <th className="px-4 py-2 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {quotaRows.map(({ q, target, closedWon, openPipeline, attainment }) => (
                    <tr key={q.id} className="border-t align-middle">
                      <td className="px-4 py-2 font-medium">
                        {q.user.name ?? q.user.email}
                      </td>
                      <td className="px-4 py-2">
                        {q.year} {quotaPeriodLabel(q.quarter)}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{formatCurrency(target)}</td>
                      <td className="px-4 py-2 tabular-nums">{formatCurrency(closedWon)}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium tabular-nums ${attainmentTone(attainment)}`}>
                            {attainment.toFixed(0)}%
                          </span>
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${
                                attainment >= 100
                                  ? "bg-success"
                                  : attainment >= 60
                                    ? "bg-warning"
                                    : "bg-danger"
                              }`}
                              style={{ width: `${Math.min(100, attainment)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 tabular-nums">{formatCurrency(openPipeline)}</td>
                      {canManage && (
                        <td className="px-4 py-2 text-right">
                          <form action={deleteQuotaAction}>
                            <input type="hidden" name="id" value={q.id} />
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
          <p className="mt-2 text-xs text-muted-foreground">
            Attainment = closed-won contract value (TCV) with a close date inside the
            period, divided by the target. Open pipeline shows what could still close
            in the period.
          </p>
        </section>
      </div>
    </div>
  );
}
