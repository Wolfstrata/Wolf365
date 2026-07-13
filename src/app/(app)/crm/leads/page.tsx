import { Inbox } from "lucide-react";
import { prisma } from "@/lib/db";
import { getEnv } from "@/env";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatSortableDateTime } from "@/lib/utils";
import { LeadsTable, type LeadRow } from "./leads-table";

export default async function LeadsPage() {
  const user = await requirePermission("crm:read");
  const canWrite = can(user.role, "crm:write");
  const ingestConfigured = Boolean(getEnv().WOLF365_LEADS_TOKEN);

  const leads = await prisma.lead.findMany({
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  const rows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    name: l.fullName ?? [l.firstName, l.lastName].filter(Boolean).join(" "),
    company: l.company ?? "",
    title: l.title ?? "",
    email: l.email ?? "",
    phone: l.phone ?? "",
    source: l.source,
    status: l.status,
    created: formatSortableDateTime(l.createdAt, user.timezone),
  }));

  const newCount = leads.filter((l) => l.status === "NEW").length;

  return (
    <div>
      <PageHeader
        title="Leads"
        description={`Inbound leads from external sources like ZoomInfo. ${leads.length} total · ${newCount} new.`}
      />
      <div className="space-y-6 p-4 sm:p-8">
        {leads.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="No leads yet"
            description="Point your ZoomInfo workflow at the ingestion endpoint below and leads will appear here."
          />
        ) : (
          <LeadsTable rows={rows} canWrite={canWrite} />
        )}

        {/* Ingestion wiring — everything the external workflow needs. */}
        <Card>
          <h2 className="text-sm font-semibold">Feeding leads in (ZoomInfo or any workflow)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            POST leads to the endpoint below with the bearer token. The body can be a
            single lead object or an array (max 500 per request). Leads are deduped by{" "}
            <code className="font-mono text-xs">externalId</code>, then by email —
            re-sending updates instead of duplicating.
          </p>
          <p className="mt-2 text-sm">
            Status:{" "}
            {ingestConfigured ? (
              <span className="font-medium text-success">
                Configured — WOLF365_LEADS_TOKEN is set.
              </span>
            ) : (
              <span className="font-medium text-warning">
                Not configured — set the WOLF365_LEADS_TOKEN environment variable
                (then redeploy) before pushing leads.
              </span>
            )}
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`POST /api/leads
Authorization: Bearer <WOLF365_LEADS_TOKEN>
Content-Type: application/json

[
  {
    "externalId": "zoominfo-person-id",   // optional but best for dedupe
    "firstName": "Jane",
    "lastName": "Doe",
    "company": "Acme Inc",
    "title": "IT Director",
    "email": "jane@acme.com",
    "phone": "555-123-4567",
    "website": "acme.com",
    "source": "zoominfo"                   // optional, defaults to zoominfo
  }
]`}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Common alternate field names (first_name, companyName, jobTitle,
            workEmail, directPhone, personId, …) are mapped automatically, and the
            full original payload is kept on each lead for reference. Responses
            report {"{ created, updated, skipped }"}.
          </p>
        </Card>
      </div>
    </div>
  );
}
