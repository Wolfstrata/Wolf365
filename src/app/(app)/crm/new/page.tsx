import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { CRM_LINES, lineFromSlug } from "@/lib/crm/constants";
import { blankFormValues } from "@/lib/crm/form";
import { OpportunityForm } from "../opportunity-form";
import { saveOpportunityAction } from "../actions";

export default async function NewOpportunityPage({
  searchParams,
}: {
  searchParams: Promise<{ line?: string }>;
}) {
  const user = await requirePermission("crm:write");
  const { line: slug } = await searchParams;
  const line = slug ? lineFromSlug(slug) : null;
  if (!line) notFound();

  const config = CRM_LINES[line];

  return (
    <div>
      <PageHeader
        title={`New ${config.label} Opportunity`}
        description={config.blurb}
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Link
          href={`/crm/${config.slug}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to {config.label}
        </Link>
        <OpportunityForm
          line={line}
          lineSlug={config.slug}
          lineLabel={config.label}
          allowYearly={config.billing === "MONTHLY_OR_YEARLY"}
          ownerName={user.name ?? user.email}
          values={blankFormValues()}
          saveAction={saveOpportunityAction}
        />
      </div>
    </div>
  );
}
