import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card } from "@/components/ui/primitives";
import { SubsidiaryMapper } from "../subsidiary-mapper";

/** Dedicated editor for a client's subsidiary associations — kept off the main
 *  client screen so it doesn't crowd it. */
export default async function ClientAssociationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("clients:read");
  const { id } = await params;

  const client = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      subsidiaries: { select: { id: true }, orderBy: { name: "asc" } },
    },
  });
  if (!client) notFound();

  const canMap = can(user.role, "mappings:approve");

  return (
    <div>
      <PageHeader
        title={`Associations — ${client.name}`}
        description="Select the clients that are subsidiaries of this one. Selecting a client already under another parent moves it here."
      />
      <div className="space-y-6 p-8">
        <Link
          href={`/clients/${client.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to {client.name}
        </Link>

        {canMap ? (
          <Card>
            <SubsidiaryMapper
              parentId={client.id}
              parentName={client.name}
              options={await prisma.client.findMany({
                select: { id: true, name: true, parentClientId: true },
                orderBy: { name: "asc" },
              })}
              initialSelectedIds={client.subsidiaries.map((s) => s.id)}
            />
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-muted-foreground">
              You don&apos;t have permission to edit client associations.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
