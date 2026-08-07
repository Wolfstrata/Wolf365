import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { prisma } from "@/lib/db";
import { getTicketFormData, newTicketValues } from "@/lib/silverfang/form";
import { safeReturnTo } from "@/lib/silverfang/return-to";
import { TicketForm } from "../../ticket-form";
import { saveTicketAction } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * `?client=<id>` preselects that client (and its profile defaults);
 * `?project=`/`?phase=` preselect a project phase, so "New project ticket" on a
 * phase lands on a form already pointed at it; `?agreement=`/`?contact=` do the
 * same for the agreement and contact pages. Every one of them is validated
 * against the chosen client, so a stale link cannot file a ticket against another
 * client's agreement, contact or project.
 *
 * `?returnTo=` is where saving goes back to. Opening this form from a phase and
 * being dropped on the ticket board afterwards loses the place you were working —
 * which is exactly what Nathan hit.
 */
export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("tickets:write");
  const [options, sp] = await Promise.all([getTicketFormData(), searchParams]);
  const values = await newTicketValues(options, sp.client, {
    projectId: sp.project,
    projectPhaseId: sp.phase,
    agreementId: sp.agreement,
    contactId: sp.contact,
  });

  // The trail is built from what the form is actually pointed at, not from the
  // query string, so a stale ?project= that no longer belongs to the client cannot
  // produce a breadcrumb to somewhere the ticket will not be filed.
  const project = values.projectId
    ? await prisma.sfProject.findUnique({
        where: { id: values.projectId },
        select: {
          id: true,
          name: true,
          client: { select: { id: true, name: true } },
          phases: { select: { id: true, name: true } },
        },
      })
    : null;
  // Deliberately no notFound() here: newTicketValues only keeps a project that
  // belongs to the chosen client, so a miss means the row vanished between the two
  // reads. Losing a breadcrumb is better than 404-ing a form that would work.
  const phase = values.projectPhaseId
    ? project?.phases.find((p) => p.id === values.projectPhaseId)
    : undefined;

  const client =
    project?.client ??
    (values.clientId
      ? await prisma.client.findUnique({
          where: { id: values.clientId },
          select: { id: true, name: true },
        })
      : null);

  // Built root-down rather than patched afterwards: with no client chosen there is
  // no client trail to show, so the root is the queue instead.
  const crumbs: Crumb[] = client
    ? [
        { label: "Clients", href: "/silverfang/clients" },
        { label: client.name, href: `/silverfang/clients/${client.id}` },
      ]
    : [{ label: "Tickets", href: "/silverfang/tickets" }];
  if (project) {
    crumbs.push({ label: project.name, href: `/silverfang/projects/${project.id}` });
  }
  if (phase) crumbs.push({ label: phase.name });
  crumbs.push({ label: "New ticket" });

  // Default back to the project when one is in play, since that is where the
  // button that opens this form lives.
  const fallback = project
    ? `/silverfang/projects/${project.id}`
    : client
      ? `/silverfang/clients/${client.id}`
      : "/silverfang/tickets";
  const returnTo = safeReturnTo(sp.returnTo) ?? fallback;

  return (
    <div>
      <PageHeader
        title={phase ? `New ticket in ${phase.name}` : "New ticket"}
        description={
          project
            ? `Opens on the Projects board and counts against ${project.name}.`
            : "Open a service ticket for a client."
        }
      />
      <div className="space-y-4 p-4 sm:p-8">
        <Breadcrumbs items={crumbs} />
        <Card>
          {options.boards.length === 0 ? (
            <EmptyState
              title="No service board yet"
              description="Run the SilverFang setup to create the MSA, Projects and Service Desk boards, their statuses and the SLA before opening tickets."
            />
          ) : options.clients.length === 0 ? (
            <EmptyState
              title="No clients available"
              description="Tickets are raised against a Wolf365 client. Sync or create a client first."
            />
          ) : (
            <TicketForm
              values={values}
              options={options}
              saveAction={saveTicketAction}
              submitLabel="Create ticket"
              returnTo={returnTo}
              cancelHref={returnTo}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
