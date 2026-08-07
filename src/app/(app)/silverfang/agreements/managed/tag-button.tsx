"use client";

import { useActionState } from "react";
import { ShieldCheck } from "lucide-react";
import { createManagedAgreementsAction, type SfActionResult } from "../../actions";

/**
 * Create the draft agreements shown in the preview.
 *
 * Safe to press twice: a client that already has a managed agreement is skipped,
 * so a second run reports "already tagged" rather than doubling up.
 */
export function TagManagedButton({ count }: { count: number }) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    createManagedAgreementsAction,
    null,
  );
  return (
    <div className="flex flex-col items-end gap-2">
      <form action={action}>
        <button
          type="submit"
          disabled={pending || count === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <ShieldCheck className={`h-4 w-4 ${pending ? "animate-pulse" : ""}`} />
          {pending
            ? "Creating…"
            : count === 0
              ? "Nothing to create"
              : `Create ${count} draft agreement${count === 1 ? "" : "s"}`}
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
