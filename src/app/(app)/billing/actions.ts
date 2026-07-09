"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { BillingRunStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import { computeLine } from "@/lib/billing/line";
import {
  generateAndSaveBillingRun,
  transitionBillingRun,
} from "@/lib/billing/service";

export interface BillingActionResult {
  ok: boolean;
  message: string;
}

/** Per-client outcome of a bulk generate. */
export interface BulkRunResult {
  ok: boolean;
  message: string;
  results?: {
    clientName: string;
    ok: boolean;
    runId?: string;
    lines?: number;
    error?: string;
  }[];
}

type PeriodInput = {
  mode: "monthly" | "custom";
  month?: string;
  start?: string;
  end?: string;
};

const createSchema = z
  .object({
    clientId: z.string().min(1, "Select a client"),
    mode: z.enum(["monthly", "custom"]),
    month: z.string().optional(), // YYYY-MM
    start: z.string().optional(), // YYYY-MM-DD
    end: z.string().optional(),
    invoiceDate: z.string().optional(),
  })
  .refine((v) => (v.mode === "monthly" ? !!v.month : !!v.start && !!v.end), {
    message: "Provide a month, or a custom start and end date",
  });

function utcDate(s: string): Date {
  return new Date(s + "T00:00:00.000Z");
}

/** Resolve the half-open billing period [start, end) from the form inputs. */
function resolvePeriod(input: PeriodInput): {
  periodStart: Date;
  periodEnd: Date;
} {
  if (input.mode === "monthly") {
    const [y, m] = input.month!.split("-").map(Number);
    return {
      periodStart: new Date(Date.UTC(y!, m! - 1, 1)),
      periodEnd: new Date(Date.UTC(y!, m!, 1)), // first day of next month
    };
  }
  return { periodStart: utcDate(input.start!), periodEnd: utcDate(input.end!) };
}

export async function createBillingRunAction(
  _prev: BillingActionResult | null,
  formData: FormData,
): Promise<BillingActionResult> {
  const user = await requirePermission("billing:edit");
  let runId: string;
  try {
    const input = createSchema.parse({
      clientId: formData.get("clientId"),
      mode: formData.get("mode"),
      month: formData.get("month") || undefined,
      start: formData.get("start") || undefined,
      end: formData.get("end") || undefined,
      invoiceDate: formData.get("invoiceDate") || undefined,
    });
    const { periodStart, periodEnd } = resolvePeriod(input);
    const invoiceDate = input.invoiceDate
      ? utcDate(input.invoiceDate)
      : periodStart;

    runId = await generateAndSaveBillingRun({
      clientId: input.clientId,
      periodStart,
      periodEnd,
      invoiceDate,
      actor: { id: user.id, email: user.email },
    });
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
  // Outside the try so Next's redirect control-flow isn't caught as an error.
  redirect(`/billing/${runId}`);
}

/** Statuses that are safe to bulk-delete: not-yet-committed work only. */
const CLEARABLE_STATUSES: BillingRunStatus[] = ["DRAFT", "CANCELLED"];

/**
 * Clear the billing-run log of all DRAFT and CANCELLED runs in one action.
 * Committed runs (REVIEWED/APPROVED/PUSHED/PARTIALLY_FAILED) are never touched.
 * Lines and edit history cascade-delete with the run. Gated by billing:edit and
 * audited.
 */
export async function clearInactiveBillingRunsAction(
  _prev: BillingActionResult | null,
  _formData: FormData,
): Promise<BillingActionResult> {
  const user = await requirePermission("billing:edit");
  try {
    const targets = await prisma.billingRun.findMany({
      where: { status: { in: CLEARABLE_STATUSES } },
      select: { id: true },
    });
    if (targets.length === 0) {
      return { ok: true, message: "No draft or cancelled runs to clear." };
    }
    const { count } = await prisma.billingRun.deleteMany({
      where: { status: { in: CLEARABLE_STATUSES } },
    });
    await audit({
      action: "BILLING_RUN_DELETED",
      actorId: user.id,
      actorEmail: user.email,
      target: "billingRun:draft+cancelled",
      metadata: { count, ids: targets.map((t) => t.id) },
    });
    revalidatePath("/billing");
    return {
      ok: true,
      message: `Cleared ${count} draft/cancelled run${count === 1 ? "" : "s"}.`,
    };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

export async function transitionRunAction(formData: FormData): Promise<void> {
  const user = await requirePermission("billing:approve");
  const runId = z.string().min(1).parse(formData.get("runId"));
  const to = String(formData.get("to")) as BillingRunStatus;
  await transitionBillingRun(runId, to, { id: user.id, email: user.email });
  revalidatePath(`/billing/${runId}`);
}

/** Approve-gated push of the run to QuickBooks Online. */
export async function pushRunAction(formData: FormData): Promise<void> {
  const user = await requirePermission("billing:push");
  const runId = z.string().min(1).parse(formData.get("runId"));
  const { pushBillingRunToQbo } = await import("@/lib/billing/push");
  await pushBillingRunToQbo(runId, { id: user.id, email: user.email });
  revalidatePath(`/billing/${runId}`);
}

// ---------------------------------------------------------------------------
// Inline line editing
// ---------------------------------------------------------------------------

const lineEditSchema = z.object({
  lineId: z.string().min(1),
  description: z.string().trim().min(1, "Description is required").max(500),
  quantity: z.coerce.number().min(0, "Quantity must be 0 or more"),
  unitPrice: z.coerce.number().min(0, "Unit price must be 0 or more"),
  discount: z.coerce.number().min(0, "Discount must be 0 or more"),
  adjustment: z.coerce.number(), // may be negative
});

/**
 * Edit a single billing line on a DRAFT run. Recomputes subtotal/total from the
 * pure line engine (never trusts client math), keeps the line's stored proration
 * factor, records a field-level edit history, and audits the change.
 */
export async function updateBillingLineAction(
  _prev: BillingActionResult | null,
  formData: FormData,
): Promise<BillingActionResult> {
  const user = await requirePermission("billing:edit");
  try {
    const input = lineEditSchema.parse({
      lineId: formData.get("lineId"),
      description: formData.get("description"),
      quantity: formData.get("quantity"),
      unitPrice: formData.get("unitPrice"),
      discount: formData.get("discount"),
      adjustment: formData.get("adjustment"),
    });

    const line = await prisma.billingLine.findUniqueOrThrow({
      where: { id: input.lineId },
      include: { billingRun: { select: { status: true } } },
    });
    if (line.billingRun.status !== "DRAFT") {
      throw new Error("Lines can only be edited while the run is a draft.");
    }

    const factor = Number(line.prorationFactor);
    const { subtotal, total } = computeLine({
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      prorationFactor: factor,
      discount: input.discount,
      adjustment: input.adjustment,
    });

    // Diff old vs new to record only fields that actually changed.
    const changes: { field: string; oldValue: string; newValue: string }[] = [];
    const track = (field: string, oldV: string | number, newV: string | number) => {
      if (String(oldV) !== String(newV)) {
        changes.push({ field, oldValue: String(oldV), newValue: String(newV) });
      }
    };
    track("description", line.description, input.description);
    track("quantity", Number(line.quantity), input.quantity);
    track("unitPrice", Number(line.unitPrice), input.unitPrice);
    track("discount", Number(line.discount), input.discount);
    track("adjustment", Number(line.adjustment), input.adjustment);

    if (changes.length === 0) return { ok: true, message: "No changes." };

    await prisma.$transaction([
      prisma.billingLine.update({
        where: { id: line.id },
        data: {
          description: input.description,
          quantity: input.quantity,
          unitPrice: input.unitPrice,
          discount: input.discount,
          adjustment: input.adjustment,
          subtotal,
          total,
        },
      }),
      prisma.billingLineEdit.createMany({
        data: changes.map((c) => ({
          billingRunId: line.billingRunId,
          billingLineId: line.id,
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
      target: `billingLine:${line.id}`,
      metadata: { runId: line.billingRunId, fields: changes.map((c) => c.field) },
    });

    revalidatePath(`/billing/${line.billingRunId}`);
    return { ok: true, message: "Line updated." };
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Bulk multi-client generation
// ---------------------------------------------------------------------------

const bulkSchema = z
  .object({
    clientIds: z.array(z.string().min(1)).min(1, "Select at least one client"),
    mode: z.enum(["monthly", "custom"]),
    month: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    invoiceDate: z.string().optional(),
  })
  .refine((v) => (v.mode === "monthly" ? !!v.month : !!v.start && !!v.end), {
    message: "Provide a month, or a custom start and end date",
  });

/**
 * Generate a DRAFT billing run for each selected client in one action. One
 * client failing (e.g. no linked subscriptions) does not fail the batch — each
 * outcome is reported so the user sees exactly what was created and what wasn't.
 */
export async function createBulkBillingRunsAction(
  _prev: BulkRunResult | null,
  formData: FormData,
): Promise<BulkRunResult> {
  const user = await requirePermission("billing:edit");
  let input: z.infer<typeof bulkSchema>;
  try {
    input = bulkSchema.parse({
      clientIds: formData.getAll("clientIds").map(String),
      mode: formData.get("mode"),
      month: formData.get("month") || undefined,
      start: formData.get("start") || undefined,
      end: formData.get("end") || undefined,
      invoiceDate: formData.get("invoiceDate") || undefined,
    });
  } catch (err) {
    return { ok: false, message: safeErrorMessage(err) };
  }

  const { periodStart, periodEnd } = resolvePeriod(input);
  const invoiceDate = input.invoiceDate ? utcDate(input.invoiceDate) : periodStart;

  const nameById = new Map(
    (
      await prisma.client.findMany({
        where: { id: { in: input.clientIds } },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name]),
  );

  const results: NonNullable<BulkRunResult["results"]> = [];
  for (const clientId of input.clientIds) {
    const clientName = nameById.get(clientId) ?? clientId;
    try {
      const runId = await generateAndSaveBillingRun({
        clientId,
        periodStart,
        periodEnd,
        invoiceDate,
        actor: { id: user.id, email: user.email },
      });
      const lines = await prisma.billingLine.count({ where: { billingRunId: runId } });
      results.push({ clientName, ok: true, runId, lines });
    } catch (err) {
      results.push({ clientName, ok: false, error: safeErrorMessage(err) });
    }
  }

  revalidatePath("/billing");
  const created = results.filter((r) => r.ok).length;
  const failed = results.length - created;
  return {
    ok: created > 0,
    message: `Generated ${created} draft run${created === 1 ? "" : "s"}${
      failed > 0 ? `, ${failed} failed` : ""
    }.`,
    results,
  };
}
