"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { addAgreementBlockAction } from "../../agreement-actions";
import type { SfActionResult } from "../../actions";

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Add a block of prepaid hours to a block-time agreement. */
export function BlockForm({ agreementId }: { agreementId: string }) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    addAgreementBlockAction,
    null,
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="agreementId" value={agreementId} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="block text-xs font-medium">
          Hours <span className="text-danger">*</span>
          <input
            type="number"
            step="0.25"
            min="0.25"
            name="purchasedHours"
            required
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-xs font-medium">
          Rate
          <input type="number" step="0.01" min="0" name="rate" className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block text-xs font-medium">
          Amount
          <input type="number" step="0.01" min="0" name="amount" className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block text-xs font-medium">
          Purchased <span className="text-danger">*</span>
          <input
            type="date"
            name="purchasedAt"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-xs font-medium">
          Expires
          <input type="date" name="expiresAt" className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block text-xs font-medium">
          PO number
          <input name="poNumber" className={`mt-1 ${inputCls}`} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          Hours are consumed soonest-to-expire first, so prepaid time is used before it lapses.
        </span>
        {result && (
          <span className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>
            {result.message}
          </span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {pending ? "Adding…" : "Add block"}
        </button>
      </div>
    </form>
  );
}
