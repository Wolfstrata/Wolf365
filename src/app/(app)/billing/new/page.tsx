import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { isActiveStatus } from "@/lib/licensing/renewal";
import { isM365Subscription } from "@/lib/licensing/vendor";
import { ensureArchiveColumn } from "@/lib/licensing/archive";
import { NewRunForm } from "./new-run-form";

export default async function NewBillingRunPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  await requirePermission("billing:edit");
  const { clientId } = await searchParams;
  await ensureArchiveColumn();

  const rows = await prisma.client.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      tdSynnexCustomer: {
        select: {
          subscriptions: {
            select: {
              status: true,
              archived: true,
              vendor: true,
              productName: true,
              productSku: true,
            },
          },
        },
      },
    },
  });
  // "Active licenses" = Microsoft 365 subscriptions with status active (any
  // expiry) that are not archived. The single-client picker only offers clients
  // with ≥1. Non-M365 (e.g. Cisco) lines are ignored entirely.
  const clients = rows.map((c) => ({
    id: c.id,
    name: c.name,
    activeSubs: (c.tdSynnexCustomer?.subscriptions ?? []).filter(
      (s) => !s.archived && isM365Subscription(s) && isActiveStatus(s.status),
    ).length,
  }));

  return (
    <div>
      <PageHeader
        title="New billing run"
        description="Generate a prorated draft invoice from synced TD SYNNEX subscriptions."
      />
      <div className="p-4 sm:p-8">
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
