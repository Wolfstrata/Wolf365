import Link from "next/link";
import { FileSignature } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";
import { formatCurrency } from "@/lib/utils";
import { formatHours } from "@/lib/silverfang/time";
import { availableHours } from "@/lib/silverfang/block-time";
import { AGREEMENT_STATUS_LABELS, AGREEMENT_TYPE_LABELS } from "@/lib/silverfang/constants";

export const dynamic = "force-dynamic";

/**
 * Agreements: block time, managed services, managed NOC, project and T&M.
 * Block-time balances are derived from the draw ledger.
 */
export default async function AgreementsPage() {
  await requirePermission("agreements:read");

  const agreements = await prisma.sfAgreement.findMany({
    where: { client: { archived: false } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      client: { select: { id: true, name: true } },
      blocks: { include: { draws: { select: { hours: true } } } },
      _count: { select: { tickets: true } },
    },
  });

  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Agreements"
        description="Block time, managed services, managed NOC and T&M agreements."
      />
      <div className="space-y-4 p-4 sm:p-8">
        {agreements.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FileSignature className="h-8 w-8" />}
              title="No agreements yet"
              description="Agreements determine which rates apply to logged time and how block-time hours are drawn down. The data model is in place; the create/edit screens arrive in the next SilverFang phase."
            />
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 font-medium">Agreement</th>
                    <th className="py-1 pr-4 font-medium">Client</th>
                    <th className="py-1 pr-4 font-medium">Type</th>
                    <th className="py-1 pr-4 font-medium">Status</th>
                    <th className="py-1 pr-4 font-medium">Term</th>
                    <th className="py-1 pr-4 text-right font-medium">Monthly</th>
                    <th className="py-1 pr-4 text-right font-medium">Block balance</th>
                    <th className="py-1 pr-4 text-right font-medium">Tickets</th>
                  </tr>
                </thead>
                <tbody>
                  {agreements.map((a) => {
                    const blocks = a.blocks.map((b) => ({
                      id: b.id,
                      purchasedHours: Number(b.purchasedHours),
                      purchasedAt: b.purchasedAt,
                      expiresAt: b.expiresAt,
                      hoursUsed: b.draws.reduce((acc, d) => acc + Number(d.hours), 0),
                    }));
                    const balance = availableHours(blocks, now);
                    return (
                      <tr key={a.id} className="border-t align-top">
                        <td className="py-1.5 pr-4 font-medium">{a.name}</td>
                        <td className="py-1.5 pr-4">
                          <Link href={`/clients/${a.client.id}`} className="text-primary hover:underline">
                            {a.client.name}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-4">{AGREEMENT_TYPE_LABELS[a.type]}</td>
                        <td className="py-1.5 pr-4">{AGREEMENT_STATUS_LABELS[a.status]}</td>
                        <td className="py-1.5 pr-4 whitespace-nowrap">
                          <LocalTime value={a.startDate.toISOString()} dateOnly />
                          {a.endDate && (
                            <>
                              {" – "}
                              <LocalTime value={a.endDate.toISOString()} dateOnly />
                            </>
                          )}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {a.monthlyAmount != null ? formatCurrency(Number(a.monthlyAmount)) : "—"}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">
                          {a.type === "BLOCK_TIME" ? formatHours(balance) : "—"}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{a._count.tickets}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        <p className="text-xs text-muted-foreground">
          Block-time balances are computed from the drawdown ledger, so they always reconcile with
          logged time. Creating and editing agreements arrives in the next SilverFang phase.
        </p>
      </div>
    </div>
  );
}
