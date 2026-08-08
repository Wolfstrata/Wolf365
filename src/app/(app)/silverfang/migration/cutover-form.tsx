"use client";

import { useActionState, useState } from "react";
import { Power, TriangleAlert } from "lucide-react";
import {
  importSuperOpsNotesAction,
  setSuperOpsEnabledAction,
  syncSuperOpsNotesAction,
  type SfActionResult,
} from "../actions";

/**
 * The cutover switch.
 *
 * Requires typing the words, because this stops every sync and every import
 * across the whole install. Not a confirm dialog — a dialog is dismissed by
 * reflex, and this is a decision that should cost a moment's attention.
 *
 * Reversible, and says so. "Cancel the subscription" is the irreversible act;
 * this is the software switch, and being able to turn it back on for one more
 * pass is worth more than the theatre of making it permanent.
 */
export function CutoverForm({
  enabled,
  complete,
  outstanding,
}: {
  enabled: boolean;
  /** True when everything mirrored has been imported. */
  complete: boolean;
  /** One line per thing still outstanding. */
  outstanding: string[];
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    setSuperOpsEnabledAction,
    null,
  );
  const [confirm, setConfirm] = useState("");
  const armed = confirm.trim().toUpperCase() === "SWITCH OFF SUPEROPS";

  if (!enabled) {
    return (
      <form action={action} className="space-y-3">
        <input type="hidden" name="enabled" value="on" />
        <p className="text-sm">
          SuperOps is <span className="font-medium text-warning">off</span>. Nothing syncs or
          imports from it, and SilverFang is the source of truth. Everything already imported is
          untouched.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
        >
          <Power className="h-4 w-4" />
          {pending ? "Turning on…" : "Turn SuperOps back on"}
        </button>
        {result && (
          <p className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>
            {result.message}
          </p>
        )}
      </form>
    );
  }

  return (
    <form action={action} className="space-y-3">
      {/* Absent checkbox = off, which is what this form submits. */}
      {!complete && outstanding.length > 0 && (
        <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium text-warning">Not everything has been brought across yet.</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {outstanding.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <label className="block text-sm font-medium">
        Note (optional)
        <input
          name="notes"
          maxLength={2000}
          placeholder="e.g. SuperOps subscription ends 30 September"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </label>

      <label className="block text-sm font-medium">
        Type <span className="font-mono">SWITCH OFF SUPEROPS</span> to confirm
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </label>

      <button
        type="submit"
        disabled={pending || !armed}
        className="inline-flex items-center gap-1.5 rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm font-medium text-warning transition hover:bg-warning/20 disabled:opacity-60"
      >
        <Power className="h-4 w-4" />
        {pending ? "Switching off…" : "Switch SuperOps off"}
      </button>
      <p className="text-xs text-muted-foreground">
        Stops the scheduled sync and every import path. Deletes nothing — the tickets, time,
        notes and contacts already imported are SilverFang&rsquo;s own records now. Reversible
        from this page.
      </p>
      {result && (
        <p className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}
    </form>
  );
}

/** Import mirrored conversations. Third step, after tickets. */
export function NoteImportForm() {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    importSuperOpsNotesAction,
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
      >
        {pending ? "Importing…" : "Import conversations as ticket notes"}
      </button>
      {result && (
        <p className={`max-w-xl text-xs ${result.ok ? "text-success" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </form>
  );
}

/**
 * Mirror conversations from SuperOps. The step before importing them.
 *
 * Two stages, like every other connector entity: the mirror is a faithful
 * read-only copy, so the mapping can be corrected and re-imported later without
 * going back to an API that may by then be cancelled.
 */
export function NoteSyncForm() {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    syncSuperOpsNotesAction,
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
      >
        {pending ? "Mirroring…" : "Mirror conversations from SuperOps"}
      </button>
      {result && (
        <p className={`max-w-xl text-xs ${result.ok ? "text-success" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </form>
  );
}
