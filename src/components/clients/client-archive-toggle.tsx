"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { setClientArchivedAction } from "@/app/(app)/clients/actions";

/**
 * Archive / restore an entire client. Archiving hides the whole client from the
 * clients list, dashboard, reports, and billing picker, so it asks for
 * confirmation first; restoring is safe and immediate. Two visual variants:
 * a compact icon `button` (for table rows) and a labelled `full` button (for
 * the client profile header). Read-only users (no billing:edit) see nothing.
 */
export function ClientArchiveToggle({
  clientId,
  clientName,
  archived,
  canArchive,
  variant = "icon",
}: {
  clientId: string;
  clientName: string;
  archived: boolean;
  canArchive: boolean;
  variant?: "icon" | "full";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canArchive) return null;

  const run = () => {
    if (
      !archived &&
      !window.confirm(
        `Archive ${clientName}? It will be hidden from the clients list, dashboard, reports, and billing until you restore it.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await setClientArchivedAction(clientId, !archived);
      if (!res.ok) setError(res.message);
    });
  };

  if (variant === "full") {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
        >
          {archived ? (
            <>
              <ArchiveRestore className="h-4 w-4" /> Restore client
            </>
          ) : (
            <>
              <Archive className="h-4 w-4" /> Archive client
            </>
          )}
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      title={archived ? "Restore this client" : "Archive this client"}
      aria-label={archived ? "Restore this client" : "Archive this client"}
      aria-pressed={archived}
      className="inline-flex items-center justify-center rounded-md p-1.5 transition hover:bg-accent disabled:opacity-60"
    >
      {archived ? (
        <ArchiveRestore className="h-4 w-4 text-orange-500" />
      ) : (
        <Archive
          className={`h-4 w-4 transition-colors ${
            error ? "text-danger" : "text-muted-foreground hover:text-foreground"
          }`}
        />
      )}
    </button>
  );
}
