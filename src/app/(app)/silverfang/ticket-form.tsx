"use client";

import Link from "next/link";

import { useActionState, useState } from "react";
import type { ReactNode } from "react";
import { PRIORITY_LABELS, SOURCE_LABELS } from "@/lib/silverfang/constants";
import { Combobox, MultiCombobox } from "@/components/ui/combobox";
import type { SfActionResult } from "./actions";

export interface TicketFormValues {
  id?: string;
  clientId: string;
  contactId: string;
  boardId: string;
  statusId: string;
  priority: string;
  source: string;
  summary: string;
  description: string;
  /** Comma-free list of assignee ids, primary first. */
  assigneeIds: string[];
  agreementId: string;
  projectId: string;
  projectPhaseId: string;
  type: string;
  subtype: string;
  estimatedHours: string;
}

export interface TicketFormProject {
  id: string;
  name: string;
  phases: { id: string; name: string }[];
}

export interface TicketFormOptions {
  boards: { id: string; name: string; statuses: { id: string; name: string }[] }[];
  clients: { id: string; name: string }[];
  users: { id: string; name: string | null; email: string }[];
  contactsByClient: Record<string, { id: string; name: string }[]>;
  /** `type` drives which board a new ticket lands on. */
  agreementsByClient: Record<string, { id: string; name: string; type: string }[]>;
  projectsByClient: Record<string, TicketFormProject[]>;
}

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function Field({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </label>
      {children}
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

/**
 * Shared create/edit ticket form. The action is passed in so one form serves
 * both routes; identity travels in a hidden `id` field.
 */
export function TicketForm({
  values,
  options,
  saveAction,
  submitLabel,
  returnTo,
  cancelHref,
}: {
  values: TicketFormValues;
  options: TicketFormOptions;
  saveAction: (
    prev: SfActionResult | null,
    formData: FormData,
  ) => Promise<SfActionResult>;
  submitLabel: string;
  /** Where the action sends you after a successful save. */
  returnTo?: string;
  /** Where Cancel goes. Usually the same place — leaving without saving and saving
   *  should both land you back where you started. */
  cancelHref?: string;
}) {
  const [result, action, pending] = useActionState(saveAction, null);

  // Client drives which contacts/agreements are selectable; board drives statuses.
  const [clientId, setClientId] = useState(values.clientId);
  const [contactId, setContactId] = useState(values.contactId);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(values.assigneeIds);
  const [boardId, setBoardId] = useState(values.boardId);
  // A project ticket belongs to a phase of that project, so the phase list
  // follows the chosen project rather than being a free-standing select.
  const [projectId, setProjectId] = useState(values.projectId);

  const contacts = options.contactsByClient[clientId] ?? [];
  const agreements = options.agreementsByClient[clientId] ?? [];
  const projects = options.projectsByClient[clientId] ?? [];
  const phases = projects.find((p) => p.id === projectId)?.phases ?? [];
  const statuses = options.boards.find((b) => b.id === boardId)?.statuses ?? [];

  return (
    <form action={action} className="space-y-6">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Client" required help="Start typing any part of the name.">
          <Combobox
            name="clientId"
            options={options.clients.map((c) => ({ id: c.id, label: c.name }))}
            value={clientId}
            onChange={(id) => {
              setClientId(id);
              // The project list is per client, so a project chosen for the old
              // client must not survive the switch.
              setProjectId("");
            }}
            placeholder="Type to find a client…"
            emptyLabel={null}
            required
          />
        </Field>

        <Field
          label="Contact"
          help={
            clientId && contacts.length === 0
              ? "This client has no SilverFang contacts yet."
              : undefined
          }
        >
          {/* Keyed on the client so switching client cannot leave a contact from
              the previous one selected. */}
          <Combobox
            key={clientId}
            name="contactId"
            options={contacts.map((c) => ({ id: c.id, label: c.name }))}
            value={contactId}
            onChange={setContactId}
            placeholder="Type to find a contact…"
            emptyLabel="No contact"
          />
        </Field>

        <Field label="Board" required>
          <select
            name="boardId"
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            className={inputCls}
            required
          >
            {options.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Status" help="Defaults to the board's default status for new tickets.">
          <select name="statusId" defaultValue={values.statusId} className={inputCls}>
            <option value="">Board default</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Priority" required>
          <select name="priority" defaultValue={values.priority} className={inputCls}>
            {Object.entries(PRIORITY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Source" required>
          <select name="source" defaultValue={values.source} className={inputCls}>
            {Object.entries(SOURCE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Assignees"
          help="Several people can be on one ticket. The first is the primary — notifications and reporting use them."
        >
          <MultiCombobox
            name="assigneeIds"
            options={options.users.map((u) => ({
              id: u.id,
              label: u.name ?? u.email,
              // Searchable by address too, since two people can share a first name.
              keywords: u.email,
            }))}
            value={assigneeIds}
            onChange={setAssigneeIds}
            placeholder="Type to add someone…"
            emptySelectionLabel="Unassigned"
          />
        </Field>

        <Field
          label="Agreement"
          help="Determines which rates apply to time logged. A managed client's agreement is filled in for you; block time is never chosen automatically."
        >
          <select name="agreementId" defaultValue={values.agreementId} className={inputCls}>
            <option value="">None</option>
            {agreements.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Project"
          help={
            clientId && projects.length === 0
              ? "This client has no open projects."
              : "Makes this a project ticket, tracked against the project's hours."
          }
        >
          <select
            name="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={inputCls}
          >
            <option value="">Not a project ticket</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Phase"
          help={
            projectId && phases.length === 0
              ? "This project has no phases yet — add them on the project."
              : undefined
          }
        >
          {/* Keyed on the project so switching project cannot leave a phase from
              the previous one selected. */}
          <select
            key={projectId}
            name="projectPhaseId"
            defaultValue={values.projectPhaseId}
            className={inputCls}
            disabled={phases.length === 0}
          >
            <option value="">No phase</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Type">
          <input name="type" defaultValue={values.type} className={inputCls} placeholder="e.g. Incident" />
        </Field>

        <Field label="Subtype">
          <input
            name="subtype"
            defaultValue={values.subtype}
            className={inputCls}
            placeholder="e.g. Email"
          />
        </Field>

        <Field label="Estimated hours">
          <input
            type="number"
            step="0.25"
            min="0"
            name="estimatedHours"
            defaultValue={values.estimatedHours}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="Summary" required>
        <input
          name="summary"
          defaultValue={values.summary}
          className={inputCls}
          maxLength={300}
          required
          placeholder="One line describing the issue"
        />
      </Field>

      <Field label="Description">
        <textarea
          name="description"
          defaultValue={values.description}
          rows={8}
          className={inputCls}
          placeholder="What was reported, what's been tried, what's needed."
        />
      </Field>

      {result && !result.ok && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{result.message}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {cancelHref && (
          <Link
            href={cancelHref}
            className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent"
          >
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}
