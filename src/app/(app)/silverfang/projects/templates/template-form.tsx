"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { saveProjectTemplateAction } from "../../project-actions";
import type { SfActionResult } from "../../actions";

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export interface TemplateFormValues {
  id?: string;
  name: string;
  description: string;
  active: boolean;
  phases: string;
  tasks: string;
  tickets: string;
  billingType: string;
  contractedHours: string;
  estimatedHours: string;
  fixedFeeAmount: string;
  billingIntervalDays: string;
  depositPercent: string;
}

export const BLANK_TEMPLATE: TemplateFormValues = {
  name: "",
  description: "",
  active: true,
  phases: "",
  tasks: "",
  tickets: "",
  billingType: "TIME_AND_MATERIALS",
  contractedHours: "",
  estimatedHours: "",
  fixedFeeAmount: "",
  billingIntervalDays: "",
  depositPercent: "",
};

const BILLING_TYPES: { value: string; label: string }[] = [
  { value: "TIME_AND_MATERIALS", label: "Time & materials" },
  { value: "FIXED_FEE", label: "Fixed fee" },
];

/**
 * Edit one template: what shape of project it makes, and the phases, tasks and
 * tickets it stamps out.
 *
 * Three textareas rather than three repeaters. A template is a checklist of
 * twenty or thirty rows, and a per-row form for that is slower to fill in and
 * harder to paste into than one line per row.
 *
 * No client, agreement, manager or date fields, deliberately — a template is a
 * shape, not a piece of work.
 */
export function TemplateForm({
  values,
  submitLabel,
}: {
  values: TemplateFormValues;
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

      <fieldset className="rounded-md border p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Project shape
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium">
            Billing type
            <select
              name="billingType"
              defaultValue={values.billingType}
              className={`mt-1 ${inputCls}`}
            >
              {BILLING_TYPES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Contracted hours
            <input
              type="number"
              step="0.25"
              min="0"
              name="contractedHours"
              defaultValue={values.contractedHours}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <label className="block text-sm font-medium">
            Estimated hours
            <input
              type="number"
              step="0.25"
              min="0"
              name="estimatedHours"
              defaultValue={values.estimatedHours}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <label className="block text-sm font-medium">
            Fixed fee
            <input
              type="number"
              step="0.01"
              min="0"
              name="fixedFeeAmount"
              defaultValue={values.fixedFeeAmount}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <label className="block text-sm font-medium">
            Billing interval (days)
            <input
              type="number"
              step="1"
              min="1"
              name="billingIntervalDays"
              defaultValue={values.billingIntervalDays}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <label className="block text-sm font-medium">
            Deposit %
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              name="depositPercent"
              defaultValue={values.depositPercent}
              className={`mt-1 ${inputCls}`}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Defaults for a project made from this template. Client, agreement, manager and dates are
          never part of a template — those are what make a project a specific piece of work.
        </p>
      </fieldset>

      <label className="block text-sm font-medium">
        Phases — one per line
        <textarea
          name="phases"
          defaultValue={values.phases}
          rows={5}
          spellCheck={false}
          className={`mt-1 font-mono text-xs ${inputCls}`}
          placeholder={"Discovery | 8\nBuild | 40\nHandover | 4"}
        />
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          Format: <span className="font-mono">Name | hours</span>. Tasks and tickets below attach
          to a phase by this name.
        </span>
      </label>

      <label className="block text-sm font-medium">
        Tasks — one per line
        <textarea
          name="tasks"
          defaultValue={values.tasks}
          rows={8}
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

      <label className="block text-sm font-medium">
        Tickets — one per line
        <textarea
          name="tickets"
          defaultValue={values.tickets}
          rows={6}
          spellCheck={false}
          className={`mt-1 font-mono text-xs ${inputCls}`}
          placeholder={"Build | Rack the switch | P2 | 4\nHandover | Client walkthrough | P3"}
        />
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          Format: <span className="font-mono">Phase | Summary | priority | hours</span>. These are
          raised as real tickets on the Projects board when a project is generated, so keep them
          client-agnostic.
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
