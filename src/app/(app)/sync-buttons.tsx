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
    <form action={formAction} className="flex flex-col items-start gap-1">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? `Syncing ${label}…` : `Sync ${label}`}
      </button>
      {state && (
        // Constrained + wrapping so a long result never widens the header.
        <span
          className={`max-w-[15rem] break-words text-xs leading-snug ${
            state.ok ? "text-success" : "text-danger"
          }`}
        >
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
    <div className="flex flex-wrap items-start justify-end gap-x-3 gap-y-2">
      <SyncButton action={syncTdSynnexAction} label="TD SYNNEX" />
      <SyncButton action={syncQboAction} label="QBO" />
    </div>
  );
}
