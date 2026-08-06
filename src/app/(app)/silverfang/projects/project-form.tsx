"use client";

import { useActionState, useState } from "react";
import { Save } from "lucide-react";
import { saveProjectAction } from "../project-actions";
import type { SfActionResult } from "../actions";
import { PROJECT_STATUS_LABELS } from "@/lib/silverfang/constants";
import { depositAmountFor, projectTotal } from "@/lib/silverfang/project-billing";
import { formatCurrency } from "@/lib/utils";

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
  contractedHours: string;
  estimatedHours: string;
  budgetAmount: string;
  billingType: string;
  fixedFeeAmount: string;
  billingIntervalDays: string;
  depositPercent: string;
  /** Set once the deposit has gone out — the amount is then frozen. */
  depositInvoiced?: boolean;
}

const BILLING_TYPE_LABELS: Record<string, string> = {
  TIME_AND_MATERIALS: "Time and materials",
  FIXED_FEE: "Fixed fee",
};

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

  // Billing type decides which money fields matter, and — critically — whether
  // hours are ever shown to the client. Kept in state so the form says which it
  // is while you are filling it in, not after saving.
  const [billingType, setBillingType] = useState(values.billingType || "TIME_AND_MATERIALS");
  const [fixedFee, setFixedFee] = useState(values.fixedFeeAmount);
  const [budget, setBudget] = useState(values.budgetAmount);
  const [depositPercent, setDepositPercent] = useState(values.depositPercent);
  const fixedFeeType = billingType === "FIXED_FEE";

  const num = (v: string) => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  };
  const total = projectTotal({
    billingType: fixedFeeType ? "FIXED_FEE" : "TIME_AND_MATERIALS",
    fixedFeeAmount: num(fixedFee),
    budgetAmount: num(budget),
  });
  const deposit = depositAmountFor(total, num(depositPercent));

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
          Contracted hours
          <input
            type="number"
            step="0.25"
            min="0"
            name="contractedHours"
            defaultValue={values.contractedHours}
            className={`mt-1 ${inputCls}`}
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            The quantity sold. Overage is measured against this.
          </span>
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
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Internal estimate — what you think it will take.
          </span>
        </label>
        <label className="block text-sm font-medium">
          Budget
          <input
            type="number"
            step="0.01"
            min="0"
            name="budgetAmount"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className={`mt-1 ${inputCls}`}
          />
          {!fixedFeeType && (
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              The project total. A deposit is a percentage of this.
            </span>
          )}
        </label>
        {isNew && (
          <label className="block text-sm font-medium">
            Phases
            <input
              type="number"
              step="1"
              min="0"
              max="50"
              name="phaseCount"
              defaultValue="3"
              className={`mt-1 ${inputCls}`}
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Created as Phase 1, Phase 2… and renamable. Contracted hours are split
              across them; adjust each phase afterwards.
            </span>
          </label>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-md border p-3 sm:grid-cols-4">
        <label className="block text-sm font-medium sm:col-span-2">
          Billing <span className="text-danger">*</span>
          <select
            name="billingType"
            value={billingType}
            onChange={(e) => setBillingType(e.target.value)}
            className={`mt-1 ${inputCls}`}
          >
            {Object.entries(BILLING_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {fixedFeeType
              ? "Hours are still tracked in full internally, but never shown to the client — they see the fee only."
              : "Hours are billed as worked and are shown to the client."}
          </span>
        </label>

        {fixedFeeType && (
          <>
            <label className="block text-sm font-medium">
              Fixed fee <span className="text-danger">*</span>
              <input
                type="number"
                step="0.01"
                min="0"
                name="fixedFeeAmount"
                value={fixedFee}
                onChange={(e) => setFixedFee(e.target.value)}
                className={`mt-1 ${inputCls}`}
              />
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                Billed each interval below.
              </span>
            </label>
            <label className="block text-sm font-medium">
              Billing interval (days)
              <input
                type="number"
                step="1"
                min="1"
                name="billingIntervalDays"
                defaultValue={values.billingIntervalDays || "30"}
                className={`mt-1 ${inputCls}`}
              />
            </label>
          </>
        )}

        <label className="block text-sm font-medium">
          Deposit %
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            name="depositPercent"
            value={depositPercent}
            onChange={(e) => setDepositPercent(e.target.value)}
            disabled={values.depositInvoiced}
            className={`mt-1 ${inputCls} disabled:opacity-60`}
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {values.depositInvoiced
              ? "The deposit has been invoiced, so its percentage is locked."
              : deposit != null
                ? `${formatCurrency(deposit)} up front.`
                : "Percentage of the total, invoiced up front. Leave blank for none."}
          </span>
        </label>
      </div>

      {fixedFeeType && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          On a fixed-fee project, hours are internal. Nothing client-facing will show them —
          the client sees the fee.
        </p>
      )}

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
