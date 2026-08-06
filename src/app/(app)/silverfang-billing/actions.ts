"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SfBillingRunStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { computeLine } from "@/lib/billing/line";
import {
  generateAndSaveSfBillingRun,
  transitionSfBillingRun,
} from "@/lib/sfbilling/service";
import { linesEditable } from "@/lib/sfbilling/state";

/**
 * SilverFang Billing actions.
 *
 * Same shapes as the M365 billing actions: `(prev, formData) => Result` for
 * `useActionState` forms, `(formData) => void` for plain button forms, permission
 * checked first, zod inside the try, `safeErrorMessage` on the way out.
 */

export interface SfBillingActionResult {
  ok: boolean;
  message: string;
}

export interface SfBulkRunResult {
  ok: boolean;
  message: string;
  results?: { clientName: string; ok: boolean; runId?: string; lines?: number; error?: string }[];
}

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

function formValue(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
}

/** Dates arrive as `YYYY-MM-DD`; treat them as UTC midnight so periods are stable. */
function utcDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

const createSchema = z.object({
  clientId: z.string().min(1, "Select a client"),
  /** `YYYY-MM` for a calendar month, or explicit start/end. */
  month: z.preprocess(emptyToUndefined, z.string().regex(/^\d{4}-\d{2}$/).optional()),
  periodStart: z.preprocess(emptyToUndefined, z.string().optional()),
  periodEnd: z.preprocess(emptyToUndefined, z.string().optional()),
  invoiceDate: z.string().min(1, "An invoice date is required"),
  groupBy: z.preprocess(
    emptyToUndefined,
    z.enum(["CHARGE_CODE", "TICKET"]).optional(),
  ),
});

/**
 * Resolve the billing period as the half-open interval [start, end) — the same
 * convention the M365 runs use, so "July" never double-counts 1 August.
 */
function resolvePeriod(input: z.infer<typeof createSchema>): {
  periodStart: Date;
  periodEnd: Date;
} {
  if (input.month) {
    const [y, m] = input.month.split("-").map(Number);
    const periodStart = new Date(Date.UTC(y!, m! - 1, 1));
    const periodEnd = new Date(Date.UTC(y!, m!, 1));
    return { periodStart, periodEnd };
  }
  if (!input.periodStart || !input.periodEnd) {
    throw new Error("Choose a month, or give both a start and an end date.");
  }
  const periodStart = utcDate(input.periodStart);
  // The form's end date is inclusive, as a human would mean it; the interval is
  // half-open, so add a day.
  const periodEnd = new Date(utcDate(input.periodEnd).getTime() + 86_400_000);
  if (periodEnd <= periodStart) {
    throw new Error("The period end cannot be before the period start.");
  }
  return { periodStart, periodEnd };
}

/** Create a run for one client, then open it. */
export async function createSfBillingRunAction(
  _prev: SfBillingActionResult | null,
  formData: FormData,
): Promise<SfBillingActionResult> {
  const user = await requirePermission("billing:edit");
  let runId: string;
  try {
    const input = createSchema.parse({
      clientId: formValue(formData, "clientId"),
      month: formValue(formData, "month"),
      periodStart: formValue(formData, "periodStart"),
      periodEnd: formValue(formData, "periodEnd"),
      invoiceDate: formValue(formData, "invoiceDate"),
      groupBy: formValue(formData, "groupBy"),
    });
    const { periodStart, periodEnd } = resolvePeriod(input);

    const result = await generateAndSaveSfBillingRun({
      clientId: input.clientId,
      periodStart,
      periodEnd,
      invoiceDate: utcDate(input.invoiceDate),
      groupBy: input.groupBy,
      actor: { id: user.id, email: user.email },
    });
    runId = result.runId;
    revalidatePath("/silverfang-billing");
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
  redirect(`/silverfang-billing/${runId}`);
}

/**
 * Create a run for each selected client. One client failing never fails the
 * batch — each result is reported, so a bad agreement on one client does not
 * cost you the other twenty runs.
 */
export async function createBulkSfBillingRunsAction(
  _prev: SfBulkRunResult | null,
  formData: FormData,
): Promise<SfBulkRunResult> {
  const user = await requirePermission("billing:edit");
  try {
    const clientIds = formData.getAll("clientIds").filter((v): v is string => typeof v === "string");
    if (clientIds.length === 0) {
      return { ok: false, message: "Select at least one client." };
    }
    const input = createSchema.parse({
      clientId: clientIds[0],
      month: formValue(formData, "month"),
      periodStart: formValue(formData, "periodStart"),
      periodEnd: formValue(formData, "periodEnd"),
      invoiceDate: formValue(formData, "invoiceDate"),
      groupBy: formValue(formData, "groupBy"),
    });
    const { periodStart, periodEnd } = resolvePeriod(input);
    const invoiceDate = utcDate(input.invoiceDate);

    const clients = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const results: NonNullable<SfBulkRunResult["results"]> = [];
    for (const c of clients) {
      try {
        const r = await generateAndSaveSfBillingRun({
          clientId: c.id,
          periodStart,
          periodEnd,
          invoiceDate,
          groupBy: input.groupBy,
          actor: { id: user.id, email: user.email },
        });
        results.push({ clientName: c.name, ok: true, runId: r.runId, lines: r.lines });
      } catch (err) {
        results.push({ clientName: c.name, ok: false, error: safeErrorMessage(err) });
      }
    }
    revalidatePath("/silverfang-billing");

    const made = results.filter((r) => r.ok).length;
    const empty = results.filter((r) => r.ok && (r.lines ?? 0) === 0).length;
    return {
      ok: made > 0,
      message:
        `Created ${made} run(s) of ${clients.length}.` +
        (empty > 0 ? ` ${empty} had nothing to bill.` : "") +
        (made < clients.length ? ` ${clients.length - made} failed — see below.` : ""),
      results,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/** Move a run through the state machine. */
export async function transitionSfRunAction(formData: FormData): Promise<void> {
  const user = await requirePermission("billing:approve");
  const runId = z.string().min(1).parse(formData.get("runId"));
  const to = z.enum(SfBillingRunStatus).parse(formData.get("to"));
  await transitionSfBillingRun(runId, to, { id: user.id, email: user.email });
  revalidatePath("/silverfang-billing");
  revalidatePath(`/silverfang-billing/${runId}`);
}

/**
 * Push an approved run to QuickBooks. Imported dynamically so the QBO client and
 * its transitive deps stay out of the page bundle graph.
 */
export async function pushSfRunAction(formData: FormData): Promise<void> {
  const user = await requirePermission("billing:push");
  const runId = z.string().min(1).parse(formData.get("runId"));
  const { pushSfBillingRunToQbo } = await import("@/lib/sfbilling/push");
  await pushSfBillingRunToQbo(runId, { id: user.id, email: user.email });
  revalidatePath("/silverfang-billing");
  revalidatePath(`/silverfang-billing/${runId}`);
}

const lineEditSchema = z.object({
  lineId: z.string().min(1),
  description: z.string().trim().min(1, "A description is required").max(2_000),
  quantity: z.coerce.number().min(0).max(1_000_000),
  unitPrice: z.coerce.number().min(0).max(10_000_000),
  discount: z.coerce.number().min(0).max(10_000_000),
  adjustment: z.coerce.number().min(-10_000_000).max(10_000_000),
  qboItemId: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
});

/**
 * Edit one line. Only while the run is DRAFT: once it has been reviewed, the
 * numbers someone signed off on must not move under them. Every change is
 * recorded field by field.
 */
export async function updateSfBillingLineAction(
  _prev: SfBillingActionResult | null,
  formData: FormData,
): Promise<SfBillingActionResult> {
  const user = await requirePermission("billing:edit");
  try {
    const input = lineEditSchema.parse({
      lineId: formValue(formData, "lineId"),
      description: formValue(formData, "description"),
      quantity: formValue(formData, "quantity"),
      unitPrice: formValue(formData, "unitPrice"),
      discount: formValue(formData, "discount") ?? 0,
      adjustment: formValue(formData, "adjustment") ?? 0,
      qboItemId: formValue(formData, "qboItemId"),
    });

    const line = await prisma.sfBillingLine.findUnique({
      where: { id: input.lineId },
      include: { run: { select: { id: true, status: true } } },
    });
    if (!line) return { ok: false, message: "That line no longer exists." };
    if (!linesEditable(line.run.status)) {
      return {
        ok: false,
        message: `Lines can only be edited while the run is a draft — this one is ${line.run.status}.`,
      };
    }

    const { subtotal, total } = computeLine({
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      discount: input.discount,
      adjustment: input.adjustment,
    });

    const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];
    const track = (field: string, oldV: unknown, newV: unknown) => {
      const a = oldV == null ? null : String(oldV);
      const b = newV == null ? null : String(newV);
      if (a !== b) changes.push({ field, oldValue: a, newValue: b });
    };
    track("description", line.description, input.description);
    track("quantity", Number(line.quantity), input.quantity);
    track("unitPrice", Number(line.unitPrice), input.unitPrice);
    track("discount", Number(line.discount), input.discount);
    track("adjustment", Number(line.adjustment), input.adjustment);
    track("qboItemId", line.qboItemId, input.qboItemId ?? null);

    if (changes.length === 0) return { ok: true, message: "No changes to save." };

    await prisma.$transaction([
      prisma.sfBillingLine.update({
        where: { id: input.lineId },
        data: {
          description: input.description,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          discount: input.discount,
          adjustment: input.adjustment,
          qboItemId: input.qboItemId ?? null,
          subtotal,
          total,
        },
      }),
      prisma.sfBillingLineEdit.createMany({
        data: changes.map((c) => ({
          runId: line.run.id,
          lineId: line.id,
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          editedById: user.id,
          editedByEmail: user.email,
        })),
      }),
    ]);

    await audit({
      action: "BILLING_LINE_EDITED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfBillingRun:${line.run.id}`,
      metadata: { source: "silverfang", lineId: line.id, fields: changes.map((c) => c.field) },
    });
    revalidatePath(`/silverfang-billing/${line.run.id}`);
    return { ok: true, message: `Saved ${changes.map((c) => c.field).join(", ")}.` };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

/**
 * Delete a draft or cancelled run. Refused for anything that has been pushed —
 * a pushed run is the record of an invoice that exists in QuickBooks.
 */
export async function deleteSfBillingRunAction(formData: FormData): Promise<void> {
  const user = await requirePermission("billing:edit");
  const runId = z.string().min(1).parse(formData.get("runId"));
  const run = await prisma.sfBillingRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true },
  });
  if (!run) return;
  if (run.status !== "DRAFT" && run.status !== "CANCELLED") return;

  await prisma.sfBillingRun.delete({ where: { id: runId } });
  await audit({
    action: "BILLING_RUN_DELETED",
    actorId: user.id,
    actorEmail: user.email,
    target: `sfBillingRun:${runId}`,
    metadata: { source: "silverfang", status: run.status },
  });
  revalidatePath("/silverfang-billing");
  redirect("/silverfang-billing");
}

const kindMapSchema = z.object({
  kind: z.enum([
    "TIME",
    "OVERAGE",
    "RECURRING",
    "BLOCK_PURCHASE",
    "PROJECT_FEE",
    "PROJECT_DEPOSIT",
    "MANUAL",
  ]),
  qboItemId: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
});

/** Map a line kind to a QuickBooks item, so those lines become pushable. */
export async function saveSfKindItemMapAction(
  _prev: SfBillingActionResult | null,
  formData: FormData,
): Promise<SfBillingActionResult> {
  const user = await requirePermission("billing:edit");
  try {
    const input = kindMapSchema.parse({
      kind: formValue(formData, "kind"),
      qboItemId: formValue(formData, "qboItemId"),
    });
    const item = input.qboItemId
      ? await prisma.qboItem.findUnique({
          where: { qboId: input.qboItemId },
          select: { name: true },
        })
      : null;

    await prisma.sfBillingKindItemMap.upsert({
      where: { kind: input.kind },
      create: { kind: input.kind, qboItemId: input.qboItemId ?? null, qboItemName: item?.name ?? null },
      update: { qboItemId: input.qboItemId ?? null, qboItemName: item?.name ?? null },
    });
    await audit({
      action: "MAPPING_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfBilling:kindMap:${input.kind}`,
      metadata: { qboItemId: input.qboItemId ?? null },
    });
    revalidatePath("/silverfang-billing/settings");
    return {
      ok: true,
      message: input.qboItemId
        ? `${input.kind} lines will push as “${item?.name ?? input.qboItemId}”.`
        : `${input.kind} lines have no item and will be skipped at push.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

const codeMapSchema = z.object({
  chargeCodeId: z.string().min(1),
  qboItemId: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
});

/** Map a charge code to a QuickBooks item. */
export async function saveSfChargeCodeItemMapAction(
  _prev: SfBillingActionResult | null,
  formData: FormData,
): Promise<SfBillingActionResult> {
  const user = await requirePermission("billing:edit");
  try {
    const input = codeMapSchema.parse({
      chargeCodeId: formValue(formData, "chargeCodeId"),
      qboItemId: formValue(formData, "qboItemId"),
    });
    const [code, item] = await Promise.all([
      prisma.sfChargeCode.findUnique({
        where: { id: input.chargeCodeId },
        select: { name: true },
      }),
      input.qboItemId
        ? prisma.qboItem.findUnique({
            where: { qboId: input.qboItemId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
    if (!code) return { ok: false, message: "That charge code no longer exists." };

    await prisma.sfChargeCodeItemMap.upsert({
      where: { chargeCodeId: input.chargeCodeId },
      create: {
        chargeCodeId: input.chargeCodeId,
        qboItemId: input.qboItemId ?? null,
        qboItemName: item?.name ?? null,
      },
      update: { qboItemId: input.qboItemId ?? null, qboItemName: item?.name ?? null },
    });
    await audit({
      action: "MAPPING_CHANGED",
      actorId: user.id,
      actorEmail: user.email,
      target: `sfBilling:chargeCode:${input.chargeCodeId}`,
      metadata: { qboItemId: input.qboItemId ?? null },
    });
    revalidatePath("/silverfang-billing/settings");
    return {
      ok: true,
      message: input.qboItemId
        ? `${code.name} will push as “${item?.name ?? input.qboItemId}”.`
        : `${code.name} has no item and its lines will be skipped at push.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}
