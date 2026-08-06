"use client";

import { useActionState } from "react";
import { CalendarCheck, Undo2 } from "lucide-react";
import {
  reopenTimesheetAction,
  submitTimesheetAction,
} from "../timesheet-actions";
import type { SfActionResult } from "../actions";

/**
 * Submit the visible week for approval, or pull it back. Shown alongside the
 * calendar because that is where the tech already is when they finish the week.
 */
export function SubmitWeekButton({
  weekStart,
  status,
  timesheetId,
  entryCount,
}: {
  weekStart: string;
  status: string;
  timesheetId: string | null;
  entryCount: number;
}) {
  const [result, submit, submitting] = useActionState<SfActionResult | null, FormData>(
    submitTimesheetAction,
    null,
  );
  const [reopenResult, reopen, reopening] = useActionState<SfActionResult | null, FormData>(
    reopenTimesheetAction,
    null,
  );

  const message = result ?? reopenResult;

  if (status === "APPROVED") {
    return (
      <span className="ml-auto text-xs font-medium text-success">
        Week approved — locked
      </span>
    );
  }

  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      {message && (
        <span className={`text-xs ${message.ok ? "text-success" : "text-danger"}`}>
          {message.message}
        </span>
      )}
      {status === "SUBMITTED" && timesheetId ? (
        <form action={reopen}>
          <input type="hidden" name="timesheetId" value={timesheetId} />
          <button
            type="submit"
            disabled={reopening}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
          >
            <Undo2 className="h-4 w-4" />
            {reopening ? "Reopening…" : "Reopen week"}
          </button>
        </form>
      ) : (
        <form action={submit}>
          <input type="hidden" name="weekStart" value={weekStart} />
          <button
            type="submit"
            disabled={submitting || entryCount === 0}
            title={entryCount === 0 ? "There is no time logged for this week." : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            <CalendarCheck className="h-4 w-4" />
            {submitting ? "Submitting…" : "Submit week"}
          </button>
        </form>
      )}
    </div>
  );
}
