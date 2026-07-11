"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { runReconciliationAction, type ExceptionActionResult } from "./actions";

/** Runs reconciliation and shows the result inline (count scanned / flagged). */
export function ReconcileButton() {
  const [state, action, pending] = useActionState<ExceptionActionResult | null, FormData>(
    runReconciliationAction,
    null,
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Reconciling…" : "Run reconciliation"}
      </button>
      {state && (
        <span className={`text-xs ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </span>
      )}
    </form>
  );
}
