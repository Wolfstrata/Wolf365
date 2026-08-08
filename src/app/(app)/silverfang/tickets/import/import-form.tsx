"use client";

import { useActionState, useState } from "react";
import { Clock, Download, TriangleAlert } from "lucide-react";
import {
  importSuperOpsTicketsAction,
  importSuperOpsWorklogsAction,
  type SfActionResult,
} from "../../actions";

/**
 * The import, and the overwrite question.
 *
 * Asked as an explicit two-option choice rather than a checkbox, because a
 * checkbox has a default and this decision should not — "overwrite 240 tickets" is
 * not something to arrive at by leaving a box as you found it.
 *
 * The count of what would be overwritten is in the label itself. A yes/no question
 * whose consequence you have to go and work out somewhere else is not really a
 * question.
 */
export function TicketImportForm({
  toCreate,
  existingOpen,
  existingClosed,
  disabled,
}: {
  toCreate: number;
  existingOpen: number;
  existingClosed: number;
  disabled?: boolean;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    importSuperOpsTicketsAction,
    null,
  );
  const [overwrite, setOverwrite] = useState<"no" | "yes">("no");

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="expectedExisting" value={existingOpen} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          {existingOpen} ticket{existingOpen === 1 ? "" : "s"} here already came from SuperOps.
          Overwrite them?
        </legend>
        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm has-[:checked]:border-primary">
          <input
            type="radio"
            name="overwrite"
            value="no"
            checked={overwrite === "no"}
            onChange={() => setOverwrite("no")}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium">No — leave them as they are.</span>
            <span className="block text-xs text-muted-foreground">
              Only the {toCreate} ticket{toCreate === 1 ? "" : "s"} not here yet get created.
              Anything you have already edited or worked on is untouched.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm has-[:checked]:border-warning">
          <input
            type="radio"
            name="overwrite"
            value="yes"
            checked={overwrite === "yes"}
            onChange={() => setOverwrite("yes")}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium text-warning">
              Yes — refresh the {existingOpen} from SuperOps.
            </span>
            <span className="block text-xs text-muted-foreground">
              Summary, priority and status are rewritten from SuperOps on the matching
              tickets. Notes, time entries and email stay. Assignment is only filled in, never
              cleared.
            </span>
          </span>
        </label>
      </fieldset>

      {overwrite === "yes" && (
        <p className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            This cannot be undone by re-running the import. Edits made in SilverFang to those{" "}
            {existingOpen} tickets&rsquo; summary, priority and status will be replaced by
            whatever SuperOps currently says.
            {existingClosed > 0 && (
              <>
                {" "}
                The {existingClosed} you have closed here are excluded — a closed ticket is never
                reopened.
              </>
            )}
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || disabled}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <Download className={`h-4 w-4 ${pending ? "animate-pulse" : ""}`} />
          {pending
            ? "Importing…"
            : overwrite === "yes"
              ? `Import and overwrite ${existingOpen}`
              : `Import ${toCreate} new`}
        </button>
        {result && (
          <p className={`max-w-xl text-xs ${result.ok ? "text-success" : "text-danger"}`}>
            {result.message}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * Worklogs, as a second and separate step.
 *
 * Deliberately not folded into the ticket import: a worklog can only land on a
 * ticket that is already here, so running them together would silently drop the
 * hours belonging to whatever the first pass created. Two buttons in the order
 * they have to happen is clearer than one that half-works.
 */
export function WorklogImportForm() {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    importSuperOpsWorklogsAction,
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
      >
        <Clock className={`h-4 w-4 ${pending ? "animate-pulse" : ""}`} />
        {pending ? "Importing…" : "Import worklogs as time entries"}
      </button>
      {result && (
        <p className={`max-w-xl text-xs ${result.ok ? "text-success" : "text-danger"}`}>
          {result.message}
        </p>
      )}
    </form>
  );
}
