import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui/primitives";
import { getTicketFormData, ticketToFormValues } from "@/lib/silverfang/form";
import { TicketForm } from "../../../ticket-form";
import { saveTicketAction } from "../../../actions";

export const dynamic = "force-dynamic";

export default async function EditTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("tickets:write");
  const { id } = await params;
  const [values, options] = await Promise.all([
    ticketToFormValues(id),
    getTicketFormData(),
  ]);
  if (!values) notFound();

  return (
    <div>
      <PageHeader title="Edit ticket" description="Changes are recorded in the ticket history." />
      <div className="space-y-4 p-4 sm:p-8">
        <Link
          href={`/silverfang/tickets/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to ticket
        </Link>
        <Card>
          <TicketForm
            values={values}
            options={options}
            saveAction={saveTicketAction}
            submitLabel="Save ticket"
          />
        </Card>
      </div>
    </div>
  );
}
