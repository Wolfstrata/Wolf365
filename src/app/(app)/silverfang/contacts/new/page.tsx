import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { ContactForm } from "../contact-form";

export const dynamic = "force-dynamic";

/** `?client=<id>` preselects the client, for the button on a client's page. */
export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("tickets:write");
  const [sp, clients] = await Promise.all([
    searchParams,
    prisma.client.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
  ]);
  // Honour the hint only when it names a real client, so a stale link cannot
  // preselect something that no longer exists.
  const clientId = sp.client && clients.some((c) => c.id === sp.client) ? sp.client : "";

  return (
    <div>
      <PageHeader title="New contact" description="Add a client contact who can raise tickets." />
      <div className="space-y-4 p-4 sm:p-8">
        <Link
          href="/silverfang/contacts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Contacts
        </Link>
        <Card>
          {clients.length === 0 ? (
            <EmptyState
              title="No clients available"
              description="A contact belongs to a Wolf365 client. Sync a connector or create a client first."
            />
          ) : (
            <ContactForm
              values={{
                clientId,
                firstName: "",
                lastName: "",
                email: "",
                phone: "",
                mobile: "",
                title: "",
                isPrimary: false,
                vip: false,
                active: true,
                notes: "",
              }}
              clients={clients}
              submitLabel="Create contact"
              canDelete={false}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
