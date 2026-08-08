"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Plus, Save, Ticket, Trash2 } from "lucide-react";
import {
  addNextProjectPhaseAction,
  deleteProjectPhaseAction,
  saveProjectPhaseAction,
} from "../../project-actions";
import type { SfActionResult } from "../../actions";
import { TASK_STATUS_LABELS } from "@/lib/silverfang/constants";
import { formatHours } from "@/lib/silverfang/time";
import { withReturnTo } from "@/lib/silverfang/return-to";
import { phaseHoursReconcile } from "@/lib/silverfang/project-billing";

const inputCls =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export interface PhaseTicketRow {
  id: string;
  number: number;
  summary: string;
  status: string;
  hours: number;
  /** Ordering fields — a phase's tickets read in the same order as every list. */
  priority: string;
  createdAt: Date;
  vip: boolean;
}

export interface PhaseRow {
  id: string;
  name: string;
  status: string;
  hours: number | null;
  notes: string | null;
  sortOrder: number;
  loggedHours: number;
  tickets: PhaseTicketRow[];
}

/**
 * The phases of a project: what was sold for each stage, what has been logged
 * against it, and the project tickets that belong to it.
 *
 * `showHours` is the fixed-fee rule made structural — on a fixed-fee project the
 * hours are still tracked in full, but a component that never receives them
 * cannot leak them into a client-facing view.
 */
export function PhaseBoard({
  projectId,
  clientId,
  phases,
  contractedHours,
  showHours,
  canManage,
}: {
  projectId: string;
  clientId: string;
  phases: PhaseRow[];
  contractedHours: number | null;
  showHours: boolean;
  canManage: boolean;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveProjectPhaseAction,
    null,
  );
  const [deleteResult, deleteAction] = useActionState<SfActionResult | null, FormData>(
    deleteProjectPhaseAction,
    null,
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reconcile = phaseHoursReconcile(
    contractedHours,
    phases.map((p) => ({ hours: p.hours })),
  );
  const loggedTotal = phases.reduce((a, p) => a + p.loggedHours, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span>
          {phases.length} phase{phases.length === 1 ? "" : "s"}
        </span>
        {showHours && (
          <>
            <span>
              {reconcile.total != null
                ? `${formatHours(reconcile.total)} sold across phases`
                : "No phase hours set yet"}
            </span>
            <span>{formatHours(loggedTotal)} logged</span>
          </>
        )}
        {canManage && (
          <form action={addNextProjectPhaseAction} className="ml-auto">
            <input type="hidden" name="projectId" value={projectId} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition hover:bg-accent"
            >
              <Plus className="h-4 w-4" /> Add phase
            </button>
          </form>
        )}
      </div>

      {showHours && !reconcile.matches && reconcile.difference != null && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          The phases add up to {formatHours(reconcile.total ?? 0)} but the project is contracted
          for {formatHours(contractedHours ?? 0)} —{" "}
          {reconcile.difference > 0
            ? `${formatHours(reconcile.difference)} more than was sold.`
            : `${formatHours(-reconcile.difference)} still unallocated.`}{" "}
          Adjust a phase or the contracted total.
        </p>
      )}

      {phases.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No phases yet. Add one to break the project into stages, each with its own hours and
          project tickets.
        </p>
      )}

      <ul className="space-y-2">
        {phases.map((p) => (
          <li key={p.id} className="rounded-md border">
            {editing === p.id && canManage ? (
              <div className="p-3">
                <PhaseFields
                  projectId={projectId}
                  phase={p}
                  showHours={showHours}
                  action={action}
                  pending={pending}
                  onCancel={() => setEditing(null)}
                />
                <form action={deleteAction} className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    name="id"
                    value={p.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete phase
                  </button>
                  {/* Offered whatever the phase holds, so the button is where you
                      expect it; the action refuses and says why when work would
                      be cut loose. */}
                  {(p.tickets.length > 0 || p.loggedHours > 0) && (
                    <span className="text-xs text-muted-foreground">
                      Holds {p.tickets.length} ticket(s) and {formatHours(p.loggedHours)} — move
                      them to another phase first.
                    </span>
                  )}
                </form>
              </div>
            ) : (
              <div className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {TASK_STATUS_LABELS[p.status as keyof typeof TASK_STATUS_LABELS] ?? p.status}
                  </span>
                  {showHours && (
                    <span
                      className={`text-xs tabular-nums ${
                        p.hours != null && p.loggedHours > p.hours
                          ? "font-medium text-warning"
                          : "text-muted-foreground"
                      }`}
                    >
                      {formatHours(p.loggedHours)}
                      {p.hours != null ? ` / ${formatHours(p.hours)} sold` : " logged"}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <Link
                      // Carries the way back, so creating the ticket returns here
                      // instead of dumping you on the global ticket board.
                      href={withReturnTo(
                        `/silverfang/tickets/new?client=${clientId}&project=${projectId}&phase=${p.id}`,
                        `/silverfang/projects/${projectId}`,
                      )}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition hover:bg-accent"
                    >
                      <Ticket className="h-3.5 w-3.5" /> New project ticket
                    </Link>
                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(p.id);
                            setAdding(false);
                          }}
                          className="rounded-md border px-2 py-0.5 text-xs font-medium transition hover:bg-accent"
                        >
                          Edit
                        </button>
                        <form action={deleteAction}>
                          <button
                            type="submit"
                            name="id"
                            value={p.id}
                            title="Delete this phase"
                            aria-label={`Delete ${p.name}`}
                            className="rounded-md border border-danger/40 px-2 py-0.5 text-xs font-medium text-danger transition hover:bg-danger/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </form>
                      </>
                    )}
                  </span>
                </div>

                {p.notes && <p className="mt-1 text-xs text-muted-foreground">{p.notes}</p>}

                {p.tickets.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-t pt-2">
                    {p.tickets.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center gap-x-2 text-xs">
                        <Link
                          href={withReturnTo(
                            `/silverfang/tickets/${t.id}`,
                            `/silverfang/projects/${projectId}`,
                          )}
                          className="font-medium text-primary hover:underline"
                        >
                          #{t.number}
                        </Link>
                        <span>{t.summary}</span>
                        <span className="text-muted-foreground">· {t.status}</span>
                        <span className="text-muted-foreground">· {t.priority}</span>
                        {t.vip && (
                          <span
                            title="VIP requester"
                            className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                          >
                            VIP
                          </span>
                        )}
                        {showHours && (
                          <span className="ml-auto tabular-nums text-muted-foreground">
                            {formatHours(t.hours)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No project tickets in this phase yet.
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding && canManage && (
        <div className="rounded-md border p-3">
          <PhaseFields
            projectId={projectId}
            phase={null}
            showHours={showHours}
            action={action}
            pending={pending}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {result && (
        <p className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}
      {deleteResult && !deleteResult.ok && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {deleteResult.message}
        </p>
      )}
    </div>
  );
}

function PhaseFields({
  projectId,
  phase,
  showHours,
  action,
  pending,
  onCancel,
}: {
  projectId: string;
  phase: PhaseRow | null;
  showHours: boolean;
  action: (formData: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      {phase && <input type="hidden" name="id" value={phase.id} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block text-xs font-medium sm:col-span-2">
          Name <span className="text-danger">*</span>
          <input
            name="name"
            defaultValue={phase?.name ?? ""}
            required
            maxLength={120}
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-xs font-medium">
          Hours
          <input
            type="number"
            step="0.25"
            min="0"
            name="hours"
            defaultValue={phase?.hours ?? ""}
            className={`mt-1 ${inputCls}`}
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {showHours ? "Sold for this phase." : "Internal — never shown to the client."}
          </span>
        </label>
        <label className="block text-xs font-medium">
          Status
          <select
            name="status"
            defaultValue={phase?.status ?? "NOT_STARTED"}
            className={`mt-1 ${inputCls}`}
          >
            {Object.entries(TASK_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium sm:col-span-3">
          Notes
          <input
            name="notes"
            defaultValue={phase?.notes ?? ""}
            className={`mt-1 ${inputCls}`}
            placeholder="Optional"
          />
        </label>
        <label className="block text-xs font-medium">
          Order
          <input
            type="number"
            min="0"
            name="sortOrder"
            defaultValue={phase?.sortOrder ?? 0}
            className={`mt-1 ${inputCls}`}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {pending ? "Saving…" : phase ? "Save phase" : "Add phase"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
