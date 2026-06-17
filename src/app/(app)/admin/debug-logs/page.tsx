import { Bug } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";

/**
 * Admin-only connector debug logs. Entries are written exclusively via the
 * redaction-enforcing logger, so no secrets/tokens/headers appear here.
 */
export default async function DebugLogsPage() {
  await requirePermission("debuglogs:read");
  const logs = await prisma.debugLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return (
    <div>
      <PageHeader
        title="Connector Debug Logs"
        description="Redacted per-call diagnostics for QuickBooks, TD SYNNEX, and other connectors. Secrets are never logged."
      />
      <div className="p-8">
        {logs.length === 0 ? (
          <EmptyState
            icon={<Bug className="h-8 w-8" />}
            title="No debug entries yet"
            description="Connector API calls (test connection, sync) will be logged here with timing, status, and safe error details."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Connector</th>
                  <th className="px-3 py-2 font-medium">Environment</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Endpoint</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td className="px-3 py-2">{l.type.replaceAll("_", " ")}</td>
                    <td className="px-3 py-2">
                      {l.environment ? (
                        <span
                          className={
                            l.environment === "production"
                              ? "font-medium text-danger"
                              : "text-warning"
                          }
                        >
                          {l.environment}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">{l.action}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {l.endpoint ?? "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{l.httpStatus ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {l.durationMs != null ? `${l.durationMs} ms` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          l.outcome === "success" ? "text-success" : "text-danger"
                        }
                      >
                        {l.outcome}
                      </span>
                      {l.message && (
                        <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">
                          {l.message}
                        </p>
                      )}
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
