"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { resyncProductsAction, type SyncActionResult } from "../../sync-actions";

/**
 * Admin control on the Products page: re-pull every Product opportunity from
 * Salesforce, overwriting local edits (clears field locks first). Use to backfill
 * margins that never synced.
 */
export function ResyncProductsButton() {
  const [state, formAction, pending] = useActionState<SyncActionResult | null, FormData>(
    resyncProductsAction,
    null,
  );
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        title="Overwrite all Product opportunities with the latest Salesforce data, ignoring local edits"
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Re-syncing…" : "Re-sync from Salesforce"}
      </button>
      {state && (
        <span
          className={`max-w-[18rem] break-words text-right text-xs leading-snug ${
            state.ok ? "text-success" : "text-danger"
          }`}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
