"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  createBulkSfBillingRunsAction,
  createSfBillingRunAction,
  previewSfBillingRunAction,
  type SfBillingActionResult,
  type SfBulkRunResult,
  type SfPreviewResult,
} from "../actions";
import { formatCurrency } from "@/lib/utils";
import { formatHours } from "@/lib/silverfang/time";

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
  // A second action on the same form, reached from its own submit button via
  // formAction, so the preview reuses the fields already filled in rather than
  // duplicating them.
  const [preview, previewAction, previewPending] = useActionState<
    SfPreviewResult | null,
    FormData
  >(previewSfBillingRunAction, null);
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending || previewPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Generating…" : "Generate run"}
        </button>
        <button
          type="submit"
          formAction={previewAction}
          disabled={pending || previewPending}
          className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-60"
        >
          {previewPending ? "Checking…" : "Preview without creating"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        The preview creates nothing — no run, no audit trail, nothing to delete afterwards.
      </p>

      {preview && <PreviewPanel result={preview} />}
    </form>
  );
}

const PREVIEW_KIND_LABELS: Record<string, string> = {
  TIME: "Time",
  OVERAGE: "Overage",
  RECURRING: "Recurring",
  BLOCK_PURCHASE: "Block purchase",
  PROJECT_FEE: "Project fee",
  PROJECT_DEPOSIT: "Deposit",
  MANUAL: "Manual",
};

/** Why hours produced no charge. Absorbed work is normal; unpriced work is not. */
const COVERED_LABELS: Record<string, string> = {
  NOT_BILLABLE: "logged as non-billable",
  PREPAID_BLOCK: "drawn from a prepaid block",
  AGREEMENT_INCLUSION: "inside an agreement's included hours",
  FIXED_FEE_PROJECT: "on a fixed-fee project",
  NO_RATE: "no rate resolved — nobody priced these",
};

function PreviewPanel({ result }: { result: SfPreviewResult }) {
  if (!result.ok) {
    return (
      <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{result.message}</p>
    );
  }
  const p = result.preview;
  if (!p) return null;

  return (
    <div className="space-y-3 rounded-md border bg-accent/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {p.clientName} would bill {formatCurrency(p.total)}
        </p>
        <span className="text-xs text-muted-foreground">Nothing has been created.</span>
      </div>

      {p.lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Kind</th>
                <th className="py-1 pr-3 font-medium">Description</th>
                <th className="py-1 pr-3 text-right font-medium">Qty</th>
                <th className="py-1 pr-3 text-right font-medium">Unit</th>
                <th className="py-1 pr-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {p.lines.map((l, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1.5 pr-3">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {PREVIEW_KIND_LABELS[l.kind] ?? l.kind}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    {l.description}
                    {!l.hoursVisible && (
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        (hours stay internal)
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {formatCurrency(l.unitPrice)}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-medium tabular-nums">
                    {formatCurrency(l.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {p.covered.length > 0 && (
        <div className="text-xs">
          <p className="font-medium">Hours that bill nothing</p>
          <ul className="mt-1 space-y-0.5">
            {p.covered.map((c) => (
              <li
                key={c.reason}
                className={c.reason === "NO_RATE" ? "text-warning" : "text-muted-foreground"}
              >
                {formatHours(c.hours)} across {c.entries} entr{c.entries === 1 ? "y" : "ies"} —{" "}
                {COVERED_LABELS[c.reason] ?? c.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.notes.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {p.notes.map((n, i) => (
            <li
              key={i}
              className={
                n.severity === "error"
                  ? "text-danger"
                  : n.severity === "warning"
                    ? "text-warning"
                    : "text-muted-foreground"
              }
            >
              {n.message}
            </li>
          ))}
        </ul>
      )}
    </div>
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
