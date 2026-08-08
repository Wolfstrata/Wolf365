"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { MultiCombobox } from "@/components/ui/combobox";
import { assignTicketAction } from "../../actions";

/**
 * Who is on this ticket.
 *
 * Seeded with the current assignees, so the natural gesture — type a name, press
 * Assign — *adds* someone rather than replacing the team. Removing is explicit:
 * take the chip off first.
 *
 * The first chip is the primary assignee, which is stated because it decides where
 * notifications go and who the hours are attributed to. Reordering is done by
 * removing and re-adding, which is rare enough not to warrant drag handles.
 */
export function AssigneePicker({
  ticketId,
  users,
  current,
}: {
  ticketId: string;
  users: { id: string; name: string; email: string }[];
  current: string[];
}) {
  const [ids, setIds] = useState<string[]>(current);
  const dirty =
    ids.length !== current.length || ids.some((id, i) => id !== current[i]);

  return (
    <form action={assignTicketAction} className="space-y-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <label className="block text-xs font-medium text-muted-foreground">
        Assignees
        <div className="mt-1 w-72">
          <MultiCombobox
            name="assigneeIds"
            options={users.map((u) => ({ id: u.id, label: u.name, keywords: u.email }))}
            value={ids}
            onChange={setIds}
            placeholder="Type a name to add…"
            emptySelectionLabel="Unassigned"
          />
        </div>
      </label>
      <div className="flex items-center gap-2">
        <button
          disabled={!dirty}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
        >
          <UserPlus className="h-4 w-4" /> Save assignees
        </button>
        {ids.length > 1 && (
          <span className="text-xs text-muted-foreground">
            First is the primary — notifications and reporting use them.
          </span>
        )}
      </div>
    </form>
  );
}
