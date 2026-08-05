"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, Timer } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/local-time";
import { formatCurrency } from "@/lib/utils";
import { formatHours } from "@/lib/silverfang/time";
import { TIME_ENTRY_STATUS_LABELS, TIME_BAND_LABELS } from "@/lib/silverfang/constants";
import type { SfTimeBand, SfTimeEntryStatus } from "@prisma/client";
import { saveTimeEntryAction, deleteTimeEntryAction, type SfActionResult } from "../../actions";

export interface TimeEntryRow {
  id: string;
  workDate: string; // ISO
  hours: number;
  chargeCode: string;
  chargeCodeId: string;
  tech: string;
  billable: boolean;
  internalOnly: boolean;
  notes: string | null;
  rate: number | null;
  amount: number | null;
  status: SfTimeEntryStatus;
  timeBand: SfTimeBand;
  editable: boolean;
}

const inputCls =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Time logged against a ticket, with an inline "log time" form. */
export function TimeCard({
  ticketId,
  entries,
  chargeCodes,
  canLog,
  totalHours,
  billableHours,
}: {
  ticketId: string;
  entries: TimeEntryRow[];
  chargeCodes: { id: string; code: string; name: string; billableDefault: boolean }[];
  canLog: boolean;
  totalHours: number;
  billableHours: number;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveTimeEntryAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (result?.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
  }, [result]);

  const today = new Date().toISOString().slice(0, 10);
  const revenue = entries.reduce((a, e) => a + (e.amount ?? 0), 0);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Timer className="h-4 w-4" /> Time ({entries.length})
        </h2>
        <span className="text-xs text-muted-foreground">
          {formatHours(totalHours)} logged · {formatHours(billableHours)} billable
          {revenue > 0 && ` · ${formatCurrency(revenue)}`}
        </span>
        {canLog && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" /> {open ? "Cancel" : "Log time"}
          </button>
        )}
      </div>

      {canLog && open && (
        <form ref={formRef} action={action} className="mb-4 rounded-md border bg-accent/30 p-3">
          <input type="hidden" name="ticketId" value={ticketId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="text-xs font-medium text-muted-foreground">
              Date
              <input type="date" name="workDate" defaultValue={today} required className={`mt-1 ${inputCls}`} />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Time
              <input
                name="hours"
                required
                placeholder="1.5, 1:30, 90m"
                className={`mt-1 ${inputCls}`}
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
              Charge code
              <select name="chargeCodeId" required className={`mt-1 ${inputCls}`}>
                {chargeCodes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground sm:col-span-4">
              Notes
              <textarea name="notes" rows={2} className={`mt-1 ${inputCls}`} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" name="billable" defaultChecked className="h-4 w-4" /> Billable
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" name="internalOnly" className="h-4 w-4" /> Internal notes only
            </label>
            <button
              type="submit"
              disabled={pending}
              className="ml-auto rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save time"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Time rounds up to the next 15 minutes. The rate is resolved from the client, agreement,
            charge code and time of day.
          </p>
        </form>
      )}

      {result && (
        <p className={`mb-3 text-sm ${result.ok ? "text-success" : "text-danger"}`}>
          {result.message}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No time logged yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1 pr-4 font-medium">Date</th>
                <th className="py-1 pr-4 font-medium">Tech</th>
                <th className="py-1 pr-4 font-medium">Code</th>
                <th className="py-1 pr-4 text-right font-medium">Hours</th>
                <th className="py-1 pr-4 text-right font-medium">Rate</th>
                <th className="py-1 pr-4 text-right font-medium">Amount</th>
                <th className="py-1 pr-4 font-medium">Status</th>
                <th className="py-1 pr-4 font-medium">Notes</th>
                {canLog && <th className="py-1 pr-4 font-medium sr-only">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t align-top">
                  <td className="py-1.5 pr-4 whitespace-nowrap">
                    <LocalTime value={e.workDate} dateOnly />
                  </td>
                  <td className="py-1.5 pr-4">{e.tech}</td>
                  <td className="py-1.5 pr-4">
                    {e.chargeCode}
                    {e.timeBand !== "ANY" && e.timeBand !== "DAY" && (
                      <span className="ml-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                        {TIME_BAND_LABELS[e.timeBand]}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{formatHours(e.hours)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {e.billable
                      ? e.rate != null
                        ? formatCurrency(e.rate)
                        : <span className="text-danger">No rate</span>
                      : <span className="text-muted-foreground">Non-billable</span>}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {e.amount != null ? formatCurrency(e.amount) : "—"}
                  </td>
                  <td className="py-1.5 pr-4">{TIME_ENTRY_STATUS_LABELS[e.status]}</td>
                  <td className="py-1.5 pr-4 text-muted-foreground">
                    {e.notes ?? "—"}
                    {e.internalOnly && (
                      <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                        internal
                      </span>
                    )}
                  </td>
                  {canLog && (
                    <td className="py-1.5 pr-4 text-right">
                      {e.editable ? (
                        <form action={deleteTimeEntryAction}>
                          <input type="hidden" name="id" value={e.id} />
                          <button className="rounded-md border px-2 py-0.5 text-xs transition hover:bg-accent">
                            Delete
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-muted-foreground">Locked</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
