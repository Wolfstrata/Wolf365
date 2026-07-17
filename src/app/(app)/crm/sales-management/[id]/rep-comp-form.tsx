"use client";

import { useActionState } from "react";
import { Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { setRepCompAction, type QuotaActionResult } from "../actions";

const fieldCls =
  "mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Edit a salesperson's base salary and commission rates. */
export function RepCompForm({
  userId,
  baseSalary,
  productCommissionPct,
  servicesCommissionMultiplier,
}: {
  userId: string;
  baseSalary: number;
  productCommissionPct: number;
  servicesCommissionMultiplier: number;
}) {
  const [state, action, pending] = useActionState<QuotaActionResult | null, FormData>(
    setRepCompAction,
    null,
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-xs font-medium text-muted-foreground">
          Base salary (annual)
          <input
            name="baseSalary"
            type="number"
            step="0.01"
            min="0"
            defaultValue={baseSalary}
            className={fieldCls}
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Product commission (% of gross margin)
          <input
            name="productCommissionPct"
            type="number"
            step="0.001"
            min="0"
            max="100"
            defaultValue={productCommissionPct}
            className={fieldCls}
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Services commission multiplier
          <input
            name="servicesCommissionMultiplier"
            type="number"
            step="0.001"
            min="0"
            max="10"
            defaultValue={servicesCommissionMultiplier}
            className={fieldCls}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Services commission is the standard schedule — 1 month of MRR for a 1-year
        agreement, 1.5 for 2 years, 2 for 3 years — scaled by the multiplier above
        (1 = standard). Product commission is the percentage of gross margin.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90",
            pending && "cursor-not-allowed opacity-50",
          )}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save compensation
        </button>
        {state && (
          <span className={cn("text-sm", state.ok ? "text-success" : "text-danger")}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
