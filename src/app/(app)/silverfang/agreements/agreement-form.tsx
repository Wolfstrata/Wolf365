"use client";

import { useActionState, useState } from "react";
import { Save } from "lucide-react";
import { saveAgreementAction } from "../agreement-actions";
import type { SfActionResult } from "../actions";
import { AGREEMENT_STATUS_LABELS, AGREEMENT_TYPE_LABELS } from "@/lib/silverfang/constants";

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export interface AgreementFormValues {
  id?: string;
  clientId: string;
  name: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  autoRenew: boolean;
  billingFrequency: string;
  monthlyAmount: string;
  includedHours: string;
  overageRate: string;
  standardRate: string;
  notes: string;
}

/**
 * Create/edit an agreement. Which money fields matter depends on the type, so the
 * form shows only the relevant ones — a block-time agreement has no monthly
 * amount, and prompting for one invites nonsense data.
 */
export function AgreementForm({
  values,
  clients,
  submitLabel,
}: {
  values: AgreementFormValues;
  clients: { id: string; name: string }[];
  submitLabel: string;
}) {
  const [result, action, pending] = useActionState<SfActionResult | null, FormData>(
    saveAgreementAction,
    null,
  );
  const [type, setType] = useState(values.type);

  const recurring = type === "MANAGED_SERVICES" || type === "MANAGED_NOC";
  const blockTime = type === "BLOCK_TIME";

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
            placeholder="e.g. Managed Services — 2026"
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-sm font-medium">
          Type <span className="text-danger">*</span>
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={`mt-1 ${inputCls}`}
          >
            {Object.entries(AGREEMENT_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Status <span className="text-danger">*</span>
          <select name="status" defaultValue={values.status} className={`mt-1 ${inputCls}`}>
            {Object.entries(AGREEMENT_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Only an Active agreement is offered on tickets and time.
          </span>
        </label>
        <label className="block text-sm font-medium">
          Start date <span className="text-danger">*</span>
          <input
            type="date"
            name="startDate"
            defaultValue={values.startDate}
            required
            className={`mt-1 ${inputCls}`}
          />
        </label>
        <label className="block text-sm font-medium">
          End date
          <input
            type="date"
            name="endDate"
            defaultValue={values.endDate}
            className={`mt-1 ${inputCls}`}
          />
        </label>
      </div>

      {recurring && (
        <div className="grid grid-cols-1 gap-4 rounded-md border p-3 sm:grid-cols-4">
          <label className="block text-sm font-medium">
            Billing frequency
            <select
              name="billingFrequency"
              defaultValue={values.billingFrequency || "MONTHLY"}
              className={`mt-1 ${inputCls}`}
            >
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            Recurring amount
            <input
              type="number"
              step="0.01"
              min="0"
              name="monthlyAmount"
              defaultValue={values.monthlyAmount}
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <label className="block text-sm font-medium">
            Included hours
            <input
              type="number"
              step="0.25"
              min="0"
              name="includedHours"
              defaultValue={values.includedHours}
              className={`mt-1 ${inputCls}`}
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Per period, before overage.
            </span>
          </label>
          <label className="block text-sm font-medium">
            Overage rate
            <input
              type="number"
              step="0.01"
              min="0"
              name="overageRate"
              defaultValue={values.overageRate}
              className={`mt-1 ${inputCls}`}
            />
          </label>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Standard rate
          <input
            type="number"
            step="0.01"
            min="0"
            name="standardRate"
            defaultValue={values.standardRate}
            className={`mt-1 ${inputCls}`}
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Used when no rate rule matches. Without it, and without a rule, logged time has no
            value.
          </span>
        </label>
        <label className="mt-6 inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="autoRenew"
            defaultChecked={values.autoRenew}
            className="h-4 w-4"
          />
          Auto-renew at the end date
        </label>
      </div>

      <label className="block text-sm font-medium">
        Notes
        <textarea name="notes" defaultValue={values.notes} rows={3} className={`mt-1 ${inputCls}`} />
      </label>

      {blockTime && !values.id && (
        <div className="grid grid-cols-1 gap-4 rounded-md border border-primary/30 bg-primary/5 p-3 sm:grid-cols-4">
          <label className="block text-sm font-medium">
            Purchased hours
            <input
              type="number"
              step="0.25"
              min="0.25"
              name="initialHours"
              placeholder="e.g. 40"
              className={`mt-1 ${inputCls}`}
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              The quantity bought, in hours.
            </span>
          </label>
          <label className="block text-sm font-medium">
            Hourly rate
            <input
              type="number"
              step="0.01"
              min="0"
              name="initialRate"
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <label className="block text-sm font-medium">
            Amount invoiced
            <input
              type="number"
              step="0.01"
              min="0"
              name="initialAmount"
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <label className="block text-sm font-medium">
            Hours expire
            <input type="date" name="initialExpiresAt" className={`mt-1 ${inputCls}`} />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-4">
            These hours become the agreement&rsquo;s opening block, so its balance is real as soon
            as it exists. Add further blocks later as the client tops up. Time is drawn
            soonest-to-expire first, and anything beyond the balance is reported as overage
            rather than pushing a block negative.
          </p>
        </div>
      )}

      {blockTime && values.id && (
        <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
          Prepaid hours are managed as blocks below — each top-up is its own block so the
          drawdown ledger stays reconcilable.
        </p>
      )}

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
