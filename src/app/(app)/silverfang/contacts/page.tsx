import Link from "next/link";
import { Contact } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { DataTable, type DataColumn, type DataRow } from "@/components/ui/data-table";
import { contactDisplayName } from "@/lib/silverfang/contacts";

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
    { key: "source", label: "Source" },
  ];

  const rows: DataRow[] = contacts.map((c) => ({
    id: c.id,
    // Link into the SilverFang client view rather than the M365 client profile.
    href: `/silverfang/clients/${c.client.id}`,
    cells: {
      name: contactDisplayName(c),
      client: c.client.name,
      email: c.email ?? "—",
      phone: c.phone ?? c.mobile ?? "—",
      title: c.title ?? "—",
      tickets: c._count.tickets,
      primary: c.isPrimary ? "Yes" : "",
      source: c.sourceSystem ?? "Manual",
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
          Contacts link to their SilverFang client. Import them from SuperOps on the{" "}
          <Link href="/silverfang/clients" className="text-primary hover:underline">
            Clients
          </Link>{" "}
          page; per-contact editing arrives with a later SilverFang phase.
        </p>
      </div>
    </div>
  );
}
