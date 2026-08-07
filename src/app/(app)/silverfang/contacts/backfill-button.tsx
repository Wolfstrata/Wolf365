"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { backfillDomainContactsAction, type SfActionResult } from "../actions";

/**
 * Match already-received email addresses against the contact domain rules and
 * create the contacts.
 *
 * Safe to re-run: an address that already has a contact is counted as known and
 * skipped, and creation keys off (source, address), so nothing duplicates.
 */
export function BackfillContactsButton() {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    backfillDomainContactsAction,
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
          <UserPlus className={`h-4 w-4 ${pending ? "animate-pulse" : ""}`} />
          {pending ? "Matching…" : "Match email domains"}
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
