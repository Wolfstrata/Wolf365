import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";
import { formatHours } from "@/lib/silverfang/time";
import { TIMESHEET_STATUS_LABELS } from "@/lib/silverfang/constants";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-warning/15 text-warning",
  APPROVED: "bg-success/15 text-success",
  REJECTED: "bg-danger/15 text-danger",
};

/** Weekly timesheets. Entries roll up here automatically as time is logged. */
export default async function TimesheetsPage() {
  const user = await requirePermission("time:log");
  const canApprove = can(user.role, "time:approve");

  const timesheets = await prisma.sfTimesheet.findMany({
    where: canApprove ? {} : { userId: user.id },
    orderBy: [{ weekStart: "desc" }, { userId: "asc" }],
    take: 100,
    include: {
      user: { select: { name: true, email: true } },
      entries: { select: { hours: true, billable: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="Timesheets"
        description={
          canApprove
            ? "Weekly timesheets across the team."
            : "Your weekly timesheets. Time logged on tickets lands here automatically."
        }
      />
      <div className="space-y-4 p-4 sm:p-8">
        {timesheets.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CalendarCheck className="h-8 w-8" />}
              title="No timesheets yet"
              description="A weekly timesheet is created the first time you log time on a ticket. Submit-and-approve workflow arrives in the next SilverFang phase."
            />
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Week of</th>
                    {canApprove && <th className="py-1 pr-4 font-medium">Tech</th>}
                    <th className="py-1 pr-4 font-medium">Status</th>
                    <th className="py-1 pr-4 text-right font-medium">Entries</th>
                    <th className="py-1 pr-4 text-right font-medium">Total</th>
                    <th className="py-1 pr-4 text-right font-medium">Billable</th>
                    <th className="py-1 pr-4 font-medium">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {timesheets.map((t) => {
                    const total = t.entries.reduce((a, e) => a + Number(e.hours), 0);
                    const billable = t.entries
                      .filter((e) => e.billable)
                      .reduce((a, e) => a + Number(e.hours), 0);
                    const week = t.weekStart.toISOString().slice(0, 10);
                    return (
                      <tr key={t.id} className="border-t align-top">
                        <td className="py-1.5 pr-4">
                          <Link href={`/silverfang/time?week=${week}`} className="text-primary hover:underline">
                            {week}
                          </Link>
                        </td>
                        {canApprove && (
                          <td className="py-1.5 pr-4">{t.user.name ?? t.user.email}</td>
                        )}
                        <td className="py-1.5 pr-4">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[t.status]}`}
                          >
                            {TIMESHEET_STATUS_LABELS[t.status]}
                          </span>
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{t.entries.length}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{formatHours(total)}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {formatHours(billable)}
                        </td>
                        <td className="py-1.5 pr-4 whitespace-nowrap">
                          {t.submittedAt ? <LocalTime value={t.submittedAt.toISOString()} /> : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
