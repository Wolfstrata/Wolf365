"use client";

/**
 * Admin-only "View as account manager" picker. Submits via GET (?rep=<userId>)
 * and auto-navigates on change, so an administrator can view any rep's clients.
 */
export function RepPicker({
  reps,
  selected,
}: {
  reps: { id: string; label: string }[];
  selected: string;
}) {
  return (
    <form method="get" className="flex items-end gap-2">
      <label className="block text-xs font-medium text-muted-foreground">
        View as account manager
        <select
          name="rep"
          defaultValue={selected}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="mt-1 block rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <noscript>
        <button className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
          View
        </button>
      </noscript>
    </form>
  );
}
