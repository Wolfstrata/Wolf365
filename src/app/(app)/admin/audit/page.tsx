import { ScrollText } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";

/** Append-only audit log of security-relevant actions. */
export default async function AuditPage() {
  const user = await requirePermission("audit:read");
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Logins, connector and SSO changes, syncs, mappings, billing edits, approvals, pushes, and exports."
      />
      <div className="p-8">
        {logs.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-8 w-8" />}
            title="No audit events yet"
            description="Security-relevant actions are recorded here as they happen."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Actor</th>
                  <th className="px-4 py-2 font-medium">Target</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                      {formatDateTime(l.createdAt, user.timezone)}
                    </td>
                    <td className="px-4 py-2 font-medium">
                      {l.action.replaceAll("_", " ")}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {l.actorEmail ?? "system"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {l.target ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
