import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { NewSfRunForm, type BillableClient } from "./new-run-form";

export const dynamic = "force-dynamic";
// Generating several clients' runs in one request does real work per client.
export const maxDuration = 300;

/** `?client=<id>` preselects the client. */
export default async function NewSfBillingRunPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("billing:edit");
  const [sp, clients, unbilled, agreementCounts] = await Promise.all([
    searchParams,
    prisma.client.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, qboCustomer: { select: { qboId: true } } },
      take: 2000,
    }),
    // Unbilled approved hours per client, so the picker says who is worth billing
    // rather than listing 156 names with no signal.
    prisma.sfTimeEntry.groupBy({
      by: ["ticketId"],
      where: { status: "APPROVED", invoicedAt: null, billable: true },
      _sum: { hours: true },
    }),
    prisma.sfAgreement.groupBy({
      by: ["clientId"],
      where: { status: "ACTIVE" },
      _count: true,
    }),
  ]);

  // groupBy cannot reach through the ticket to the client, so resolve the ticket
  // → client mapping once and fold the hours in.
  const ticketIds = unbilled
    .map((u) => u.ticketId)
    .filter((id): id is string => id !== null);
  const tickets =
    ticketIds.length > 0
      ? await prisma.sfTicket.findMany({
          where: { id: { in: ticketIds } },
          select: { id: true, clientId: true },
        })
      : [];
  const clientByTicket = new Map(tickets.map((t) => [t.id, t.clientId]));
  const hoursByClient = new Map<string, number>();
  for (const u of unbilled) {
    const clientId = u.ticketId ? clientByTicket.get(u.ticketId) : undefined;
    if (!clientId) continue;
    hoursByClient.set(
      clientId,
      (hoursByClient.get(clientId) ?? 0) + Number(u._sum.hours ?? 0),
    );
  }
  const agreementsByClient = new Map(agreementCounts.map((a) => [a.clientId, a._count]));

  const rows: BillableClient[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    unbilledHours: hoursByClient.get(c.id) ?? 0,
    activeAgreements: agreementsByClient.get(c.id) ?? 0,
    hasQbo: c.qboCustomer != null,
  }));

  const now = new Date();
  // Default to last month: you bill a period once it is over.
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const defaultMonth = lastMonth.toISOString().slice(0, 7);

  return (
    <div>
      <PageHeader
        title="New SilverFang billing run"
        description="Gathers approved time, recurring agreement fees, prepaid block purchases, project fees and deposits for the period."
      />
      <div className="space-y-4 p-4 sm:p-8">
        <Link
          href="/silverfang-billing"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> SilverFang Billing
        </Link>
        <Card>
          {rows.length === 0 ? (
            <EmptyState
              title="No clients available"
              description="A billing run is raised against a Wolf365 client. Sync or create a client first."
            />
          ) : (
            <NewSfRunForm
              clients={rows}
              defaultClientId={sp.client}
              defaultMonth={defaultMonth}
              today={now.toISOString().slice(0, 10)}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
