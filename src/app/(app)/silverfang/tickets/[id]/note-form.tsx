"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Lock, Send } from "lucide-react";
import { addTicketNoteAction, type SfActionResult } from "../../actions";

/**
 * Add a note to a ticket. Internal notes are the default so a tech can't leak
 * working notes to a client by accident; the visibility is stated explicitly.
 */
export function NoteForm({ ticketId }: { ticketId: string }) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    addTicketNoteAction,
    null,
  );
  const [internal, setInternal] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the textarea after a successful save.
  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      <textarea
        name="body"
        rows={4}
        required
        placeholder={
          internal ? "Internal note — not visible to the client…" : "Note visible to the client…"
        }
        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="internalOnly"
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3.5 w-3.5" /> Internal only
          </span>
        </label>
        <span className="text-xs text-muted-foreground">
          {internal
            ? "Kept private to your team."
            : "Client-visible — this also records the SLA first response."}
        </span>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <Send className="h-4 w-4" />
          {pending ? "Adding…" : "Add note"}
        </button>
      </div>
      {result && (
        <p className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}
    </form>
  );
}
