import Link from "next/link";
import { Ticket } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { getTicketRows, getTicketFormOptions } from "@/lib/silverfang/queries";
import { PRIORITY_LABELS } from "@/lib/silverfang/constants";
import { TICKET_ORDER_EXPLANATION } from "@/lib/silverfang/ticket-order";
import { TicketsTable } from "./tickets-table";

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

  const [rows, options] = await Promise.all([
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
        title={activeBoard ? `${activeBoard.name} tickets` : "Tickets"}
        description={
          (activeBoard
            ? `Tickets on the ${activeBoard.name} board. `
            : "Service tickets across all boards. ") +
          `${TICKET_ORDER_EXPLANATION} SLA state is measured in business hours.`
        }
        actions={
          can(user.role, "tickets:write") && !noSetup ? (
            <Link
              href="/silverfang/tickets/new"
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              New ticket
            </Link>
          ) : null
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

            {/* Filters — plain GET form, no client state needed. */}
            <Card>
              <form method="get" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="view" value={view} />
                <label className="block text-xs font-medium text-muted-foreground">
                  Search
                  <input
                    name="q"
                    defaultValue={sp.q ?? ""}
                    placeholder="Summary or #number"
                    className="mt-1 block w-56 rounded-md border bg-background px-3 py-1.5 text-sm"
                  />
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  Board
                  <select
                    name="board"
                    defaultValue={sp.board ?? ""}
                    className="mt-1 block w-44 rounded-md border bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="">All boards</option>
                    {options.boards.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  Priority
                  <select
                    name="priority"
                    defaultValue={sp.priority ?? ""}
                    className="mt-1 block w-40 rounded-md border bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="">Any priority</option>
                    {Object.entries(PRIORITY_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  Assignee
                  <select
                    name="assignee"
                    defaultValue={sp.assignee ?? ""}
                    className="mt-1 block w-48 rounded-md border bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="">Anyone</option>
                    {options.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name ?? u.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  Client
                  <select
                    name="client"
                    defaultValue={sp.client ?? ""}
                    className="mt-1 block w-56 rounded-md border bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="">All clients</option>
                    {options.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent">
                  Apply
                </button>
                <Link
                  href="/silverfang/tickets"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Reset
                </Link>
              </form>
            </Card>

            <Card>
              {rows.length === 0 ? (
                <EmptyState
                  icon={<Ticket className="h-8 w-8" />}
                  title="No tickets found"
                  description="No tickets match these filters. Try the All tab, or open a new ticket."
                />
              ) : (
                <TicketsTable rows={rows} />
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
