"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { clearInactiveBillingRunsAction, type BillingActionResult } from "./actions";

/**
 * Clears all DRAFT and CANCELLED billing runs. Committed runs are never
 * affected. Requires an explicit confirmation before submitting.
 */
export function ClearRunsButton({ count }: { count: number }) {
  const [state, action, pending] = useActionState<BillingActionResult | null, FormData>(
    clearInactiveBillingRunsAction,
    null,
  );
  return (
    <form
      action={action}
      className="flex items-center gap-3"
      onSubmit={(e) => {
        if (
          !confirm(
            `Delete all ${count} draft and cancelled billing run${count === 1 ? "" : "s"}? This cannot be undone. Committed runs are not affected.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        disabled={pending || count === 0}
        className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-2 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
        {pending ? "Clearing…" : `Clear draft & cancelled${count > 0 ? ` (${count})` : ""}`}
      </button>
      {state && (
        <span className={state.ok ? "text-sm text-success" : "text-sm text-danger"}>
          {state.message}
        </span>
      )}
    </form>
  );
}
