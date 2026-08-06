"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { syncHuduAction, type SyncActionResult } from "./actions";

/** Sync control for the Hudu Companies page. */
export function HuduSyncControls() {
  const [state, action, pending] = useActionState<SyncActionResult | null, FormData>(
    syncHuduAction,
    null,
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
          {pending ? "Syncing…" : "Sync Hudu"}
        </button>
      </form>
      {state && (
        <p className={`max-w-md text-right text-xs ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}
