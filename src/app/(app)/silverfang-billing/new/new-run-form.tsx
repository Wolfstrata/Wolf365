"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  createBulkSfBillingRunsAction,
  createSfBillingRunAction,
  type SfBillingActionResult,
  type SfBulkRunResult,
} from "../actions";

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export interface BillableClient {
  id: string;
  name: string;
  unbilledHours: number;
  activeAgreements: number;
  hasQbo: boolean;
}

type Scope = "single" | "multiple";

/**
 * Create one run, or one per client. The period is entered as a month by default
 * because that is how service work is billed; a custom range is there for the
 * exceptions.
 */
export function NewSfRunForm({
  clients,
  defaultClientId,
  defaultMonth,
  today,
}: {
  clients: BillableClient[];
  defaultClientId?: string;
  defaultMonth: string;
  today: string;
}) {
  const [scope, setScope] = useState<Scope>("single");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(["single", "multiple"] as Scope[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${
              scope === s ? "border-primary bg-accent" : "hover:bg-accent/60"
            }`}
          >
            {s === "single" ? "One client" : "Several clients"}
          </button>
        ))}
      </div>

      {scope === "single" ? (
        <SingleForm
          clients={clients}
          defaultClientId={defaultClientId}
          defaultMonth={defaultMonth}
          today={today}
        />
      ) : (
        <MultipleForm clients={clients} defaultMonth={defaultMonth} today={today} />
      )}
    </div>
  );
}

function PeriodFields({ defaultMonth, today }: { defaultMonth: string; today: string }) {
  const [mode, setMode] = useState<"monthly" | "custom">("monthly");
  return (
    <>
      <input type="hidden" name="mode" value={mode} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium">
          Period
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "monthly" | "custom")}
            className={`mt-1 ${inputCls}`}
          >
            <option value="monthly">A calendar month</option>
            <option value="custom">A custom range</option>
          </select>
        </label>

        {mode === "monthly" ? (
          <label className="block text-sm font-medium">
            Month
            <input type="month" name="month" defaultValue={defaultMonth} className={`mt-1 ${inputCls}`} />
          </label>
        ) : (
          <>
            <label className="block text-sm font-medium">
              From
              <input type="date" name="periodStart" className={`mt-1 ${inputCls}`} />
            </label>
            <label className="block text-sm font-medium">
              To (inclusive)
              <input type="date" name="periodEnd" className={`mt-1 ${inputCls}`} />
            </label>
          </>
        )}

        <label className="block text-sm font-medium">
          Invoice date
          <input type="date" name="invoiceDate" defaultValue={today} required className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block text-sm font-medium">
          Group hours by
          <select name="groupBy" defaultValue="CHARGE_CODE" className={`mt-1 ${inputCls}`}>
            <option value="CHARGE_CODE">Charge code (one line per service type)</option>
            <option value="TICKET">Ticket (one line per ticket)</option>
          </select>
        </label>
      </div>
    </>
  );
}

function ClientHint({ c }: { c: BillableClient }) {
  return (
    <span className="text-xs text-muted-foreground">
      {c.unbilledHours > 0 ? `${c.unbilledHours.toFixed(2)}h unbilled` : "no unbilled time"}
      {c.activeAgreements > 0 ? ` · ${c.activeAgreements} agreement(s)` : ""}
      {c.hasQbo ? "" : " · no QuickBooks customer"}
    </span>
  );
}

function SingleForm({
  clients,
  defaultClientId,
  defaultMonth,
  today,
}: {
  clients: BillableClient[];
  defaultClientId?: string;
  defaultMonth: string;
  today: string;
}) {
  const [state, action, pending] = useActionState<SfBillingActionResult | null, FormData>(
    createSfBillingRunAction,
    null,
  );
  const [clientId, setClientId] = useState(defaultClientId ?? "");
  const chosen = clients.find((c) => c.id === clientId);

  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium">
        Client <span className="text-danger">*</span>
        <select
          name="clientId"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          required
          className={`mt-1 ${inputCls}`}
        >
          <option value="">Select a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.unbilledHours > 0 ? ` — ${c.unbilledHours.toFixed(2)}h unbilled` : ""}
            </option>
          ))}
        </select>
      </label>
      {chosen && (
        <p>
          <ClientHint c={chosen} />
          {!chosen.hasQbo && (
            <span className="ml-2 text-xs text-warning">
              The run can still be generated and reviewed, but it cannot be pushed until this
              client is matched to a QuickBooks customer.
            </span>
          )}
        </p>
      )}

      <PeriodFields defaultMonth={defaultMonth} today={today} />

      {state && !state.ok && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{state.message}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Generating…" : "Generate run"}
      </button>
    </form>
  );
}

function MultipleForm({
  clients,
  defaultMonth,
  today,
}: {
  clients: BillableClient[];
  defaultMonth: string;
  today: string;
}) {
  const [state, action, pending] = useActionState<SfBulkRunResult | null, FormData>(
    createBulkSfBillingRunsAction,
    null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <form action={action} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setSelected(new Set(clients.filter((c) => c.unbilledHours > 0).map((c) => c.id)))}
          className="rounded-md border px-2.5 py-1 transition hover:bg-accent"
        >
          Select all with unbilled time
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set(clients.map((c) => c.id)))}
          className="rounded-md border px-2.5 py-1 transition hover:bg-accent"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          className="rounded-md border px-2.5 py-1 transition hover:bg-accent"
        >
          Clear
        </button>
        <span className="text-xs text-muted-foreground">{selected.size} selected</span>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-md border">
        <ul className="divide-y text-sm">
          {clients.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-1.5">
              <input
                type="checkbox"
                name="clientIds"
                value={c.id}
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                className="h-4 w-4"
              />
              <span className="font-medium">{c.name}</span>
              <span className="ml-auto">
                <ClientHint c={c} />
              </span>
            </li>
          ))}
        </ul>
      </div>

      <PeriodFields defaultMonth={defaultMonth} today={today} />

      {state && (
        <div className="space-y-2">
          <p className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>{state.message}</p>
          {state.results && state.results.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {state.results.map((r) => (
                <li key={r.clientName} className="flex flex-wrap items-center gap-3 px-3 py-1.5">
                  <span className="font-medium">{r.clientName}</span>
                  {r.ok ? (
                    <>
                      <span className="text-xs text-muted-foreground">
                        {r.lines === 0 ? "nothing to bill" : `${r.lines} line(s)`}
                      </span>
                      {r.runId && (
                        <Link
                          href={`/silverfang-billing/${r.runId}`}
                          className="ml-auto text-xs text-primary hover:underline"
                        >
                          Open run →
                        </Link>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-danger">{r.error}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={pending || selected.size === 0}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Generating…" : `Generate ${selected.size || ""} run(s)`}
      </button>
    </form>
  );
}
