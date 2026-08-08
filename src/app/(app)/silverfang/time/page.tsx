import Link from "next/link";
import { Timer } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem, EmptyState } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { LocalTime } from "@/components/ui/local-time";
import { formatCurrency } from "@/lib/utils";
import { formatHours, weekStartOf } from "@/lib/silverfang/time";
import { TIME_BAND_LABELS, TIME_ENTRY_STATUS_LABELS } from "@/lib/silverfang/constants";
import { isoDateKey, weekDays } from "@/lib/silverfang/timesheet";
import { minutesOf, DEFAULT_GRID } from "@/lib/silverfang/calendar";
import { timeEntryEditable } from "@/lib/silverfang/status";
import { WeekCalendar, type CalendarBlock } from "./week-calendar";
import { SubmitWeekButton } from "./submit-week";

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

  const view = sp.view === "list" ? "list" : "calendar";

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
      agreement: { select: { id: true, name: true } },
    },
  });

  // Calendar options and this week's sheet state.
  const [chargeCodes, openTickets, activeAgreements, clients, sheet] =
    await Promise.all([
      prisma.sfChargeCode.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      prisma.sfTicket.findMany({
        where: { status: { isClosed: false }, client: { archived: false } },
        orderBy: { number: "desc" },
        take: 300,
        select: { id: true, number: true, summary: true, client: { select: { name: true } } },
      }),
      prisma.sfAgreement.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        take: 500,
        select: { id: true, name: true, client: { select: { name: true } } },
      }),
      prisma.client.findMany({
        where: { archived: false },
        orderBy: { name: "asc" },
        take: 2000,
        select: { id: true, name: true },
      }),
      prisma.sfTimesheet.findUnique({
        where: { userId_weekStart: { userId: user.id, weekStart } },
        select: { id: true, status: true, rejectionNote: true },
      }),
    ]);

  // The calendar only ever edits the signed-in tech's own blocks; an approver
  // viewing everyone still sees the whole week, but read-only on others' time.
  const weekLocked = sheet?.status === "SUBMITTED" || sheet?.status === "APPROVED";
  const days = weekDays(weekStart).map((d) => ({
    key: d.key,
    label: d.label,
    dateLabel: d.date.toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }),
    weekend: d.weekend,
    isToday: d.key === isoDateKey(new Date()),
  }));

  const blocks: CalendarBlock[] = entries.map((e) => {
    // An entry logged without start/end still needs a place on the grid: put it at
    // the start of the working day so it is visible and editable rather than lost.
    const offset = 0;
    const start = e.startedAt
      ? minutesOf(e.startedAt, offset)
      : DEFAULT_GRID.startHour * 60;
    const end = e.endedAt
      ? minutesOf(e.endedAt, offset)
      : start + Math.max(15, Math.round(Number(e.hours) * 60));
    return {
      id: e.id,
      day: isoDateKey(e.workDate),
      startMinutes: start,
      endMinutes: end,
      hours: Number(e.hours),
      label: e.ticket
        ? `#${e.ticket.number} ${e.ticket.summary}`
        : (e.agreement?.name ?? e.chargeCode.code),
      sublabel: scope === "all" ? (e.user.name ?? e.user.email) : e.chargeCode.code,
      billable: e.billable,
      editable: e.userId === user.id && timeEntryEditable(e.status),
      status: e.status,
      chargeCodeId: e.chargeCodeId,
      ticketId: e.ticketId,
      agreementId: e.agreementId,
      notes: e.notes,
      internalOnly: e.internalOnly,
    };
  });

  const total = entries.reduce((a, e) => a + Number(e.hours), 0);
  const billable = entries.filter((e) => e.billable).reduce((a, e) => a + Number(e.hours), 0);
  const revenue = entries.reduce((a, e) => a + (e.amount != null ? Number(e.amount) : 0), 0);
  const weekLabel = weekStart.toISOString().slice(0, 10);
  const prevWeek = new Date(weekStart.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const nextWeek = new Date(weekStart.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const qs = (week: string) =>
    `/silverfang/time?week=${week}${scope === "all" ? "&scope=all" : ""}${
      view === "list" ? "&view=list" : ""
    }`;
  const viewQs = (v: string) =>
    `/silverfang/time?week=${weekLabel}${scope === "all" ? "&scope=all" : ""}${
      v === "list" ? "&view=list" : ""
    }`;

  return (
    <div>
      <PageHeader
        help={<PawTip topic="time" />}
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

        {sheet?.status === "REJECTED" && sheet.rejectionNote && (
          <Card>
            <p className="text-sm text-danger">
              This week was sent back: {sheet.rejectionNote}
            </p>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={viewQs("calendar")}
            className={
              view === "calendar"
                ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                : "rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
            }
          >
            Calendar
          </Link>
          <Link
            href={viewQs("list")}
            className={
              view === "list"
                ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                : "rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
            }
          >
            List
          </Link>
          <span className="text-xs text-muted-foreground">
            Click any empty slot to log a block — attach it to a ticket, a project phase, an
            agreement, or open a new ticket on the spot.
          </span>
          <SubmitWeekButton
            weekStart={weekLabel}
            status={sheet?.status ?? "OPEN"}
            timesheetId={sheet?.id ?? null}
            entryCount={entries.filter((e) => e.userId === user.id).length}
          />
        </div>

        {view === "calendar" && (
          <Card>
            <WeekCalendar
              days={days}
              blocks={blocks}
              weekLocked={weekLocked}
              options={{
                chargeCodes: chargeCodes.map((c) => ({
                  id: c.id,
                  code: c.code,
                  name: c.name,
                  billableDefault: c.billableDefault,
                })),
                tickets: openTickets.map((t) => ({
                  id: t.id,
                  label: `#${t.number} ${t.client.name} — ${t.summary}`,
                })),
                agreements: activeAgreements.map((a) => ({
                  id: a.id,
                  label: `${a.client.name} — ${a.name}`,
                })),
                clients,
              }}
            />
          </Card>
        )}

        {view === "list" && (
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
        )}
      </div>
    </div>
  );
}
