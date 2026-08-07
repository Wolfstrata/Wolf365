import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { prisma } from "@/lib/db";
import { getTicketFormData, ticketToFormValues } from "@/lib/silverfang/form";
import { safeReturnTo } from "@/lib/silverfang/return-to";
import { TicketForm } from "../../../ticket-form";
import { saveTicketAction } from "../../../actions";

export const dynamic = "force-dynamic";

/**
 * `?returnTo=` is honoured on save and on cancel, so editing from a project (or a
 * client, or a filtered queue) closes back to that screen rather than to the
 * ticket. Without it, saving always meant navigating back by hand.
 */
export default async function EditTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("tickets:write");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [values, options, ticket] = await Promise.all([
    ticketToFormValues(id),
    getTicketFormData(),
    prisma.sfTicket.findUnique({
      where: { id },
      select: {
        number: true,
        summary: true,
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        projectPhase: { select: { name: true } },
      },
    }),
  ]);
  if (!values || !ticket) notFound();

  const crumbs: Crumb[] = [
    { label: "Clients", href: "/silverfang/clients" },
    { label: ticket.client.name, href: `/silverfang/clients/${ticket.client.id}` },
  ];
  if (ticket.project) {
    crumbs.push({ label: ticket.project.name, href: `/silverfang/projects/${ticket.project.id}` });
  }
  if (ticket.projectPhase) crumbs.push({ label: ticket.projectPhase.name });
  crumbs.push({ label: `#${ticket.number}`, href: `/silverfang/tickets/${id}` });
  crumbs.push({ label: "Edit" });

  // The ticket itself is the sensible default: it is where the Edit button lives.
  const returnTo = safeReturnTo(sp.returnTo) ?? `/silverfang/tickets/${id}`;

  return (
    <div>
      <PageHeader
        title={`Edit #${ticket.number}`}
        description="Changes are recorded in the ticket history."
      />
      <div className="space-y-4 p-4 sm:p-8">
        <Breadcrumbs items={crumbs} />
        <Card>
          <TicketForm
            values={values}
            options={options}
            saveAction={saveTicketAction}
            submitLabel="Save ticket"
            returnTo={returnTo}
            cancelHref={returnTo}
          />
        </Card>
      </div>
    </div>
  );
}
