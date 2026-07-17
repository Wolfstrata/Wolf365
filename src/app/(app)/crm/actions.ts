"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  CrmLine,
  CrmStage,
  CrmForecastCategory,
  CrmBillingFrequency,
  CrmOpportunityType,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";
import {
  CRM_LINES,
  STAGE_PROBABILITY,
  ALL_LOCKABLE_COLUMNS,
} from "@/lib/crm/constants";
import { computeMarginPercentage } from "@/lib/crm/forecast";
import { totalContractValue, commissionAmount } from "@/lib/crm/pricing";

export interface OpportunityActionResult {
  ok: boolean;
  message: string;
  /** Slug of the line to return to on success (for redirect by the caller). */
  lineSlug?: string;
}

// Coerce an empty string to undefined so optional fields stay null.
const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const numberish = z.preprocess(
  emptyToUndefined,
  z.coerce.number().nonnegative().optional(),
);
const dateish = z.preprocess(
  emptyToUndefined,
  z.coerce.date().optional(),
);

const schema = z.object({
  id: z.preprocess(emptyToUndefined, z.string().optional()),
  line: z.enum(CrmLine),
  name: z.string().trim().min(1, "Opportunity Name is required"),
  accountName: z.string().trim().min(1, "Account Name is required"),
  monthlyAmount: numberish,
  monthlyMargin: numberish,
  // One-time Products: a flat amount + dollar margin (see pricingMode).
  amount: numberish,
  marginAmount: numberish,
  pricingMode: z.preprocess(emptyToUndefined, z.enum(["onetime", "mrr"]).optional()),
  termYears: z.coerce.number().int().refine((n) => [1, 2, 3].includes(n), {
    message: "Term must be 1, 2 or 3 years",
  }),
  billingFrequency: z.enum(CrmBillingFrequency),
  stage: z.enum(CrmStage),
  probability: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(100).optional(),
  ),
  forecastCategory: z.enum(CrmForecastCategory),
  closeDate: z.coerce.date({ message: "Close Date is required" }),
  estimatedInvoiceDate: dateish,
  cashInDate: dateish,
  lockbox: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  type: z.preprocess(emptyToUndefined, z.enum(CrmOpportunityType).optional()),
  leadSource: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  nextStep: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  description: z.preprocess(emptyToUndefined, z.string().trim().optional()),
});

function parse(formData: FormData) {
  return schema.parse({
    id: formData.get("id"),
    line: formData.get("line"),
    name: formData.get("name"),
    accountName: formData.get("accountName"),
    monthlyAmount: formData.get("monthlyAmount"),
    monthlyMargin: formData.get("monthlyMargin"),
    amount: formData.get("amount"),
    marginAmount: formData.get("marginAmount"),
    pricingMode: formData.get("pricingMode"),
    termYears: formData.get("termYears"),
    billingFrequency: formData.get("billingFrequency"),
    stage: formData.get("stage"),
    probability: formData.get("probability"),
    forecastCategory: formData.get("forecastCategory"),
    closeDate: formData.get("closeDate"),
    estimatedInvoiceDate: formData.get("estimatedInvoiceDate"),
    cashInDate: formData.get("cashInDate"),
    lockbox: formData.get("lockbox"),
    type: formData.get("type"),
    leadSource: formData.get("leadSource"),
    nextStep: formData.get("nextStep"),
    description: formData.get("description"),
  });
}

/** Save (create or update) an opportunity, then redirect to its line list. */
export async function saveOpportunityAction(
  _prev: OpportunityActionResult | null,
  formData: FormData,
): Promise<OpportunityActionResult> {
  const actor = await requirePermission("crm:write");
  let lineSlug: string | undefined;
  try {
    const data = parse(formData);

    // Enforce the per-line billing rule: only M365 may bill yearly.
    if (
      CRM_LINES[data.line].billing === "MONTHLY_ONLY" &&
      data.billingFrequency !== "MONTHLY"
    ) {
      return {
        ok: false,
        message: `${CRM_LINES[data.line].label} is billed monthly only.`,
      };
    }

    lineSlug = CRM_LINES[data.line].slug;
    const probability = data.probability ?? STAGE_PROBABILITY[data.stage];

    // Money can be entered two ways:
    //  • One-time Products: a flat Amount + dollar Margin Amount (no MRR/term).
    //  • Everything else (incl. recurring Products): monthly figures × term,
    //    from which TCV, contract margin, margin % and commission are derived.
    const isOneTimeProduct =
      data.line === "PRODUCTS" && data.pricingMode === "onetime";

    let money: {
      monthlyAmount: number | null;
      monthlyMargin: number | null;
      amount: number | null;
      marginAmount: number | null;
      marginPercentage: number;
      commissionAmount: number | null;
    };
    if (isOneTimeProduct) {
      money = {
        monthlyAmount: null,
        monthlyMargin: null,
        amount: data.amount ?? null,
        marginAmount: data.marginAmount ?? null,
        marginPercentage: computeMarginPercentage(
          data.amount ?? 0,
          data.marginAmount ?? 0,
        ),
        commissionAmount: null,
      };
    } else {
      const tcv = totalContractValue(data.monthlyAmount, data.termYears);
      const tcvMargin = totalContractValue(data.monthlyMargin, data.termYears);
      money = {
        monthlyAmount: data.monthlyAmount ?? null,
        monthlyMargin: data.monthlyMargin ?? null,
        amount: data.monthlyAmount != null ? tcv : null,
        marginAmount: data.monthlyMargin != null ? tcvMargin : null,
        marginPercentage: computeMarginPercentage(
          data.monthlyAmount ?? 0,
          data.monthlyMargin ?? 0,
        ),
        commissionAmount:
          data.monthlyAmount != null
            ? commissionAmount(data.line, data.termYears, data.monthlyAmount)
            : null,
      };
    }

    const fields = {
      line: data.line,
      name: data.name,
      accountName: data.accountName,
      monthlyAmount: money.monthlyAmount,
      monthlyMargin: money.monthlyMargin,
      amount: money.amount,
      marginAmount: money.marginAmount,
      marginPercentage: money.marginPercentage,
      commissionAmount: money.commissionAmount,
      termYears: data.termYears,
      billingFrequency: data.billingFrequency,
      stage: data.stage,
      probability,
      forecastCategory: data.forecastCategory,
      closeDate: data.closeDate,
      estimatedInvoiceDate: data.estimatedInvoiceDate ?? null,
      cashInDate: data.cashInDate ?? null,
      lockbox: data.lockbox,
      type: data.type ?? null,
      leadSource: data.leadSource ?? null,
      nextStep: data.nextStep ?? null,
      description: data.description ?? null,
    };

    if (data.id) {
      const existing = await prisma.crmOpportunity.findUniqueOrThrow({
        where: { id: data.id },
      });
      // Once a user changes ANY value, their numbers win from then on: lock the
      // whole record against future connector syncs. (Imports still use the
      // standard rules for untouched records; the padlock unlocks this one.)
      const changed = changedFormFields(existing, { ...fields, probability });
      const lockedFields =
        changed.length > 0 ? ALL_LOCKABLE_COLUMNS : existing.lockedFields;
      await prisma.crmOpportunity.update({
        where: { id: data.id },
        data: { ...fields, lockedFields, locallyModifiedAt: new Date() },
      });
      await audit({
        action: "OPPORTUNITY_UPDATED",
        actorId: actor.id,
        actorEmail: actor.email,
        target: `opportunity:${data.id}`,
        metadata: {
          name: data.name,
          line: data.line,
          stage: data.stage,
          from: existing.stage,
          lockedFields,
        },
      });
    } else {
      const created = await prisma.crmOpportunity.create({
        data: { ...fields, ownerId: actor.id, createdById: actor.id },
      });
      await audit({
        action: "OPPORTUNITY_CREATED",
        actorId: actor.id,
        actorEmail: actor.email,
        target: `opportunity:${created.id}`,
        metadata: { name: data.name, line: data.line, stage: data.stage },
      });
    }
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err), lineSlug };
  }

  revalidatePath("/crm/forecast");
  if (lineSlug) revalidatePath(`/crm/${lineSlug}`);
  redirect(`/crm/${lineSlug}`);
}

/** Which editable form fields changed vs the stored row (for field-level locks). */
function changedFormFields(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const numEq = (a: unknown, b: unknown) => {
    const an = a == null ? null : Number(a);
    const bn = b == null ? null : Number(b);
    return an === bn;
  };
  const dateEq = (a: unknown, b: unknown) => {
    const at = a instanceof Date ? a.getTime() : a == null ? null : new Date(a as string).getTime();
    const bt = b instanceof Date ? b.getTime() : b == null ? null : new Date(b as string).getTime();
    return at === bt;
  };
  const strEq = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

  const changed: string[] = [];
  if (!strEq(existing.name, next.name)) changed.push("name");
  if (!strEq(existing.accountName, next.accountName)) changed.push("accountName");
  if (!strEq(existing.line, next.line)) changed.push("line");
  if (!numEq(existing.monthlyAmount, next.monthlyAmount)) changed.push("monthlyAmount");
  if (!numEq(existing.monthlyMargin, next.monthlyMargin)) changed.push("monthlyMargin");
  if (existing.termYears !== next.termYears) changed.push("termYears");
  if (!strEq(existing.billingFrequency, next.billingFrequency)) changed.push("billingFrequency");
  if (!strEq(existing.stage, next.stage)) changed.push("stage");
  if (existing.probability !== next.probability) changed.push("probability");
  if (!strEq(existing.forecastCategory, next.forecastCategory)) changed.push("forecastCategory");
  if (!dateEq(existing.closeDate, next.closeDate)) changed.push("closeDate");
  if (!dateEq(existing.estimatedInvoiceDate, next.estimatedInvoiceDate)) changed.push("estimatedInvoiceDate");
  if (!dateEq(existing.cashInDate, next.cashInDate)) changed.push("cashInDate");
  if (existing.lockbox !== next.lockbox) changed.push("lockbox");
  if (!strEq(existing.type, next.type)) changed.push("type");
  if (!strEq(existing.leadSource, next.leadSource)) changed.push("leadSource");
  if (!strEq(existing.nextStep, next.nextStep)) changed.push("nextStep");
  if (!strEq(existing.description, next.description)) changed.push("description");
  return changed;
}

/**
 * Lock or unlock ALL of an opportunity's fields from connector sync (the
 * padlock). Locking sets every lockable column; unlocking clears them so the
 * row syncs freely again. Per-field locks are managed automatically on edit.
 */
export async function setOpportunityLockAction(id: string, lock: boolean): Promise<void> {
  const actor = await requirePermission("crm:write");
  const existing = await prisma.crmOpportunity.findUniqueOrThrow({
    where: { id },
    select: { line: true, name: true },
  });
  await prisma.crmOpportunity.update({
    where: { id },
    data: {
      lockedFields: lock ? ALL_LOCKABLE_COLUMNS : [],
      locallyModifiedAt: lock ? new Date() : null,
    },
  });
  await audit({
    action: "OPPORTUNITY_UPDATED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: `opportunity:${id}`,
    metadata: { name: existing.name, line: existing.line, locked: lock },
  });
  revalidatePath("/crm/forecast");
  revalidatePath(`/crm/${CRM_LINES[existing.line].slug}`);
}

const deleteSchema = z.object({ id: z.string().min(1) });

/** Delete an opportunity. */
export async function deleteOpportunityAction(formData: FormData): Promise<void> {
  const actor = await requirePermission("crm:write");
  const { id } = deleteSchema.parse({ id: formData.get("id") });
  const existing = await prisma.crmOpportunity.findUniqueOrThrow({ where: { id } });
  await prisma.crmOpportunity.delete({ where: { id } });
  await audit({
    action: "OPPORTUNITY_DELETED",
    actorId: actor.id,
    actorEmail: actor.email,
    target: `opportunity:${id}`,
    metadata: { name: existing.name, line: existing.line },
  });
  revalidatePath("/crm/forecast");
  revalidatePath(`/crm/${CRM_LINES[existing.line].slug}`);
  redirect(`/crm/${CRM_LINES[existing.line].slug}`);
}
