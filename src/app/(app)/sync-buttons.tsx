"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import {
  syncTdSynnexAction,
  syncQboAction,
  type SyncActionResult,
} from "./sync-actions";

function SyncButton({
  action,
  label,
}: {
  action: (
    prev: SyncActionResult | null,
    formData: FormData,
  ) => Promise<SyncActionResult>;
  label: string;
}) {
  const [state, formAction, pending] = useActionState<SyncActionResult | null, FormData>(
    action,
    null,
  );
  return (
    <form action={formAction} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? `Syncing ${label}…` : `Sync ${label}`}
      </button>
      {state && (
        <span className={state.ok ? "text-xs text-success" : "text-xs text-danger"}>
          {state.message}
        </span>
      )}
    </form>
  );
}

/**
 * On-demand connector sync controls for the dashboard, so a finance user can
 * pull fresh data whenever they want. Only rendered for users with
 * connectors:sync.
 */
export function DashboardSyncButtons() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SyncButton action={syncTdSynnexAction} label="TD SYNNEX" />
      <SyncButton action={syncQboAction} label="QBO" />
    </div>
  );
}
