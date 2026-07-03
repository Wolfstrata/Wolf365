"use client";

import { useActionState } from "react";
import { Loader2, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { QUOTA_PERIOD_OPTIONS } from "@/lib/crm/quota";
import { setQuotaAction, type QuotaActionResult } from "./actions";

const fieldCls =
  "rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Set (or overwrite) a quota target for a salesperson + year + period. */
export function QuotaForm({
  salespeople,
  year,
}: {
  salespeople: { id: string; label: string }[];
  year: number;
}) {
  const [state, action, pending] = useActionState<QuotaActionResult | null, FormData>(
    setQuotaAction,
    null,
  );

  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs font-medium text-muted-foreground">
          Salesperson
          <select name="userId" required className={cn(fieldCls, "mt-1 block")}>
            <option value="">Select…</option>
            {salespeople.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Year
          <input
            name="year"
            type="number"
            defaultValue={year}
            min={2020}
            max={2100}
            required
            className={cn(fieldCls, "mt-1 block w-24")}
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Period
          <select name="quarter" required className={cn(fieldCls, "mt-1 block")}>
            {QUOTA_PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Target (contract value)
          <input
            name="targetAmount"
            type="number"
            step="0.01"
            min="0"
            placeholder="250000"
            required
            className={cn(fieldCls, "mt-1 block w-40")}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90",
            pending && "cursor-not-allowed opacity-50",
          )}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
          Set quota
        </button>
      </div>
      {state && (
        <p className={cn("text-sm", state.ok ? "text-success" : "text-danger")}>
          {state.message}
        </p>
      )}
    </form>
  );
}
