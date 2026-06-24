"use client";

import { useActionState, useState } from "react";
import type { CrmLine } from "@prisma/client";
import { cn } from "@/lib/utils";
import {
  STAGE_ORDER,
  STAGE_LABELS,
  STAGE_PROBABILITY,
  FORECAST_CATEGORY_LABELS,
  BILLING_FREQUENCY_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  TERM_YEARS_OPTIONS,
  defaultForecastCategory,
} from "@/lib/crm/constants";
import { computeMarginPercentage } from "@/lib/crm/forecast";
import {
  totalContractValue,
  commissionAmount,
  lineHasCommission,
  COMMISSION_MONTHS,
} from "@/lib/crm/pricing";
import { formatCurrency } from "@/lib/utils";
import type { OpportunityActionResult } from "./actions";

export interface OpportunityFormValues {
  id?: string;
  name: string;
  accountName: string;
  monthlyAmount: string;
  monthlyMargin: string;
  termYears: number;
  billingFrequency: "MONTHLY" | "YEARLY";
  stage: keyof typeof STAGE_LABELS;
  probability: number;
  forecastCategory: keyof typeof FORECAST_CATEGORY_LABELS;
  closeDate: string;
  estimatedInvoiceDate: string;
  cashInDate: string;
  lockbox: boolean;
  type: string;
  leadSource: string;
  nextStep: string;
  description: string;
}

interface Props {
  line: CrmLine;
  lineSlug: string;
  lineLabel: string;
  allowYearly: boolean;
  ownerName: string;
  values: OpportunityFormValues;
  saveAction: (
    prev: OpportunityActionResult | null,
    formData: FormData,
  ) => Promise<OpportunityActionResult>;
}

function Field({
  label,
  required,
  children,
  help,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">
        {required && <span className="text-danger">* </span>}
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function OpportunityForm({
  line,
  lineSlug,
  lineLabel,
  allowYearly,
  ownerName,
  values,
  saveAction,
}: Props) {
  const [result, action, pending] = useActionState(saveAction, null);

  const [stage, setStage] = useState(values.stage);
  const [probability, setProbability] = useState(values.probability);
  const [forecastCategory, setForecastCategory] = useState(values.forecastCategory);
  const [monthlyAmount, setMonthlyAmount] = useState(values.monthlyAmount);
  const [monthlyMargin, setMonthlyMargin] = useState(values.monthlyMargin);
  const [termYears, setTermYears] = useState(values.termYears);

  // When the stage changes, suggest the matching probability + forecast
  // category (still editable afterwards).
  function onStageChange(next: keyof typeof STAGE_LABELS) {
    setStage(next);
    setProbability(STAGE_PROBABILITY[next]);
    setForecastCategory(defaultForecastCategory(next));
  }

  const mrr = Number(monthlyAmount) || 0;
  const marginPct = computeMarginPercentage(mrr, Number(monthlyMargin) || 0);
  const tcv = totalContractValue(mrr, termYears);
  const showCommission = lineHasCommission(line);
  const commission = commissionAmount(line, termYears, mrr);

  return (
    <form action={action} className="space-y-8">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <input type="hidden" name="line" value={line} />
      {!allowYearly && <input type="hidden" name="billingFrequency" value="MONTHLY" />}

      {result && !result.ok && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {result.message}
        </p>
      )}

      <section>
        <h2 className="mb-4 border-b pb-2 text-sm font-semibold">
          Opportunity Information
        </h2>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
          <Field label="Account Name" required>
            <input
              name="accountName"
              defaultValue={values.accountName}
              placeholder="Prospect / company name"
              className={inputCls}
              required
            />
          </Field>
          <Field label="Opportunity Owner">
            <div className="px-1 py-2 text-sm">{ownerName}</div>
          </Field>

          <Field label="Opportunity Name" required>
            <input
              name="name"
              defaultValue={values.name}
              placeholder={`${lineLabel} — `}
              className={inputCls}
              required
            />
          </Field>
          <Field
            label="Forecast Category"
            required
            help="Where this deal sits in your forecast."
          >
            <select
              name="forecastCategory"
              value={forecastCategory}
              onChange={(e) =>
                setForecastCategory(e.target.value as typeof forecastCategory)
              }
              className={inputCls}
            >
              {Object.entries(FORECAST_CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Monthly Amount (MRR)"
            help="Monthly recurring revenue for this deal. TCV is derived from this and the term."
          >
            <input
              name="monthlyAmount"
              type="number"
              step="0.01"
              min="0"
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field
            label="Total Contract Value"
            help="MRR × 12 × term. Calculated."
          >
            <div className="px-1 py-2 text-sm font-medium tabular-nums">
              {formatCurrency(tcv)}
            </div>
          </Field>

          <Field label="Monthly Margin Amount">
            <input
              name="monthlyMargin"
              type="number"
              step="0.01"
              min="0"
              value={monthlyMargin}
              onChange={(e) => setMonthlyMargin(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Margin Percentage" help="Margin ÷ MRR. Calculated.">
            <div className="px-1 py-2 text-sm font-medium tabular-nums">
              {marginPct.toFixed(2)}%
            </div>
          </Field>

          <Field label="Term" required help="Length of the agreement.">
            <select
              name="termYears"
              value={termYears}
              onChange={(e) => setTermYears(Number(e.target.value))}
              className={inputCls}
            >
              {TERM_YEARS_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y} year{y > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Billing Frequency"
            required
            help={
              allowYearly
                ? "Microsoft 365 can bill monthly or yearly."
                : `${lineLabel} is billed monthly only.`
            }
          >
            {allowYearly ? (
              <select
                name="billingFrequency"
                defaultValue={values.billingFrequency}
                className={inputCls}
              >
                {Object.entries(BILLING_FREQUENCY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            ) : (
              <div className="px-1 py-2 text-sm">Monthly</div>
            )}
          </Field>

          {showCommission && (
            <>
              <Field
                label="Commission"
                help={`${lineLabel}: ${COMMISSION_MONTHS[termYears] ?? 0} month${(COMMISSION_MONTHS[termYears] ?? 0) === 1 ? "" : "s"} of MRR for a ${termYears}-year term. Calculated.`}
              >
                <div className="px-1 py-2 text-sm font-medium tabular-nums">
                  {formatCurrency(commission)}
                </div>
              </Field>
              <Field label="Next Step">
                <input name="nextStep" defaultValue={values.nextStep} className={inputCls} />
              </Field>
            </>
          )}
          {!showCommission && (
            <Field label="Next Step">
              <input name="nextStep" defaultValue={values.nextStep} className={inputCls} />
            </Field>
          )}

          <Field label="Close Date" required>
            <input
              name="closeDate"
              type="date"
              defaultValue={values.closeDate}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Probability (%)" help="Defaults from stage; editable.">
            <input
              name="probability"
              type="number"
              min="0"
              max="100"
              value={probability}
              onChange={(e) => setProbability(Number(e.target.value))}
              className={inputCls}
            />
          </Field>

          <Field label="Stage" required>
            <select
              name="stage"
              value={stage}
              onChange={(e) => onStageChange(e.target.value as typeof stage)}
              className={inputCls}
            >
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Estimated Invoice Date">
            <input
              name="estimatedInvoiceDate"
              type="date"
              defaultValue={values.estimatedInvoiceDate}
              className={inputCls}
            />
          </Field>

          <Field label="Cash in Date">
            <input
              name="cashInDate"
              type="date"
              defaultValue={values.cashInDate}
              className={inputCls}
            />
          </Field>
          <Field label="Lockbox">
            <label className="flex items-center gap-2 py-2 text-sm">
              <input
                name="lockbox"
                type="checkbox"
                defaultChecked={values.lockbox}
                className="h-4 w-4 rounded border"
              />
              Payment handled via lockbox
            </label>
          </Field>
        </div>
      </section>

      <section>
        <h2 className="mb-4 border-b pb-2 text-sm font-semibold">
          Additional Information
        </h2>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
          <Field label="Type">
            <select name="type" defaultValue={values.type} className={inputCls}>
              <option value="">--None--</option>
              {Object.entries(OPPORTUNITY_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lead Source">
            <input name="leadSource" defaultValue={values.leadSource} className={inputCls} />
          </Field>
        </div>
      </section>

      <section>
        <h2 className="mb-4 border-b pb-2 text-sm font-semibold">
          Description Information
        </h2>
        <Field label="Description">
          <textarea
            name="description"
            defaultValue={values.description}
            rows={4}
            className={inputCls}
          />
        </Field>
      </section>

      <div className="flex items-center justify-end gap-3 border-t pt-4">
        <a
          href={`/crm/${lineSlug}`}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60",
          )}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
