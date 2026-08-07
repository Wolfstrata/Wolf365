import Link from "next/link";
import { UserCheck } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
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

  return (
    <div>
      <PageHeader
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
            <TicketsTable rows={rows} returnTo="/silverfang/my-tickets" />
          )}
        </Card>
      </div>
    </div>
  );
}
