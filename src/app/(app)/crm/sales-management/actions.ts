"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { safeErrorMessage } from "@/lib/redact";
import { quotaPeriodLabel } from "@/lib/crm/quota";

export interface QuotaActionResult {
  ok: boolean;
  message: string;
}

const quotaSchema = z.object({
  userId: z.string().min(1, "Select a salesperson"),
  year: z.coerce.number().int().min(2020).max(2100),
  quarter: z.coerce.number().int().min(0).max(4),
  targetAmount: z.coerce.number().min(0, "Target must be zero or positive"),
});

/** Create or update a quota target for a salesperson + period. */
export async function setQuotaAction(
  _prev: QuotaActionResult | null,
  formData: FormData,
): Promise<QuotaActionResult> {
  const actor = await requirePermission("crm:manage");
  try {
    const data = quotaSchema.parse({
      userId: formData.get("userId"),
      year: formData.get("year"),
      quarter: formData.get("quarter"),
      targetAmount: formData.get("targetAmount"),
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: data.userId },
      select: { name: true, email: true },
    });
    await prisma.salesQuota.upsert({
      where: {
        userId_year_quarter: {
          userId: data.userId,
          year: data.year,
          quarter: data.quarter,
        },
      },
      create: {
        userId: data.userId,
        year: data.year,
        quarter: data.quarter,
        targetAmount: data.targetAmount,
      },
      update: { targetAmount: data.targetAmount },
    });
    await audit({
      action: "QUOTA_SET",
      actorId: actor.id,
      actorEmail: actor.email,
      target: `quota:${data.userId}:${data.year}:${data.quarter}`,
      metadata: {
        salesperson: user.name ?? user.email,
        year: data.year,
        period: quotaPeriodLabel(data.quarter),
        targetAmount: data.targetAmount,
      },
    });
    revalidatePath("/crm/sales-management");
    return {
      ok: true,
      message: `Quota saved: ${user.name ?? user.email} · ${data.year} ${quotaPeriodLabel(data.quarter)}.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const repCompSchema = z.object({
  userId: z.string().min(1, "Missing salesperson"),
  baseSalary: z.coerce.number().min(0, "Base salary must be zero or positive"),
  productCommissionPct: z.coerce
    .number()
    .min(0)
    .max(100, "Product commission is a percentage (0–100)"),
  servicesCommissionMultiplier: z.coerce.number().min(0).max(10),
});

/** Create or update a salesperson's compensation settings. */
export async function setRepCompAction(
  _prev: QuotaActionResult | null,
  formData: FormData,
): Promise<QuotaActionResult> {
  const actor = await requirePermission("crm:manage");
  try {
    const data = repCompSchema.parse({
      userId: formData.get("userId"),
      baseSalary: formData.get("baseSalary"),
      productCommissionPct: formData.get("productCommissionPct"),
      servicesCommissionMultiplier: formData.get("servicesCommissionMultiplier"),
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: data.userId },
      select: { name: true, email: true },
    });
    await prisma.salesRepComp.upsert({
      where: { userId: data.userId },
      create: {
        userId: data.userId,
        baseSalary: data.baseSalary,
        productCommissionPct: data.productCommissionPct,
        servicesCommissionMultiplier: data.servicesCommissionMultiplier,
      },
      update: {
        baseSalary: data.baseSalary,
        productCommissionPct: data.productCommissionPct,
        servicesCommissionMultiplier: data.servicesCommissionMultiplier,
      },
    });
    await audit({
      action: "REP_COMP_SET",
      actorId: actor.id,
      actorEmail: actor.email,
      target: `repcomp:${data.userId}`,
      metadata: {
        salesperson: user.name ?? user.email,
        baseSalary: data.baseSalary,
        productCommissionPct: data.productCommissionPct,
        servicesCommissionMultiplier: data.servicesCommissionMultiplier,
      },
    });
    revalidatePath(`/crm/sales-management/${data.userId}`);
    revalidatePath("/crm/sales-management");
    return { ok: true, message: `Compensation saved for ${user.name ?? user.email}.` };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Remove a quota target. */
export async function deleteQuotaAction(formData: FormData): Promise<void> {
  const actor = await requirePermission("crm:manage");
  const id = String(formData.get("id"));
  const quota = await prisma.salesQuota.findUniqueOrThrow({
    where: { id },
    include: { user: { select: { name: true, email: true } } },
  });
  await prisma.salesQuota.delete({ where: { id } });
  await audit({
    action: "QUOTA_SET",
    actorId: actor.id,
    actorEmail: actor.email,
    target: `quota:${quota.userId}:${quota.year}:${quota.quarter}`,
    metadata: {
      salesperson: quota.user.name ?? quota.user.email,
      year: quota.year,
      period: quotaPeriodLabel(quota.quarter),
      deleted: true,
    },
  });
  revalidatePath("/crm/sales-management");
}
