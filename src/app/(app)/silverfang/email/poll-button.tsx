"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { pollMailboxesAction, type SfActionResult } from "../actions";

/** Poll every inbound mailbox now instead of waiting for the 15-minute cron. */
export function PollMailboxesButton() {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    pollMailboxesAction,
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
          {pending ? "Checking…" : "Check mail now"}
        </button>
      </form>
      {result && (
        <p className={`max-w-md text-right text-xs ${result.ok ? "text-success" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
