import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { blankTicketValues, getTicketFormData } from "@/lib/silverfang/form";
import { TicketForm } from "../../ticket-form";
import { saveTicketAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewTicketPage() {
  await requirePermission("tickets:write");
  const options = await getTicketFormData();

  return (
    <div>
      <PageHeader title="New ticket" description="Open a service ticket for a client." />
      <div className="space-y-4 p-4 sm:p-8">
        <Link
          href="/silverfang/tickets"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Tickets
        </Link>
        <Card>
          {options.boards.length === 0 ? (
            <EmptyState
              title="No service board yet"
              description="Run the SilverFang setup to create the default board, statuses and SLA before opening tickets."
            />
          ) : options.clients.length === 0 ? (
            <EmptyState
              title="No clients available"
              description="Tickets are raised against a Wolf365 client. Sync or create a client first."
            />
          ) : (
            <TicketForm
              values={blankTicketValues({ boardId: options.boards[0]?.id })}
              options={options}
              saveAction={saveTicketAction}
              submitLabel="Create ticket"
            />
          )}
        </Card>
      </div>
    </div>
  );
}
