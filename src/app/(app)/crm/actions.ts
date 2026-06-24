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
import { CRM_LINES, STAGE_PROBABILITY } from "@/lib/crm/constants";
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
  line: z.nativeEnum(CrmLine),
  name: z.string().trim().min(1, "Opportunity Name is required"),
  accountName: z.string().trim().min(1, "Account Name is required"),
  monthlyAmount: numberish,
  monthlyMargin: numberish,
  termYears: z.coerce.number().int().refine((n) => [1, 2, 3].includes(n), {
    message: "Term must be 1, 2 or 3 years",
  }),
  billingFrequency: z.nativeEnum(CrmBillingFrequency),
  stage: z.nativeEnum(CrmStage),
  probability: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(100).optional(),
  ),
  forecastCategory: z.nativeEnum(CrmForecastCategory),
  closeDate: z.coerce.date({ message: "Close Date is required" }),
  estimatedInvoiceDate: dateish,
  cashInDate: dateish,
  lockbox: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  type: z.preprocess(emptyToUndefined, z.nativeEnum(CrmOpportunityType).optional()),
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

    // Derive TCV, contract-level margin, margin % and commission from the
    // monthly figures the user entered.
    const tcv = totalContractValue(data.monthlyAmount, data.termYears);
    const tcvMargin = totalContractValue(data.monthlyMargin, data.termYears);
    const marginPercentage = computeMarginPercentage(
      data.monthlyAmount ?? 0,
      data.monthlyMargin ?? 0,
    );
    const commission = commissionAmount(
      data.line,
      data.termYears,
      data.monthlyAmount,
    );

    const fields = {
      line: data.line,
      name: data.name,
      accountName: data.accountName,
      monthlyAmount: data.monthlyAmount ?? null,
      monthlyMargin: data.monthlyMargin ?? null,
      amount: data.monthlyAmount != null ? tcv : null,
      marginAmount: data.monthlyMargin != null ? tcvMargin : null,
      marginPercentage,
      commissionAmount: data.monthlyAmount != null ? commission : null,
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
      await prisma.crmOpportunity.update({ where: { id: data.id }, data: fields });
      await audit({
        action: "OPPORTUNITY_UPDATED",
        actorId: actor.id,
        actorEmail: actor.email,
        target: `opportunity:${data.id}`,
        metadata: { name: data.name, line: data.line, stage: data.stage, from: existing.stage },
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
