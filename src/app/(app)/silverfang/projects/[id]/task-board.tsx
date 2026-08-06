"use client";

import { useActionState, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { saveProjectTaskAction, deleteProjectTaskAction } from "../../project-actions";
import type { SfActionResult } from "../../actions";
import { TASK_STATUS_LABELS } from "@/lib/silverfang/constants";
import { formatHours } from "@/lib/silverfang/time";

const inputCls =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export interface TaskRow {
  id: string;
  /** Structured phase, when the task belongs to one. */
  projectPhaseId: string | null;
  phaseName: string | null;
  /** Legacy free-text phase, kept for tasks (and templates) that predate phases. */
  phase: string | null;
  name: string;
  status: string;
  assigneeId: string | null;
  assignee: string | null;
  estimatedHours: number | null;
  actualHours: number;
  dueDate: string | null;
  sortOrder: number;
  hasTime: boolean;
}

/**
 * Project task list, grouped by phase. Each row edits in place — a task list is
 * worked through rather than navigated, so a separate page per task would be
 * friction with no benefit.
 */
export function TaskBoard({
  projectId,
  tasks,
  users,
  phases: projectPhases,
  canManage,
}: {
  projectId: string;
  tasks: TaskRow[];
  users: { id: string; name: string | null; email: string }[];
  phases: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveProjectTaskAction,
    null,
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Group under the structured phase when the task has one, falling back to the
  // legacy free-text phase so nothing disappears from view.
  const groupOf = (t: TaskRow) => t.phaseName ?? t.phase ?? "";
  const phases = Array.from(new Set(tasks.map(groupOf)));
  const totalEstimated = tasks.reduce((a, t) => a + (t.estimatedHours ?? 0), 0);
  const totalActual = tasks.reduce((a, t) => a + t.actualHours, 0);
  const done = tasks.filter((t) => t.status === "COMPLETED").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span>
          {done} of {tasks.length} complete
        </span>
        <span>
          {formatHours(totalActual)} logged of {formatHours(totalEstimated)} estimated
        </span>
        {totalEstimated > 0 && totalActual > totalEstimated && (
          <span className="font-medium text-warning">
            Over estimate by {formatHours(totalActual - totalEstimated)}
          </span>
        )}
        {canManage && !adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setEditing(null);
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition hover:bg-accent"
          >
            <Plus className="h-4 w-4" /> Add task
          </button>
        )}
      </div>

      {tasks.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          No tasks yet. Add them here, or create the project from a template next time to get a
          standard list.
        </p>
      )}

      {phases.map((phase) => {
        const inPhase = tasks.filter((t) => groupOf(t) === phase);
        if (inPhase.length === 0) return null;
        return (
          <div key={phase || "_none"}>
            {phase && (
              <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                {phase}
              </h3>
            )}
            <ul className="space-y-1">
              {inPhase.map((t) =>
                editing === t.id && canManage ? (
                  <li key={t.id} className="rounded-md border p-3">
                    <TaskFields
                      projectId={projectId}
                      task={t}
                      users={users}
                      phases={projectPhases}
                      action={action}
                      pending={pending}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                ) : (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-1.5 text-sm"
                  >
                    <span
                      className={`font-medium ${t.status === "COMPLETED" ? "text-muted-foreground line-through" : ""}`}
                    >
                      {t.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] ?? t.status}
                    </span>
                    {t.assignee && (
                      <span className="text-xs text-muted-foreground">· {t.assignee}</span>
                    )}
                    {t.dueDate && (
                      <span className="text-xs text-muted-foreground">· due {t.dueDate}</span>
                    )}
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {formatHours(t.actualHours)}
                      {t.estimatedHours != null ? ` / ${formatHours(t.estimatedHours)}` : ""}
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(t.id);
                          setAdding(false);
                        }}
                        className="rounded-md border px-2 py-0.5 text-xs font-medium transition hover:bg-accent"
                      >
                        Edit
                      </button>
                    )}
                  </li>
                ),
              )}
            </ul>
          </div>
        );
      })}

      {adding && canManage && (
        <div className="rounded-md border p-3">
          <TaskFields
            projectId={projectId}
            task={null}
            users={users}
            phases={projectPhases}
            action={action}
            pending={pending}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {result && (
        <p className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}
    </div>
  );
}

function TaskFields({
  projectId,
  task,
  users,
  phases,
  action,
  pending,
  onCancel,
}: {
  projectId: string;
  task: TaskRow | null;
  users: { id: string; name: string | null; email: string }[];
  phases: { id: string; name: string }[];
  action: (formData: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      {task && <input type="hidden" name="id" value={task.id} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {phases.length > 0 ? (
          <label className="block text-xs font-medium">
            Phase
            <select
              name="projectPhaseId"
              defaultValue={task?.projectPhaseId ?? ""}
              className={`mt-1 ${inputCls}`}
            >
              <option value="">No phase</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block text-xs font-medium">
            Phase
            <input
              name="phase"
              defaultValue={task?.phase ?? ""}
              className={`mt-1 ${inputCls}`}
              placeholder="Optional"
            />
          </label>
        )}
        <label className="block text-xs font-medium sm:col-span-2">
          Task <span className="text-danger">*</span>
          <input
            name="name"
            defaultValue={task?.name ?? ""}
            required
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-xs font-medium">
          Status
          <select
            name="status"
            defaultValue={task?.status ?? "NOT_STARTED"}
            className={`mt-1 ${inputCls}`}
          >
            {Object.entries(TASK_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium">
          Assignee
          <select
            name="assigneeId"
            defaultValue={task?.assigneeId ?? ""}
            className={`mt-1 ${inputCls}`}
          >
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium">
          Est. hours
          <input
            type="number"
            step="0.25"
            min="0"
            name="estimatedHours"
            defaultValue={task?.estimatedHours ?? ""}
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-xs font-medium">
          Due
          <input
            type="date"
            name="dueDate"
            defaultValue={task?.dueDate ?? ""}
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-xs font-medium">
          Order
          <input
            type="number"
            min="0"
            name="sortOrder"
            defaultValue={task?.sortOrder ?? 0}
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
          {pending ? "Saving…" : task ? "Save task" : "Add task"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
        >
          Cancel
        </button>
        {task && !task.hasTime && (
          <span className="ml-auto text-xs text-muted-foreground">
            No time logged, so this task can still be deleted.
          </span>
        )}
      </div>
      {task && !task.hasTime && (
        <DeleteTask id={task.id} />
      )}
    </form>
  );
}

/** Separate form so deleting isn't nested inside the save form. */
function DeleteTask({ id }: { id: string }) {
  return (
    <span className="block">
      <button
        type="submit"
        formAction={deleteProjectTaskAction}
        name="id"
        value={id}
        className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger/10"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete task
      </button>
    </span>
  );
}
