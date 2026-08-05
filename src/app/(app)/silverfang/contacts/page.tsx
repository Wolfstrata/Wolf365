import { Contact } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";

export const dynamic = "force-dynamic";

/** SilverFang contacts — the people who raise tickets, per client. */
export default async function ContactsPage() {
  await requirePermission("tickets:read");

  const contacts = await prisma.sfContact.findMany({
    where: { client: { archived: false } },
    orderBy: [{ client: { name: "asc" } }, { isPrimary: "desc" }, { firstName: "asc" }],
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { tickets: true } },
    },
    take: 2000,
  });

  const columns: DataColumn[] = [
    { key: "name", label: "Name" },
    { key: "client", label: "Client" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "title", label: "Title" },
    { key: "tickets", label: "Tickets", numeric: true },
    { key: "primary", label: "Primary" },
  ];

  const rows: DataRow[] = contacts.map((c) => ({
    id: c.id,
    href: `/clients/${c.client.id}`,
    cells: {
      name: [c.firstName, c.lastName].filter(Boolean).join(" "),
      client: c.client.name,
      email: c.email ?? "—",
      phone: c.phone ?? c.mobile ?? "—",
      title: c.title ?? "—",
      tickets: c._count.tickets,
      primary: c.isPrimary ? "Yes" : "",
    },
  }));

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="Client contacts used as ticket requesters."
      />
      <div className="p-4 sm:p-8">
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Contact className="h-8 w-8" />}
              title="No contacts yet"
              description="SilverFang contacts are first-party records linked to a Wolf365 client. None have been created yet — a ticket can still be raised without a contact."
            />
          </Card>
        ) : (
          <Card>
            <DataTable columns={columns} rows={rows} searchPlaceholder="Filter contacts…" />
          </Card>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Contacts link to their Wolf365 client. Import from SuperOps and per-contact editing arrive
          with the next SilverFang phase.
        </p>
      </div>
    </div>
  );
}
