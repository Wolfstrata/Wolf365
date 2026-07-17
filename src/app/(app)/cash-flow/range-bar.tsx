"use client";

import { useState } from "react";

const OPTIONS: { value: string; label: string }[] = [
  { value: "fiscal", label: "Fiscal Year" },
  { value: "calendar", label: "Calendar Year" },
  { value: "all", label: "All-Time" },
  { value: "last-month", label: "Last Month" },
  { value: "this-quarter", label: "This Quarter" },
  { value: "last-quarter", label: "Last Quarter" },
  { value: "custom", label: "Custom range" },
];

const fieldCls =
  "mt-1 block rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Date-range picker for the Cash-Flow / DSO report (submits via GET). */
export function RangeBar({
  range,
  from,
  to,
}: {
  range: string;
  from?: string;
  to?: string;
}) {
  const [sel, setSel] = useState(range);

  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <label className="block text-xs font-medium text-muted-foreground">
        Date range
        <select
          name="range"
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          className={fieldCls}
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {sel === "custom" && (
        <>
          <label className="block text-xs font-medium text-muted-foreground">
            From
            <input type="date" name="from" defaultValue={from} className={fieldCls} />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            To
            <input type="date" name="to" defaultValue={to} className={fieldCls} />
          </label>
        </>
      )}

      <button className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent">
        Apply
      </button>
    </form>
  );
}
