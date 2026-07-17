"use client";

import { useActionState, useState } from "react";
import type { CrmLine } from "@prisma/client";
import { cn } from "@/lib/utils";
import {
  CRM_LINES,
  CRM_LINE_ORDER,
  STAGE_ORDER,
  STAGE_LABELS,
  STAGE_PROBABILITY,
  FORECAST_CATEGORY_LABELS,
  BILLING_FREQUENCY_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  TERM_YEARS_OPTIONS,
  forecastCategoryForProbability,
} from "@/lib/crm/constants";
import { computeMarginPercentage } from "@/lib/crm/forecast";
import { totalContractValue } from "@/lib/crm/pricing";
import { formatCurrency } from "@/lib/utils";
import type { OpportunityActionResult } from "./actions";

export interface OpportunityFormValues {
  id?: string;
  name: string;
  accountName: string;
  monthlyAmount: string;
  monthlyMargin: string;
  /** One-time deal amount + dollar margin — used for the Products line. */
  amount: string;
  marginAmount: string;
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
  line: initialLine,
  lineSlug,
  ownerName,
  values,
  saveAction,
}: Props) {
  const [result, action, pending] = useActionState(saveAction, null);

  // Line / category is editable so a user can manually re-categorize an
  // opportunity (e.g. after name-based auto-routing on import).
  const [line, setLine] = useState<CrmLine>(initialLine);
  const lineLabel = CRM_LINES[line].label;
  const allowYearly = CRM_LINES[line].billing === "MONTHLY_OR_YEARLY";

  const [stage, setStage] = useState(values.stage);
  const [probability, setProbability] = useState(values.probability);
  const [forecastCategory, setForecastCategory] = useState(values.forecastCategory);
  const [monthlyAmount, setMonthlyAmount] = useState(values.monthlyAmount);
  const [monthlyMargin, setMonthlyMargin] = useState(values.monthlyMargin);
  const [termYears, setTermYears] = useState(values.termYears);

  // Products can be sold one-time (a flat Amount + dollar Margin Amount, mirroring
  // the Salesforce Product opportunity) OR as MRR (like the service lines). The
  // rep picks which. Existing rows infer the mode: a stored MRR ⇒ recurring, else
  // one-time.
  const isProduct = line === "PRODUCTS";
  const [amount, setAmount] = useState(values.amount);
  const [marginAmount, setMarginAmount] = useState(values.marginAmount);
  const [productMode, setProductMode] = useState<"onetime" | "mrr">(
    Number(values.monthlyAmount) > 0 ? "mrr" : "onetime",
  );
  const productOneTime = isProduct && productMode === "onetime";
  const productMarginPct = computeMarginPercentage(
    Number(amount) || 0,
    Number(marginAmount) || 0,
  );

  // Stage and probability drive the forecast category (Closed / Commit / Best
  // Case / Open Pipeline). Both are still editable afterwards.
  function onStageChange(next: keyof typeof STAGE_LABELS) {
    const prob = STAGE_PROBABILITY[next];
    setStage(next);
    setProbability(prob);
    setForecastCategory(forecastCategoryForProbability(next, prob));
  }

  function onProbabilityChange(prob: number) {
    setProbability(prob);
    setForecastCategory(forecastCategoryForProbability(stage, prob));
  }

  // Changing the term is ambiguous for money: keep the MRR (contract value
  // changes) or keep the contract value (MRR changes)? Ask instead of guessing.
  // `from` anchors to the term the current MRR was entered against, even if the
  // user flips the select several times before deciding.
  const [termPrompt, setTermPrompt] = useState<{ from: number; to: number } | null>(null);

  function onTermChange(next: number) {
    const prev = termYears;
    setTermYears(next);
    const anchor = termPrompt?.from ?? prev;
    if (next !== anchor && (Number(monthlyAmount) || 0) > 0) {
      setTermPrompt({ from: anchor, to: next });
    } else {
      setTermPrompt(null); // back to the original term, or no MRR to adjust
    }
  }

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  /** Keep the total contract value: rescale MRR (and margin) to the new term. */
  function recalcMrrForTerm() {
    if (!termPrompt) return;
    const factor = termPrompt.from / termPrompt.to;
    const amt = Number(monthlyAmount) || 0;
    if (amt > 0) setMonthlyAmount(String(round2(amt * factor)));
    const mgn = Number(monthlyMargin) || 0;
    if (mgn > 0) setMonthlyMargin(String(round2(mgn * factor)));
    setTermPrompt(null);
  }

  const mrr = Number(monthlyAmount) || 0;
  const marginPct = computeMarginPercentage(mrr, Number(monthlyMargin) || 0);
  const tcv = totalContractValue(mrr, termYears);
  // Preview for the term prompt: what MRR becomes if the contract value is kept.
  const promptMrr = termPrompt ? round2(mrr * (termPrompt.from / termPrompt.to)) : 0;
  const promptTcv = termPrompt ? totalContractValue(mrr, termPrompt.from) : 0;

  return (
    <form action={action} className="space-y-8">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {(!allowYearly || productOneTime) && (
        <input type="hidden" name="billingFrequency" value="MONTHLY" />
      )}
      {/* Pricing mode drives how the server interprets the money fields. */}
      {isProduct && <input type="hidden" name="pricingMode" value={productMode} />}
      {/* One-time products have no term; keep the required field satisfied. */}
      {productOneTime && <input type="hidden" name="termYears" value={1} />}

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
          <Field
            label="Line / Category"
            required
            help="Move this opportunity to another category. Imports auto-route by name; changing it here keeps your choice."
          >
            <select
              name="line"
              value={line}
              onChange={(e) => setLine(e.target.value as CrmLine)}
              className={inputCls}
            >
              {CRM_LINE_ORDER.map((l) => (
                <option key={l} value={l}>
                  {CRM_LINES[l].label}
                </option>
              ))}
            </select>
          </Field>
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

          {isProduct && (
            <Field
              label="Pricing"
              required
              help="Choose one-time (a flat price) or recurring monthly revenue."
            >
              <select
                value={productMode}
                onChange={(e) => setProductMode(e.target.value as "onetime" | "mrr")}
                className={inputCls}
              >
                <option value="onetime">One-time</option>
                <option value="mrr">Monthly (MRR)</option>
              </select>
            </Field>
          )}

          {productOneTime ? (
            <>
              <Field label="Amount" help="One-time deal amount (price).">
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Margin Amount" help="Gross margin in dollars.">
                <input
                  name="marginAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={marginAmount}
                  onChange={(e) => setMarginAmount(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Margin Percentage" help="Margin ÷ amount. Calculated.">
                <div className="px-1 py-2 text-sm font-medium tabular-nums">
                  {productMarginPct.toFixed(2)}%
                </div>
              </Field>
            </>
          ) : (
            <>
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
                  onChange={(e) => onTermChange(Number(e.target.value))}
                  className={inputCls}
                >
                  {TERM_YEARS_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      {y} year{y > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
                {termPrompt && (
                  <div className="mt-2 space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                    <p>
                      Term changed from {termPrompt.from} to {termPrompt.to} year
                      {termPrompt.to > 1 ? "s" : ""}. Keep the total contract value at{" "}
                      <strong>{formatCurrency(promptTcv)}</strong> by recalculating MRR{" "}
                      {formatCurrency(mrr)} → <strong>{formatCurrency(promptMrr)}</strong>
                      /mo, or keep the MRR (contract value becomes{" "}
                      {formatCurrency(tcv)})?
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={recalcMrrForTerm}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
                      >
                        Recalculate MRR (keep contract value)
                      </button>
                      <button
                        type="button"
                        onClick={() => setTermPrompt(null)}
                        className="rounded-md border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
                      >
                        Keep MRR
                      </button>
                    </div>
                  </div>
                )}
              </Field>
              <Field
                label="Billing Frequency"
                required
                help={
                  allowYearly
                    ? "Can bill monthly or yearly."
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
            </>
          )}

          <Field label="Next Step">
            <input name="nextStep" defaultValue={values.nextStep} className={inputCls} />
          </Field>

          <Field label="Close Date" required>
            <input
              name="closeDate"
              type="date"
              defaultValue={values.closeDate}
              className={inputCls}
              required
            />
          </Field>
          <Field
            label="Probability (%)"
            help="100 = Closed (PO) · 99 = Commit · 75+ = Best Case · 0–74 = Open Pipeline."
          >
            <input
              name="probability"
              type="number"
              min="0"
              max="100"
              value={probability}
              onChange={(e) => onProbabilityChange(Number(e.target.value))}
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
