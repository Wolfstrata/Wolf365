"use client";

import { useActionState, useState } from "react";
import { CalendarSync, Save } from "lucide-react";
import { saveTechProfileAction, type SfActionResult } from "../actions";

const inputCls =
  "w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export interface TechProfileRow {
  userId: string;
  name: string;
  email: string;
  calendarMailbox: string | null;
  calendarSyncEnabled: boolean;
  /** Blocks currently mirrored onto this technician's calendar. */
  syncedBlocks: number;
  /** Most recent sync failure, if the last attempt did not succeed. */
  lastError: string | null;
}

/**
 * Per-technician calendar settings.
 *
 * These two fields have existed on SfTechProfile since the original schema with
 * nothing able to set them, so calendar sync could never be turned on at all.
 *
 * Off by default and per-person: writing to somebody's calendar is not something
 * to switch on for a whole company at once.
 */
export function TechProfiles({ rows }: { rows: TechProfileRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active users to configure.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <TechRow key={r.userId} row={r} />
      ))}
    </div>
  );
}

function TechRow({ row }: { row: TechProfileRow }) {
  const [state, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveTechProfileAction,
    null,
  );
  const [enabled, setEnabled] = useState(row.calendarSyncEnabled);

  return (
    <form action={action} className="rounded-md border p-3">
      <input type="hidden" name="userId" value={row.userId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <p className="text-sm font-medium">{row.name || row.email}</p>
          <p className="text-xs text-muted-foreground">{row.email}</p>
        </div>

        <label className="min-w-56 flex-1 text-xs font-medium">
          Calendar mailbox
          <input
            name="calendarMailbox"
            type="email"
            defaultValue={row.calendarMailbox ?? ""}
            placeholder={row.email}
            className={`mt-1 ${inputCls}`}
          />
        </label>

        <label className="flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            name="calendarSyncEnabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <CalendarSync className="h-3.5 w-3.5" />
          Sync to Outlook
        </label>

        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition hover:bg-accent disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" />
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="mt-1.5 space-y-1 text-xs">
        {row.syncedBlocks > 0 && (
          <p className="text-muted-foreground">
            {row.syncedBlocks} block{row.syncedBlocks === 1 ? "" : "s"} currently on this calendar.
          </p>
        )}
        {/* A calendar that has quietly stopped updating looks identical to one
            nobody scheduled anything on, so the last failure is shown here. */}
        {row.lastError && (
          <p className="text-danger">Last sync failed: {row.lastError}</p>
        )}
        {enabled && !row.calendarMailbox && (
          <p className="text-warning">
            Sync is on but no mailbox is set — nothing will be written. The address defaults to
            nothing, not to the sign-in address, because a calendar is written to and guessing
            which one would be wrong.
          </p>
        )}
        {state && (
          <p className={state.ok ? "text-success" : "text-danger"}>{state.message}</p>
        )}
      </div>
    </form>
  );
}
