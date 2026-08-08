"use client";

import { useActionState } from "react";
import { RefreshCw, Clock } from "lucide-react";
import {
  syncSuperOpsAction,
  syncSuperOpsTicketsAction,
  type SyncActionResult,
} from "./actions";

const btnCls =
  "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60";

/**
 * Account data: clients, sites, contacts, assets, contracts, invoices.
 *
 * Exported on its own as well as inside `SuperOpsSyncControls`, because the
 * migration runbook needs the same button in its own numbered step — the buttons
 * for one job should not be spread across three screens, and duplicating the
 * action wiring to achieve that is how two copies drift apart.
 */
export function SuperOpsAccountSyncButton({ className }: { className?: string }) {
  const [result, action, pending] = useActionState<SyncActionResult | null, FormData>(
    syncSuperOpsAction,
    null,
  );
  return (
    <div className={className ?? "space-y-2"}>
      <form action={action}>
        <button type="submit" disabled={pending} className={btnCls}>
          <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
          {pending ? "Syncing…" : "Sync SuperOps"}
        </button>
      </form>
      {result && (
        <p className={`max-w-xl text-xs ${result.ok ? "text-success" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}

/**
 * One bounded chunk of the resumable tickets + worklogs backfill.
 *
 * Says "click again to continue" rather than looping by itself: a long-running
 * button that silently keeps going gives no way to stop, and no honest progress.
 */
export function SuperOpsTicketSyncButton({ className }: { className?: string }) {
  const [result, action, pending] = useActionState<SyncActionResult | null, FormData>(
    syncSuperOpsTicketsAction,
    null,
  );
  return (
    <div className={className ?? "space-y-2"}>
      <form action={action}>
        <button type="submit" disabled={pending} className={btnCls}>
          <Clock className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
          {pending ? "Syncing…" : "Sync tickets & worklogs"}
        </button>
      </form>
      {result && (
        <p className={`max-w-xl text-xs ${result.ok ? "text-success" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}

/** Both sync controls side by side, for the Connector Data page header. */
export function SuperOpsSyncControls() {
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      <SuperOpsAccountSyncButton className="flex flex-col items-end gap-2 text-right" />
      <SuperOpsTicketSyncButton className="flex flex-col items-end gap-2 text-right" />
    </div>
  );
}
