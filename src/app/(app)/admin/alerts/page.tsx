import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/primitives";
import { SendDigestForm } from "./send-digest-form";

/**
 * Admin M365 alerts page — verify/trigger the renewal + cost-change digest
 * delivered via Resend, on demand (the cron sends it automatically on Mondays).
 */
export default async function AlertsPage() {
  await requirePermission("connectors:configure");
  return (
    <div>
      <PageHeader
        title="M365 Alerts"
        description="Renewal and cost-change alerts for Microsoft 365 licensing, delivered by email via Resend."
      />
      <div className="p-8">
        <SendDigestForm />
      </div>
    </div>
  );
}
