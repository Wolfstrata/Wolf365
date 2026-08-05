"use client";

import { useActionState } from "react";
import { Wand2 } from "lucide-react";
import { seedSilverFangAction, type SfActionResult } from "../actions";

/** Creates the default board, statuses, SLA and charge codes. Idempotent. */
export function SeedButton() {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    seedSilverFangAction,
    null,
  );
  return (
    <div className="flex flex-col items-start gap-2">
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <Wand2 className={`h-4 w-4 ${pending ? "animate-pulse" : ""}`} />
          {pending ? "Creating…" : "Create defaults"}
        </button>
      </form>
      {result && (
        <p className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}
    </div>
  );
}
