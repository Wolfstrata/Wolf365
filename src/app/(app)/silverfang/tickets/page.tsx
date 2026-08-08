import Link from "next/link";
import { Download, Ticket } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { PawTip } from "@/components/ui/paw-tip";
import { getTicketRows, getTicketFormOptions } from "@/lib/silverfang/queries";
import { PRIORITY_LABELS } from "@/lib/silverfang/constants";
import { TICKET_ORDER_EXPLANATION } from "@/lib/silverfang/ticket-order";
import { TicketsTable } from "./tickets-table";
import { QueueFilters } from "./queue-filters";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

function tabClass(active: boolean): string {
  return active
    ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
    : "rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent";
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("tickets:read");
  const sp = await searchParams;
  const view = sp.view ?? "open";

  const canWrite = can(user.role, "tickets:write");
  const [rows, options, moveProjects] = await Promise.all([
    getTicketRows({
      view,
      boardId: sp.board,
      statusId: sp.status,
      assigneeId: sp.assignee,
      clientId: sp.client,
      priority: sp.priority,
      q: sp.q,
    }),
    getTicketFormOptions(),
    // Live projects only: moving a ticket onto a finished project would put new
    // work on something already closed out.
    canWrite
      ? prisma.sfProject.findMany({
          where: { status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } },
          orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            client: { select: { name: true } },
            phases: {
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              select: { id: true, name: true },
            },
          },
          take: 500,
        })
      : Promise.resolve([]),
  ]);

  const noSetup = options.boards.length === 0;
  // Named when you have drilled into one, so the page says where you are instead
  // of claiming to show every board.
  const activeBoard = sp.board ? options.boards.find((b) => b.id === sp.board) : undefined;
  const breached = rows.filter((r) => r.slaBreached && !r.statusIsClosed).length;
  const unassigned = rows.filter((r) => !r.assignee && !r.statusIsClosed).length;

  /**
   * A link that keeps the current filters, with `overrides` applied. Passing
   * `undefined` for a key drops it — building the query rather than editing the
   * finished URL, because a regex over a query string breaks on the first filter
   * whose value contains an ampersand.
   */
  const filterHref = (overrides: Record<string, string | undefined> = {}) => {
    const current: Record<string, string | undefined> = {
      view: view === "open" ? undefined : view,
      board: sp.board,
      status: sp.status,
      assignee: sp.assignee,
      client: sp.client,
      priority: sp.priority,
      q: sp.q,
    };
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...overrides })) {
      if (v) q.set(k, v);
    }
    const query = q.toString();
    return query ? `/silverfang/tickets?${query}` : "/silverfang/tickets";
  };
  const viewHref = (key: string) => filterHref({ view: key === "open" ? undefined : key });

  return (
    <div>
      <PageHeader
        help={<PawTip topic="tickets" />}
        title={activeBoard ? `${activeBoard.name} tickets` : "Tickets"}
        description={
          (activeBoard
            ? `Tickets on the ${activeBoard.name} board. `
            : "Service tickets across all boards. ") +
          `${TICKET_ORDER_EXPLANATION} SLA state is measured in business hours.`
        }
        actions={
          noSetup ? null : (
            <div className="flex flex-wrap items-center gap-2">
              {can(user.role, "silverfang:configure") && (
                <Link
                  href="/silverfang/tickets/import"
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent"
                >
                  <Download className="h-4 w-4" /> Import from SuperOps
                </Link>
              )}
              {can(user.role, "tickets:write") && (
                <Link
                  href="/silverfang/tickets/new"
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                >
                  New ticket
                </Link>
              )}
            </div>
          )
        }
      />
      <div className="space-y-4 p-4 sm:p-8">
        {noSetup ? (
          <EmptyState
            icon={<Ticket className="h-8 w-8" />}
            title="SilverFang isn't set up yet"
            description={
              can(user.role, "silverfang:configure")
                ? "Create the default service board, statuses, SLA and charge codes from SilverFang Setup, then you can open tickets."
                : "No service board exists yet. Ask a SilverFang administrator to run the setup."
            }
          />
        ) : (
          <>
            {/* View tabs + quick counts */}
            <div className="flex flex-wrap items-center gap-3">
              {VIEWS.map((v) => (
                <Link key={v.key} href={viewHref(v.key)} className={tabClass(view === v.key)}>
                  {v.label}
                </Link>
              ))}
              <span className="text-sm text-muted-foreground">{rows.length} shown</span>
              {activeBoard && (
                <Link
                  href={filterHref({ board: undefined })}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  All boards
                </Link>
              )}
              {breached > 0 && (
                <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
                  {breached} SLA breached
                </span>
              )}
              {unassigned > 0 && (
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                  {unassigned} unassigned
                </span>
              )}
            </div>

            {/* Filters. The client and assignee pickers are type-to-filter; see
                QueueFilters for why that needs a client component. */}
            <Card>
              <QueueFilters
                view={view}
                boards={options.boards.map((b) => ({ id: b.id, name: b.name }))}
                users={options.users.map((u) => ({
                  id: u.id,
                  name: u.name ?? u.email,
                  email: u.email,
                }))}
                clients={options.clients}
                priorities={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                initial={{
                  q: sp.q ?? "",
                  board: sp.board ?? "",
                  priority: sp.priority ?? "",
                  assignee: sp.assignee ?? "",
                  client: sp.client ?? "",
                }}
              />
            </Card>

            <Card>
              {rows.length === 0 ? (
                <EmptyState
                  icon={<Ticket className="h-8 w-8" />}
                  title="No tickets found"
                  description="No tickets match these filters. Try the All tab, or open a new ticket."
                />
              ) : (
                <TicketsTable
                  rows={rows}
                  returnTo={filterHref()}
                  {...(canWrite
                    ? {
                        bulk: {
                          boards: options.boards.map((b) => ({ id: b.id, name: b.name })),
                          projects: moveProjects.map((p) => ({
                            id: p.id,
                            name: p.name,
                            clientName: p.client.name,
                            phases: p.phases,
                          })),
                        },
                        // Row-level triage: change status, priority or assignee
                        // without leaving the queue and losing your place in it.
                        inline: {
                          statusesByBoard: Object.fromEntries(
                            options.boards.map((b) => [
                              b.id,
                              b.statuses.map((st) => ({ id: st.id, name: st.name })),
                            ]),
                          ),
                          users: options.users.map((u) => ({
                            id: u.id,
                            name: u.name ?? u.email,
                          })),
                        },
                      }
                    : {})}
                />
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
