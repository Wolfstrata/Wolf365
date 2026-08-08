"use client";

import { useActionState } from "react";
import { Copy } from "lucide-react";
import { saveProjectAsTemplateAction } from "../../project-actions";
import type { SfActionResult } from "../../actions";

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Capture this project's shape as a reusable template.
 *
 * Says up front what does *not* come across, because "save as template" reads
 * like a full copy and the whole point is that the client-specific half is left
 * behind.
 */
export function SaveAsTemplate({
  projectId,
  suggestedName,
}: {
  projectId: string;
  suggestedName: string;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveProjectAsTemplateAction,
    null,
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Template name <span className="text-danger">*</span>
          <input
            name="name"
            defaultValue={suggestedName}
            required
            maxLength={200}
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="mt-6 inline-flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" name="includeTickets" defaultChecked className="h-4 w-4" />
          Include the open tickets
        </label>
      </div>
      <label className="block text-sm font-medium">
        Description
        <input name="description" maxLength={500} className={`mt-1 ${inputCls}`} />
      </label>
      <p className="text-xs text-muted-foreground">
        Copies the phases with their hours, the billing shape, and optionally the open ticket
        summaries. Does{" "}
        <span className="font-medium">not</span> copy the client, agreement, manager, dates,
        logged hours, or any ticket description — a description is one client&rsquo;s
        problem in their words, and it would follow the template onto every project made from it.
      </p>
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
          <Copy className="h-4 w-4" />
          {pending ? "Saving…" : "Save as template"}
        </button>
      </div>
    </form>
  );
}
