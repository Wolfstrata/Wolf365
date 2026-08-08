"use client";

import { useActionState } from "react";
import { Download } from "lucide-react";
import { importSuperOpsClientsAction, type SfActionResult } from "../actions";

/**
 * Import SuperOps clients + contacts. Safe to re-run — contacts key off their
 * source id, so a second run updates rather than duplicating.
 *
 * `className` exists so the migration runbook can show the same button
 * left-aligned in its numbered step, rather than a second copy of the wiring.
 */
export function ImportSuperOpsButton({ className }: { className?: string } = {}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    importSuperOpsClientsAction,
    null,
  );
  return (
    <div className={className ?? "flex flex-col items-end gap-2 text-right"}>
      <form action={action}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
        >
          <Download className={`h-4 w-4 ${pending ? "animate-pulse" : ""}`} />
          {pending ? "Importing…" : "Import from SuperOps"}
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
