"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { saveProjectAction } from "../project-actions";
import type { SfActionResult } from "../actions";
import { PROJECT_STATUS_LABELS } from "@/lib/silverfang/constants";

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export interface ProjectFormValues {
  id?: string;
  clientId: string;
  agreementId: string;
  name: string;
  description: string;
  status: string;
  managerId: string;
  startDate: string;
  dueDate: string;
  estimatedHours: string;
  budgetAmount: string;
}

export function ProjectForm({
  values,
  clients,
  agreements,
  users,
  templates,
  submitLabel,
}: {
  values: ProjectFormValues;
  clients: { id: string; name: string }[];
  agreements: { id: string; label: string }[];
  users: { id: string; name: string | null; email: string }[];
  /** Only offered on creation — a template stamps out tasks once. */
  templates: { id: string; name: string; taskCount: number }[];
  submitLabel: string;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveProjectAction,
    null,
  );
  const isNew = !values.id;

  return (
    <form action={action} className="space-y-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Client <span className="text-danger">*</span>
          <select
            name="clientId"
            defaultValue={values.clientId}
            required
            className={`mt-1 ${inputCls}`}
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Name <span className="text-danger">*</span>
          <input
            name="name"
            defaultValue={values.name}
            required
            maxLength={200}
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-sm font-medium">
          Status <span className="text-danger">*</span>
          <select name="status" defaultValue={values.status} className={`mt-1 ${inputCls}`}>
            {Object.entries(PROJECT_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Project manager
          <select name="managerId" defaultValue={values.managerId} className={`mt-1 ${inputCls}`}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Agreement
          <select
            name="agreementId"
            defaultValue={values.agreementId}
            className={`mt-1 ${inputCls}`}
          >
            <option value="">None</option>
            {agreements.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Determines the rates for time logged on this project&rsquo;s tasks.
          </span>
        </label>
        {isNew && (
          <label className="block text-sm font-medium">
            Start from a template
            <select name="templateId" defaultValue="" className={`mt-1 ${inputCls}`}>
              <option value="">No template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.taskCount} task{t.taskCount === 1 ? "" : "s"})
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Tasks are created now, with due dates offset from the start date.
            </span>
          </label>
        )}
        <label className="block text-sm font-medium">
          Start date
          <input
            type="date"
            name="startDate"
            defaultValue={values.startDate}
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-sm font-medium">
          Due date
          <input
            type="date"
            name="dueDate"
            defaultValue={values.dueDate}
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
          Budget
          <input
            type="number"
            step="0.01"
            min="0"
            name="budgetAmount"
            defaultValue={values.budgetAmount}
            className={`mt-1 ${inputCls}`}
          />
        </label>
      </div>

      <label className="block text-sm font-medium">
        Description
        <textarea
          name="description"
          defaultValue={values.description}
          rows={3}
          className={`mt-1 ${inputCls}`}
        />
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
