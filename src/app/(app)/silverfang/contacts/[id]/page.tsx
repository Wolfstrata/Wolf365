import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { contactRead } from "@/lib/silverfang/pii";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, StatItem } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";
import { contactDisplayName } from "@/lib/silverfang/contacts";
import { getTicketRows } from "@/lib/silverfang/queries";
import { TicketsTable } from "../../tickets/tickets-table";
import { ContactForm } from "../contact-form";
import { ChangeTrail, ChangeTrailHeading } from "../../change-trail";
import { changeLogFor } from "@/lib/silverfang/change-log";
import { safeReturnTo } from "@/lib/silverfang/return-to";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user.role, "tickets:read")) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const stored = await prisma.sfContact.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { tickets: true } },
    },
  });
  if (!stored) notFound();
  // Contact detail is encrypted at rest — decrypt once, at the boundary.
  const contact = contactRead(stored);

  const [clients, tickets, trail] = await Promise.all([
    prisma.client.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
    getTicketRows({ contactId: id, view: "all" }, 50),
    changeLogFor("SfContact", id),
  ]);

  const canWrite = can(user.role, "tickets:write");
  // Saving closes back to wherever this was opened from — usually the client page,
  // since that is where the contacts table lives.
  const returnTo =
    safeReturnTo(sp.returnTo) ?? `/silverfang/clients/${contact.client.id}`;
  const crumbs: Crumb[] = [
    { label: "Clients", href: "/silverfang/clients" },
    { label: contact.client.name, href: `/silverfang/clients/${contact.client.id}` },
    { label: contactDisplayName(contact) },
  ];

  return (
    <div>
      <PageHeader
        title={contactDisplayName(contact)}
        description={`Contact at ${contact.client.name}`}
      />
      <div className="space-y-6 p-4 sm:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <Breadcrumbs items={crumbs} />
          <Link
            href="/silverfang/contacts"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> All contacts
          </Link>
        </div>

        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatItem label="Tickets" value={contact._count.tickets} />
            <StatItem label="Primary" value={contact.isPrimary ? "Yes" : "No"} />
            <StatItem
              label="VIP"
              value={
                contact.vip ? (
                  <span className="text-warning">Yes — sorts above peers</span>
                ) : (
                  "No"
                )
              }
            />
            <StatItem label="Active" value={contact.active ? "Yes" : "No"} />
            <StatItem label="Source" value={contact.sourceSystem ?? "Created in Wolf365"} />
            {contact.sourceUpdatedAt && (
              <StatItem
                label="Source last synced"
                value={<LocalTime value={contact.sourceUpdatedAt.toISOString()} />}
              />
            )}
            {contact.locallyModifiedAt && (
              <StatItem
                label="Edited here"
                value={<LocalTime value={contact.locallyModifiedAt.toISOString()} />}
              />
            )}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold">Details</h2>
          {canWrite ? (
            <ContactForm
              values={{
                id: contact.id,
                clientId: contact.clientId,
                firstName: contact.firstName,
                lastName: contact.lastName ?? "",
                email: contact.email ?? "",
                phone: contact.phone ?? "",
                mobile: contact.mobile ?? "",
                title: contact.title ?? "",
                isPrimary: contact.isPrimary,
                vip: contact.vip,
                active: contact.active,
                notes: contact.notes ?? "",
              }}
              clients={clients}
              submitLabel="Save contact"
              returnTo={returnTo}
              cancelHref={returnTo}
              canDelete={can(user.role, "silverfang:configure")}
              source={contact.sourceSystem}
              lockedFromImport={Boolean(contact.locallyModifiedAt)}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatItem label="Email" value={contact.email ?? "—"} />
              <StatItem label="Phone" value={contact.phone ?? "—"} />
              <StatItem label="Mobile" value={contact.mobile ?? "—"} />
              <StatItem label="Title" value={contact.title ?? "—"} />
            </div>
          )}
        </Card>

        <Card>
          <ChangeTrailHeading count={trail.length} />
          <ChangeTrail
            rows={trail}
            emptyHint="No changes recorded yet. Every edit from here on is logged with who made it and what it was before."
          />
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold">Tickets ({contact._count.tickets})</h2>
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tickets have been raised by this contact.
            </p>
          ) : (
            <TicketsTable rows={tickets} returnTo={`/silverfang/contacts/${contact.id}`} />
          )}
        </Card>
      </div>
    </div>
  );
}
