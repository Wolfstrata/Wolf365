import type { CrmOpportunity } from "@prisma/client";
import type { OpportunityFormValues } from "@/app/(app)/crm/opportunity-form";
import { STAGE_PROBABILITY } from "./constants";

/** Format a Date as YYYY-MM-DD for <input type="date">, or "" when absent. */
export function toDateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

function money(d: unknown): string {
  return d == null ? "" : String(d);
}

/** Default values for a brand-new opportunity. */
export function blankFormValues(): OpportunityFormValues {
  return {
    name: "",
    accountName: "",
    monthlyAmount: "",
    monthlyMargin: "",
    termYears: 1,
    billingFrequency: "MONTHLY",
    stage: "PROSPECTING",
    probability: STAGE_PROBABILITY.PROSPECTING,
    forecastCategory: "PIPELINE",
    closeDate: "",
    estimatedInvoiceDate: "",
    cashInDate: "",
    lockbox: false,
    type: "",
    leadSource: "",
    nextStep: "",
    description: "",
  };
}

/** Map a stored opportunity into editable form values. */
export function toFormValues(o: CrmOpportunity): OpportunityFormValues {
  return {
    id: o.id,
    name: o.name,
    accountName: o.accountName,
    monthlyAmount: money(o.monthlyAmount),
    monthlyMargin: money(o.monthlyMargin),
    termYears: o.termYears,
    billingFrequency: o.billingFrequency,
    stage: o.stage,
    probability: o.probability,
    forecastCategory: o.forecastCategory,
    closeDate: toDateInput(o.closeDate),
    estimatedInvoiceDate: toDateInput(o.estimatedInvoiceDate),
    cashInDate: toDateInput(o.cashInDate),
    lockbox: o.lockbox,
    type: o.type ?? "",
    leadSource: o.leadSource ?? "",
    nextStep: o.nextStep ?? "",
    description: o.description ?? "",
  };
}
