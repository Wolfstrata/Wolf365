import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";
import { safeReturnTo } from "@/lib/silverfang/return-to";
import { AgreementForm } from "../agreement-form";

export const dynamic = "force-dynamic";

/** `?client=<id>` preselects the client. */
export default async function NewAgreementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("agreements:manage");
  const [sp, clients] = await Promise.all([
    searchParams,
    prisma.client.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
  ]);
  const clientId = sp.client && clients.some((c) => c.id === sp.client) ? sp.client : "";
  const backTo =
    safeReturnTo(sp.returnTo) ??
    (clientId ? `/silverfang/clients/${clientId}` : "/silverfang/agreements");

  return (
    <div>
      <PageHeader title="New agreement" description="What pays for the work." />
      <div className="space-y-4 p-4 sm:p-8">
        {/* Back to whoever opened this — usually a client page — rather than
            always to the module list. */}
        <Link
          href={backTo}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <Card>
          <AgreementForm
            values={{
              clientId,
              name: "",
              type: "MANAGED_SERVICES",
              status: "DRAFT",
              startDate: new Date().toISOString().slice(0, 10),
              endDate: "",
              autoRenew: false,
              renewalIncreasePercent: "15",
              billingFrequency: "MONTHLY",
              monthlyAmount: "",
              includedHours: "",
              overageRate: "",
              standardRate: "",
              notes: "",
            }}
            clients={clients}
            submitLabel="Create agreement"
          />
        </Card>
      </div>
    </div>
  );
}
