import Link from "next/link";
import { LayoutDashboard, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem, EmptyState } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/utils";
import { formatHours, weekStartOf } from "@/lib/silverfang/time";
import { shiftWeeks } from "@/lib/silverfang/timesheet";
import { PRIORITY_LABELS } from "@/lib/silverfang/constants";

export const dynamic = "force-dynamic";

/**
 * SilverFang dashboard: queue health, SLA attainment, utilisation and unbilled
 * work. Every figure is a real query — where there is no data, the card says so
 * rather than showing a zero that looks like a result.
 */
export default async function SilverFangDashboardPage() {
  const user = await requirePermission("tickets:read");
  const canApprove = can(user.role, "time:approve");

  const now = new Date();
  const thisWeek = weekStartOf(now);
  const lastWeek = shiftWeeks(thisWeek, -1);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [
    openCount,
    unassigned,
    breachedResponse,
    breachedResolution,
    atRiskCount,
    byPriority,
    byBoard,
    closedThisMonth,
    openedThisMonth,
    weekTime,
    lastWeekTime,
    unbilledApproved,
    pendingSheets,
    topClients,
    oldestOpen,
  ] = await Promise.all([
    prisma.sfTicket.count({ where: { status: { isClosed: false }, client: { archived: false } } }),
    prisma.sfTicket.count({
      where: { status: { isClosed: false }, assigneeId: null, client: { archived: false } },
    }),
    prisma.sfTicket.count({
      where: { status: { isClosed: false }, slaResponseBreached: true },
    }),
    prisma.sfTicket.count({
      where: { status: { isClosed: false }, slaResolutionBreached: true },
    }),
    // Warned but not yet breached: the ones still worth chasing. A target that
    // has already breached is counted above, not here — it is no longer at risk,
    // it is a miss.
    prisma.sfTicket.count({
      where: {
        status: { isClosed: false },
        client: { archived: false },
        OR: [
          { slaResponseAtRiskAt: { not: null }, slaResponseBreached: false },
          { slaResolutionAtRiskAt: { not: null }, slaResolutionBreached: false },
        ],
      },
    }),
    prisma.sfTicket.groupBy({
      by: ["priority"],
      where: { status: { isClosed: false }, client: { archived: false } },
      _count: { _all: true },
    }),
    prisma.sfTicket.groupBy({
      by: ["boardId"],
      where: { status: { isClosed: false }, client: { archived: false } },
      _count: { _all: true },
    }),
    prisma.sfTicket.count({ where: { closedAt: { gte: monthStart } } }),
    prisma.sfTicket.count({ where: { openedAt: { gte: monthStart } } }),
    prisma.sfTimeEntry.aggregate({
      where: { workDate: { gte: thisWeek } },
      _sum: { hours: true, amount: true },
    }),
    prisma.sfTimeEntry.aggregate({
      where: { workDate: { gte: lastWeek, lt: thisWeek } },
      _sum: { hours: true, amount: true },
    }),
    prisma.sfTimeEntry.aggregate({
      where: { status: "APPROVED", billable: true, invoicedAt: null },
      _sum: { hours: true, amount: true },
    }),
    canApprove
      ? prisma.sfTimesheet.count({ where: { status: "SUBMITTED" } })
      : Promise.resolve(0),
    prisma.sfTimeEntry.groupBy({
      by: ["agreementId"],
      where: { status: "APPROVED", billable: true, invoicedAt: null },
      _sum: { amount: true, hours: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 5,
    }),
    prisma.sfTicket.findMany({
      where: { status: { isClosed: false }, client: { archived: false } },
      orderBy: { openedAt: "asc" },
      take: 8,
      select: {
        id: true,
        number: true,
        summary: true,
        openedAt: true,
        priority: true,
        slaResponseBreached: true,
        slaResolutionBreached: true,
        client: { select: { name: true } },
        assignee: { select: { name: true, email: true } },
      },
    }),
  ]);

  const boards = await prisma.sfBoard.findMany({ select: { id: true, name: true } });
  const boardName = new Map(boards.map((b) => [b.id, b.name]));
  const agreementIds = topClients.map((t) => t.agreementId).filter((v): v is string => v != null);
  const agreements = agreementIds.length
    ? await prisma.sfAgreement.findMany({
        where: { id: { in: agreementIds } },
        select: { id: true, name: true, client: { select: { name: true } } },
      })
    : [];
  const agreementLabel = new Map(
    agreements.map((a) => [a.id, `${a.client.name} — ${a.name}`]),
  );

  const weekHours = weekTime._sum.hours != null ? Number(weekTime._sum.hours) : 0;
  const weekValue = weekTime._sum.amount != null ? Number(weekTime._sum.amount) : 0;
  const lastHours = lastWeekTime._sum.hours != null ? Number(lastWeekTime._sum.hours) : 0;
  const unbilledHours = unbilledApproved._sum.hours != null ? Number(unbilledApproved._sum.hours) : 0;
  const unbilledValue =
    unbilledApproved._sum.amount != null ? Number(unbilledApproved._sum.amount) : 0;
  const breached = breachedResponse + breachedResolution;
  const everything = openCount === 0 && weekHours === 0 && unbilledHours === 0;

  if (everything) {
    return (
      <div>
        <PageHeader title="SilverFang Dashboard" description="Queue health, SLA, time and unbilled work." />
        <div className="p-4 sm:p-8">
          <Card>
            <EmptyState
              icon={<LayoutDashboard className="h-8 w-8" />}
              title="Nothing to report yet"
              description="Once tickets are open and time is logged, this page shows queue health, SLA breaches, weekly hours and approved time waiting to be invoiced."
            />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="SilverFang Dashboard"
        description="Queue health, SLA, time and unbilled work."
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Queue</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatItem
              label="Open tickets"
              value={
                <Link href="/silverfang/tickets" className="text-primary hover:underline">
                  {openCount}
                </Link>
              }
            />
            <StatItem
              label="Unassigned"
              value={
                <span className={unassigned > 0 ? "text-warning" : ""}>{unassigned}</span>
              }
            />
            <StatItem
              label="SLA at risk"
              value={<span className={atRiskCount > 0 ? "text-warning" : ""}>{atRiskCount}</span>}
            />
            <StatItem
              label="SLA breached"
              value={<span className={breached > 0 ? "text-danger" : ""}>{breached}</span>}
            />
            <StatItem label="Opened this month" value={openedThisMonth} />
            <StatItem label="Closed this month" value={closedThisMonth} />
            <StatItem
              label="Net this month"
              value={
                <span className={openedThisMonth > closedThisMonth ? "text-warning" : "text-success"}>
                  {openedThisMonth - closedThisMonth >= 0 ? "+" : ""}
                  {openedThisMonth - closedThisMonth}
                </span>
              }
            />
          </div>
          {atRiskCount > 0 && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-warning">
              <TriangleAlert className="h-3.5 w-3.5" />
              {atRiskCount} open ticket(s) have a target close to being missed that can still be
              met.
            </p>
          )}
          {breached > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-danger">
              <TriangleAlert className="h-3.5 w-3.5" />
              {breachedResponse} response and {breachedResolution} resolution target(s) breached on
              open tickets.
            </p>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Open by priority</h2>
            {byPriority.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing open.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {byPriority
                  .sort((a, b) => a.priority.localeCompare(b.priority))
                  .map((p) => (
                    <li key={p.priority} className="flex items-center gap-3">
                      <span className="w-28">{PRIORITY_LABELS[p.priority]}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full bg-primary"
                          style={{ width: `${(p._count._all / Math.max(openCount, 1)) * 100}%` }}
                        />
                      </span>
                      <span className="w-8 text-right tabular-nums">{p._count._all}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold">Open by board</h2>
            {byBoard.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing open.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {byBoard.map((b) => (
                  <li key={b.boardId} className="flex items-center gap-3">
                    <span className="w-40 truncate">{boardName.get(b.boardId) ?? "Unknown"}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full bg-primary"
                        style={{ width: `${(b._count._all / Math.max(openCount, 1)) * 100}%` }}
                      />
                    </span>
                    <span className="w-8 text-right tabular-nums">{b._count._all}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Time &amp; billing</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatItem label="Hours this week" value={formatHours(weekHours)} />
            <StatItem
              label="vs last week"
              value={
                lastHours === 0 ? (
                  <span className="text-muted-foreground">no baseline</span>
                ) : (
                  <span className={weekHours >= lastHours ? "text-success" : "text-warning"}>
                    {weekHours >= lastHours ? "+" : ""}
                    {formatHours(Math.abs(weekHours - lastHours))}
                  </span>
                )
              }
            />
            <StatItem label="Value this week" value={formatCurrency(weekValue)} />
            <StatItem
              label="Approved, not invoiced"
              value={
                <Link href="/silverfang/timesheets" className="text-primary hover:underline">
                  {formatHours(unbilledHours)}
                </Link>
              }
            />
            <StatItem label="Unbilled value" value={formatCurrency(unbilledValue)} />
          </div>
          {canApprove && pendingSheets > 0 && (
            <p className="mt-3 text-xs text-warning">
              {pendingSheets} timesheet(s) awaiting approval — approved time is what can be
              invoiced.{" "}
              <Link
                href="/silverfang/timesheets?view=all&pending=1"
                className="text-primary hover:underline"
              >
                Review
              </Link>
            </p>
          )}
          {unbilledHours > 0 && unbilledValue === 0 && (
            <p className="mt-3 text-xs text-warning">
              {formatHours(unbilledHours)} is approved but has no value — no rate resolved for it.
              Add a rate rule or an agreement standard rate, or it can never be invoiced.
            </p>
          )}
        </Card>

        {topClients.length > 0 && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Unbilled by agreement</h2>
            <ul className="space-y-1.5 text-sm">
              {topClients.map((t) => (
                <li key={t.agreementId ?? "none"} className="flex flex-wrap items-center gap-3">
                  <span className="flex-1 truncate">
                    {t.agreementId
                      ? (agreementLabel.get(t.agreementId) ?? "Unknown agreement")
                      : "No agreement — time and materials"}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatHours(t._sum.hours != null ? Number(t._sum.hours) : 0)}
                  </span>
                  <span className="w-24 text-right tabular-nums">
                    {formatCurrency(t._sum.amount != null ? Number(t._sum.amount) : 0)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Oldest open tickets</h2>
          {oldestOpen.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing open.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {oldestOpen.map((t) => {
                const days = Math.floor((now.getTime() - t.openedAt.getTime()) / 86_400_000);
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/silverfang/tickets/${t.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      #{t.number}
                    </Link>
                    <span className="flex-1 truncate">{t.summary}</span>
                    <span className="text-xs text-muted-foreground">{t.client.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.assignee?.name ?? t.assignee?.email ?? "unassigned"}
                    </span>
                    {(t.slaResponseBreached || t.slaResolutionBreached) && (
                      <span className="rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
                        SLA
                      </span>
                    )}
                    <span className={`w-16 text-right text-xs tabular-nums ${days > 14 ? "text-warning" : "text-muted-foreground"}`}>
                      {days}d
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
