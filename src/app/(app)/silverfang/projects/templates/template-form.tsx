"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { saveProjectTemplateAction } from "../../project-actions";
import type { SfActionResult } from "../../actions";

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function TemplateForm({
  values,
  submitLabel,
}: {
  values: { id?: string; name: string; description: string; active: boolean; tasks: string };
  submitLabel: string;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveProjectTemplateAction,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Name <span className="text-danger">*</span>
          <input
            name="name"
            defaultValue={values.name}
            required
            maxLength={200}
            placeholder="e.g. Server replacement"
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="mt-6 inline-flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={values.active} className="h-4 w-4" />
          Active — offered when creating a project
        </label>
      </div>

      <label className="block text-sm font-medium">
        Description
        <textarea
          name="description"
          defaultValue={values.description}
          rows={2}
          className={`mt-1 ${inputCls}`}
        />
      </label>

      <label className="block text-sm font-medium">
        Tasks — one per line
        <textarea
          name="tasks"
          defaultValue={values.tasks}
          rows={10}
          spellCheck={false}
          className={`mt-1 font-mono text-xs ${inputCls}`}
          placeholder={"Discovery | Site audit | 2 | 0\nBuild | Rack and cable | 8 | 5\nHandover"}
        />
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          Format: <span className="font-mono">Phase | Task | hours | days after start</span>.
          Everything after the task name is optional, and a line with just a name is a task with
          no phase. Saving replaces the whole list.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        {result && (
          <span className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>
            {result.message}
          </span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
