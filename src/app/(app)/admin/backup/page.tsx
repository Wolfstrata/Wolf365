import { DatabaseBackup, ShieldAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { getEnv } from "@/env";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Card, EmptyState } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { isNeonConfigured } from "@/lib/backup/neon";
import { BackupPanel } from "./backup-panel";
import { RestoreButton } from "./restore-button";

// Server actions on this route (dry-run restore) make several sequential Neon
// API calls; give them headroom.
export const maxDuration = 120;

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: "bg-success/15 text-success",
  FAILED: "bg-danger/15 text-danger",
  PENDING: "bg-warning/15 text-warning",
  PRUNED: "bg-muted text-muted-foreground",
};

/**
 * Backups. Creates Neon branch snapshots of the whole database (on-demand and
 * on the daily cron) and offers a sanitized JSON data export for download.
 * Administrator-only.
 */
export default async function BackupPage() {
  const me = await requirePermission("backups:manage");
  const env = getEnv();
  const neonConfigured = isNeonConfigured();
  const retentionDays = env.BACKUP_RETENTION_DAYS;

  const backups = await prisma.backup.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { createdBy: { select: { name: true, email: true } } },
  });

  return (
    <div>
      <PageHeader
        title="Backups"
        description="Snapshot the entire database to Neon, on demand or daily, and download a sanitized data export."
      />
      <div className="space-y-6 p-4 sm:p-8">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Neon database backups</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {neonConfigured
                  ? `Configured. Snapshots are kept for ${retentionDays} days, then pruned automatically.`
                  : "Not configured — set NEON_API_KEY and NEON_PROJECT_ID to enable Neon snapshots."}
              </p>
            </div>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                neonConfigured ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
              )}
            >
              {neonConfigured ? "Configured" : "Not configured"}
            </span>
          </div>

          <BackupPanel neonConfigured={neonConfigured} />

          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p>
              A snapshot includes the encrypted connector secrets, but they are{" "}
              <strong>unrecoverable without WOLF365_ENCRYPTION_KEY</strong>. That key
              is not stored in the database — back it up separately, out-of-band (e.g.
              a password manager or secrets vault). The JSON data export excludes all
              secrets.
            </p>
          </div>
        </Card>

        <div>
          <h2 className="mb-3 text-sm font-semibold">Recent backups</h2>
          {backups.length === 0 ? (
            <EmptyState
              icon={<DatabaseBackup className="h-8 w-8" />}
              title="No backups yet"
              description={
                neonConfigured
                  ? "Click “Back up now” to create your first snapshot, or wait for the daily cron."
                  : "Configure Neon backups to start creating snapshots."
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Created</th>
                    <th className="px-4 py-2 font-medium">Trigger</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Snapshot</th>
                    <th className="px-4 py-2 font-medium">By</th>
                    <th className="px-4 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.id} className="border-t">
                      <td className="px-4 py-2 whitespace-nowrap">
                        {formatDateTime(b.createdAt, me.timezone)}
                      </td>
                      <td className="px-4 py-2">{b.trigger === "CRON" ? "Scheduled" : "Manual"}</td>
                      <td className="px-4 py-2">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            STATUS_STYLES[b.status] ?? "bg-muted text-muted-foreground",
                          )}
                        >
                          {b.status.charAt(0) + b.status.slice(1).toLowerCase()}
                        </span>
                        {b.error && (
                          <div className="mt-0.5 text-xs text-danger">{b.error}</div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {b.branchName ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {b.createdBy?.name ?? b.createdBy?.email ?? "Cron"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {b.status === "SUCCESS" &&
                        b.kind === "NEON_BRANCH" &&
                        b.neonBranchId &&
                        b.branchName ? (
                          <RestoreButton backupId={b.id} branchName={b.branchName} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
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
    </div>
  );
}
