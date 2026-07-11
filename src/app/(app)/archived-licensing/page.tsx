import { Archive } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { getArchivedLicenses } from "@/lib/reports/queries";
import { ArchivedTable } from "./archived-table";

/**
 * M365 Archived Clients — licenses a finance user has filed away. They are hidden
 * from the expired report, the dashboard, and each client's profile, and can be
 * restored from here. A client appears only for its archived licenses; its other
 * licensing is untouched.
 */
export default async function ArchivedLicensingPage() {
  const user = await requirePermission("clients:read");
  const canArchive = can(user.role, "billing:edit");
  const rows = await getArchivedLicenses();

  return (
    <div>
      <PageHeader
        title="M365 Archived Clients"
        description="Expired M365 licenses you've filed away. They're hidden from the expired report, the dashboard, and the client profile — restore one to bring it back."
      />
      <div className="space-y-4 p-4 sm:p-8">
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Archive className="h-8 w-8" />}
              title="Nothing archived yet"
              description="Open Expired licenses from the dashboard and click the filing-cabinet icon on a row to archive it. Archived licenses show up here."
            />
          </Card>
        ) : (
          <Card>
            <ArchivedTable rows={rows} canArchive={canArchive} />
          </Card>
        )}
      </div>
    </div>
  );
}
