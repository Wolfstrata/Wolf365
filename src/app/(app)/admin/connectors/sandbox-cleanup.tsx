"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  cleanupSandboxDataAction,
  type QboCleanupActionResult,
} from "./qbo-actions";

/**
 * Admin control to remove leftover sandbox/test QuickBooks data, keeping only
 * the connected production company. Requires a type-to-confirm step.
 */
export function SandboxCleanup() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const router = useRouter();
  const [state, action, pending] = useActionState<QboCleanupActionResult | null, FormData>(
    cleanupSandboxDataAction,
    null,
  );
  const confirmed = typed.trim().toUpperCase() === "REMOVE SANDBOX";

  // Close the dialog and refresh server data once the purge succeeds.
  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <div className="mt-4 border-t pt-4">
      <p className="text-sm font-medium">Remove sandbox / test data</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Deletes QuickBooks customers and items that aren&apos;t part of your connected
        production company, plus any client records created only from that sandbox
        data. Production data is never touched.
      </p>

      <button
        type="button"
        onClick={() => {
          setTyped("");
          setOpen(true);
        }}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10"
      >
        <Trash2 className="h-4 w-4" /> Remove sandbox data
      </button>

      {state && (
        <p className={cn("mt-2 text-sm", state.ok ? "text-success" : "text-danger")}>
          {state.message}
        </p>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
              <div>
                <h2 className="text-sm font-semibold">Remove sandbox data</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  This deletes all QuickBooks records that don&apos;t belong to your
                  connected production company, and the client entries created only
                  from them. Clients with billing, CRM, or another data source are
                  kept. This cannot be undone (restore from a backup if needed).
                </p>
              </div>
            </div>

            <form action={action} className="mt-4 space-y-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Type <span className="font-mono">REMOVE SANDBOX</span> to confirm
                <input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="REMOVE SANDBOX"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>

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
                  Remove sandbox data
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
