import Link from "next/link";
import { Contact, Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { contactDisplayName } from "@/lib/silverfang/contacts";
import { contactRead } from "@/lib/silverfang/pii";

export const dynamic = "force-dynamic";

/** SilverFang contacts — the people who raise tickets, per client. */
export default async function ContactsPage() {
  const user = await requirePermission("tickets:read");

  const rawContacts = await prisma.sfContact.findMany({
    where: { client: { archived: false } },
    orderBy: [{ client: { name: "asc" } }, { isPrimary: "desc" }, { firstName: "asc" }],
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { tickets: true } },
    },
    take: 2000,
  });

  // Contact detail is encrypted at rest; decrypt once here so everything below
  // reads plaintext rather than each use having to remember.
  const contacts = rawContacts.map(contactRead);
  const withEmail = contacts.filter((c) => c.email).length;
  const canWrite = can(user.role, "tickets:write");

  const columns: DataColumn[] = [
    { key: "name", label: "Name" },
    { key: "client", label: "Client" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "title", label: "Title" },
    { key: "tickets", label: "Tickets", numeric: true },
    { key: "flags", label: "Flags" },
    { key: "source", label: "Source" },
  ];

  const rows: DataRow[] = contacts.map((c) => ({
    id: c.id,
    href: `/silverfang/contacts/${c.id}`,
    cells: {
      name: contactDisplayName(c),
      client: c.client.name,
      // Stated plainly: no email means inbound mail can't be matched to this person.
      email: c.email ?? "— no email",
      phone: c.phone ?? c.mobile ?? "—",
      title: c.title ?? "—",
      tickets: c._count.tickets,
      flags: [c.isPrimary ? "Primary" : null, c.active ? null : "Inactive"]
        .filter(Boolean)
        .join(" · "),
      source: c.locallyModifiedAt
        ? `${c.sourceSystem ?? "Wolf365"} · edited here`
        : (c.sourceSystem ?? "Wolf365"),
    },
  }));

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Client contacts used as ticket requesters."
        actions={
          canWrite ? (
            <Link
              href="/silverfang/contacts/new"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> New contact
            </Link>
          ) : null
        }
      />
      <div className="p-4 sm:p-8">
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Contact className="h-8 w-8" />}
              title="No contacts yet"
              description="Contacts are first-party records linked to a Wolf365 client. Create one with “New contact”, or import them from SuperOps on the Clients page. A ticket can still be raised without a contact."
            />
          </Card>
        ) : (
          <Card>
            <DataTable columns={columns} rows={rows} searchPlaceholder="Filter contacts…" />
          </Card>
        )}
        {rows.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {withEmail} of {contacts.length} contacts have an email address. Inbound ticket mail
            is matched to a client by the sender&rsquo;s address, so a contact without one can
            only be placed by their domain — or not at all. Click a contact to edit it; editing
            an imported contact stops a later SuperOps import overwriting it.
          </p>
        )}
      </div>
    </div>
  );
}
