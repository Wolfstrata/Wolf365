"use client";

import { useActionState } from "react";
import {
  saveSfChargeCodeItemMapAction,
  saveSfKindItemMapAction,
  type SfBillingActionResult,
} from "../actions";

const selectCls =
  "w-full rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * One row per thing that needs a QuickBooks item. Submits on its own so a page of
 * mappings does not have to be saved all at once — and so the message tells you
 * exactly which one changed.
 */
export function MapRow({
  scope,
  id,
  label,
  hint,
  current,
  items,
}: {
  scope: "chargeCode" | "kind";
  id: string;
  label: string;
  hint?: string;
  current: string | null;
  items: { qboId: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<SfBillingActionResult | null, FormData>(
    scope === "chargeCode" ? saveSfChargeCodeItemMapAction : saveSfKindItemMapAction,
    null,
  );

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2">
      <div className="min-w-40">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <form action={action} className="flex flex-1 flex-wrap items-center gap-2">
        <input
          type="hidden"
          name={scope === "chargeCode" ? "chargeCodeId" : "kind"}
          value={id}
        />
        <select
          name="qboItemId"
          defaultValue={current ?? ""}
          className={`max-w-xs ${selectCls}`}
        >
          <option value="">Not mapped — these lines are skipped at push</option>
          {items.map((i) => (
            <option key={i.qboId} value={i.qboId}>
              {i.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border px-2.5 py-1 text-xs font-medium transition hover:bg-accent disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state && (
          <span className={`text-xs ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </span>
        )}
        {!current && !state && (
          <span className="text-xs text-warning">not mapped</span>
        )}
      </form>
    </li>
  );
}
