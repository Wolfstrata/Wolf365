"use client";

import { useActionState } from "react";
import { Activity, DatabaseBackup, Download, FlaskConical, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  triggerBackupAction,
  checkNeonAccessAction,
  dryRunRestoreAction,
  type BackupActionResult,
} from "./actions";

/** On-demand backup button + data-export download link + connectivity check. */
export function BackupPanel({ neonConfigured }: { neonConfigured: boolean }) {
  const [state, action, pending] = useActionState<BackupActionResult | null, FormData>(
    triggerBackupAction,
    null,
  );
  const [checkState, checkAction, checking] = useActionState<
    BackupActionResult | null,
    FormData
  >(checkNeonAccessAction, null);
  const [dryState, dryAction, drying] = useActionState<
    BackupActionResult | null,
    FormData
  >(dryRunRestoreAction, null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={action}>
          <button
            type="submit"
            disabled={!neonConfigured || pending}
            title={
              neonConfigured
                ? "Create a Neon branch snapshot of the whole database now."
                : "Set NEON_API_KEY and NEON_PROJECT_ID to enable Neon backups."
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90",
              (!neonConfigured || pending) && "cursor-not-allowed opacity-50",
            )}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <DatabaseBackup className="h-4 w-4" />
            )}
            Back up now
          </button>
        </form>

        <a
          href="/api/backup/export"
          className="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent"
        >
          <Download className="h-4 w-4" /> Download data export (JSON)
        </a>

        <form action={checkAction}>
          <button
            type="submit"
            disabled={checking}
            title="Read-only check: confirms the Neon API key works and finds the restore target. Never restores or changes anything."
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent",
              checking && "cursor-not-allowed opacity-50",
            )}
          >
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Activity className="h-4 w-4" />
            )}
            Check Neon connection
          </button>
        </form>

        <form action={dryAction}>
          <button
            type="submit"
            disabled={!neonConfigured || drying}
            title="Safe end-to-end test: creates throwaway test branches, restores one from the other, then deletes them. Never touches production."
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent",
              (!neonConfigured || drying) && "cursor-not-allowed opacity-50",
            )}
          >
            {drying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="h-4 w-4" />
            )}
            Dry-run restore (safe test)
          </button>
        </form>
      </div>

      {state && (
        <p className={cn("text-sm", state.ok ? "text-success" : "text-danger")}>
          {state.message}
        </p>
      )}
      {checkState && (
        <p className={cn("text-sm", checkState.ok ? "text-success" : "text-danger")}>
          {checkState.message}
        </p>
      )}
      {dryState && (
        <p className={cn("text-sm", dryState.ok ? "text-success" : "text-danger")}>
          {dryState.message}
        </p>
      )}
    </div>
  );
}
