"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { restoreBackupAction, type BackupActionResult } from "./actions";

/**
 * Danger-styled "Restore" button that opens a type-to-confirm modal. Restoring
 * overwrites the entire database with the snapshot, so the admin must type the
 * exact snapshot name to enable the action.
 */
export function RestoreButton({
  backupId,
  branchName,
}: {
  backupId: string;
  branchName: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const router = useRouter();
  const [state, action, pending] = useActionState<BackupActionResult | null, FormData>(
    restoreBackupAction,
    null,
  );

  // Refresh the page after a successful restore so the table reflects the
  // restored (snapshot) state.
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const confirmed = typed === branchName;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTyped("");
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger/10"
      >
        <History className="h-3.5 w-3.5" /> Restore
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
              <div>
                <h2 className="text-sm font-semibold">Restore from snapshot</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  This <strong>overwrites the entire database</strong> with snapshot{" "}
                  <span className="font-mono">{branchName}</span>. All current data
                  (including newer records) will be replaced. The current state is
                  saved first as a <span className="font-mono">pre-restore-…</span>{" "}
                  safety branch in Neon, so this can be reversed.
                </p>
              </div>
            </div>

            <form action={action} className="mt-4 space-y-3">
              <input type="hidden" name="backupId" value={backupId} />
              <input type="hidden" name="confirmation" value={typed} />
              <label className="block text-xs font-medium text-muted-foreground">
                Type the snapshot name to confirm
                <input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={branchName}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>

              {state && !state.ok && (
                <p className="text-sm text-danger">{state.message}</p>
              )}
              {state?.ok && <p className="text-sm text-success">{state.message}</p>}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                  className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!confirmed || pending}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90",
                    (!confirmed || pending) && "cursor-not-allowed opacity-50",
                  )}
                >
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Restore database
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
