"use client";

import { useActionState, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { SfActionResult } from "./actions";

/**
 * Choose the technicians allowed to log time against one agreement or project.
 *
 * Checkboxes rather than a multi-select: a multi-select needs ctrl-click to
 * deselect, which nobody discovers, and the whole list has to be visible for
 * "who is on this?" to be answerable at a glance.
 *
 * States what an empty list means, in the UI, right where the decision is made.
 * The empty-means-everyone rule is the sort of thing that is obvious while you
 * are building it and surprising six months later.
 */
export function AuthorizedTechsForm({
  scope,
  targetId,
  users,
  selectedIds,
  saveAction,
}: {
  scope: "agreement" | "project";
  targetId: string;
  users: { id: string; name: string | null; email: string }[];
  selectedIds: string[];
  saveAction: (
    prev: SfActionResult | null,
    formData: FormData,
  ) => Promise<SfActionResult>;
}) {
  const [result, action, pending] = useActionState(saveAction, null);
  // Tracked so the explanatory line below changes as boxes are ticked, rather than
  // only telling you what you did after the save.
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const idField = scope === "agreement" ? "agreementId" : "projectId";

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name={idField} value={targetId} />

      <p className="text-sm text-muted-foreground">
        {selected.length === 0 ? (
          <>
            <span className="font-medium text-foreground">Unrestricted.</span> Every technician can
            log time against this {scope}. Tick names to restrict it.
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">Restricted.</span> Only these{" "}
            {selected.length} can log time against this {scope} or edit it. Everyone else can still
            open it and read every detail — they just cannot add time. Untick all of them to remove
            the restriction.
          </>
        )}
      </p>

      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {users.map((u) => (
          <label
            key={u.id}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent"
          >
            <input
              type="checkbox"
              name="userIds"
              value={u.id}
              checked={selected.includes(u.id)}
              onChange={() => toggle(u.id)}
              className="h-4 w-4"
            />
            <span className="truncate">{u.name ?? u.email}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {result && (
          <span className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>
            {result.message}
          </span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
        >
          <ShieldCheck className="h-4 w-4" />
          {pending ? "Saving…" : "Save authorised technicians"}
        </button>
      </div>
    </form>
  );
}
