import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { NewRunForm } from "./new-run-form";

export default async function NewBillingRunPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  await requirePermission("billing:edit");
  const { clientId } = await searchParams;

  const rows = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      tdSynnexCustomer: { select: { _count: { select: { subscriptions: true } } } },
    },
  });
  const clients = rows.map((c) => ({
    id: c.id,
    name: c.name,
    subs: c.tdSynnexCustomer?._count.subscriptions ?? 0,
  }));

  return (
    <div>
      <PageHeader
        title="New billing run"
        description="Generate a prorated draft invoice from synced TD SYNNEX subscriptions."
      />
      <div className="p-8">
        <Link
          href="/billing"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Billing runs
        </Link>

        {clients.length === 0 ? (
          <EmptyState
            title="No clients available"
            description="Sync and map clients before generating a billing run."
          />
        ) : (
          <NewRunForm clients={clients} defaultClientId={clientId} />
        )}
      </div>
    </div>
  );
}
