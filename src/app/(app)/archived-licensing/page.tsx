import Link from "next/link";
import { Archive } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { getArchivedLicenses, type ArchivedLicenseRow } from "@/lib/reports/queries";
import { ArchiveToggle } from "@/components/licensing/archive-toggle";

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

  // Group by client (rows are already sorted by client then product).
  const groups = new Map<string, { client: string; clientId: string | null; rows: ArchivedLicenseRow[] }>();
  for (const r of rows) {
    const key = r.clientId ?? r.client;
    const g = groups.get(key) ?? { client: r.client, clientId: r.clientId, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const clients = [...groups.values()];

  return (
    <div>
      <PageHeader
        title="M365 Archived Clients"
        description="Expired M365 licenses you've filed away. They're hidden from the expired report, the dashboard, and the client profile — restore one to bring it back."
      />
      <div className="space-y-4 p-8">
        {clients.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Archive className="h-8 w-8" />}
              title="Nothing archived yet"
              description="Open Expired licenses from the dashboard and click the filing-cabinet icon on a row to archive it. Archived licenses show up here."
            />
          </Card>
        ) : (
          clients.map((g) => (
            <Card key={g.clientId ?? g.client}>
              <h2 className="mb-3 text-sm font-semibold">
                {g.clientId ? (
                  <Link href={`/clients/${g.clientId}`} className="text-primary hover:underline">
                    {g.client}
                  </Link>
                ) : (
                  g.client
                )}
                <span className="ml-2 font-normal text-muted-foreground">
                  {g.rows.length} archived license{g.rows.length === 1 ? "" : "s"}
                </span>
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4 font-medium">SKU</th>
                      <th className="py-2 pr-4 font-medium">Product</th>
                      <th className="py-2 pr-4 font-medium">Qty</th>
                      <th className="py-2 pr-4 font-medium">Expired</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Restore</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.subscriptionId} className="border-t">
                        <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{r.sku}</td>
                        <td className="py-2 pr-4">{r.product}</td>
                        <td className="py-2 pr-4 tabular-nums">{r.quantity}</td>
                        <td className="py-2 pr-4 text-orange-600 dark:text-orange-400">{r.expiryDate}</td>
                        <td className="py-2 pr-4">{r.status}</td>
                        <td className="py-2 pr-4">
                          <ArchiveToggle
                            subscriptionId={r.subscriptionId}
                            archived={true}
                            canArchive={canArchive}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
