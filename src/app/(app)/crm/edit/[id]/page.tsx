import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { CRM_LINES } from "@/lib/crm/constants";
import { toFormValues } from "@/lib/crm/form";
import { OpportunityForm } from "../../opportunity-form";
import { saveOpportunityAction, deleteOpportunityAction } from "../../actions";

export default async function EditOpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("crm:write");
  const { id } = await params;

  const opp = await prisma.crmOpportunity.findUnique({
    where: { id },
    include: { owner: { select: { name: true, email: true } } },
  });
  if (!opp) notFound();

  const config = CRM_LINES[opp.line];

  return (
    <div>
      <PageHeader
        title={opp.name}
        description={`${config.label} opportunity`}
        actions={
          <form action={deleteOpportunityAction}>
            <input type="hidden" name="id" value={opp.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-2 text-sm font-medium text-danger transition hover:bg-danger/10"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </form>
        }
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Link
          href={`/crm/${config.slug}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to {config.label}
        </Link>
        <OpportunityForm
          line={opp.line}
          lineSlug={config.slug}
          lineLabel={config.label}
          allowYearly={config.billing === "MONTHLY_OR_YEARLY"}
          ownerName={opp.owner.name ?? opp.owner.email}
          values={toFormValues(opp)}
          saveAction={saveOpportunityAction}
        />
      </div>
    </div>
  );
}
