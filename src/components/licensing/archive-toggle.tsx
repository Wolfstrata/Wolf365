"use client";

import { useState, useTransition } from "react";
import { Archive } from "lucide-react";
import { setLicenseArchivedAction } from "@/app/(app)/archived-licensing/actions";

/**
 * Filing-cabinet toggle for a single M365 license. Muted when the license is
 * live; turns orange when archived — and immediately while a toggle is pending,
 * so the click gives instant feedback before the list revalidates and the row
 * moves. Read-only users (no billing:edit) see a static, non-interactive icon.
 */
export function ArchiveToggle({
  subscriptionId,
  archived,
  canArchive,
}: {
  subscriptionId: string;
  archived: boolean;
  canArchive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  // Optimistic look: once clicked, show the target (archived) state right away.
  const showArchived = pending ? !archived : archived;

  if (!canArchive) {
    return (
      <Archive
        className={`h-4 w-4 ${archived ? "text-orange-500" : "text-muted-foreground/50"}`}
        aria-label={archived ? "Archived" : "Not archived"}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      title={archived ? "Restore this license" : "Archive this license"}
      aria-label={archived ? "Restore this license" : "Archive this license"}
      aria-pressed={archived}
      onClick={() => {
        setError(false);
        startTransition(async () => {
          const res = await setLicenseArchivedAction(subscriptionId, !archived);
          if (!res.ok) setError(true);
        });
      }}
      className="inline-flex items-center justify-center rounded-md p-1.5 transition hover:bg-accent disabled:opacity-60"
    >
      <Archive
        className={`h-4 w-4 transition-colors ${
          error
            ? "text-danger"
            : showArchived
              ? "text-orange-500"
              : "text-muted-foreground hover:text-foreground"
        }`}
      />
    </button>
  );
}
