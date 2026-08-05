import Link from "next/link";
import { Timer } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem, EmptyState } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";
import { formatCurrency } from "@/lib/utils";
import { formatHours, weekStartOf } from "@/lib/silverfang/time";
import { TIME_BAND_LABELS, TIME_ENTRY_STATUS_LABELS } from "@/lib/silverfang/constants";

export const dynamic = "force-dynamic";

/**
 * Time entries for the signed-in technician (or everyone, for approvers).
 * Time is logged from a ticket; this is the review/rollup view.
 */
export default async function TimeEntriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("time:log");
  const sp = await searchParams;
  const canApprove = can(user.role, "time:approve");
  const scope = canApprove && sp.scope === "all" ? "all" : "mine";

  // Default to the current week so the page is a useful timesheet view.
  const weekStart = sp.week ? new Date(`${sp.week}T00:00:00Z`) : weekStartOf(new Date());
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

  const entries = await prisma.sfTimeEntry.findMany({
    where: {
      ...(scope === "mine" ? { userId: user.id } : {}),
      workDate: { gte: weekStart, lt: weekEnd },
    },
    orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
    include: {
      chargeCode: { select: { code: true, name: true } },
      user: { select: { name: true, email: true } },
      ticket: { select: { id: true, number: true, summary: true } },
    },
  });

  const total = entries.reduce((a, e) => a + Number(e.hours), 0);
  const billable = entries.filter((e) => e.billable).reduce((a, e) => a + Number(e.hours), 0);
  const revenue = entries.reduce((a, e) => a + (e.amount != null ? Number(e.amount) : 0), 0);
  const weekLabel = weekStart.toISOString().slice(0, 10);
  const prevWeek = new Date(weekStart.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const nextWeek = new Date(weekStart.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const qs = (week: string) =>
    `/silverfang/time?week=${week}${scope === "all" ? "&scope=all" : ""}`;

  return (
    <div>
      <PageHeader
        title="Time Entries"
        description="Time logged against tickets, by week. Log time from a ticket."
        actions={
          canApprove ? (
            <Link
              href={
                scope === "all"
                  ? `/silverfang/time?week=${weekLabel}`
                  : `/silverfang/time?week=${weekLabel}&scope=all`
              }
              className="rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
            >
              {scope === "all" ? "Show only mine" : "Show everyone"}
            </Link>
          ) : null
        }
      />
      <div className="space-y-4 p-4 sm:p-8">
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Link href={qs(prevWeek)} className="rounded-md border px-2.5 py-1 text-sm transition hover:bg-accent">
              ← Previous
            </Link>
            <span className="text-sm font-medium">Week of {weekLabel}</span>
            <Link href={qs(nextWeek)} className="rounded-md border px-2.5 py-1 text-sm transition hover:bg-accent">
              Next →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatItem label="Total" value={formatHours(total)} />
            <StatItem label="Billable" value={formatHours(billable)} />
            <StatItem label="Non-billable" value={formatHours(total - billable)} />
            <StatItem label="Revenue" value={formatCurrency(revenue)} />
          </div>
        </Card>

        <Card>
          {entries.length === 0 ? (
            <EmptyState
              icon={<Timer className="h-8 w-8" />}
              title="No time this week"
              description="Open a ticket and use “Log time” to record work. Entries appear here grouped by week."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Date</th>
                    {scope === "all" && <th className="py-1 pr-4 font-medium">Tech</th>}
                    <th className="py-1 pr-4 font-medium">Ticket</th>
                    <th className="py-1 pr-4 font-medium">Code</th>
                    <th className="py-1 pr-4 text-right font-medium">Hours</th>
                    <th className="py-1 pr-4 text-right font-medium">Amount</th>
                    <th className="py-1 pr-4 font-medium">Status</th>
                    <th className="py-1 pr-4 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-t align-top">
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        <LocalTime value={e.workDate.toISOString()} dateOnly />
                      </td>
                      {scope === "all" && (
                        <td className="py-1.5 pr-4">{e.user.name ?? e.user.email}</td>
                      )}
                      <td className="py-1.5 pr-4">
                        {e.ticket ? (
                          <Link
                            href={`/silverfang/tickets/${e.ticket.id}`}
                            className="text-primary hover:underline"
                          >
                            #{e.ticket.number}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-1.5 pr-4">
                        {e.chargeCode.code}
                        {e.timeBand !== "ANY" && e.timeBand !== "DAY" && (
                          <span className="ml-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                            {TIME_BAND_LABELS[e.timeBand]}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {formatHours(Number(e.hours))}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {e.amount != null ? formatCurrency(Number(e.amount)) : "—"}
                      </td>
                      <td className="py-1.5 pr-4">{TIME_ENTRY_STATUS_LABELS[e.status]}</td>
                      <td className="py-1.5 pr-4 text-muted-foreground">{e.notes ?? "—"}</td>
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
