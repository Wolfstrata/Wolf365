"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import {
  DEFAULT_GRID,
  assignLanes,
  daySlots,
  formatClock,
  hourMarks,
  minutesToTime,
  placeBlock,
} from "@/lib/silverfang/calendar";
import { formatHours } from "@/lib/silverfang/time";
import { saveTimeBlockAction, deleteTimeBlockAction } from "../calendar-actions";
import type { SfActionResult } from "../actions";

export interface CalendarBlock {
  id: string;
  day: string;
  startMinutes: number;
  endMinutes: number;
  hours: number;
  label: string;
  sublabel: string | null;
  billable: boolean;
  editable: boolean;
  status: string;
  chargeCodeId: string;
  ticketId: string | null;
  projectTaskId: string | null;
  agreementId: string | null;
  notes: string | null;
  internalOnly: boolean;
}

export interface CalendarOptions {
  chargeCodes: { id: string; code: string; name: string; billableDefault: boolean }[];
  tickets: { id: string; label: string }[];
  tasks: { id: string; label: string }[];
  agreements: { id: string; label: string }[];
  clients: { id: string; name: string }[];
}

interface Draft {
  id?: string;
  day: string;
  startTime: string;
  endTime: string;
}

const inputCls =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Outlook-style week grid for logging time: days across, hours down, click any
 * slot to open a block. Existing blocks are positioned by their start/end and
 * laid out side by side when they overlap, so nothing becomes unclickable.
 *
 * The grid is wall-clock in the viewer's own timezone; the offset is sent with the
 * form so the server stores the instant the person actually saw.
 */
export function WeekCalendar({
  days,
  blocks,
  options,
  weekLocked,
}: {
  days: { key: string; label: string; dateLabel: string; weekend: boolean; isToday: boolean }[];
  blocks: CalendarBlock[];
  options: CalendarOptions;
  /** True once the week is submitted or approved — no editing. */
  weekLocked: boolean;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveTimeBlockAction,
    null,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [target, setTarget] = useState<"ticket" | "task" | "agreement" | "new">("ticket");
  const formRef = useRef<HTMLFormElement>(null);
  const [offsetMinutes, setOffsetMinutes] = useState(0);

  useEffect(() => {
    // getTimezoneOffset is minutes *behind* UTC, so invert it.
    setOffsetMinutes(-new Date().getTimezoneOffset());
  }, []);

  useEffect(() => {
    if (result?.ok) {
      setDraft(null);
      formRef.current?.reset();
    }
  }, [result]);

  const slots = useMemo(() => daySlots(DEFAULT_GRID), []);
  const marks = useMemo(() => hourMarks(DEFAULT_GRID), []);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarBlock[]>();
    for (const b of blocks) {
      const list = map.get(b.day) ?? [];
      list.push(b);
      map.set(b.day, list);
    }
    return map;
  }, [blocks]);

  const openSlot = (day: string, minutes: number) => {
    if (weekLocked) return;
    setTarget("ticket");
    setDraft({
      day,
      startTime: minutesToTime(minutes),
      endTime: minutesToTime(minutes + DEFAULT_GRID.slotMinutes),
    });
  };

  const openBlock = (b: CalendarBlock) => {
    if (!b.editable || weekLocked) return;
    setTarget(
      b.ticketId ? "ticket" : b.projectTaskId ? "task" : b.agreementId ? "agreement" : "ticket",
    );
    setDraft({
      id: b.id,
      day: b.day,
      startTime: minutesToTime(b.startMinutes),
      endTime: minutesToTime(b.endMinutes),
    });
  };

  const editing = draft?.id ? blocks.find((b) => b.id === draft.id) : undefined;

  return (
    <div className="space-y-3">
      {weekLocked && (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
          This week is submitted or approved, so its blocks are read-only. Reopen it on the
          Timesheets page to make changes.
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <div className="min-w-[820px]">
          {/* Day headers */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b bg-muted/40 text-xs">
            <div className="px-2 py-2" />
            {days.map((d) => (
              <div
                key={d.key}
                className={`border-l px-2 py-2 text-center ${
                  d.isToday ? "font-semibold text-primary" : d.weekend ? "text-muted-foreground" : ""
                }`}
              >
                <div>{d.label}</div>
                <div className="text-[11px] text-muted-foreground">{d.dateLabel}</div>
              </div>
            ))}
          </div>

          {/* Grid body */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)]">
            {/* Hour gutter */}
            <div className="relative" style={{ height: `${slots.length * 28}px` }}>
              {marks.map((m) => (
                <div
                  key={m}
                  className="absolute right-1 -translate-y-1/2 text-[11px] text-muted-foreground"
                  style={{
                    top: `${((m - DEFAULT_GRID.startHour * 60) /
                      (DEFAULT_GRID.endHour * 60 - DEFAULT_GRID.startHour * 60)) * 100}%`,
                  }}
                >
                  {formatClock(m)}
                </div>
              ))}
            </div>

            {days.map((d) => {
              const dayBlocks = byDay.get(d.key) ?? [];
              const lanes = assignLanes(
                dayBlocks.map((b) => ({
                  id: b.id,
                  startMinutes: b.startMinutes,
                  endMinutes: b.endMinutes,
                })),
              );
              const laneOf = new Map(lanes.map((l) => [l.id, l]));
              return (
                <div
                  key={d.key}
                  className={`relative border-l ${d.weekend ? "bg-muted/20" : ""}`}
                  style={{ height: `${slots.length * 28}px` }}
                >
                  {/* Clickable empty slots */}
                  {slots.map((m, i) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => openSlot(d.key, m)}
                      disabled={weekLocked}
                      aria-label={`Add time on ${d.dateLabel} at ${formatClock(m)}`}
                      className={`absolute left-0 w-full border-t border-dashed border-border/50 transition hover:bg-accent/60 disabled:cursor-default disabled:hover:bg-transparent ${
                        m % 60 === 0 ? "border-solid border-border" : ""
                      }`}
                      style={{ top: `${i * 28}px`, height: "28px" }}
                    />
                  ))}

                  {/* Blocks */}
                  {dayBlocks.map((b) => {
                    const p = placeBlock(b.startMinutes, b.endMinutes, DEFAULT_GRID);
                    const lane = laneOf.get(b.id);
                    const count = lane?.laneCount ?? 1;
                    const width = 100 / count;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => openBlock(b)}
                        title={`${b.label}${b.sublabel ? ` · ${b.sublabel}` : ""} · ${formatHours(b.hours)}`}
                        className={`absolute overflow-hidden rounded-sm border px-1.5 py-0.5 text-left text-[11px] leading-tight transition hover:brightness-110 ${
                          b.billable
                            ? "border-primary/40 bg-primary/20 text-foreground"
                            : "border-border bg-muted text-muted-foreground"
                        } ${!b.editable || weekLocked ? "cursor-default opacity-80" : ""}`}
                        style={{
                          top: `${p.topPercent}%`,
                          height: `${p.heightPercent}%`,
                          left: `${(lane?.lane ?? 0) * width}%`,
                          width: `${width}%`,
                        }}
                      >
                        <span className="block truncate font-medium">{b.label}</span>
                        <span className="block truncate">
                          {formatHours(b.hours)}
                          {b.sublabel ? ` · ${b.sublabel}` : ""}
                        </span>
                        {p.clipped && <span className="block text-[10px]">↕ outside view</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {result && !draft && (
        <p className={`text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
      )}

      {/* Entry panel */}
      {draft && (
        <form ref={formRef} action={action} className="rounded-md border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {draft.id ? "Edit time block" : "New time block"} —{" "}
              {days.find((d) => d.key === draft.day)?.dateLabel ?? draft.day}
            </h3>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-accent"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {draft.id && <input type="hidden" name="id" value={draft.id} />}
          <input type="hidden" name="day" value={draft.day} />
          <input type="hidden" name="offsetMinutes" value={offsetMinutes} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block text-xs font-medium">
              Start
              <input
                type="time"
                name="startTime"
                defaultValue={draft.startTime}
                required
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium">
              End
              <input
                type="time"
                name="endTime"
                defaultValue={draft.endTime}
                required
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="block text-xs font-medium">
              Charge code
              <select
                name="chargeCodeId"
                defaultValue={editing?.chargeCodeId ?? options.chargeCodes[0]?.id ?? ""}
                required
                className={`mt-1 ${inputCls}`}
              >
                {options.chargeCodes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              Attach to
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as typeof target)}
                className={`mt-1 ${inputCls}`}
              >
                <option value="ticket">Existing ticket</option>
                <option value="new">New ticket</option>
                <option value="task">Project task</option>
                <option value="agreement">Agreement only</option>
              </select>
            </label>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {target === "ticket" && (
              <label className="block text-xs font-medium sm:col-span-2">
                Ticket
                <select
                  name="ticketId"
                  defaultValue={editing?.ticketId ?? ""}
                  className={`mt-1 ${inputCls}`}
                >
                  <option value="">Select a ticket…</option>
                  {options.tickets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {target === "new" && (
              <>
                <label className="block text-xs font-medium">
                  Client
                  <select name="newTicketClientId" required className={`mt-1 ${inputCls}`}>
                    <option value="">Select a client…</option>
                    {options.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium">
                  New ticket summary
                  <input
                    name="newTicketSummary"
                    required
                    maxLength={300}
                    placeholder="What was this work?"
                    className={`mt-1 ${inputCls}`}
                  />
                </label>
              </>
            )}

            {target === "task" && (
              <label className="block text-xs font-medium sm:col-span-2">
                Project task
                <select
                  name="projectTaskId"
                  defaultValue={editing?.projectTaskId ?? ""}
                  className={`mt-1 ${inputCls}`}
                >
                  <option value="">Select a task…</option>
                  {options.tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block text-xs font-medium sm:col-span-2">
              Agreement {target === "agreement" ? "" : "(optional override)"}
              <select
                name="agreementId"
                defaultValue={editing?.agreementId ?? ""}
                className={`mt-1 ${inputCls}`}
              >
                <option value="">
                  {target === "agreement" ? "Select an agreement…" : "Use the ticket's agreement"}
                </option>
                {options.agreements.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="mt-3 block text-xs font-medium">
            Notes
            <textarea
              name="notes"
              rows={2}
              defaultValue={editing?.notes ?? ""}
              className={`mt-1 ${inputCls}`}
            />
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="billable"
                defaultChecked={editing?.billable ?? true}
                className="h-4 w-4"
              />
              Billable
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="internalOnly"
                defaultChecked={editing?.internalOnly ?? false}
                className="h-4 w-4"
              />
              Internal notes only
            </label>
            <button
              type="submit"
              disabled={pending}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              {pending ? "Saving…" : draft.id ? "Save block" : "Log time"}
            </button>
          </div>

          {result && (
            <p className={`mt-2 text-sm ${result.ok ? "text-success" : "text-danger"}`}>
              {result.message}
            </p>
          )}
        </form>
      )}

      {draft?.id && (
        <form action={deleteTimeBlockAction}>
          <input type="hidden" name="id" value={draft.id} />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/10"
          >
            <Trash2 className="h-4 w-4" /> Delete this block
          </button>
        </form>
      )}
    </div>
  );
}
