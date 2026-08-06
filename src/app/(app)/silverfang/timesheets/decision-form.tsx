"use client";

import { useActionState, useState } from "react";
import { Check, Undo2, X } from "lucide-react";
import {
  approveTimesheetAction,
  rejectTimesheetAction,
  reopenTimesheetAction,
} from "../timesheet-actions";
import type { SfActionResult } from "../actions";

/**
 * Approve or send back one submitted week. Rejection requires a note, so the tech
 * knows what to change — a week returned silently just comes back unchanged.
 */
export function DecisionForm({
  timesheetId,
  status,
  isOwn,
}: {
  timesheetId: string;
  status: string;
  /** True when this is the viewer's own week — they cannot approve it. */
  isOwn: boolean;
}) {
  const [approveResult, approve, approving] = useActionState<SfActionResult | null, FormData>(
    approveTimesheetAction,
    null,
  );
  const [rejectResult, reject, rejecting] = useActionState<SfActionResult | null, FormData>(
    rejectTimesheetAction,
    null,
  );
  const [reopenResult, reopen, reopening] = useActionState<SfActionResult | null, FormData>(
    reopenTimesheetAction,
    null,
  );
  const [showReject, setShowReject] = useState(false);

  const result = approveResult ?? rejectResult ?? reopenResult;

  if (status === "APPROVED") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-success">Approved</span>
        {result && (
          <span className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>
            {result.message}
          </span>
        )}
      </div>
    );
  }

  if (status !== "SUBMITTED") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {status === "REJECTED" ? "Sent back" : "Not submitted"}
        </span>
        {result && (
          <span className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>
            {result.message}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={approve}>
          <input type="hidden" name="timesheetId" value={timesheetId} />
          <button
            type="submit"
            disabled={approving || isOwn}
            title={isOwn ? "You can't approve your own timesheet." : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {approving ? "Approving…" : "Approve"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setShowReject((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" /> Send back
        </button>
        <form action={reopen}>
          <input type="hidden" name="timesheetId" value={timesheetId} />
          <button
            type="submit"
            disabled={reopening}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition hover:bg-accent disabled:opacity-60"
          >
            <Undo2 className="h-3.5 w-3.5" /> Reopen
          </button>
        </form>
      </div>

      {showReject && (
        <form action={reject} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="timesheetId" value={timesheetId} />
          <input
            name="note"
            required
            placeholder="What needs changing?"
            className="w-64 rounded-md border bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={rejecting}
            className="rounded-md border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
          >
            {rejecting ? "Sending…" : "Confirm send back"}
          </button>
        </form>
      )}

      {result && (
        <p className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}
    </div>
  );
}
