"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { BillingRunStatus } from "@prisma/client";
import { requirePermission } from "@/lib/auth/session";
import { safeErrorMessage } from "@/lib/redact";
import {
  generateAndSaveBillingRun,
  transitionBillingRun,
} from "@/lib/billing/service";

export interface BillingActionResult {
  ok: boolean;
  message: string;
}

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
function resolvePeriod(input: z.infer<typeof createSchema>): {
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
