import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem, EmptyState } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";
import { formatHours } from "@/lib/silverfang/time";
import { TIMESHEET_STATUS_LABELS } from "@/lib/silverfang/constants";
import { isoDateKey } from "@/lib/silverfang/timesheet";
import { DecisionForm } from "./decision-form";

export const dynamic = "force-dynamic";

/**
 * Weekly timesheets: a tech sees their own, an approver sees everyone's.
 * Submission happens on the Time Entries page, where the week is being worked.
 */
export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("time:log");
  const sp = await searchParams;
  const canApprove = can(user.role, "time:approve");
  const view = sp.view === "all" && canApprove ? "all" : "mine";
  const pendingOnly = sp.pending === "1";

  const sheets = await prisma.sfTimesheet.findMany({
    where: {
      ...(view === "mine" ? { userId: user.id } : {}),
      ...(pendingOnly ? { status: "SUBMITTED" } : {}),
    },
    orderBy: [{ weekStart: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      user: { select: { id: true, name: true, email: true } },
      _count: { select: { entries: true } },
    },
  });

  const awaiting = canApprove
    ? await prisma.sfTimesheet.count({ where: { status: "SUBMITTED" } })
    : 0;

  return (
    <div>
      <PageHeader
        title="Timesheets"
        description="Weekly time, submitted for approval. Approved time is what billing can draw on."
        actions={
          canApprove ? (
            <div className="flex items-center gap-2">
              <Link
                href={view === "all" ? "/silverfang/timesheets" : "/silverfang/timesheets?view=all"}
                className="rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
              >
                {view === "all" ? "Show only mine" : "Show everyone"}
              </Link>
              <Link
                href="/silverfang/timesheets?view=all&pending=1"
                className="rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
              >
                Awaiting approval ({awaiting})
              </Link>
            </div>
          ) : null
        }
      />
      <div className="space-y-4 p-4 sm:p-8">
        {sheets.length === 0 ? (
          <Card>
            <EmptyState
              icon={<CalendarCheck className="h-8 w-8" />}
              title={pendingOnly ? "Nothing awaiting approval" : "No timesheets yet"}
              description="A week appears here once it's submitted. Log time on the Time Entries page and use “Submit week”."
            />
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Week</th>
                    {view === "all" && <th className="py-1 pr-4 font-medium">Tech</th>}
                    <th className="py-1 pr-4 font-medium">Status</th>
                    <th className="py-1 pr-4 text-right font-medium">Entries</th>
                    <th className="py-1 pr-4 text-right font-medium">Total</th>
                    <th className="py-1 pr-4 text-right font-medium">Billable</th>
                    <th className="py-1 pr-4 font-medium">Submitted</th>
                    <th className="py-1 pr-4 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sheets.map((s) => (
                    <tr key={s.id} className="border-t align-top">
                      <td className="py-2 pr-4 whitespace-nowrap">
                        <Link
                          href={`/silverfang/time?week=${isoDateKey(s.weekStart)}`}
                          className="text-primary hover:underline"
                        >
                          {isoDateKey(s.weekStart)}
                        </Link>
                      </td>
                      {view === "all" && (
                        <td className="py-2 pr-4">{s.user.name ?? s.user.email}</td>
                      )}
                      <td className="py-2 pr-4">
                        <span
                          className={
                            s.status === "APPROVED"
                              ? "text-success"
                              : s.status === "REJECTED"
                                ? "text-danger"
                                : s.status === "SUBMITTED"
                                  ? "text-warning"
                                  : ""
                          }
                        >
                          {TIMESHEET_STATUS_LABELS[s.status]}
                        </span>
                        {s.rejectionNote && (
                          <span className="block text-xs text-muted-foreground">
                            {s.rejectionNote}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{s._count.entries}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatHours(Number(s.totalHours))}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatHours(Number(s.billableHours))}
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                        {s.submittedAt ? (
                          <LocalTime value={s.submittedAt.toISOString()} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {canApprove ? (
                          <DecisionForm
                            timesheetId={s.id}
                            status={s.status}
                            isOwn={s.userId === user.id}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {s.status === "SUBMITTED" ? "Awaiting approval" : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {canApprove && (
          <Card>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatItem label="Awaiting approval" value={awaiting} />
              <StatItem
                label="Approved hours (all time)"
                value={formatHours(
                  sheets
                    .filter((s) => s.status === "APPROVED")
                    .reduce((a, s) => a + Number(s.totalHours), 0),
                )}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              An approver can&rsquo;t approve their own week — approved time becomes billable, so
              it needs a second pair of eyes. Sending a week back requires a reason and makes the
              tech&rsquo;s entries editable again.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
