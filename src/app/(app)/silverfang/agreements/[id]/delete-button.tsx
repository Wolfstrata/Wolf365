"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { deleteAgreementAction } from "../../agreement-actions";
import type { SfActionResult } from "../../actions";

/** Delete an agreement. The server refuses when anything references it. */
export function DeleteAgreementButton({ id }: { id: string }) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    deleteAgreementAction,
    null,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
      >
        <Trash2 className="h-4 w-4" />
        {pending ? "Deleting…" : "Delete agreement"}
      </button>
      {result && !result.ok && (
        <span className="max-w-xl text-sm text-danger">{result.message}</span>
      )}
    </form>
  );
}
