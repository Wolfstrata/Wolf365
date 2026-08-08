import Link from "next/link";
import { UserCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { getTicketRows } from "@/lib/silverfang/queries";
import { TicketsTable } from "../tickets/tickets-table";

export const dynamic = "force-dynamic";

/** The signed-in technician's open queue. */
export default async function MyTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("tickets:read");
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "open";

  const rows = await getTicketRows({ view, assigneeId: user.id });
  const breached = rows.filter((r) => r.slaBreached && !r.statusIsClosed).length;

  // Inline triage here too: this is the queue a tech actually works from, so
  // making them open every ticket to move it along would defeat the point.
  // The same options the main queue passes, so this list is the *same* table with
  // the same controls rather than a stripped-down cousin of it.
  const canWrite = can(user.role, "tickets:write");
  const [boards, users, moveProjects] = canWrite
    ? await Promise.all([
        prisma.sfBoard.findMany({
          where: { active: true },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            statuses: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true } },
          },
        }),
        prisma.user.findMany({
          where: { disabled: false },
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true },
        }),
        // Live projects only: moving a ticket onto a finished project would put new
        // work somewhere nobody is looking.
        prisma.sfProject.findMany({
          where: { status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } },
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            client: { select: { name: true } },
            phases: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              select: { id: true, name: true },
            },
          },
        }),
      ])
    : [[], [], []];

  return (
    <div>
      <PageHeader
        help={<PawTip topic="myTickets" />}
        title="My Tickets"
        description="Tickets currently assigned to you."
        actions={
          <Link
            href={view === "all" ? "/silverfang/my-tickets" : "/silverfang/my-tickets?view=all"}
            className="rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
          >
            {view === "all" ? "Show open only" : "Show all"}
          </Link>
        }
      />
      <div className="space-y-4 p-4 sm:p-8">
        {breached > 0 && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {breached} of your tickets {breached === 1 ? "has" : "have"} breached SLA.
          </div>
        )}
        <Card>
          {rows.length === 0 ? (
            <EmptyState
              icon={<UserCheck className="h-8 w-8" />}
              title="Nothing assigned to you"
              description={
                view === "open"
                  ? "You have no open tickets. Check the full queue for unassigned work."
                  : "No tickets have ever been assigned to you."
              }
            />
          ) : (
            <TicketsTable
              rows={rows}
              returnTo={`/silverfang/my-tickets${view === "all" ? "?view=all" : ""}`}
              {...(canWrite
                ? {
                    bulk: {
                      boards: boards.map((b) => ({ id: b.id, name: b.name })),
                      projects: moveProjects.map((p) => ({
                        id: p.id,
                        name: p.name,
                        clientName: p.client.name,
                        phases: p.phases,
                      })),
                    },
                    inline: {
                      statusesByBoard: Object.fromEntries(
                        boards.map((b) => [b.id, b.statuses]),
                      ),
                      users: users.map((u) => ({ id: u.id, name: u.name ?? u.email })),
                    },
                  }
                : {})}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
