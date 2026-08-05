"use client";

import { useActionState } from "react";
import { RefreshCw, Clock } from "lucide-react";
import {
  syncSuperOpsAction,
  syncSuperOpsTicketsAction,
  type SyncActionResult,
} from "./actions";

/** Sync controls for the SuperOps Clients page (account data + ticket backfill). */
export function SuperOpsSyncControls() {
  const [acctState, acctAction, acctPending] = useActionState<SyncActionResult | null, FormData>(
    syncSuperOpsAction,
    null,
  );
  const [tixState, tixAction, tixPending] = useActionState<SyncActionResult | null, FormData>(
    syncSuperOpsTicketsAction,
    null,
  );
  const result = acctState ?? tixState;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <form action={acctAction}>
          <button
            type="submit"
            disabled={acctPending}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${acctPending ? "animate-spin" : ""}`} />
            {acctPending ? "Syncing…" : "Sync SuperOps"}
          </button>
        </form>
        <form action={tixAction}>
          <button
            type="submit"
            disabled={tixPending}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
          >
            <Clock className={`h-4 w-4 ${tixPending ? "animate-spin" : ""}`} />
            {tixPending ? "Syncing…" : "Sync tickets & worklogs"}
          </button>
        </form>
      </div>
      {result && (
        <p className={`max-w-md text-right text-xs ${result.ok ? "text-success" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
